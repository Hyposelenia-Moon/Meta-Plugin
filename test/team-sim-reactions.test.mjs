import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const {
  REACTIONS,
  REACTION_COEFFICIENT,
  reactionMultiplier,
  pairMultiplier,
  describeMismatch,
  reactionCoefficient,
  amplifyingFactor,
  catalyzeBonus,
  transformativeBase,
  isReactiveKind,
  isStatefulKind,
  statefulReason,
  reactionClass
} = await import(mod('modules/teamSimulation/reactions.js'))
const { calculateOrdinaryHit } = await import(mod('modules/teamSimulation/formula.js'))
const { FRAME_TIERS, simulateTimeline, validateActionSpec } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} != ${b}`)

// 等级系数表：1 级与 90 级的锚点，来自社区口径（miao 表 × 4）。
assert.equal(reactionCoefficient(1), 17.164)
assert.equal(reactionCoefficient(90), 1446.852)
assert.equal(reactionCoefficient(100), 1674.088)
assert.equal(reactionCoefficient(101), undefined)
// 表按玩家可达等级 1..90 连续；91/92/93/94/96..99 在 miao 原始表里就缺（角色最高 90 级，不影响结算）。
for (let level = 1; level <= 90; level += 1) assert.ok(reactionCoefficient(level) > 0, `缺少 ${level} 级系数`)
assert.equal(reactionCoefficient(91), undefined)
assert.equal(Object.keys(REACTION_COEFFICIENT).length, 92)

// 倍率表：官方口径。
assert.equal(reactionMultiplier('vaporize'), undefined) // 增幅没有单一倍率，取决于元素方向
assert.equal(reactionMultiplier('overloaded'), 2.75)
assert.equal(pairMultiplier('vaporize', 'hydro', 'pyro'), 2)
assert.equal(pairMultiplier('vaporize', 'pyro', 'hydro'), 1.5)
assert.equal(pairMultiplier('melt', 'pyro', 'cryo'), 2)
assert.equal(pairMultiplier('melt', 'cryo', 'pyro'), 1.5)
// 剧变的倍数记在 reactionMultiplier 上，配对只负责「这对元素能不能触发」。
assert.ok(pairMultiplier('overloaded', 'pyro', 'electro') !== undefined)
assert.equal(reactionMultiplier('electro-charged'), 2)
assert.equal(reactionMultiplier('superconduct'), 1.5)
assert.equal(reactionMultiplier('swirl'), 0.6)
assert.equal(reactionMultiplier('bloom'), 2)
assert.equal(reactionMultiplier('burning'), 0.25)
assert.equal(reactionClass('aggravate'), 'catalyze')
assert.equal(reactionClass('overloaded'), 'transformative')

// 配对校验：元素方向写反或不出反应时给出原因。
assert.equal(describeMismatch('vaporize', 'hydro', 'pyro'), undefined)
assert.match(describeMismatch('vaporize', 'pyro', 'pyro'), /蒸发/)
assert.match(describeMismatch('aggravate', 'dendro', 'electro'), /超激化/)
assert.equal(isReactiveKind('vaporize'), true)
assert.equal(isReactiveKind('shatter'), false)
assert.equal(isStatefulKind('frozen'), true)
assert.match(statefulReason('burgeon'), /草原核/)

// 精通曲线：增幅 2.78×EM/(EM+1400)、剧变 16×EM/(EM+2000)、激化 5×EM/(EM+1200)。
near(amplifyingFactor('vaporize', 'hydro', 'pyro', 0), 2, '0 精通蒸发')
near(amplifyingFactor('vaporize', 'hydro', 'pyro', 200), 2 * (1 + (25 / 9) * 200 / 1600), '200 精通蒸发')
near(transformativeBase('overloaded', 90, 0), 1446.852 * 2.75, '超载基础伤害')
near(transformativeBase('overloaded', 90, 400), 1446.852 * 2.75 * (1 + 16 * 400 / 2400), '超载精通加成')
near(catalyzeBonus('aggravate', 90, 0), 1446.852 * 1.15, '超激化加成')
near(catalyzeBonus('spread', 90, 0), 1446.852 * 1.25, '蔓激化加成')

// 直伤公式：增幅乘基础伤害区、激化加基础伤害区、剧变不走这条公式。
const hit = {
  kind: 'ordinary', gameVersion: '7.1', source: 'reaction-test', targetId: 'dummy-lv100',
  scaling: [{ stat: 1000, multiplier: 1 }], additiveBase: 0,
  damageBonus: 0.15, canCrit: false, crit: 'expected', critRate: 0, critDamage: 0,
  attackerLevel: 90, enemyLevel: 100, defenseReduction: 0, defenseIgnore: 0,
  resistance: 0.1, resistanceReduction: 0
}
const plain = calculateOrdinaryHit({ ...hit, reaction: 'none' })
assert.equal(plain.status, 'calculated', JSON.stringify(plain.issues))
const vaporize = calculateOrdinaryHit({ ...hit, reaction: 'vaporize', element: 'hydro', aura: 'pyro', mastery: 0 })
assert.equal(vaporize.status, 'calculated', JSON.stringify(vaporize.issues))
assert.equal(vaporize.scope, 'ordinary-hit-with-reaction')
assert.equal(vaporize.factors.reaction, 2)
near(vaporize.damage, plain.damage * 2, '蒸发 2.0 倍')
const catalyze = calculateOrdinaryHit({ ...hit, reaction: 'aggravate', element: 'electro', aura: 'dendro', mastery: 0 })
assert.equal(catalyze.status, 'calculated', JSON.stringify(catalyze.issues))
assert.equal(catalyze.factors.reaction, 1)
// 激化把加成加进基础伤害区，再照常过增伤、防御、抗性三区。
near(catalyze.damage - plain.damage, 1446.852 * 1.15 * 1.15 * (190 / 390) * 0.9, '超激化加成落在基础区')

// 拒绝项：剧变、状态型、元素不符、附着非法。
const overloadedInFormula = calculateOrdinaryHit({ ...hit, reaction: 'overloaded', element: 'electro', aura: 'pyro', mastery: 0 })
assert.equal(overloadedInFormula.status, 'unsupported')
const frozen = calculateOrdinaryHit({ ...hit, reaction: 'frozen', element: 'cryo', aura: 'hydro', mastery: 0 })
assert.equal(frozen.status, 'unsupported')
const wrongPair = calculateOrdinaryHit({ ...hit, reaction: 'vaporize', element: 'pyro', aura: 'pyro', mastery: 0 })
assert.equal(wrongPair.status, 'invalid')
const badAura = calculateOrdinaryHit({ ...hit, reaction: 'vaporize', element: 'hydro', aura: 'geo', mastery: 0 })
assert.equal(badAura.status, 'invalid')

// 动作校验：命中上的附着声明。
const action = (reaction, element = 'pyro') => ({
  id: 'a', actorId: 'a', kind: 'normal', timing: { type: 'frames', frames: 20 },
  hits: [{ atFrame: 5, motionValue: 1, scaling: 'atk', element, canCrit: true, ...(reaction ? { reaction } : {}) }]
})
assert.deepEqual(validateActionSpec(action(undefined), 'a'), [])
assert.deepEqual(validateActionSpec(action({ kind: 'vaporize', aura: 'hydro' }), 'a'), [])
assert.equal(validateActionSpec(action({ kind: 'vaporize', aura: 'hydro' }, 'physical'), 'a')[0].code, 'invalid')
assert.equal(validateActionSpec(action({ kind: 'frozen', aura: 'hydro' }, 'cryo'), 'a')[0].code, 'unsupported')
assert.equal(validateActionSpec(action({ kind: 'melt', aura: 'cryo' }, 'electro'), 'a')[0].code, 'invalid')
assert.equal(validateActionSpec(action({ kind: 'nope', aura: 'hydro' }), 'a')[0].code, 'unsupported')
assert.equal(validateActionSpec(action({ kind: 'vaporize', aura: 'water' }), 'a')[0].code, 'invalid')

// 结算层：增幅改同一段的伤害，剧变另起一段。
const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0.15, phy: 0.1, heal: 0,
  pyro: 0.2, hydro: 0.1, electro: 0.1, cryo: 0, anemo: 0, geo: 0, dendro: 0
}
const pack = {
  'itto.test': {
    id: 'itto.test', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [
      { atFrame: 5, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, reaction: { kind: 'vaporize', aura: 'hydro' } },
      { atFrame: 15, motionValue: 1, scaling: 'atk', element: 'electro', canCrit: false, reaction: { kind: 'overloaded', aura: 'pyro' } }
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
  steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.test', atFrame: 0 }]
})
assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
const base = {
  level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'reaction-test',
  debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
}
const out = calculateTimelineDamage({ timeline, contexts: { itto: { ...base, stats } } })
assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
assert.equal(out.scope, 'timeline-damage-with-reaction')
assert.equal(out.rows.length, 3)
const amplifyingRow = out.rows.find(row => row.reaction?.kind === 'vaporize')
assert.ok(amplifyingRow, '应有蒸发记录')
assert.equal(amplifyingRow.origin, 'action')
assert.ok(amplifyingRow.reaction.damage > 0, '蒸发贡献必须为正')
const transformativeRow = out.rows.find(row => row.origin === 'reaction')
assert.ok(transformativeRow, '剧变必须单独成行')
assert.equal(transformativeRow.reaction.kind, 'overloaded')
near(transformativeRow.damage, 1446.852 * 2.75 * 0.9, '超载只乘抗性区')
near(out.total, out.rows.reduce((sum, row) => sum + row.damage, 0), '合计等于逐段之和')
near(out.perActor.itto, out.total, '单角色合计等于总数')

console.log('reactions ok')
