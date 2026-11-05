/**
 * 能量为零条件（2026-11-05 第一轮第九批）：深廊终曲 400351。
 *
 * 「元素能量为 0 时普攻/爆发 +60%」按命中当帧读能量：
 * 能量为 0 的普攻按 1.6 倍结算，能量非 0 时回到原值；战技不受影响。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

const baseStats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}

const effects = {
  'artifact-set:400351:4pc': {
    id: 'artifact-set:400351:4pc',
    target: 'self',
    stats: { normalDmg: 0.6, burstDmg: 0.6 },
    trigger: 'energy-zero'
  }
}

const actions = {
  'itto.normal-1': {
    id: 'itto.normal-1', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: false }]
  },
  'itto.skill': {
    id: 'itto.skill', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: false }]
  }
}

function damageOf (actionId, energy) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400351:4pc', actorId: 'itto', on: 'energy-zero' }],
    actors: [{ actorId: 'itto', energy, energyMax: 60 }],
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
        source: 'energy-zero-4pc-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats: baseStats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return out.rows[0].damage
}

const zeroNormal = damageOf('itto.normal-1', 0)
const fullNormal = damageOf('itto.normal-1', 20)
assert.ok(Math.abs(zeroNormal / fullNormal - 1.6) < 1e-9, `能量为 0 时普攻应放大 1.6 倍：${zeroNormal / fullNormal}`)

const zeroSkill = damageOf('itto.skill', 0)
const fullSkill = damageOf('itto.skill', 20)
assert.ok(Math.abs(zeroSkill / fullSkill - 1) < 1e-9, '战技不受深廊终曲影响')

const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
assert.equal(runtime.ok, true)
const spec = runtime.data.runtimeEffects?.['artifact-set:400351:4pc']
assert.deepEqual(spec?.stats, { normalDmg: 0.6, burstDmg: 0.6 })
assert.equal(spec?.trigger, 'energy-zero')
const audit = runtime.data.effects['artifact-set:400351:4pc']
assert.equal(audit.runtimeRequired, true)
assert.match(String(audit.unmodeled ?? ''), /失效窗/)

console.log('深廊终曲：能量为 0 时普攻/爆发 +60%，能量非 0 不生效')
