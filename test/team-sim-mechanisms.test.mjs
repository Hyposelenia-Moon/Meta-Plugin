import assert from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * P1 纯岩四角色机制：数值来自 miao-plugin 的天赋表（天赋 10 级），
 * 动作帧数是占位值（miao 无帧数据），测试只验证机制换算与叠加，不主张动作时长正确。
 */
const root = dirname(fileURLToPath(import.meta.url))
const repo = join(root, '..')
const libReady = existsSync(join(repo, 'lib/modules/teamSimulation/mechanisms.js'))
const mod = (rel) => pathToFileURL(join(repo, 'lib', rel)).href
if (!libReady) { console.log('跳过 team-sim-mechanisms：lib 未编译'); process.exit(0) }

const { planMechanisms, GEO_MECHANICS } = await import(mod('modules/teamSimulation/mechanisms.js'))
const { simulateTimeline, FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { calculateOrdinaryHit, TARGET_PRESETS } = await import(mod('modules/teamSimulation/formula.js'))

const tier = FRAME_TIERS['fps-60']
const seconds = (value) => Math.round(value * tier.fps)
const procFrames = [1, 2, 3, 4].map(n => 40 + n * seconds(GEO_MECHANICS.albedo.procIntervalSeconds))

/** 命中段：倍率取 miao 天赋 10 级，帧偏移为占位值。 */
const hit = (atFrame, motionValue, scaling = 'atk') => ({ atFrame, motionValue, scaling, element: 'geo', canCrit: true })

const pack = {
  schemaVersion: 1,
  gameVersion: '7.1',
  source: 'miao-plugin meta-gs talent tables (lv10) + 占位帧数',
  actions: {
    'gorou.e': { id: 'gorou.e', actorId: 'gorou', kind: 'skill', mechanism: 'gorou-e', timing: { type: 'frames', frames: 40 }, hits: [hit(10, 1.9296)], cancelWindows: [{ fromFrame: 30, toFrame: 40 }], cooldownFrames: 600 },
    'albedo.e': { id: 'albedo.e', actorId: 'albedo', kind: 'skill', mechanism: 'albedo-e', timing: { type: 'frames', frames: 30 }, hits: [hit(8, 2.3472)], cancelWindows: [{ fromFrame: 20, toFrame: 30 }], cooldownFrames: 240 },
    'zhongli.hold-e': { id: 'zhongli.hold-e', actorId: 'zhongli', kind: 'skill', mechanism: 'zhongli-hold-e', timing: { type: 'frames', frames: 60 }, hits: [hit(50, 1.44)], cancelWindows: [{ fromFrame: 50, toFrame: 60 }], cooldownFrames: 720 },
    'itto.q': { id: 'itto.q', actorId: 'itto', kind: 'burst', mechanism: 'itto-q', timing: { type: 'frames', frames: 40 }, hits: [], energyCost: 70, cooldownFrames: 1080 },
    'itto.na1': { id: 'itto.na1', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 20 }, hits: [hit(8, 0.7923)], cancelWindows: [{ fromFrame: 16, toFrame: 20 }] },
    'itto.na2': { id: 'itto.na2', actorId: 'itto', kind: 'normal', mechanism: 'itto-na2', timing: { type: 'frames', frames: 20 }, hits: [hit(8, 0.7637)], cancelWindows: [{ fromFrame: 16, toFrame: 20 }] },
    'itto.na4': { id: 'itto.na4', actorId: 'itto', kind: 'normal', mechanism: 'itto-na4', timing: { type: 'frames', frames: 20 }, hits: [hit(10, 1.1722)], cancelWindows: [{ fromFrame: 16, toFrame: 20 }] },
    'itto.charged': { id: 'itto.charged', actorId: 'itto', kind: 'charged', mechanism: 'itto-charged', timing: { type: 'frames', frames: 60 }, hits: [hit(10, 0.9116), hit(25, 0.9116), hit(40, 1.9092)], cancelWindows: [{ fromFrame: 50, toFrame: 60 }] }
  }
}

