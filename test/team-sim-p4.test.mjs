import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources } = await import(mod('modules/teamSimulation/build.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))
const { buildTeamRunReport, formatTeamRunReport } = await import(mod('modules/teamSimulation/report.js'))
const { diffPacks, diffRotations, diffValues, formatDiff } = await import(mod('modules/teamSimulation/diff.js'))
const { buildRunLog } = await import(mod('modules/teamSimulation/log.js'))

const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const mains = [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.2 }, { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.62 }]
const subs = [[{ key: 'hpPct', value: 0.05 }], [{ key: 'atkPct', value: 0.1 }], [{ key: 'mastery', value: 20 }], [{ key: 'cpct', value: 0.07 }], [{ key: 'recharge', value: 0.1 }]]

const build = {
  schemaVersion: 1, actorId: 'actor:0', characterId: 'char:p4-0', name: 'Synthetic P4', element: 'geo',
  level: 90, ascension: 6, constellation: 0,
  talents: { normal: 9, skill: 9, burst: 9 },
  weapon: { id: 'weapon:p4-0', name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
  artifacts: slots.map((slot, i) => ({ slot, name: `Artifact ${slot}`, setId: 'fixture-set', rarity: 5, level: 20, main: mains[i], sub: subs[i] })),
  requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
}
build.requiredEffects = requiredEffectSources(build)

const charSource = `character:${build.characterId}:a${build.ascension}`
const permanentData = {
  gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data',
  character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000, atk: 300, def: 700 }, bonuses: [] },
  weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500, bonuses: [] },
  effects: Object.fromEntries(build.requiredEffects.map(e => [e.id,
    e.id === charSource ? { status: 'verified-static', modifiers: [{ key: 'atkPct', value: 0.1 }], runtimeRequired: false }
      : { status: 'known-no-static', modifiers: [], runtimeRequired: false }]))
}

const expected = { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' }
const members = [{ build, permanentData }]

const action = (id, hits, frames = 36) => ({ id, actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames }, hits })

const pack = {
  schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-p4-pack',
  actions: {
    'a.normal': action('a.normal', [
      { atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true, triggerIds: ['atk-up'] },
      { atFrame: 18, motionValue: 1.2, scaling: 'atk', element: 'geo', canCrit: true }
    ]),
    'a.skill': action('a.skill', [{ atFrame: 10, motionValue: 2, scaling: 'def', element: 'geo', canCrit: true }], 30)
  },
  effects: {
    'atk-up': { id: 'atk-up', target: 'team', stats: { atk: 300 }, durationFrames: 240 }
  }
}

const rotation = {
  id: 'rotation:p4', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 120,
  steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a.normal', atFrame: 0 }],
  actors: [{ actorId: 'actor:0', energy: 20, energyMax: 60 }],
  activeActorId: 'actor:0'
}

const input = { pack, rotation, members, expected, targetPresetId: 'dummy-lv100', crit: 'expected', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }, mode: 'diagnostic', instrument: true }
const run = simulateTeam(input)
assert.equal(run.status, 'calculated', JSON.stringify(run.issues ?? []))

// 1. 性能报告：逐关耗时与关一一对应，且都非负。
const stages = run.checks.map(check => check.stage)
assert.deepEqual(Object.keys(run.timings), stages)
for (const ms of Object.values(run.timings)) assert.ok(ms >= 0 && Number.isFinite(ms))

// 2. 能量披露：起手能量来自轴，结束能量来自内核，上限原样。
assert.equal(run.energy.length, 1)
assert.deepEqual(run.energy[0], { actorId: 'actor:0', start: 20, end: 20, max: 60 })

// 3. 报告把能量与耗时都摊到文本里。
const report = buildTeamRunReport(run)
assert.deepEqual(report.energy, run.energy)
assert.equal(report.timings, run.timings)
const text = formatTeamRunReport(report)
assert.ok(text.some(line => line.includes('能量 actor:0')), text.join('\n'))
assert.ok(text.some(line => line.startsWith('耗时：')), text.join('\n'))

