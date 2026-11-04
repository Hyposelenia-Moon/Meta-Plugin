/**
 * 固定值伤害通道（2026-11-04 第五批）：来歆余响。
 *
 * 1) 永久数据：400204 的 runtimeEffects 带 flatDamage，概率按期望折算；
 * 2) 结算层：普攻命中时按「攻击力 × 折算比例」加进基伤，其它动作不受影响。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

const EFFECT = 'artifact-set:400204:4pc'

// ---------- 1. 永久数据 ----------
{
  const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
  assert.equal(runtime.ok, true)
  const spec = runtime.data.runtimeEffects?.[EFFECT]
  assert.ok(spec, '来歆余响应出现在 runtimeEffects')
  assert.equal(spec.trigger, 'normal-hit')
  assert.equal(spec.flatDamage.scaling, 'atk')
  // 36% 起、每次未触发 +20%、第 5 次必触发：平均 1.99188736 次普攻触发一次 → 0.7 / 1.99188736
  assert.ok(Math.abs(spec.flatDamage.ratio - 0.3514253) < 1e-6, `期望折算比例：${spec.flatDamage.ratio}`)
  const audit = runtime.data.effects[EFFECT]
  assert.equal(audit.status, 'verified-static')
  assert.ok(audit.unmodeled && audit.unmodeled.includes('期望'), '期望折算要写进 unmodeled')
}

// ---------- 2. 结算层 ----------
const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}

const actions = {
  'a0.normal-1': {
    id: 'a0.normal-1', actorId: 'a0', kind: 'normal', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: false }]
  },
  'a0.skill': {
    id: 'a0.skill', actorId: 'a0', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: false }]
  }
}

function damageOf (actionId, withEffect) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    actors: [{ actorId: 'a0', energy: 0, energyMax: 60 }],
    activeActorId: 'a0',
    measurementEndFrame: 60,
    steps: [{ id: 's1', kind: 'action', actorId: 'a0', actionId, atFrame: 0 }],
    ...(withEffect
      ? {
          effects: {
            [EFFECT]: {
              id: EFFECT, target: 'self', durationFrames: 3, trigger: 'normal-hit',
              stacking: 'refresh', flatDamage: { scaling: 'atk', ratio: 0.7 / 1.99188736 }
            }
          },
          effectTriggers: [{ effectId: EFFECT, actorId: 'a0', on: 'normal-hit' }]
        }
      : {})
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const out = calculateTimelineDamage({
    timeline,
    contexts: {
      a0: {
        level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1',
        source: 'flat-damage-4pc-test',
        debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return out.rows[0].damage
}

const normalBase = damageOf('a0.normal-1', false)
const normalFlat = damageOf('a0.normal-1', true)
const expectedRatio = 1 + 0.7 / 1.99188736
assert.ok(Math.abs(normalFlat / normalBase - expectedRatio) < 1e-9, `普攻应加 35.14% 基伤：${normalFlat / normalBase}`)

const skillBase = damageOf('a0.skill', false)
const skillFlat = damageOf('a0.skill', true)
assert.ok(Math.abs(skillFlat / skillBase - 1) < 1e-9, '只对普攻生效，战技不受影响')

console.log('来歆余响：固定值伤害按攻击力折算，只作用于普通攻击')