const actors = [
  { actorId: 'itto', energy: 100, energyMax: 100 },
  { actorId: 'gorou', energy: 100, energyMax: 100 },
  { actorId: 'albedo', energy: 100, energyMax: 100 },
  { actorId: 'zhongli', energy: 100, energyMax: 100 }
]

const rotation = {
  id: 'p1.geo',
  scheduler: 'fixed',
  frameTier: tier,
  measurementEndFrame: 600,
  switchFrames: 0,
  steps: [
    { id: 's1', kind: 'action', actorId: 'gorou', actionId: 'gorou.e', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'albedo', atFrame: 40 },
    { id: 's3', kind: 'action', actorId: 'albedo', actionId: 'albedo.e', atFrame: 40 },
    { id: 's4', kind: 'switch', actorId: 'zhongli', atFrame: 70 },
    { id: 's5', kind: 'action', actorId: 'zhongli', actionId: 'zhongli.hold-e', atFrame: 70 },
    { id: 's6', kind: 'switch', actorId: 'itto', atFrame: 130 },
    { id: 's7', kind: 'action', actorId: 'itto', actionId: 'itto.q', atFrame: 130 },
    { id: 's8', kind: 'action', actorId: 'itto', actionId: 'itto.na2', atFrame: 170 },
    { id: 's9', kind: 'action', actorId: 'itto', actionId: 'itto.na4', atFrame: 195 },
    { id: 's10', kind: 'action', actorId: 'itto', actionId: 'itto.charged', atFrame: 220 },
    { id: 's11', kind: 'action', actorId: 'itto', actionId: 'itto.na1', atFrame: 290 }
  ],
  actors,
  activeActorId: 'gorou'
}

const stats = (over = {}) => ({
  hp: 20000, atk: 1200, def: 800, mastery: 0, cpct: 0.5, cdmg: 1, recharge: 1,
  dmg: 0, phy: 0, heal: 0, geo: 0.5,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, dendro: 0, ...over
})
const context = (over = {}) => ({
  level: 90, stats: stats(over), targetPresetId: 'dummy-lv100', crit: 'critical',
  gameVersion: '7.1', source: 'synthetic', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
})
const contexts = {
  itto: context({ atk: 1200, def: 800 }),
  gorou: context({ atk: 900, def: 900 }),
  albedo: context({ atk: 800, def: 1400 }),
  zhongli: context({ atk: 1000, def: 700 })
}
const builds = { itto: { actorId: 'itto', element: 'geo' }, gorou: { actorId: 'gorou', element: 'geo' }, albedo: { actorId: 'albedo', element: 'geo' }, zhongli: { actorId: 'zhongli', element: 'geo' } }

// 1) 机制规划：窗口、召唤物、资源合法性
const { plan, issues } = planMechanisms({ pack, rotation, builds, contexts, tier })
assert.deepEqual(issues, [])
const ittoQ = plan.statWindows.filter(w => w.source === 'itto-q')
assert.ok(ittoQ.length >= 1, '一斗 Q 应产生面板窗口')
assert.equal(ittoQ[0].actorId, 'itto')
assert.equal(ittoQ[0].stats.atk, 800 * GEO_MECHANICS.itto.burstAtkFromDef)
assert.equal(ittoQ[0].fromFrame, 130)
assert.equal(Math.max(...ittoQ.map(w => w.toFrame)), Math.min(130 + seconds(11), rotation.measurementEndFrame), 'Q 窗口按前台切片并在测量窗口处截断')

const gorouE = plan.statWindows.filter(w => w.source === 'gorou-e')
assert.ok(gorouE.every(w => w.stats.def === GEO_MECHANICS.gorou.flatDef))
assert.ok(gorouE.every(w => w.stats.geo === GEO_MECHANICS.gorou.geoDamageBonus), '4 名岩元素角色时应带岩伤加成')

const shield = plan.enemyWindows[0]
assert.equal(shield.enemy.resistanceReduction, 0.2)
assert.equal(shield.toFrame, 70 + seconds(20))

