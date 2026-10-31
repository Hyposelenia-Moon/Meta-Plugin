import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'
const { GOLDEN_THRESHOLDS, validateGoldenCases, evaluateGolden } = await import(mod('modules/teamSimulation/metrics.js'))

// 黄金集脚手架只做算术：不提供期望值，也不读文件。
const measured = (id, source, total, perActor) => ({ id, source, kind: 'measured', expected: { total, perActor } })

// 0. 公开出口：模块外只认 index.js，导出缺一个就断。
{
  const barrel = await import(mod('modules/teamSimulation/index.js'))
  for (const name of ['validateCharacterBuild', 'buildPermanentStats', 'requiredEffectSources', 'calculateOrdinaryHit', 'simulateTimeline', 'calculateTimelineDamage', 'planMechanisms', 'simulateTeam', 'buildTeamRunReport', 'formatTeamRunReport', 'evaluateGolden', 'validateGoldenCases', 'checkDpsStandard', 'dpsWindowFrames']) {
    assert.equal(typeof barrel[name], 'function', `index.js 必须导出 ${name}`)
  }
  for (const name of ['FRAME_TIERS', 'TARGET_PRESETS', 'DPS_STANDARD', 'GOLDEN_THRESHOLDS', 'SCHEMA_VERSION']) {
    assert.notEqual(barrel[name], undefined, `index.js 必须导出 ${name}`)
  }
}
// 1. 用例自校验：来源、正期望值、重复 id。
{
  assert.deepEqual(validateGoldenCases([measured('c1', '录像 2026-10-30.mp4', 10000)]), [])
  const empty = validateGoldenCases([])
  assert.deepEqual(empty, [], '空集本身是合法的（只是闸门判 insufficient-data）')

  const bad = [
    { id: '', source: '', kind: 'measured', expected: { total: 0 } },
    { id: 'dup', source: 'x', kind: 'measured', expected: { total: 1 } },
    { id: 'dup', source: 'y', kind: 'measured', expected: { total: 1 } },
    { id: 'k', source: 'x', kind: 'guess', expected: { total: 1 } }
  ]
  const issues = validateGoldenCases(bad)
  const paths = issues.map(issue => issue.path)
  assert.ok(paths.includes('cases.0.id'), '缺 id 必须报')
  assert.ok(paths.includes('cases.0.source'), '缺来源必须报')
  assert.ok(paths.includes('cases.0.expected.total'), '非正期望值必须报')
  assert.ok(paths.includes('cases.2.id'), '重复 id 必须报')
  assert.ok(paths.includes('cases.3.kind'), '未知类型必须报')
  assert.equal(issues.find(issue => issue.path === 'cases.3.kind').code, 'unsupported')

  assert.equal(validateGoldenCases('不是数组')[0].code, 'invalid')
}

// 2. 全通过：误差与闸门都按阈值算。
{
  const cases = [measured('a', 'src-a', 10000), measured('b', 'src-b', 20000)]
  const report = evaluateGolden(cases, [
    { id: 'a', total: 10500 },
    { id: 'b', total: 19000 }
  ])
  assert.equal(report.rows.length, 2)
  assert.ok(Math.abs(report.rows[0].error - 0.05) < 1e-9)
  assert.ok(Math.abs(report.rows[1].error - 0.05) < 1e-9)
  assert.equal(report.counted, 2)
  assert.equal(report.passed, 2)
  assert.equal(report.gate, 'pass')
  assert.ok(Math.abs(report.median - 0.05) < 1e-9)
  assert.ok(Math.abs(report.max - 0.05) < 1e-9)
}

// 3. 中位数超阈值 → fail，且原因点名阈值。
{
  const cases = [measured('a', 's', 1000), measured('b', 's', 1000), measured('c', 's', 1000)]
  const report = evaluateGolden(cases, [
    { id: 'a', total: 1150 },
    { id: 'b', total: 180 },
    { id: 'c', total: 1140 }
  ])
  assert.equal(report.gate, 'fail')
  assert.ok(report.reason.includes('中位'))
  assert.ok(report.median > GOLDEN_THRESHOLDS.totalMedian)
}

