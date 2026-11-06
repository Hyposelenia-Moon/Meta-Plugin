/**
 * 附着状态机第 2 轮：与 `declared` 的一致性 + 无声明时的推导能力。
 *
 * 1) 纯岩动作：两种模式命中与总伤必须完全一致（岩不附着、也不会产生反应）；
 * 2) 水→火序列：`declared` 下没有反应，`simulated` 下按附着推出 3 次蒸发（爆发命中按 Independent）；
 * 3) 增幅确实放大了伤害（蒸发行 > 直伤行）。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const stats = { hp: 14000, atk: 1000, def: 700, mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0, phy: 0, geo: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, dendro: 0, heal: 0 }
const context = {
  level: 90,
  targetPresetId: 'dummy-lv100',
  crit: 'non-critical',
  gameVersion: '7.1',
  source: 'aura-consistency',
  debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
  stats
}

const run = (actions, auraMode) => simulateTimeline({
  scheduler: 'fixed',
  steps: Object.keys(actions).map((actionId, index) => ({ id: `s${index}`, kind: 'action', actorId: 'actor:0', actionId, atFrame: 0 })),
  actions,
  actors: [{ actorId: 'actor:0', energy: 0, energyMax: 80 }],
  activeActorId: 'actor:0',
  frameTier: FRAME_TIERS['fps-60'],
  measurementEndFrame: 300,
  ...(auraMode ? { auraMode } : {})
})

const damageOf = timeline => {
  const result = calculateTimelineDamage({ timeline, contexts: { 'actor:0': context } })
  assert.equal(result.status, 'calculated', JSON.stringify(result.issues))
  return result
}

// ---------- 1. 纯岩：两种模式完全一致 ----------
{
  const actions = {
    'a0.geo': {
      id: 'a0.geo', actorId: 'actor:0', kind: 'skill',
      timing: { type: 'frames', frames: 60 },
      hits: [
        { atFrame: 10, motionValue: 1, scaling: 'def', element: 'geo', canCrit: true },
        { atFrame: 40, motionValue: 2, scaling: 'def', element: 'physical', canCrit: true }
      ]
    }
  }
  const declared = damageOf(run(actions, undefined))
  const simulated = damageOf(run(actions, 'simulated'))
  assert.equal(simulated.total, declared.total, '岩/物理不产生反应，总伤必须一致')
  assert.equal(simulated.rows.length, declared.rows.length)
  assert.ok(declared.rows.every(row => row.reaction === undefined), '纯岩不应有反应行')
}

// ---------- 2. 水→火：无声明时由附着推导蒸发 ----------
{
  const actions = {
    'a0.combo': {
      id: 'a0.combo', actorId: 'actor:0', kind: 'burst',
      timing: { type: 'frames', frames: 90 },
      hits: [
        { atFrame: 0, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false },
        { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false },
        { atFrame: 20, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false },
        { atFrame: 30, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false },
        { atFrame: 40, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false },
        { atFrame: 50, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }
      ]
    }
  }
  const declared = run(actions, 'declared')
  assert.equal(declared.status, 'simulated', JSON.stringify(declared.issues))
  assert.ok(declared.hits.every(hit => hit.reaction === undefined), 'declared 下没有声明就没有反应')

  const simulated = run(actions, 'simulated')
  assert.equal(simulated.status, 'simulated', JSON.stringify(simulated.issues))
  const vapors = simulated.hits.filter(hit => hit.reaction?.kind === 'vaporize')
  assert.equal(vapors.length, 3, '爆发按 Independent，每次火伤都有水附着可打')
  assert.deepEqual(vapors.map(hit => hit.frame), [10, 30, 50])

  const declaredDamage = damageOf(declared).total
  const simulatedDamage = damageOf(simulated).total
  assert.ok(simulatedDamage > declaredDamage, `蒸发应放大总伤（${simulatedDamage} > ${declaredDamage}）`)
}
