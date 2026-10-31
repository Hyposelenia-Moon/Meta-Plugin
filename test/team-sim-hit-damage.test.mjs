import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateOrdinaryHit, TARGET_PRESETS } = await import(mod('modules/teamSimulation/formula.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const ittoStats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0.15, phy: 0.1, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0.2, dendro: 0
}
const albedoStats = { ...ittoStats, def: 1400 }

const actions = {
  'itto.normal-1': {
    id: 'itto.normal-1', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 36 },
    hits: [
      { atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true },
      { atFrame: 18, motionValue: 1.2, scaling: 'atk', element: 'physical', canCrit: true }
    ]
  },
  'albedo.skill': {
    id: 'albedo.skill', actorId: 'albedo', kind: 'skill', timing: { type: 'frames', frames: 30 }, cooldownFrames: 600, cooldownId: 'skill',
    hits: [{ atFrame: 10, motionValue: 2, scaling: 'def', element: 'geo', canCrit: true }]
  }
}

const timeline = simulateTimeline({
  scheduler: 'fixed',
  frameTier: FRAME_TIERS['fps-60'],
  actions,
  actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }, { actorId: 'albedo', energy: 0, energyMax: 40 }],
  activeActorId: 'itto',
  measurementEndFrame: 60,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'albedo', atFrame: 36 },
    { id: 's3', kind: 'action', actorId: 'albedo', actionId: 'albedo.skill', atFrame: 36 }
  ]
})
assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
assert.equal(timeline.hits.length, 3)

const base = {
  level: 90,
  targetPresetId: 'dummy-lv100',
  crit: 'expected',
  gameVersion: '7.1',
  source: 'hit-damage-test',
  debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
}
const contexts = { itto: { ...base, stats: ittoStats }, albedo: { ...base, stats: albedoStats } }

const out = calculateTimelineDamage({ timeline, contexts })
assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
assert.equal(out.scope, 'timeline-damage-no-reaction')
assert.equal(out.simulationReady, false)
assert.deepEqual(out.target, { id: 'dummy-lv100', level: 100, resistance: 0.1 })
assert.deepEqual(out.rows.map(r => r.frame), timeline.hits.map(h => h.frame))
assert.ok(Math.abs(out.total - out.rows.reduce((sum, r) => sum + r.damage, 0)) < 1e-9)
assert.ok(Math.abs(out.perActor.itto + out.perActor.albedo - out.total) < 1e-9)

// 每段的伤害必须与直接调用公式完全一致：映射不改数值，且各角色读自己的面板。
const preset = TARGET_PRESETS['dummy-lv100']
const expected = timeline.hits.map(hit => {
  const stats = contexts[hit.actorId].stats
  const stat = hit.scaling === 'atk' ? stats.atk : hit.scaling === 'hp' ? stats.hp : stats.def
  const result = calculateOrdinaryHit({
    kind: 'ordinary', reaction: 'none', gameVersion: '7.1', source: 'hit-damage-test', targetId: preset.id,
    scaling: [{ stat, multiplier: hit.motionValue }], additiveBase: 0,
    damageBonus: hit.element === 'physical' ? stats.phy : stats.dmg + stats[hit.element],
    canCrit: hit.canCrit, crit: 'expected', critRate: stats.cpct, critDamage: stats.cdmg,
    attackerLevel: 90, enemyLevel: preset.level, defenseReduction: 0, defenseIgnore: 0,
    resistance: preset.resistance, resistanceReduction: 0
  })
  assert.equal(result.status, 'calculated', JSON.stringify(result.issues))
  return result.damage
})
assert.deepEqual(out.rows.map(r => r.damage), expected)

// 面板按 actorId 取：防御段的伤害随该角色的防御面板变化，证明没有借用别人的面板。
const albedoHit = { ...timeline, hits: [timeline.hits[2]] }
const withIttoStats = calculateTimelineDamage({ timeline: albedoHit, contexts: { albedo: { ...base, stats: ittoStats } } }).rows[0].damage
const withAlbedoStats = calculateTimelineDamage({ timeline: albedoHit, contexts: { albedo: { ...base, stats: albedoStats } } }).rows[0].damage
assert.ok(withIttoStats !== withAlbedoStats, '不同面板必须得到不同伤害')

