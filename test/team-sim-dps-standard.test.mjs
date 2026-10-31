import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'
const { DPS_STANDARD, dpsWindowFrames, checkDpsStandard } = await import(mod('modules/teamSimulation/dpsStandard.js'))
const { TARGET_PRESETS, calculateOrdinaryHit } = await import(mod('modules/teamSimulation/formula.js'))
const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))

// 标准本身：110 级小宝、10% 抗性、120 秒、0 能量。任何一项被改动这里都会先红。
assert.deepEqual({ ...DPS_STANDARD }, { targetId: 'ruin-guard-lv110', enemyLevel: 110, resistance: 0.1, windowSeconds: 120, initialEnergy: 0 })
assert.ok(TARGET_PRESETS[DPS_STANDARD.targetId], '标准目标必须登记在 TARGET_PRESETS 里')
const preset = TARGET_PRESETS[DPS_STANDARD.targetId]
assert.equal(preset.level, DPS_STANDARD.enemyLevel)
assert.equal(preset.resistance, DPS_STANDARD.resistance)

// 120 秒换成帧：档位不同、秒数不变。
assert.equal(dpsWindowFrames(FRAME_TIERS['fps-60']), Math.round(120 * 60.36144))
assert.equal(dpsWindowFrames(FRAME_TIERS['fps-60']), 7243)
assert.equal(dpsWindowFrames(FRAME_TIERS['fps-56']), 6758)
assert.equal(dpsWindowFrames(FRAME_TIERS['fps-625']), 79889)
for (const tier of Object.values(FRAME_TIERS)) {
  assert.ok(dpsWindowFrames(tier) > 0 && Number.isInteger(dpsWindowFrames(tier)), `${tier.id} 的窗口帧数必须是正整数`)
}

// 合规的一轮：空数组；不合规的逐条点名，不自动修正。
const good = { frameTier: FRAME_TIERS['fps-60'], targetPresetId: 'ruin-guard-lv110', measurementEndFrame: 7243, actors: [{ actorId: 'itto', energy: 0 }, { actorId: 'albedo', energy: 0 }] }
assert.deepEqual(checkDpsStandard(good), [])

assert.deepEqual(checkDpsStandard(null).map(v => v.path), ['frameTier'])
assert.deepEqual(checkDpsStandard({ ...good, targetPresetId: 'dummy-lv100' }).map(v => v.path), ['targetPresetId'])
assert.deepEqual(checkDpsStandard({ ...good, measurementEndFrame: 7200 }).map(v => v.path), ['measurementEndFrame'])
assert.deepEqual(checkDpsStandard({ ...good, actors: [] }).map(v => v.path), ['actors'])
assert.deepEqual(checkDpsStandard({ ...good, actors: [{ actorId: 'itto' }] }).map(v => v.path), ['actors.0.energy'])
assert.deepEqual(checkDpsStandard({ ...good, actors: [{ actorId: 'itto', energy: 30 }] }).map(v => v.path), ['actors.0.energy'])
assert.match(checkDpsStandard({ ...good, actors: [{ actorId: 'itto', energy: 30 }] })[0].message, /30/)

// 目标口径走公式时：90 级打 110 级，防御乘区 190/400，抗性 90%。
const hit = calculateOrdinaryHit({
  kind: 'ordinary',
  reaction: 'none',
  gameVersion: '7.1',
  source: 'dps-standard-fixture',
  additiveBase: 0,
  damageBonus: 0,
  canCrit: false,
  crit: 'non-critical',
  critRate: 0,
  critDamage: 0,
  attackerLevel: 90,
  enemyLevel: 110,
  defenseReduction: 0,
  defenseIgnore: 0,
  resistance: 0.1,
  resistanceReduction: 0,
  scaling: [{ stat: 1000, multiplier: 1 }],
  targetId: 'ruin-guard-lv110'
})
assert.equal(hit.status, 'calculated')
assert.deepEqual(hit.target, { id: 'ruin-guard-lv110', level: 110, resistance: 0.1 })
assert.ok(Math.abs(hit.factors.defense - 190 / 400) < 1e-12, `防御乘区 ${hit.factors.defense}`)
assert.ok(Math.abs(hit.factors.resistance - 0.9) < 1e-12, `抗性乘区 ${hit.factors.resistance}`)
assert.ok(Math.abs(hit.damage - 1000 * 0.475 * 0.9) < 1e-9, `伤害 ${hit.damage}`)

console.log('dps-standard ok')
