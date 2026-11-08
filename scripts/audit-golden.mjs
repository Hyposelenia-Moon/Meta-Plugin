/**
 * 黄金集审计：把 `data/team-sim/golden/cases.json` 里的手算用例交给内核重算，产出 `actuals.json`。
 *
 * 为什么单独一支脚本：
 *   - 期望值是**手算**的（推导写在用例的 source 里），不能由引擎自己生成；
 *   - 实跑值必须能被任何人复跑核对，所以固定成文件入库，测试再比对文件与重算结果是否一致。
 *
 * 只读 data/，只写 `data/team-sim/golden/actuals.json`（该文件是发布闸门的输入，入库）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CASES_REL = 'data/team-sim/golden/cases.json'
const ACTUALS_REL = 'data/team-sim/golden/actuals.json'

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

/**
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ cases: any[], actuals: any[], report: any, issues: any[] }>}
 */
export async function auditGolden (options = {}) {
  const root = options.root ?? path.resolve(import.meta.dirname, '..')
  const K = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')).href)

  const raw = readJson(path.join(root, CASES_REL))
  const cases = Array.isArray(raw?.cases) ? raw.cases : []
  const gameVersion = typeof raw?.gameVersion === 'string' ? raw.gameVersion : '7.1'
  const issues = K.validateGoldenCases(cases)

  const actuals = cases.map(item => {
    const result = K.calculateOrdinaryHit({
      kind: 'ordinary',
      gameVersion,
      source: `golden:${item.id}`,
      canCrit: true,
      ...item.scenario
    })
    if (!result || result.status !== 'calculated') {
      throw new Error(`${item.id} 的实跑没有算出结果：${JSON.stringify(result?.issues ?? result)}`)
    }
    /* 存 6 位小数：够闸门判误差，又不会因为浮点尾数天天改文件。 */
    return { id: item.id, total: Number(result.damage.toFixed(6)) }
  })

  const report = K.evaluateGolden(cases, actuals)
  return { cases, actuals, report, issues }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)

if (invokedDirectly) {
  const root = path.resolve(import.meta.dirname, '..')
  const { actuals, report, issues } = await auditGolden({ root })
  if (issues.length) {
    console.error('黄金集用例本身不合法：')
    for (const issue of issues) console.error(`  · ${issue.path}：${issue.message}`)
    process.exitCode = 1
  } else {
    const target = path.join(root, ACTUALS_REL)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify({
      schemaVersion: 1,
      note: '由 scripts/audit-golden.mjs 从 cases.json 的 scenario 重算写入；期望值见 cases.json，勿手改本文件。',
      actuals
    }, null, 2)}\n`)
    console.log(`黄金集：${actuals.length} 例，${report.gate}（${report.reason}）`)
    console.log(`  中位误差：${report.median ?? '—'}，最大误差：${report.max ?? '—'}`)
    console.log(`  已写入 ${ACTUALS_REL}`)
  }
}
