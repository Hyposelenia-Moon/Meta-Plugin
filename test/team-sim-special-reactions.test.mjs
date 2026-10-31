import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const {
  SPECIAL_REACTIONS,
  specialMultiplier,
  specialMasteryFactor,
  specialPairMatches,
  describeSpecialMismatch,
  isSpecialKind,
  specialClass,
  specialLabel,
  STELLAR_CONDUCT_DEFAULT_COUNT,
  STELLAR_VORTEX_DEFAULT_COUNT,
  reactionCoefficient
} = await import(mod('modules/teamSimulation/reactions.js'))
const { FRAME_TIERS, simulateTimeline, validateActionSpec } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { REACTION_FAMILIES, gateReactionFamily, familyCoverage } = await import(mod('modules/teamSimulation/reactionFamilies.js'))

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} != ${b}`)

// 家族表：月反应与星烁已从 blocked 升级为已覆盖，证据指向本文件。
for (const family of ['lunar', 'stellar']) {
  const spec = REACTION_FAMILIES[family]
  assert.equal(spec.coverage, 'fixture-covered', `${family} 必须已覆盖`)
  assert.equal(spec.cls, family, `${family} 的类别必须与家族同名`)
  assert.equal(spec.evidence, 'test/team-sim-special-reactions.test.mjs', `${family} 的证据必须指向本文件`)
  assert.equal(gateReactionFamily(family).status, 'ok')
}
assert.deepEqual(familyCoverage(), { covered: 5, blocked: 0, total: 5 })

// 类型判定与文案。
assert.ok(isSpecialKind('lunar-charged'))
assert.ok(isSpecialKind('stellar-conduct'))
assert.ok(!isSpecialKind('vaporize'))
assert.ok(!isSpecialKind('frozen'))
assert.equal(specialClass('lunar-bloom'), 'lunar')
assert.equal(specialClass('stellar-swirl'), 'stellar')
assert.equal(specialLabel('lunar-crystallize'), '月结晶')
assert.deepEqual(Object.keys(SPECIAL_REACTIONS).sort(), [
  'lunar-bloom',
  'lunar-charged',
  'lunar-crystallize',
  'stellar-conduct',
  'stellar-swirl',
  'stellar-vortex'
])

// 倍率：月反应看天赋开关，星超导查计数表，星辉冰旋看阈值。
assert.equal(specialMultiplier('lunar-bloom'), 1)
assert.equal(specialMultiplier('lunar-charged'), 3)
assert.equal(specialMultiplier('lunar-charged', { talent: true }), 7.2)
assert.equal(specialMultiplier('lunar-crystallize'), 1.6)
assert.equal(specialMultiplier('lunar-crystallize', { talent: true }), 3.84)
assert.equal(specialMultiplier('stellar-swirl'), 1)
assert.equal(specialMultiplier('stellar-swirl', { talent: true }), 3)
// 星超导：13 项系数表，缺省按 miao 的 12 层；越界夹到两端。
assert.equal(specialMultiplier('stellar-conduct'), 1.95)
assert.equal(specialMultiplier('stellar-conduct', { count: STELLAR_CONDUCT_DEFAULT_COUNT }), 1.95)
assert.equal(specialMultiplier('stellar-conduct', { count: 13 }), 2)
assert.equal(specialMultiplier('stellar-conduct', { count: 1 }), 1)
assert.equal(specialMultiplier('stellar-conduct', { count: 2 }), 1.45)
assert.equal(specialMultiplier('stellar-conduct', { count: 99 }), 2)
assert.equal(specialMultiplier('stellar-conduct', { count: -5 }), 1)
// 星辉冰旋：计数 < 3 用 8，>= 3 用 12；缺省按 miao 的 6 层。
assert.equal(specialMultiplier('stellar-vortex'), 12)
assert.equal(specialMultiplier('stellar-vortex', { count: STELLAR_VORTEX_DEFAULT_COUNT }), 12)
assert.equal(specialMultiplier('stellar-vortex', { count: 2 }), 8)
assert.equal(specialMultiplier('stellar-vortex', { count: 3 }), 12)

// 精通：6 × EM / (EM + 2000)，与剧变的 16 不是同一条曲线。
near(specialMasteryFactor(0), 1, '零精通没有加成')
near(specialMasteryFactor(2000), 4, '2000 精通时 6EM/(EM+2000) 贡献 3 倍')
near(specialMasteryFactor(200), 1 + (6 * 200) / 2200, '200 精通')
near(specialMasteryFactor(-100), 1, '负精通按 0 处理')
near(specialMasteryFactor(Number.NaN), 1, 'NaN 按 0 处理')

// 配对：月反应与星烁各有元素对，描述要能直接进 issue。
assert.ok(specialPairMatches('lunar-charged', 'hydro', 'electro'))
assert.ok(specialPairMatches('lunar-charged', 'electro', 'hydro'))
assert.ok(!specialPairMatches('lunar-charged', 'hydro', 'dendro'))
assert.match(describeSpecialMismatch('lunar-charged', 'hydro', 'dendro'), /月感电只能由 hydro 打 electro \/ electro 打 hydro 触发/)
assert.equal(describeSpecialMismatch('lunar-charged', 'hydro', 'electro'), undefined)
assert.ok(specialPairMatches('stellar-vortex', 'anemo', 'cryo'))
assert.ok(!specialPairMatches('stellar-vortex', 'anemo', 'pyro'))

// 动作校验：合法声明放行，配对不符、非法计数、非法乘区各自拒绝。
const action = (reaction, element = 'hydro') => ({
  id: 'a', actorId: 'a', kind: 'normal', timing: { type: 'frames', frames: 20 },
  hits: [{ atFrame: 5, motionValue: 1, scaling: 'atk', element, canCrit: true, ...(reaction ? { reaction } : {}) }]
})
assert.deepEqual(validateActionSpec(action({ kind: 'lunar-charged', aura: 'electro' })), [])
assert.deepEqual(validateActionSpec(action({ kind: 'stellar-conduct', aura: 'electro', count: 3, talent: true, fypct: 0.2, elevated: 0.1, kNum: 1.5 }, 'cryo')), [])
assert.equal(validateActionSpec(action({ kind: 'lunar-charged', aura: 'dendro' }))[0].code, 'invalid')
assert.equal(validateActionSpec(action({ kind: 'stellar-conduct', aura: 'electro', count: 0 }, 'cryo'))[0].path, 'actions.a.hits.0.reaction.count')
assert.equal(validateActionSpec(action({ kind: 'stellar-conduct', aura: 'electro', count: 1.5 }, 'cryo'))[0].code, 'invalid')
assert.equal(validateActionSpec(action({ kind: 'lunar-charged', aura: 'electro', talent: 'yes' }))[0].path, 'actions.a.hits.0.reaction.talent')
assert.equal(validateActionSpec(action({ kind: 'lunar-charged', aura: 'electro', fypct: -1 }))[0].path, 'actions.a.hits.0.reaction.fypct')
assert.equal(validateActionSpec(action({ kind: 'lunar-charged', aura: 'electro', kNum: 0 }))[0].path, 'actions.a.hits.0.reaction.kNum')

// 结算层：月反应与星烁各自另起一段，只乘抗性区与显式乘区。
const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0.15, phy: 0.1, heal: 0,
  pyro: 0, hydro: 0.1, electro: 0.1, cryo: 0, anemo: 0, geo: 0, dendro: 0
}
const pack = {
  'itto.moon': {
    id: 'itto.moon', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [
      { atFrame: 5, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false, reaction: { kind: 'lunar-charged', aura: 'electro' } },
      { atFrame: 15, motionValue: 1, scaling: 'atk', element: 'cryo', canCrit: true, reaction: { kind: 'stellar-conduct', aura: 'electro', count: 3, fypct: 0.2, elevated: 0.1, kNum: 1.5 } }
    ]
  }
}
const timeline = simulateTimeline({
  scheduler: 'fixed',
  frameTier: FRAME_TIERS['fps-60'],
  actions: pack,
  actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }],
  activeActorId: 'itto',
  measurementEndFrame: 120,
  steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.moon', atFrame: 0 }]
})
assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
const base = {
  level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'special-reaction-test',
  debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
}
const out = calculateTimelineDamage({ timeline, contexts: { itto: { ...base, stats } } })
assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
// 每一发直伤一行 + 每一发反应各一行。
assert.equal(out.rows.length, 4)
const coefficient = reactionCoefficient(90)
const lunarRow = out.rows.find(row => row.reaction?.kind === 'lunar-charged')
assert.ok(lunarRow, '月感电必须单独成行')
assert.equal(lunarRow.origin, 'reaction')
near(lunarRow.damage, coefficient * 3 * 0.9, '月感电：系数 × 3 × 抗性')
const stellarRow = out.rows.find(row => row.reaction?.kind === 'stellar-conduct')
assert.ok(stellarRow, '星超导必须单独成行')
near(
  stellarRow.damage,
  coefficient * 1.2 * 1.5 * 1.1 * 1.5 * 0.9,
  '星超导：系数 × (1+fypct) × 计数倍率 × (1+提升) × kNum × 抗性'
)
near(out.total, out.rows.reduce((sum, row) => sum + row.damage, 0), '合计等于逐段之和')

// 计数来源：星超导的层数由效果读，不在数据里写死；反应加成也能由效果按加法提供。
const effects = {
  'echo': { id: 'echo', target: 'team', stats: { atk: 0 }, durationFrames: 200, stacking: 'stack', maxStacks: 5 },
  'moon-bless': { id: 'moon-bless', target: 'team', durationFrames: 200, reactionBonus: { fypct: 0.2, elevated: 0.1, kNum: 0.5 } }
}
const countPack = {
  'itto.count': {
    id: 'itto.count', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [
      { atFrame: 2, motionValue: 0.001, scaling: 'atk', element: 'physical', canCrit: false, triggerIds: ['echo', 'moon-bless'] },
      { atFrame: 3, motionValue: 0.001, scaling: 'atk', element: 'physical', canCrit: false, triggerIds: ['echo'] },
      { atFrame: 5, motionValue: 1, scaling: 'atk', element: 'cryo', canCrit: false, reaction: { kind: 'stellar-conduct', aura: 'electro', countFrom: 'echo' } }
    ]
  }
}
const countTimeline = simulateTimeline({
  scheduler: 'fixed',
  frameTier: FRAME_TIERS['fps-60'],
  actions: countPack,
  effects,
  actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }],
  activeActorId: 'itto',
  measurementEndFrame: 120,
  steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.count', atFrame: 0 }]
})
assert.equal(countTimeline.status, 'simulated', JSON.stringify(countTimeline.issues))
const countHit = countTimeline.hits.find(hit => hit.reaction)
assert.equal(countHit.reaction.count, 2, '计数应取效果层数 2')
const countOut = calculateTimelineDamage({ timeline: countTimeline, contexts: { itto: { ...base, stats } } })
assert.equal(countOut.status, 'calculated', JSON.stringify(countOut.issues))
const countRow = countOut.rows.find(row => row.reaction?.kind === 'stellar-conduct')
// 系数 × (1+0.2 专用加成) × 1.45（2 层）× 1（精通 0）× (1+0.1 提升) × (1+0.5 效果乘区) × 0.9 抗性。
near(countRow.damage, coefficient * 1.2 * 1.45 * 1.1 * 1.5 * 0.9, '计数来源与效果加成同时生效')

// 数据包校验：countFrom 指向不存在的效果必须拒绝，不能静默按 0 层算。
const { validateDataPack } = await import(mod('modules/teamSimulation/dataPack.js'))
const ghostPack = validateDataPack({
  schemaVersion: 1, gameVersion: '7.1', source: 'special-test',
  actions: { 'a.ghost': { id: 'a.ghost', actorId: 'a', kind: 'normal', timing: { type: 'frames', frames: 20 }, hits: [{ atFrame: 5, motionValue: 1, scaling: 'atk', element: 'cryo', canCrit: false, reaction: { kind: 'stellar-conduct', aura: 'electro', countFrom: 'ghost' } }] } },
  effects: {}
})
assert.equal(ghostPack.status, 'unsupported')
assert.ok(ghostPack.issues.some(issue => issue.path === 'actions.a.ghost.hits.0.reaction.countFrom'), JSON.stringify(ghostPack.issues))

console.log('special reactions ok')