// 4. 机制日志：帧号、现实毫秒、逐段伤害都在，条目数与事件数一致。
const log = buildRunLog(run)
assert.equal(log.status, 'calculated')
assert.equal(log.accuracy, run.timeline.accuracy)
assert.equal(log.entries.length, run.timeline.events.length)
const first = log.entries[0]
assert.equal(first.realMs, Math.round(run.timeline.events[0].frame * run.timeline.timing.realMsPerFrame * 10) / 10)
assert.ok(log.lines.some(line => line.startsWith('窗口：')))
assert.ok(log.lines.filter(line => line.includes('] damage ')).length === run.damage.rows.length)
assert.ok(log.lines.some(line => line.includes('命中结算：')))

// 失败轮次只报问题，不产出事件行。
const failed = buildRunLog(simulateTeam({ ...input, targetPresetId: 'no-such-target' }))
assert.equal(failed.status, 'unsupported')
assert.equal(failed.entries.length, 0)
assert.ok(failed.lines.some(line => line.startsWith('问题：')))

// 5. 结构差异：增删改三种都给，数组按下标。
const diffed = diffValues({ a: 1, b: [1, 2], c: { d: 'x' } }, { a: 2, b: [1], c: { d: 'x', e: true } })
assert.deepEqual(diffed.map(entry => [entry.path, entry.kind]), [['a', 'changed'], ['b.1', 'removed'], ['c.e', 'added']])

// 6. 数据包差异：动作增删改、效果增删改、版本变更分别报。
const nextPack = {
  ...pack, gameVersion: '6.1-synthetic',
  actions: {
    'a.normal': { ...pack.actions['a.normal'], hits: [{ ...pack.actions['a.normal'].hits[0], atFrame: 8 }, pack.actions['a.normal'].hits[1]] },
    'a.burst': action('a.burst', [{ atFrame: 40, motionValue: 3, scaling: 'atk', element: 'geo', canCrit: true }], 60)
  },
  effects: { 'atk-up': { ...pack.effects['atk-up'], stats: { atk: 400 } }, 'def-up': { id: 'def-up', target: 'team', stats: { def: 200 }, durationFrames: 120 } }
}
const packDiff = diffPacks(pack, nextPack)
assert.equal(packDiff.summary.versionChanged, true)
assert.equal(packDiff.summary.schemaChanged, false)
assert.deepEqual(packDiff.summary.actionsAdded, ['a.burst'])
assert.deepEqual(packDiff.summary.actionsRemoved, ['a.skill'])
assert.deepEqual(packDiff.summary.actionsChanged, ['a.normal'])
assert.deepEqual(packDiff.summary.effectsAdded, ['def-up'])
assert.deepEqual(packDiff.summary.effectsChanged, ['atk-up'])
const packLines = formatDiff(packDiff.entries)
assert.ok(packLines.some(line => line.startsWith('+ actions.a.burst')))
assert.ok(packLines.some(line => line.includes('actions.a.normal.hits.0.atFrame')))
// 超出上限时明确说还有多少条，不静默截断。
const cut = formatDiff(packDiff.entries, 2)
assert.equal(cut.length, 3)
assert.ok(cut[2].startsWith('…另有'))

// 7. 轴差异：换档位、改窗口、步骤增删分别报。
const nextRotation = { ...rotation, frameTier: FRAME_TIERS['fps-56'], measurementEndFrame: 200, steps: [...rotation.steps, { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'a.skill', atFrame: 60 }] }
const rotationDiff = diffRotations(rotation, nextRotation)
assert.equal(rotationDiff.summary.tierChanged, true)
assert.equal(rotationDiff.summary.windowChanged, true)
assert.equal(rotationDiff.summary.stepsAdded, 1)
assert.equal(rotationDiff.summary.stepsChanged, 0)
assert.equal(rotationDiff.summary.stepsRemoved, 0)

console.log('team-sim-p4 ok')