assert.deepEqual(plan.summonHits.map(s => s.atFrame), procFrames)
assert.ok(plan.summonHits.every(s => s.scaling === 'def' && s.ownerId === 'albedo'))
assert.equal(plan.checks.find(c => c.id === 'itto.stacks').status, 'ok')

// 2) 岩元素角色不足 3 名时不应给岩伤加成
const twoGeo = planMechanisms({ pack, rotation, builds: { ...builds, albedo: { actorId: 'albedo', element: 'pyro' }, zhongli: { actorId: 'zhongli', element: 'pyro' } }, contexts, tier }).plan
assert.ok(twoGeo.statWindows.filter(w => w.source === 'gorou-e').every(w => w.stats.geo === undefined))

// 3) 逆袈裟先于叠层：资源非法
const badRotation = { ...rotation, activeActorId: 'itto', steps: [
  { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.charged', atFrame: 0 }
] }
const bad = planMechanisms({ pack, rotation: badRotation, builds, contexts, tier })
assert.equal(bad.plan.checks.find(c => c.id === 'itto.stacks').status, 'violation')

// 4) 结算：机制窗口与召唤物都进入伤害
const timeline = simulateTimeline({
  scheduler: rotation.scheduler, steps: rotation.steps, actions: pack.actions, actors, activeActorId: 'gorou', switchFrames: 0,
  frameTier: tier, measurementEndFrame: rotation.measurementEndFrame
})
assert.equal(timeline.status, 'simulated')
const plain = calculateTimelineDamage({ timeline, contexts })
const withPlan = calculateTimelineDamage({ timeline, contexts, plan })
assert.equal(plain.status, 'calculated')
assert.equal(withPlan.status, 'calculated')
assert.ok(withPlan.total > plain.total, '机制窗口与召唤物应提高总伤害')
assert.equal(withPlan.rows.filter(r => r.origin === 'summon').length, 4)
assert.deepEqual(withPlan.rows.filter(r => r.origin === 'summon').map(r => r.frame), procFrames)

// 召唤物按防御结算：1400 × 2.4048
const summonRow = withPlan.rows.find(r => r.origin === 'summon')
assert.equal(summonRow.motionValue, GEO_MECHANICS.albedo.procMotionValue)
assert.equal(summonRow.scaling, 'def')

// 5) 一斗 Q 窗口内的攻击段确实吃到了 830.4 攻击力增量
const ittoHit = withPlan.rows.find(r => r.actorId === 'itto' && r.actionId === 'itto.na2')
const plainHit = plain.rows.find(r => r.actorId === 'itto' && r.actionId === 'itto.na2')
assert.ok(ittoHit.damage > plainHit.damage, 'Q 窗口内的普攻应高于无机制时')
// 同时被五郎领域覆盖：把手算结果与公式对齐
const expectedStats = stats({ atk: 1200 + 800 * GEO_MECHANICS.itto.burstAtkFromDef, def: 800 + GEO_MECHANICS.gorou.flatDef, geo: 0.5 + GEO_MECHANICS.gorou.geoDamageBonus })
const preset = TARGET_PRESETS['dummy-lv100']
const expected = calculateOrdinaryHit({
  kind: 'ordinary', reaction: 'none', gameVersion: '7.1', source: 'synthetic', targetId: preset.id,
  scaling: [{ stat: expectedStats.atk, multiplier: 0.7637 }], additiveBase: 0,
  damageBonus: expectedStats.dmg + expectedStats.geo, canCrit: true, crit: 'critical',
  critRate: expectedStats.cpct, critDamage: expectedStats.cdmg, attackerLevel: 90,
  enemyLevel: preset.level, defenseReduction: 0, defenseIgnore: 0,
  resistance: preset.resistance, resistanceReduction: 0.2
})
assert.equal(expected.status, 'calculated')
assert.ok(Math.abs(ittoHit.damage - expected.damage) < 1e-6, 'Q 与五郎与钟离减抗三者应同时叠加到这一发')

console.log('team-sim-mechanisms ok')
