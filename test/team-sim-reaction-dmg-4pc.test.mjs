/**
 * 反应族伤害加成（2026-11-05 第一轮第十二批）：如雷的盛怒 400109。
 *
 * 「超载/感电/超导 +40%」按声明的剧变反应放大等级系数：
 * 同一条超载反应，穿 4 件套时反应伤害正好 ×1.4，直伤部分不变。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const EFFECT_ID = 'artifact-set:400109:4pc'
const effects = {
  [EFFECT_ID]: {
    id: EFFECT_ID,
    target: 'self',
    trigger: 'always',
    stacking: 'refresh',
    reactionDmg: { overloaded: 0.4, 'electro-charged': 0.4, superconduct: 0.4 }
  }
}

const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}

const actions = {
  'test.electro': {
    id: 'test.electro', actorId: 'test', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'electro', canCrit: false, reaction: { kind: 'overloaded', aura: 'pyro' } }]
  }
}

function run (withEffect) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    ...(withEffect ? { effects, effectTriggers: [{ effectId: EFFECT_ID, actorId: 'test', on: 'always' }] } : {}),
    actors: [{ actorId: 'test', energy: 0, energyMax: 60 }],
    activeActorId: 'test',
    measurementEndFrame: 40,
    steps: [{ id: 's1', kind: 'action', actorId: 'test', actionId: 'test.electro', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const out = calculateTimelineDamage({
    timeline,
    contexts: {
      test: {
        level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1',
        source: 'reaction-dmg-4pc-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return out.rows
}

const plain = run(false)
const boosted = run(true)
const reactionRow = rows => rows.find(row => row.origin === 'reaction')

assert.ok(reactionRow(plain) && reactionRow(boosted), '两轮都要产生剧变反应行')
const ratio = reactionRow(boosted).damage / reactionRow(plain).damage
assert.ok(Math.abs(ratio - 1.4) < 1e-9, `超载伤害应 ×1.4：${ratio}`)

const directPlain = plain.filter(row => row.origin !== 'reaction').reduce((sum, row) => sum + row.damage, 0)
const directBoosted = boosted.filter(row => row.origin !== 'reaction').reduce((sum, row) => sum + row.damage, 0)
assert.ok(Math.abs(directBoosted - directPlain) < 1e-9, '直伤不吃反应族加成')

console.log('反应族加成：如雷 4 件套把超载伤害放大 1.4 倍')
