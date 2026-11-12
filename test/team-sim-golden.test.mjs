import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { mod, createChecks } from './_helper.mjs'

const { GOLDEN_THRESHOLDS, evaluateGolden, validateGoldenCases } = await import(mod('modules/teamSimulation/metrics.js'))
const { evaluateReleaseGate } = await import(mod('modules/teamSimulation/gate.js'))
const { loadGoldenSet } = await import(mod('model/GoldenSet.js'))
const { auditGolden } = await import('../scripts/audit-golden.mjs')

const root = path.resolve(import.meta.dirname, '..')
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'))
const casesRaw = readJson('data', 'team-sim', 'golden', 'cases.json')
const cases = casesRaw.cases
const actualsRaw = readJson('data', 'team-sim', 'golden', 'actuals.json')

// 1. 用例本身可采信：够 10 例、全部手算、来源与推导非空、期望值为正、scenario 可复算
assert.ok(Array.isArray(cases) && cases.length >= 10, `黄金集至少 10 例，实际 ${cases?.length}`)
assert.deepEqual(validateGoldenCases(cases), [], '黄金集用例必须能通过 validateGoldenCases')
for (const item of cases) {
  assert.equal(item.kind, 'hand-calculated', `${item.id} 必须是手算用例`)
  assert.ok(item.source.includes('手算'), `${item.id} 的 source 必须写出手算推导`)
  assert.ok(item.expected.total > 0, `${item.id} 的期望值必须为正`)
  assert.ok(typeof item.tolerance === 'number' && item.tolerance > 0, `${item.id} 必须自带容差`)
  const mode = item.mode ?? 'ordinary'
  assert.ok(mode === 'ordinary' || mode === 'timeline', `${item.id} 的 mode 只能是 ordinary 或 timeline`)
  if (mode === 'ordinary') {
    assert.ok(Array.isArray(item.scenario?.scaling) && item.scenario.scaling.length, `${item.id} 必须带可复算的 scenario.scaling`)
  } else {
    const hits = Array.isArray(item.scenario?.hits) ? item.scenario.hits : [item.scenario?.hit]
    assert.ok(hits.length > 0, `${item.id} 的 timeline 用例必须至少声明一段命中`)
    assert.ok(hits.every(hit => typeof hit?.element === 'string'), `${item.id} 的每段命中必须声明元素`)
    const reacted = hits.filter(hit => hit?.reaction)
    assert.ok(reacted.every(hit => typeof hit.reaction.kind === 'string' && typeof hit.reaction.aura === 'string'), `${item.id} 的反应必须声明 kind 与 aura`)
  }
}

// 2. 引擎实跑值与手算值一致（这才是黄金集的意义：拿外部算出来的数字卡引擎）
const audit = await auditGolden({ root })
assert.deepEqual(audit.issues, [], `黄金集用例必须能跑通：${JSON.stringify(audit.issues)}`)
assert.equal(audit.actuals.length, cases.length, '实跑条数必须与用例一致')
for (const [index, actual] of audit.actuals.entries()) {
  const expected = cases[index].expected.total
  const tolerance = cases[index].tolerance
  const error = Math.abs(actual.total - expected) / expected
  assert.ok(error <= tolerance, `${actual.id} 实跑 ${actual.total} 与手算 ${expected} 相差 ${(error * 100).toFixed(6)}%`)
}

// 3. 入库的 actuals.json 与重算结果同步，防止有人只改一边
assert.equal(actualsRaw.actuals.length, cases.length, 'actuals 数量必须与 cases 一致')
for (const [index, actual] of actualsRaw.actuals.entries()) {
  assert.equal(actual.id, cases[index].id, `第 ${index + 1} 条 actual 的 id 必须与 cases 同序`)
  assert.ok(Math.abs(actual.total - audit.actuals[index].total) <= 1e-6, `${actual.id} 的入库实跑值与重算值不一致`)
}

// 4. 达标；改动期望值必须被拦
assert.equal(audit.report.gate, 'pass', `黄金集应达标：${audit.report.reason}`)
assert.equal(audit.report.counted, cases.length)
assert.ok(audit.report.max !== null && audit.report.max <= GOLDEN_THRESHOLDS.singleMax)

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

