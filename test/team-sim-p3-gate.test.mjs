import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const {
  REACTION_FAMILIES,
  BLOCKED_FAMILIES,
  gateReactionFamily,
  familyCoverage
} = await import(mod('modules/teamSimulation/reactionFamilies.js'))
const { REACTIONS, reactionClass, SPECIAL_REACTIONS, specialClass } = await import(mod('modules/teamSimulation/reactions.js'))

// 五个家族都必须已覆盖，并和 reactions.ts 的分类一一对上，防止表与实现漂移。
const families = ['amplifying', 'catalyze', 'transformative', 'lunar', 'stellar']
for (const family of families) {
  const spec = REACTION_FAMILIES[family]
  assert.equal(spec.coverage, 'fixture-covered', `${family} 必须已覆盖`)
  assert.equal(spec.cls, family, `${family} 的分类必须与家族同名`)
  assert.ok(spec.evidence.startsWith('test/'), `${family} 必须指向真实测试文件`)
}
for (const kind of Object.keys(REACTIONS)) {
  const cls = reactionClass(kind)
  const spec = Object.values(REACTION_FAMILIES).find(item => item.cls === cls)
  assert.ok(spec, `${kind} 的分类 ${cls} 没有对应的家族表项`)
  assert.equal(spec.coverage, 'fixture-covered', `${kind} 所在家族必须已覆盖`)
}
for (const kind of Object.keys(SPECIAL_REACTIONS)) {
  const cls = specialClass(kind)
  const spec = Object.values(REACTION_FAMILIES).find(item => item.cls === cls)
  assert.ok(spec, `${kind} 的分类 ${cls} 没有对应的家族表项`)
  assert.equal(spec.coverage, 'fixture-covered', `${kind} 所在家族必须已覆盖`)
}

// gate 现在没有拦下的家族，但机制仍要在：未知名字必须拒绝，且不冒充已覆盖。
assert.deepEqual(BLOCKED_FAMILIES, [])
for (const family of families) assert.equal(gateReactionFamily(family).status, 'ok')
assert.equal(gateReactionFamily('vaporize').status, 'unknown')
assert.equal(gateReactionFamily(undefined).status, 'unknown')
assert.equal(gateReactionFamily('lunar').family, 'lunar')

assert.deepEqual(familyCoverage(), { covered: 5, blocked: 0, total: 5 })

console.log('p3 gate ok')