// 4. 单例超容差 → fail，即使中位数很低。
{
  const cases = [measured('a', 's', 1000), measured('b', 's', 1000), measured('c', 's', 1000), measured('d', 's', 1000), measured('e', 's', 1000)]
  const report = evaluateGolden(cases, [
    { id: 'a', total: 1000 },
    { id: 'b', total: 1000 },
    { id: 'c', total: 1000 },
    { id: 'd', total: 1000 },
    { id: 'e', total: 1300 }
  ])
  assert.equal(report.gate, 'fail')
  assert.ok(report.reason.includes('单例'))
  assert.ok(report.reason.includes('e'))
  assert.equal(report.rows.find(row => row.id === 'e').status, 'failed')
}

// 5. 分角色贡献偏差也算失败；只差总伤时不报贡献。
{
  const cases = [{ ...measured('a', 's', 1000, { itto: 800, albedo: 200 }) }]
  const report = evaluateGolden(cases, [{ id: 'a', total: 1000, perActor: { itto: 500, albedo: 500 } }])
  assert.ok(Math.abs(report.rows[0].contributionError - 0.3) < 1e-9, String(report.rows[0].contributionError))
  assert.equal(report.gate, 'fail')
  assert.ok(report.rows[0].message.includes('贡献偏差'))

  const pass = evaluateGolden(cases, [{ id: 'a', total: 1000, perActor: { itto: 820, albedo: 180 } }])
  assert.equal(pass.gate, 'pass')
  assert.ok(Math.abs(pass.rows[0].contributionError - 0.02) < 1e-9)
}

// 6. 缺实跑 → missing；不按 0 参与统计，也不因为缺数据就判过。
{
  const report = evaluateGolden([measured('a', 's', 1000), measured('b', 's', 1000)], [{ id: 'a', total: 1000 }])
  assert.equal(report.rows[1].status, 'missing')
  assert.equal(report.rows[1].error, null)
  assert.equal(report.counted, 1)
  assert.equal(report.gate, 'pass')
}

// 7. synthetic 只展示、不计入闸门：真实用例为 0 时判 insufficient-data。
{
  const cases = [{ id: 's', source: 'placeholder', kind: 'synthetic', expected: { total: 1000 } }]
  const report = evaluateGolden(cases, [{ id: 's', total: 3800 }])
  assert.equal(report.rows[0].status, 'failed')
  assert.equal(report.counted, 0)
  assert.equal(report.gate, 'insufficient-data')
  assert.ok(report.reason.includes('synthetic'))
}

// 8. 期望值非正 → unmeasurable，不拿绝对值硬算。
{
  const report = evaluateGolden([{ id: 'z', source: 's', kind: 'measured', expected: { total: 1 } }], [{ id: 'z', total: 0 }])
  assert.equal(report.rows[0].error, 1)
  const zero = evaluateGolden([{ id: 'z', source: 's', kind: 'measured', expected: { total: 1 } }], [{ id: 'z', total: Number.NaN }])
  assert.equal(zero.rows[0].status, 'unmeasurable')
  assert.equal(zero.rows[0].error, null)
  assert.equal(zero.gate, 'insufficient-data')
}

// 9. 自定义阈值覆盖默认值；样本不足三条时只看单例容差，中位数门槛不参与。
{
  const cases = [measured('a', 's', 1000)]
  const loose = evaluateGolden(cases, [{ id: 'a', total: 1300 }], { singleMax: 0.5 })
  assert.equal(loose.gate, 'pass')
  const tight = evaluateGolden(cases, [{ id: 'a', total: 1300 }], { singleMax: 0.2 })
  assert.equal(tight.gate, 'fail')
  assert.ok(tight.reason.includes('单例'))
}

console.log('team-sim-metrics ok')
