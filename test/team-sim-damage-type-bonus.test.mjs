/**
 * 技能类型伤害加成通道（2026-11-02 切片 1）。
 *
 * 只验证结算层：同一发命中，面板多出 normalDmg / skillDmg 后，
 * 对应类型的伤害按加算进 A 乘区，类型不匹配的命中不受影响。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const baseStats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0.15, phy: 0.1, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0.2, dendro: 0
}

const actions = {
  'itto.normal-1': {
    id: 'itto.normal-1', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
  },
  'itto.skill': {
    id: 'itto.skill', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
  }
}

/** 只跑一个动作并返回单发伤害。 */
function damageOf (actionId, stats) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }],
    activeActorId: 'itto',
    measurementEndFrame: 60,
    steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId, atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const out = calculateTimelineDamage({
    timeline,
    contexts: {
      itto: {
        level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1',
        source: 'damage-type-bonus-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return out.rows[0].damage
}

// 用零增伤面板做比值，避免原有 phy/dmg 加成干扰乘区基数。
const plain = { ...baseStats, dmg: 0, phy: 0, geo: 0 }
const normalBase = damageOf('itto.normal-1', plain)
const normalBuffed = damageOf('itto.normal-1', { ...plain, normalDmg: 0.35 })
assert.ok(Math.abs(normalBuffed / normalBase - 1.35) < 1e-9, `普攻 +35% 应放大 1.35 倍：${normalBuffed / normalBase}`)

const skillBase = damageOf('itto.skill', plain)
const skillWithNormalBonus = damageOf('itto.skill', { ...plain, normalDmg: 0.35 })
assert.ok(Math.abs(skillWithNormalBonus / skillBase - 1) < 1e-9, '普攻加成不能作用到战技')

const skillBuffed = damageOf('itto.skill', { ...plain, skillDmg: 0.35 })
assert.ok(Math.abs(skillBuffed / skillBase - 1.35) < 1e-9, `战技 +35% 应放大 1.35 倍：${skillBuffed / skillBase}`)

console.log('技能类型伤害加成：普攻/战技各自生效，不串类型')