// 7. 发布最低数量按已比对的非占位用例统计，部分实跑仍可展示。
const checks = createChecks('黄金集发布与CLI回归')
const release = (items, actuals, minimumCases) => evaluateReleaseGate({
  result: base, golden: { cases: items, actuals }, ...(minimumCases ? { minimumCases } : {})
}).checks.find(check => check.id === 'golden')?.status
const partial = evaluateGolden(cases, actualsRaw.actuals.slice(0, 1))
checks.push('部分实跑保留一例计数', partial.counted, 1)
checks.push('部分实跑保留缺失行', partial.rows.filter(row => row.status === 'missing').length, cases.length - 1)
checks.push('一例实跑未达发布最低数量', release(cases, actualsRaw.actuals.slice(0, 1)), 'insufficient-data')
checks.push('九例实跑未达发布最低数量', release(cases, actualsRaw.actuals.slice(0, 9)), 'insufficient-data')
checks.push('没有实跑时证据不足', release(cases, []), 'insufficient-data')
checks.push('十例真实比对达到默认最低数量', release(cases, actualsRaw.actuals.slice(0, 10)), 'pass')
checks.push('自定义最低数量仍有效', release(cases, actualsRaw.actuals.slice(0, 2), 2), 'pass')
checks.push('占位用例全部不计发布数量', release(cases.map(item => ({ ...item, kind: 'synthetic' })), actualsRaw.actuals), 'insufficient-data')
checks.push('九例有效加占位用例仍不足', release(cases.map((item, index) => index < cases.length - 9 ? { ...item, kind: 'synthetic' } : item), actualsRaw.actuals), 'insufficient-data')
checks.push('十例有效加占位用例仍通过', release(cases.map((item, index) => index < cases.length - 10 ? { ...item, kind: 'synthetic' } : item), actualsRaw.actuals), 'pass')
checks.push('未知黄金来源类型被拦', release(cases.map((item, index) => index === 0 ? { ...item, kind: 'unsupported' } : item), actualsRaw.actuals), 'blocked')
checks.push('缺黄金来源类型被拦', release(cases.map((item, index) => index === 0 ? { ...item, kind: undefined } : item), actualsRaw.actuals), 'blocked')
checks.push('空来源被拦', release(cases.map((item, index) => index === 0 ? { ...item, source: ' ' } : item), actualsRaw.actuals), 'blocked')
checks.push('重复用例被拦', release([...cases.slice(0, -1), cases[0]], actualsRaw.actuals), 'blocked')
checks.push('非法期望值被拦', release(cases.map((item, index) => index === 0 ? { ...item, expected: { total: -1 } } : item), actualsRaw.actuals), 'blocked')
checks.push('完整黄金集超差被拦', release(drifted, actualsRaw.actuals), 'blocked')