// 元素加成只读对应键：岩伤命中吃 dmg + geo，物理命中只吃 phy；换元素必须换出不同结果。
const physOnly = { ...timeline, hits: [timeline.hits[1]] }
const physHit = calculateTimelineDamage({ timeline: physOnly, contexts })
const swapped = calculateTimelineDamage({ timeline: { ...physOnly, hits: [{ ...timeline.hits[1], element: 'geo' }] }, contexts })
assert.ok(swapped.rows[0].damage !== physHit.rows[0].damage, '换元素必须换加成键')

// 目标、减益、暴击口径与面板缺失都必须拒绝，不能默默按 0 算。
const unknownTarget = calculateTimelineDamage({ timeline, contexts: { itto: { ...contexts.itto, targetPresetId: 'dummy-lv200' }, albedo: contexts.albedo } })
assert.equal(unknownTarget.status, 'unsupported')
assert.ok(unknownTarget.issues.some(i => i.path === 'contexts.itto.targetPresetId'))
const debuff = calculateTimelineDamage({ timeline, contexts: { itto: { ...contexts.itto, debuffs: { defenseReduction: 0.4, defenseIgnore: 0, resistanceReduction: 0 } }, albedo: contexts.albedo } })
assert.equal(debuff.status, 'unsupported')
assert.ok(debuff.issues.some(i => i.path === 'contexts.itto.debuffs.defenseReduction'))
const noDebuffs = calculateTimelineDamage({ timeline, contexts: { itto: { ...contexts.itto, debuffs: undefined }, albedo: contexts.albedo } })
assert.equal(noDebuffs.status, 'incomplete')
assert.ok(noDebuffs.issues.some(i => i.path === 'contexts.itto.debuffs'))
const badCrit = calculateTimelineDamage({ timeline, contexts: { itto: { ...contexts.itto, crit: 'lucky' }, albedo: contexts.albedo } })
assert.equal(badCrit.status, 'unsupported')
assert.ok(badCrit.issues.some(i => i.path === 'contexts.itto.crit'))
const badStats = calculateTimelineDamage({ timeline, contexts: { itto: { ...contexts.itto, stats: { ...ittoStats, atk: -1 } }, albedo: contexts.albedo } })
assert.equal(badStats.status, 'invalid')
assert.ok(badStats.issues.some(i => i.path === 'contexts.itto.stats.atk'))

// 同一轮里版本、目标、减益必须一致，否则汇总的总数没有意义。
const mixedVersion = calculateTimelineDamage({ timeline, contexts: { itto: contexts.itto, albedo: { ...contexts.albedo, gameVersion: '7.2' } } })
assert.equal(mixedVersion.status, 'invalid')
assert.ok(mixedVersion.issues.some(i => i.path === 'contexts.albedo'))
// 同一目标重复绑定不误报（真正的不一致由版本、目标或减益任何一项不同触发）。
const sameTarget = calculateTimelineDamage({ timeline, contexts: { itto: contexts.itto, albedo: { ...contexts.albedo, targetPresetId: 'dummy-lv100' } } })
assert.equal(sameTarget.status, 'calculated')

// 命中来自没提供面板的角色必须报出来，而不是当成 0 伤害。
const missingActor = calculateTimelineDamage({ timeline, contexts: { itto: contexts.itto } })
assert.equal(missingActor.status, 'invalid')
assert.ok(missingActor.issues.some(i => i.path === 'contexts.albedo'))

const noContexts = calculateTimelineDamage({ timeline, contexts: {} })
assert.equal(noContexts.status, 'incomplete')
assert.ok(noContexts.issues.some(i => i.path === 'contexts'))
const invalidTimeline = calculateTimelineDamage({ timeline: { ...timeline, status: 'invalid', issues: [{ code: 'invalid', path: 'steps.0', message: 'x' }] }, contexts })
assert.equal(invalidTimeline.status, 'invalid')
assert.ok(invalidTimeline.issues.some(i => i.path === 'steps.0'))
const notTimeline = calculateTimelineDamage({ timeline: {}, contexts })
assert.equal(notTimeline.status, 'invalid')
assert.ok(notTimeline.issues.some(i => i.path === 'timeline'))

console.log('team-sim-hit-damage ok')
