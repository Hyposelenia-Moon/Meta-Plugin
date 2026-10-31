import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const {
  REACTION_FAMILIES,
  BLOCKED_FAMILIES,
  gateReactionFamily,
  familyCoverage
} = await import(mod('modules/teamSimulation/reactionFamilies.js'))
const { REACTIONS, reactionClass } = await import(mod('modules/teamSimulation/reactions.js'))

// 三个已覆盖家族必须和 reactions.ts 的分类一一对上，防止表与实现漂移。
for (const family of ['amplifying', 'catalyze', 'transformative']) {
  const spec = REACTION_FAMILIES[family]
  assert.equal(spec.coverage, 'fixture-covered')
  assert.ok(spec.evidence.includes('team-sim-reactions'), `${family} 必须指向真实测试文件`)
}
for (const kind of Object.keys(REACTIONS)) {
  const cls = reactionClass(kind)
  const spec = Object.values(REACTION_FAMILIES).find(item => item.cls === cls)
  assert.ok(spec, `${kind} 的分类 ${cls} 没有对应的家族表项`)
  assert.equal(spec.coverage, 'fixture-covered', `${kind} 所在家族必须已覆盖`)
}

// 月反应与星烁按方案第 659 行 gate：可以声明，但必须被拒绝且给出原因。
assert.deepEqual(BLOCKED_FAMILIES.sort(), ['lunar', 'stellar'])
for (const family of BLOCKED_FAMILIES) {
  const result = gateReactionFamily(family)
  assert.equal(result.status, 'blocked')
  assert.match(result.message, /尚未建模/)
  assert.ok(REACTION_FAMILIES[family].reason, `${family} 必须写清 gate 原因`)
  assert.equal(REACTION_FAMILIES[family].cls, null, `${family} 不能挂到普通反应分类上`)
}

// 已覆盖家族放行；未知名字拒绝。
assert.equal(gateReactionFamily('amplifying').status, 'ok')
assert.equal(gateReactionFamily('lunar').status, 'blocked')
assert.equal(gateReactionFamily('vaporize').status, 'unknown')
assert.equal(gateReactionFamily(undefined).status, 'unknown')
assert.match(gateReactionFamily('stellar').message, /计数|契约字段|资料/)

const coverage = familyCoverage()
assert.deepEqual(coverage, { covered: 3, blocked: 2, total: 5 })

console.log('p3 gate ok')
