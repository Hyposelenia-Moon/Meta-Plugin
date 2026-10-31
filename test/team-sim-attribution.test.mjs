import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources, buildPermanentStats } = await import(mod('modules/teamSimulation/build.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))
const { attributeEffects } = await import(mod('modules/teamSimulation/attribution.js'))

const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const mains = [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.2 }, { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.62 }]
const subs = [[{ key: 'hpPct', value: 0.05 }], [{ key: 'atkPct', value: 0.1 }], [{ key: 'mastery', value: 20 }], [{ key: 'cpct', value: 0.07 }], [{ key: 'recharge', value: 0.1 }]]

function makeBuild() {
  const build = {
    schemaVersion: 1, actorId: 'actor:0', characterId: 'char:attr-0', name: 'Synthetic Attr', element: 'geo',
    level: 90, ascension: 6, constellation: 1,
    talents: { normal: 9, skill: 9, burst: 9 },
    weapon: { id: 'weapon:attr-0', name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
    artifacts: slots.map((slot, i) => ({ slot, name: `Artifact ${slot}`, setId: 'fixture-set', rarity: 5, level: 20, main: mains[i], sub: subs[i] })),
    requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = requiredEffectSources(build)
  return build
}

function makeData(build) {
  const charSource = `character:${build.characterId}:a${build.ascension}`
  return {
    gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data',
    character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000, atk: 300, def: 700 }, bonuses: [] },
    weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500, bonuses: [] },
    effects: Object.fromEntries(build.requiredEffects.map(e => [e.id,
      e.id === charSource ? { status: 'verified-static', modifiers: [{ key: 'atkPct', value: 0.1 }], runtimeRequired: false }
        : { status: 'known-no-static', modifiers: [], runtimeRequired: false }]))
  }
}

const build = makeBuild()
const expected = { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' }
const members = [{ build, permanentData: makeData(build) }]
assert.equal(buildPermanentStats(build, members[0].permanentData, expected).status, 'permanent-ready')

const pack = {
  schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-attribution-pack',
  actions: {
    'a.normal': {
      id: 'a.normal', actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames: 36 },
      hits: [
        { atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true, triggerIds: ['atk-up'] },
        { atFrame: 18, motionValue: 1.2, scaling: 'atk', element: 'geo', canCrit: true }
      ]
    }
  },
  effects: {
    'atk-up': { id: 'atk-up', target: 'team', stats: { atk: 300 }, durationFrames: 240 },
    'never-triggered': { id: 'never-triggered', target: 'team', stats: { atk: 1000 }, durationFrames: 240 }
  }
}

const rotation = {
  id: 'rotation:attr', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 120,
  steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a.normal', atFrame: 0 }],
  actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
  activeActorId: 'actor:0'
}

const input = { pack, rotation, members, expected, targetPresetId: 'dummy-lv100', crit: 'expected', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }, mode: 'diagnostic' }

const baseline = simulateTeam(input)
assert.equal(baseline.status, 'calculated', JSON.stringify(baseline.issues ?? []))

// 归因给出「去掉它以后少打多少」，不是占比。
const attribution = attributeEffects(input)
assert.equal(attribution.status, 'ok')
assert.equal(attribution.baseline, baseline.damage.total)
assert.deepEqual(attribution.skipped, [])

const byId = new Map(attribution.rows.map(row => [row.effectId, row]))
const atkUp = byId.get('atk-up')
assert.ok(atkUp, '触发过的效果必须有行')
assert.ok(atkUp.delta > 0, '300 攻击的效果必须带来正差额')
assert.equal(atkUp.triggers, 1, '只有第一段命中带触发标记，计数必须是 1')
assert.equal(atkUp.baseline, attribution.baseline)
assert.equal(atkUp.without, attribution.baseline - atkUp.delta)

// 从未触发过的效果差额必须是 0，不能因为表里有它就凭空给贡献。
const unused = byId.get('never-triggered')
assert.equal(unused.delta, 0)
assert.equal(unused.triggers, 0)

// 行按差额降序，便于直接看谁最值。
const deltas = attribution.rows.map(row => row.delta)
assert.deepEqual(deltas, [...deltas].sort((a, b) => b - a))

// 基线失败时不编数字，只报不可用。
const broken = attributeEffects({ ...input, targetPresetId: 'no-such-target' })
assert.equal(broken.status, 'unavailable')
assert.equal(broken.rows.length, 0)
assert.ok(typeof broken.reason === 'string' && broken.reason.length > 0)

console.log('team-sim-attribution ok')
