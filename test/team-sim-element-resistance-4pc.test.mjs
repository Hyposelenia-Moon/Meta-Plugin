/**
 * 分元素抗性削减（2026-11-05 第一轮第十一批）：深林的记忆 400209。
 *
 * 「造成草元素伤害后，敌人草抗降低 30%，持续 8 秒」按命中元素触发：
 * 第一发只负责触发，第二发草伤吃减免（10% → −20%），火伤不受影响。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { resistanceMultiplier } = await import(mod('modules/teamSimulation/formula.js'))

const EFFECT_ID = 'artifact-set:400209:4pc'
const effects = {
  [EFFECT_ID]: {
    id: EFFECT_ID,
    target: 'enemy',
    durationFrames: 480,
    trigger: 'hit',
    hitElements: ['dendro'],
    stacking: 'refresh',
    enemy: { resistanceByElement: { dendro: 0.3 } }
  }
}

const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}

const actions = {
  'test.dendro': {
    id: 'test.dendro', actorId: 'test', kind: 'skill', timing: { type: 'frames', frames: 60 },
    hits: [
      { atFrame: 6, motionValue: 1, scaling: 'atk', element: 'dendro', canCrit: false },
      { atFrame: 30, motionValue: 1, scaling: 'atk', element: 'dendro', canCrit: false }
    ]
  },
  'test.pyro': {
    id: 'test.pyro', actorId: 'test', kind: 'skill', timing: { type: 'frames', frames: 60 },
    hits: [{ atFrame: 30, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }]
  }
}

function run (actionId, withEffect) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    ...(withEffect ? { effects, effectTriggers: [{ effectId: EFFECT_ID, actorId: 'test', on: 'hit' }] } : {}),
    actors: [{ actorId: 'test', energy: 0, energyMax: 60 }],
    activeActorId: 'test',
    measurementEndFrame: 60,
    steps: [{ id: 's1', kind: 'action', actorId: 'test', actionId, atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const out = calculateTimelineDamage({
    timeline,
    contexts: {
      test: {
        level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1',
        source: 'element-resistance-4pc-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return { timeline, rows: out.rows }
}

const plain = run('test.dendro', false)
const reduced = run('test.dendro', true)

const fired = reduced.timeline.events.filter(event => event.detail?.effectId === EFFECT_ID)
assert.deepEqual(fired.map(event => event.frame), [6, 30], '两发草伤各触发一次')

const expected = resistanceMultiplier(-0.2) / resistanceMultiplier(0.1)
const ratio = reduced.rows[1].damage / plain.rows[1].damage
assert.ok(Math.abs(ratio - expected) < 1e-9, `第二发草伤应按 −20% 抗性结算：${ratio} vs ${expected}`)
assert.ok(Math.abs(reduced.rows[0].damage - plain.rows[0].damage) < 1e-9, '触发它的那一发不受影响')

const pyroPlain = run('test.pyro', false)
const pyroReduced = run('test.pyro', true)
assert.ok(Math.abs(pyroReduced.rows[0].damage - pyroPlain.rows[0].damage) < 1e-9, '火伤不吃草抗削减')

console.log('分元素抗性：深林的记忆按草伤命中降低草抗，不影响其它元素')
