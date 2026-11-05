/**
 * 技能类型暴击率通道（2026-11-05 第一轮第八批）。
 *
 * 行者之心 400003「重击的暴击率提升 30%」走 `chargedCpct`：
 * 1) 结算层：同一发命中，面板多出 chargedCpct 后只放大重击的期望暴击倍率；
 * 2) 永久数据：400003 以静态效果 `chargedCpct: 0.3` 出现在面板增量里。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

const baseStats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 1, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}

const actions = {
  'itto.normal-1': {
    id: 'itto.normal-1', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
  },
  'itto.charged-1': {
    id: 'itto.charged-1', actorId: 'itto', kind: 'charged', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
  }
}

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
        source: 'crit-kind-4pc-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return out.rows[0].damage
}

// 期望暴击：0% 暴击率时倍率 1；加上 30% 暴击率、100% 暴伤后应放大到 1.3。
const chargedBase = damageOf('itto.charged-1', baseStats)
const chargedBuffed = damageOf('itto.charged-1', { ...baseStats, chargedCpct: 0.3 })
assert.ok(Math.abs(chargedBuffed / chargedBase - 1.3) < 1e-9, `重击暴击率 +30% 应放大 1.3 倍：${chargedBuffed / chargedBase}`)

const normalBase = damageOf('itto.normal-1', baseStats)
const normalWithChargedCrit = damageOf('itto.normal-1', { ...baseStats, chargedCpct: 0.3 })
assert.ok(Math.abs(normalWithChargedCrit / normalBase - 1) < 1e-9, '重击暴击率加成不能作用到普攻')

// 永久数据：400003 是静态效果，装备后直接进面板增量。
const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
assert.equal(runtime.ok, true)
const entry = runtime.data.effects['artifact-set:400003:4pc']
assert.ok(entry, '行之心 4 件套应出现在效果表')
assert.equal(entry.status, 'verified-static')
assert.equal(entry.unmodeled, undefined)
assert.deepEqual(entry.modifiers, [{ key: 'chargedCpct', value: 0.3 }])

console.log('技能类型暴击率：重击暴击率加成生效，不串到普攻')
