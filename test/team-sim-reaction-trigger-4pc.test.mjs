/**
 * 反应触发（2026-11-05 第一轮第十一批）：教官 400033。
 *
 * 「触发元素反应后全队元素精通 +120，持续 8 秒」按命中上的反应声明触发：
 * 声明蒸发的第一发只负责触发，之后同一角色的蒸发伤害应按 120 精通放大。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

const EFFECT_ID = 'artifact-set:400033:4pc'
const effects = {
  [EFFECT_ID]: {
    id: EFFECT_ID,
    target: 'team',
    stats: { mastery: 120 },
    durationFrames: 480,
    trigger: 'reaction',
    stacking: 'refresh'
  }
}

const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}

const actions = {
  'test.pyro': {
    id: 'test.pyro', actorId: 'test', kind: 'skill', timing: { type: 'frames', frames: 60 },
    hits: [
      { atFrame: 6, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, reaction: { kind: 'vaporize', aura: 'hydro' } },
      { atFrame: 30, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, reaction: { kind: 'vaporize', aura: 'hydro' } }
    ]
  }
}

function run (withEffect) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    ...(withEffect ? { effects, effectTriggers: [{ effectId: EFFECT_ID, actorId: 'test', on: 'reaction' }] } : {}),
    actors: [{ actorId: 'test', energy: 0, energyMax: 60 }],
    activeActorId: 'test',
    measurementEndFrame: 60,
    steps: [{ id: 's1', kind: 'action', actorId: 'test', actionId: 'test.pyro', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const out = calculateTimelineDamage({
    timeline,
    contexts: {
      test: {
        level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1',
        source: 'reaction-trigger-4pc-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return { timeline, rows: out.rows }
}

// 1) 永久数据：教官登记为运行时效果，审计不再报未建模
const permanent = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
assert.equal(permanent.ok, true, permanent.error)
const runtime = permanent.data.runtimeEffects?.[EFFECT_ID]
assert.ok(runtime, '永久数据里要有教官的运行时效果')
assert.equal(runtime.trigger, 'reaction')
assert.deepEqual(runtime.stats, { mastery: 120 })
const audit = permanent.data.effects[EFFECT_ID]
assert.equal(audit.status, 'verified-static')
assert.equal(audit.runtimeRequired, true)
assert.ok(audit.unmodeled?.includes('刷新'), '没有写明冷却，按刷新处理要披露')

// 2) 时间轴：每次声明的反应命中都刷新一次（不叠加层数）
const withEffect = run(true)
const fired = withEffect.timeline.events.filter(event => event.detail?.effectId === EFFECT_ID)
assert.deepEqual(fired.map(event => event.frame), [6, 30], '两发反应各刷新一次')
assert.ok(fired.every(event => event.detail.source === 'reaction'))

// 3) 伤害：第二发蒸发吃到 120 精通（2.78×120/(120+1400) 的放大）
const plain = run(false)
const factor = 1 + ((25 / 9) * 120) / (120 + 1400)
const ratio = withEffect.rows[1].damage / plain.rows[1].damage
assert.ok(Math.abs(ratio - factor) < 1e-6, `第二发应按 120 精通放大：${ratio} vs ${factor}`)
assert.ok(Math.abs(withEffect.rows[0].damage - plain.rows[0].damage) < 1e-9, '触发它的那一发不受影响')

console.log('反应触发：教官 400033 在声明的反应命中后给全队 120 精通')
