import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { register } from 'node:module'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: { repo: { type: 'string' }, out: { type: 'string' } } })
const repo = path.resolve(values.repo ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const moduleUrl = file => pathToFileURL(path.join(repo, 'lib', file)).href
const runtimeUrl = moduleUrl('modules/teamSimulation/index.js')
const runtime = await import(runtimeUrl)
const { createEffectRuntime } = await import(moduleUrl('modules/teamSimulation/effects.js'))
const { requiredEffectSources, FRAME_TIERS, dpsWindowFrames, buildTeamRunReport } = runtime

const expected = { gameVersion: 'entry-synthetic', bundleId: 'entry-fixture', source: 'entry-fixture' }
const nonMoonIds = ['10000023', '10000021', '10000032', '10000031']
const actors = nonMoonIds.map((id, index) => ({ actorId: `entry${index}`, energy: 0, energyMax: 60 }))
const pack = {
  schemaVersion: 1, gameVersion: expected.gameVersion, source: 'entry-fixture',
  actions: {
    'entry0.normal': {
      id: 'entry0.normal', actorId: 'entry0', kind: 'normal', timing: { type: 'frames', frames: 60 },
      hits: [{ atFrame: 30, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }]
    }
  }
}
const moonEffects = {
  'artifact-set:400361:4pc': {
    id: 'artifact-set:400361:4pc', target: 'self', trigger: 'always', stacking: 'refresh',
    requiresMoonPhase: 'initial', stats: { cpct: 0.15 }
  },
  'artifact-set:400361:4pc-full': {
    id: 'artifact-set:400361:4pc-full', target: 'self', trigger: 'always', stacking: 'refresh',
    requiresMoonPhase: 'full', stats: { cpct: 0.3 }
  }
}

const appUrl = moduleUrl('apps/teamDamage.js')
const stubs = new Map([
  ['../components/config.js', 'export const getPluginConfig = () => ({ priority: 8000 });'],
  ['../model/TeamBuildAdapter.js', `export const readTeamBuilds = async () => ({
    status: 'raw-complete', issues: [], members: globalThis.__metaEntryFixture.members.map(m => ({ status: 'raw-complete', build: m.build }))
  });`],
  ['../model/TeamSimStore.js', `
    export { toRotation } from ${JSON.stringify(moduleUrl('model/TeamSimStore.js'))};
    export const findRotation = () => ({ rotationFile: globalThis.__metaEntryFixture.file, nearby: [], issues: [] });
    export const loadTeamPack = () => ({ status: 'ok', keys: globalThis.__metaEntryFixture.members.map(m => m.build.actorId), pack: globalThis.__metaEntryFixture.pack, issues: [] });
    export const loadPermanentData = build => ({ data: globalThis.__metaEntryFixture.members.find(m => m.build.actorId === build.actorId).permanentData });
    export const loadRoster = () => ({ characters: [] });
  `],
  ['../modules/teamSimulation/index.js', `
    export * from ${JSON.stringify(runtimeUrl)};
    import { simulateTeam as original } from ${JSON.stringify(runtimeUrl)};
    export function simulateTeam(input) {
      const result = original(input);
      globalThis.__metaEntryRuns.push({ input, result });
      return result;
    }
  `],
  ['../model/GoldenSet.js', 'export const loadGoldenSet = () => null;'],
  ['../modules/moduleGate.js', 'export const moduleGateReply = async () => false;'],
  ['../../../../lib/plugins/plugin.js', 'export default class Plugin { constructor(options) { this.options = options; } }']
])
// Intercept the app's external inputs. The original handler and all simulation/report implementations execute.
register(`data:text/javascript,${encodeURIComponent(`
  const appUrl = ${JSON.stringify(appUrl)};
  const stubs = new Map(${JSON.stringify([...stubs])});
  export function resolve(specifier, context, nextResolve) {
    if (context.parentURL === appUrl && stubs.has(specifier)) {
      return { url: 'data:text/javascript,' + encodeURIComponent(stubs.get(specifier)), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url)
const checks = []
const observations = {}
try {
  const { MetaTeamDamage } = await import(appUrl)
  const app = new MetaTeamDamage()
  const recording = {
    schemaVersion: 1, id: 'entry-recording-217', team: nonMoonIds, scheduler: 'fixed',
    measurementEndFrame: dpsWindowFrames(FRAME_TIERS['fps-217']),
    keymap: { version: 'entry-v1', bindings: { n: { actorId: 'entry0', actionId: 'entry0.normal' } } },
    recording: {
      schemaVersion: 1, frameTierId: 'fps-217', keymapVersion: 'entry-v1',
      gameVersion: expected.gameVersion, source: 'entry-fixture',
      start: { activeActorId: 'entry0', actors },
      events: [{ atMs: 0, key: 'n', phase: 'down' }, { atMs: 1500, key: 'n', phase: 'down' }]
    }
  }
  const recorded = await handle(app, { file: recording, pack, members: membersFor(nonMoonIds, false) })
  observations.recording217 = summarize(recorded)
  check('录制轴使用嵌套 fps-217 换算动作包', () => {
    assert.equal(recorded.run.timeline.hits[0].frame, 110)
    assert.equal(recorded.input.pack.actions['entry0.normal'].timing.frames, 220)
    assert.equal(recorded.report.window.tierId, 'fps-217')
  })

  for (const [tierId, hitFrame] of [['fps-60', 30], ['fps-217', 110]]) {
    const result = await handle(app, { file: sequenceFor(nonMoonIds, tierId), pack, members: membersFor(nonMoonIds, false) })
    observations[tierId] = summarize(result)
    check(`普通顺序轴 ${tierId} 保持正确帧档`, () => {
      assert.equal(result.run.timeline.hits[0].frame, hitFrame)
      assert.equal(result.report.window.tierId, tierId)
      assert.ok(result.reply.includes(tierId))
    })
  }

  const baseline = await handle(app, { file: sequenceFor(nonMoonIds), pack, members: membersFor(nonMoonIds, false) })
  observations.moonBaseline = summarize(baseline)
  for (const moon of [
    { name: 'zero', ids: nonMoonIds, phase: undefined, bonus: 0, label: null },
    { name: 'initial', ids: ['10000119', ...nonMoonIds.slice(1)], phase: 'initial', bonus: 0.15, label: '初辉' },
    { name: 'full', ids: ['10000119', '10000120', ...nonMoonIds.slice(2)], phase: 'full', bonus: 0.3, label: '满辉' }
  ]) {
    const result = await handle(app, { file: sequenceFor(moon.ids), pack, members: membersFor(moon.ids) })
    observations[moon.name] = summarize(result)
    check(`月相 ${moon.name} 的数值与报告一致`, () => {
      assert.equal(result.input.moonPhase, moon.phase)
      assert.equal(result.run.timeline.hits[0].modifiers.stats.cpct ?? 0, moon.bonus)
      assert.equal(result.report.moonPhase, moon.phase ?? null)
      if (moon.label) assert.ok(result.reply.includes(`月相：${moon.label}`))
      else {
        assert.equal(result.run.damage.total, baseline.run.damage.total)
        assert.equal(result.reply.includes('月相：'), false)
      }
    })
  }

  const effectRuntime = createEffectRuntime(moonEffects, ['entry0'], 100)
  for (const id of Object.keys(moonEffects)) effectRuntime.trigger(id, 0, 'entry0')
  check('低层 modifiersAt 未传月相保留 initial 默认', () => {
    assert.equal(effectRuntime.modifiersAt('entry0', 1).stats.cpct, 0.15)
  })
  check('低层显式 none 关闭月相效果', () => {
    assert.equal(effectRuntime.modifiersAt('entry0', 1, { moonPhase: 'none' }).stats.cpct ?? 0, 0)
  })
} finally {
  delete globalThis.__metaEntryFixture
  delete globalThis.__metaEntryRuns
}

const result = {
  repo,
  boundary: 'Original app handler, parser, moon list, toRotation, simulateTeam and report. Synthetic four-member input boundaries. Framework/config/module gate/golden loading are offline substitutes. Replies captured in memory. No source/data writes or business network.',
  summary: { passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length, total: checks.length },
  checks,
  observations
}
if (values.out) {
  const outputPath = path.resolve(values.out)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
}
for (const item of checks) console.log(`${item.passed ? '✓' : '✗'} ${item.name}${item.error ? `\n${item.error}` : ''}`)
console.log(`入口传播 ${result.summary.passed}/${checks.length} 通过`)
process.exitCode = result.summary.failed ? 1 : 0

function check(name, assertion) {
  try {
    assertion()
    checks.push({ name, passed: true })
  } catch (error) {
    checks.push({ name, passed: false, error: error.message })
  }
}

async function handle(app, fixture) {
  globalThis.__metaEntryFixture = fixture
  globalThis.__metaEntryRuns = []
  const replies = []
  const handled = await app.handleTeamDamage({
    msg: '#队伍伤害 香菱 安柏 班尼特 菲谢尔', reply: async value => { replies.push(value) }
  })
  assert.equal(handled, true)
  assert.equal(replies.length, 1)
  assert.equal(globalThis.__metaEntryRuns.length, 1, replies[0])
  const { input, result: run } = globalThis.__metaEntryRuns[0]
  assert.equal(run.status, 'calculated', JSON.stringify(run.issues))
  assert.equal(input.members.length, 4)
  return { input, run, report: buildTeamRunReport(run), reply: replies[0] }
}

function summarize(result) {
  return {
    tier: result.report.window.tierId,
    hitFrames: result.run.timeline.hits.map(hit => hit.frame),
    cpctBonus: result.run.timeline.hits[0].modifiers.stats.cpct ?? 0,
    total: result.run.damage.total,
    phase: result.report.moonPhase,
    reportLines: result.reply.split('\n').filter(line => /^(?:月相|窗口|命中|DPS：)/.test(line))
  }
}

function sequenceFor(ids, frameTierId = 'fps-60') {
  return {
    schemaVersion: 1, id: `entry-sequence-${frameTierId}`, team: ids, frameTierId,
    measurementEndFrame: dpsWindowFrames(FRAME_TIERS[frameTierId]),
    sequence: ['entry0.normal'], actors
  }
}

function membersFor(ids, includeEffects = true) {
  const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
  const mains = [
    { key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'atkPct', value: 0.466 },
    { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.622 }
  ]
  const subs = mains.map(main => [
    { key: main.key === 'atkPct' ? 'atk' : 'atkPct', value: main.key === 'atkPct' ? 20 : 0.05 },
    { key: 'cpct', value: 0.03 },
    { key: main.key === 'cdmg' ? 'mastery' : 'cdmg', value: main.key === 'cdmg' ? 20 : 0.06 },
    { key: 'recharge', value: 0.05 }
  ])
  return ids.map((characterId, index) => {
    const build = {
      schemaVersion: 1, actorId: `entry${index}`, characterId, name: `Entry ${index}`, element: 'geo',
      level: 90, ascension: 6, constellation: 0, talents: { normal: 9, skill: 9, burst: 9 },
      weapon: { id: `entry-weapon-${index}`, name: 'Entry weapon', level: 90, ascension: 6, refinement: 1 },
      artifacts: slots.map((slot, i) => ({
        slot, name: slot, setId: index === 0 ? '400361' : 'entry-set', rarity: 5, level: 20, main: mains[i], sub: subs[i]
      })),
      requiredEffects: [], provenance: { provider: 'synthetic', providerVersion: null, sourceTime: null }
    }
    build.requiredEffects = requiredEffectSources(build)
    const permanentData = {
      ...expected,
      character: { id: characterId, level: 90, ascension: 6, base: { hp: 10000, atk: 300, def: 700 }, bonuses: [] },
      weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500, bonuses: [] },
      effects: Object.fromEntries(build.requiredEffects.map(effect => [effect.id, {
        status: effect.id === `character:${characterId}:a6` ? 'verified-static' : 'known-no-static',
        modifiers: [], runtimeRequired: false
      }]))
    }
    if (index === 0 && includeEffects) permanentData.runtimeEffects = moonEffects
    return { build, permanentData }
  })
}
