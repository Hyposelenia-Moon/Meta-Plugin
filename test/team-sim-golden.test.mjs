import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { mod } from './_helper.mjs'

const { calculateOrdinaryHit } = await import(mod('modules/teamSimulation/formula.js'))
const { GOLDEN_THRESHOLDS, evaluateGolden, validateGoldenCases } = await import(mod('modules/teamSimulation/metrics.js'))
const { evaluateReleaseGate } = await import(mod('modules/teamSimulation/gate.js'))
const { loadGoldenSet } = await import(mod('model/GoldenSet.js'))

const root = path.resolve(import.meta.dirname, '..')
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'))
const casesRaw = readJson('data', 'team-sim', 'golden', 'cases.json')
const cases = casesRaw.cases
const actualsRaw = readJson('data', 'team-sim', 'golden', 'actuals.json')

// 1. 用例本身可采信：够 10 例、全部手算、来源与推导非空、期望值为正
assert.ok(Array.isArray(cases) && cases.length >= 10, `黄金集至少 10 例，实际 ${cases?.length}`)
assert.deepEqual(validateGoldenCases(cases), [], '黄金集用例必须能通过 validateGoldenCases')
for (const item of cases) {
  assert.equal(item.kind, 'hand-calculated', `${item.id} 必须是手算用例`)
  assert.ok(item.source.includes('手算'), `${item.id} 的 source 必须写出手算推导`)
  assert.ok(item.expected.total > 0, `${item.id} 的期望值必须为正`)
  assert.ok(typeof item.tolerance === 'number' && item.tolerance > 0, `${item.id} 必须自带容差`)
  assert.ok(item.scenario && Array.isArray(item.scenario.scaling) && item.scenario.scaling.length, `${item.id} 必须带可复算的 scenario`)
}

// 2. 引擎实跑值与手算值一致（这才是黄金集的意义：拿外部算出来的数字卡引擎）
const recomputed = cases.map(item => {
  const result = calculateOrdinaryHit({
    kind: 'ordinary',
    gameVersion: casesRaw.gameVersion ?? '7.1',
    source: `golden:${item.id}`,
    canCrit: true,
    ...item.scenario
  })
  assert.equal(result.status, 'calculated', `${item.id} 的实跑必须算出结果`)
  const error = Math.abs(result.damage - item.expected.total) / item.expected.total
  assert.ok(error <= item.tolerance, `${item.id} 实跑 ${result.damage} 与手算 ${item.expected.total} 相差 ${(error * 100).toFixed(6)}%`)
  return { id: item.id, total: Number(result.damage.toFixed(6)) }
})

// 3. 入库的 actuals.json 与重算结果同步，防止有人只改一边
assert.equal(actualsRaw.actuals.length, cases.length, 'actuals 数量必须与 cases 一致')
for (const [index, actual] of actualsRaw.actuals.entries()) {
  assert.equal(actual.id, cases[index].id, `第 ${index + 1} 条 actual 的 id 必须与 cases 同序`)
  assert.ok(Math.abs(actual.total - recomputed[index].total) <= 1e-6, `${actual.id} 的入库实跑值与重算值不一致`)
}

// 4. 十例达标；改动期望值必须被拦
const report = evaluateGolden(cases, actualsRaw.actuals)
assert.equal(report.gate, 'pass', `黄金集应达标：${report.reason}`)
assert.equal(report.counted, cases.length)
assert.ok(report.max !== null && report.max <= GOLDEN_THRESHOLDS.singleMax)

const drifted = cases.map((item, index) => index === 0
  ? { ...item, expected: { total: item.expected.total * 1.05 } }
  : item)
assert.equal(evaluateGolden(drifted, actualsRaw.actuals).gate, 'fail', '期望值偏 5% 必须判失败')

// 5. 运行时读取：模型层能取到同一批用例与实跑值
const golden = loadGoldenSet()
assert.ok(golden, 'loadGoldenSet 必须读到入库的黄金集')
assert.equal(golden.cases.length, cases.length)
assert.equal(golden.actuals.length, cases.length)

// 6. 接进发布闸门：黄金集这一关判 pass，整体可以 pass（其余关的条件由这一轮的结果决定）
const base = {
  status: 'calculated',
  mode: 'dps-standard',
  checks: [],
  versions: { pack: '7.1', panels: '7.1' },
  timeline: { accuracy: 'verified', approximateItems: [], endFrame: 100, events: [], hits: [] },
  damage: { status: 'calculated', total: 1, rows: [], perActor: {}, byAction: {} },
  plan: { checks: [] },
  dps: { total: 1, windowSeconds: 120, value: 0.008 }
}
const withGolden = evaluateReleaseGate({ result: base, golden })
assert.equal(withGolden.status, 'pass')
const goldenCheck = withGolden.checks.find(check => check.id === 'golden')
assert.ok(goldenCheck && goldenCheck.status === 'pass', `golden 检查应为 pass：${JSON.stringify(goldenCheck)}`)
assert.ok(withGolden.checks.every(check => check.status === 'pass'))

const withoutGolden = evaluateReleaseGate({ result: base })
assert.equal(withoutGolden.status, 'insufficient-data')
assert.equal(withoutGolden.checks.find(check => check.id === 'golden')?.status, 'insufficient-data')

console.log('golden ok')