// 8. 文件读取与CLI只在独立临时插件中执行，保留入库数据的原字节。
const tmpRoot = path.join(root, 'test', '.test-tmp')
fs.mkdirSync(tmpRoot, { recursive: true })
const fixture = fs.mkdtempSync(path.join(tmpRoot, 'golden-gates-'))
try {
  fs.cpSync(path.join(root, 'lib'), path.join(fixture, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true })
  fs.copyFileSync(path.join(root, 'scripts', 'audit-golden.mjs'), path.join(fixture, 'scripts', 'audit-golden.mjs'))
  fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
  const goldenDir = path.join(fixture, 'data', 'team-sim', 'golden')
  fs.mkdirSync(goldenDir, { recursive: true })
  const casesFile = path.join(goldenDir, 'cases.json')
  const actualsFile = path.join(goldenDir, 'actuals.json')
  const writeCases = items => fs.writeFileSync(casesFile, JSON.stringify({ ...casesRaw, cases: items }))
  const writeActuals = actuals => fs.writeFileSync(actualsFile, JSON.stringify({ ...actualsRaw, actuals }))
  const fixtureGolden = (await import(pathToFileURL(path.join(fixture, 'lib', 'model', 'GoldenSet.js')).href)).loadGoldenSet
  writeCases(cases)
  writeActuals(actualsRaw.actuals)
  checks.push('无分角色字段的旧结果读取保持兼容', fixtureGolden()?.actuals, actualsRaw.actuals)
  const contributionCases = cases.map(item => ({ ...item, expected: {
    ...item.expected, perActor: { a: item.expected.total * 0.9, b: item.expected.total * 0.1 }
  } }))
  const matchingActuals = actualsRaw.actuals.map(item => ({ ...item, perActor: { a: item.total * 0.9, b: item.total * 0.1 } }))
  writeCases(contributionCases)
  writeActuals(matchingActuals)
  checks.push('读取保留分角色实跑值', fixtureGolden()?.actuals, matchingActuals)
  checks.push('正确分角色占比发布通过', evaluateReleaseGate({ result: base, golden: fixtureGolden() }).status, 'pass')
  writeActuals(actualsRaw.actuals.map(item => ({ ...item, perActor: { a: item.total * 0.1, b: item.total * 0.9 } })))
  checks.push('总伤相同但角色贡献偏差被拦', evaluateReleaseGate({ result: base, golden: fixtureGolden() }).status, 'blocked')
  for (const [label, perActor] of [
    ['空值', null], ['字符串', 'invalid'], ['数组', [1, 2]], ['非数值分量', { a: null }]
  ]) {
    writeActuals(actualsRaw.actuals.map((item, index) => index === 0 ? { ...item, perActor } : item))
    checks.push(`非法分角色结果${label}使文件读取失败`, fixtureGolden(), undefined)
  }

  const cli = items => {
    writeCases(items)
    writeActuals([{ id: 'stale', total: -1 }])
    return spawnSync(process.execPath, [path.join(fixture, 'scripts', 'audit-golden.mjs')], { encoding: 'utf8', timeout: 30000 })
  }
  const healthyCli = cli(cases)
  checks.push('完整健康黄金集CLI成功退出', healthyCli.status, 0)
  checks.push('健康CLI仍写完整实跑结果', JSON.parse(fs.readFileSync(actualsFile, 'utf8')).actuals, audit.actuals)
  const failedCli = cli(drifted)
  checks.push('超差CLI失败退出', failedCli.status, 1)
  checks.ok('超差CLI保留失败结论', failedCli.stdout.includes('fail'))
  checks.push('超差CLI仍写诊断实跑结果', JSON.parse(fs.readFileSync(actualsFile, 'utf8')).actuals, audit.actuals)
  const syntheticCli = cli(cases.map(item => ({ ...item, kind: 'synthetic' })))
  checks.push('全占位CLI证据不足失败退出', syntheticCli.status, 1)
  checks.ok('全占位CLI保留证据不足结论', syntheticCli.stdout.includes('insufficient-data'))
  checks.push('全占位CLI仍写诊断实跑结果', JSON.parse(fs.readFileSync(actualsFile, 'utf8')).actuals, audit.actuals)
  const emptyCli = cli([])
  checks.push('空黄金集CLI证据不足失败退出', emptyCli.status, 1)
  checks.push('空黄金集CLI仍写空实跑结果', JSON.parse(fs.readFileSync(actualsFile, 'utf8')).actuals, [])
  const invalidCli = cli(cases.map((item, index) => index === 0 ? { ...item, source: '' } : item))
  checks.push('非法黄金契约CLI失败退出', invalidCli.status, 1)
  checks.push('非法黄金契约CLI保持原文件处理', JSON.parse(fs.readFileSync(actualsFile, 'utf8')).actuals, [{ id: 'stale', total: -1 }])
} finally {
  assert.ok(path.resolve(fixture).startsWith(`${path.resolve(tmpRoot)}${path.sep}`))
  fs.rmSync(fixture, { recursive: true, force: true })
}
assert.equal(checks.report(), 0, '黄金集发布与CLI回归必须全部通过')

console.log('golden ok')
