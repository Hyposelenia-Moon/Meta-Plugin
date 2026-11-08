/**
 * 月相派生（2026-11-08）。
 *
 * 口径：队伍里 1 位月兆角色 → 初辉（initial）、2 位及以上 → 满辉（full），不是叠层。
 * 名单来自 `data/team-sim/moon-characters.json`（miao 天赋文本里的「月兆·满辉/初辉」）。
 * 这里守住三件事：名单本身可核对、派生映射正确、simulateTeam 会把月相透到结果与报告。
 */
import assert from 'node:assert/strict'
import { mod, readJson, pluginRoot } from './_helper.mjs'
import path from 'node:path'

const { deriveMoonPhase, moonCharacterIds } = await import(mod('model/MoonPhase.js'))
const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources } = await import(mod('modules/teamSimulation/build.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))
const { buildTeamRunReport, formatTeamRunReport } = await import(mod('modules/teamSimulation/report.js'))

// ---------- 1. 名单可核对 ----------
const moon = readJson(path.join(pluginRoot, 'data/team-sim/moon-characters.json'))
const roster = readJson(path.join(pluginRoot, 'data/team-sim/roster.json'))
const rosterIds = new Set(roster.characters.map(entry => entry.charId))
assert.equal(moon.characters.length, 9, `月兆角色应为 9 位，实际 ${moon.characters.length}`)
assert.equal(new Set(moon.characters.map(entry => entry.charId)).size, 9, '角色 id 不能重复')
for (const entry of moon.characters) {
  assert.ok(rosterIds.has(entry.charId), `${entry.cn}（${entry.charId}）必须能在名录里找到`)
  assert.ok(String(entry.evidence).includes('月兆'), `${entry.cn} 的证据必须来自月兆文本`)
}
assert.ok(moon.source.rule.includes('初辉') && moon.source.rule.includes('满辉'), '规则要写明初辉/满辉')
assert.equal(moonCharacterIds().size, 9)

// ---------- 2. 派生映射 ----------
const lauma = '10000119'
const flins = '10000120'
const xiangling = '10000023'
assert.equal(deriveMoonPhase([]), undefined, '没有角色就没有月相')
assert.equal(deriveMoonPhase([xiangling, '10000021']), undefined, '全队没有月兆角色 → 不进入档位')
assert.equal(deriveMoonPhase([lauma]), 'initial', '1 位月兆角色 → 初辉')
assert.equal(deriveMoonPhase([lauma, lauma]), 'initial', '同一个人不重复计数')
assert.equal(deriveMoonPhase([lauma, flins]), 'full', '2 位月兆角色 → 满辉')
assert.equal(deriveMoonPhase([lauma, flins, xiangling]), 'full', '非月兆角色不影响档位')

// ---------- 3. simulateTeam 透出月相 ----------
const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const expected = { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' }
const build = {
  schemaVersion: 1, actorId: 'actor:0', characterId: 'char:fixture-0', name: 'Synthetic 0', element: 'geo',
  level: 90, ascension: 6, constellation: 0,
  talents: { normal: 9, skill: 9, burst: 9 },
  weapon: { id: 'weapon:fixture-0', name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
  artifacts: slots.map((slot, i) => ({
    slot,
    name: `Artifact ${slot}`,
    setId: '400089',
    rarity: 5,
    level: 20,
    main: [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.2 }, { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.62 }][i],
    sub: []
  })),
  requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
}
build.requiredEffects = requiredEffectSources(build)
const charSource = `character:${build.characterId}:a${build.ascension}`
const permanentData = {
  gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data',
  character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000, atk: 300, def: 700 }, bonuses: [] },
  weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500, bonuses: [] },
  effects: Object.fromEntries(build.requiredEffects.map(effect => [effect.id,
    effect.id === charSource
      ? { status: 'verified-static', modifiers: [], runtimeRequired: false }
      : { status: 'known-no-static', modifiers: [], runtimeRequired: false }]))
}

const pack = {
  schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-pack',
  actions: {
    'actor0.normal-1': { id: 'actor0.normal-1', actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames: 36 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }] }
  }
}
const rotation = {
  id: 'rotation:moon', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 200,
  steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'actor0.normal-1', atFrame: 0 }],
  actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
  activeActorId: 'actor:0'
}

function runWith (moonPhase) {
  return simulateTeam({
    pack,
    rotation,
    members: [{ build, permanentData }],
    expected,
    targetPresetId: 'dummy-lv100',
    crit: 'expected',
    debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
    mode: 'diagnostic',
    ...(moonPhase ? { moonPhase } : {})
  })
}

const full = runWith('full')
assert.equal(full.status, 'calculated', JSON.stringify(full.issues))
assert.equal(full.moonPhase, 'full', '结果里要带出满辉')
const fullLines = formatTeamRunReport(buildTeamRunReport(full))
assert.ok(fullLines.some(line => line.includes('月相') && line.includes('满辉')), '报告要写明满辉')

const none = runWith(undefined)
assert.equal(none.status, 'calculated', JSON.stringify(none.issues))
assert.equal(none.moonPhase, undefined, '没有月兆角色时结果里不出现月相')
assert.equal(buildTeamRunReport(none).moonPhase, null)

const invalid = runWith('half')
assert.notEqual(invalid.status, 'calculated', '非法月相必须拒跑')
assert.ok((invalid.issues ?? []).some(issue => issue.path === 'moonPhase'), '要指出是 moonPhase 不合法')

console.log('月相派生：名单 9 位、1/2 位分档、结果与报告透出正确')
