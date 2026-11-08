import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot, skip } from './_helper.mjs'

// 附着口径基线：真实轴在 declared / simulated 两种模式下都要能算出来，
// 且「没有元素反应的队伍」两种模式必须逐位相等——否则说明状态机在别处泄漏。
const miaoRoot = process.env.MIAO_ROOT ?? 'D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs'
const { ok, report } = createChecks('队伍模拟 附着基线审计')

if (!fs.existsSync(path.join(miaoRoot, 'character'))) {
  skip(`缺少 miao 数据目录 ${miaoRoot}（基线审计需要运行时永久数据）`)
} else {
  const { auditRotations } = await import(pathToFileURL(path.join(pluginRoot, 'scripts/audit-aura-baseline.mjs')).href)
  const result = await auditRotations({ root: pluginRoot, miaoRoot })

  ok('每条轴都跑出结果', result.total > 0 && result.rows.length === result.total)
  ok('全部轴两种模式都 calculated', result.completed === result.total)

  const failed = result.rows.filter(row => row.status !== 'ok')
  ok('没有失败的轴', failed.length === 0)
  if (failed.length) console.log('  失败：' + failed.map(row => `${row.file}:${row.error ?? row.declared?.status}`).join('；'))

  const geo = result.rows.find(row => row.file === 'geo-four.json')
  ok('纯岩轴存在', Boolean(geo))
  if (geo) {
    ok('纯岩轴 declared 与 simulated 总伤一致', geo.delta === 0)
    ok('纯岩轴两种模式命中行数一致', geo.declared.rows === geo.simulated.rows)
    ok('纯岩轴没有反应行', geo.declared.reactionRows === 0 && geo.simulated.reactionRows === 0)
  }

  // simulated 只会在「补上声明缺失的反应」时加伤害；若出现反向，说明状态机把已有声明覆盖掉了。
  const reversed = result.rows.filter(row => typeof row.delta === 'number' && row.delta < 0)
  ok('simulated 不应低于 declared', reversed.length === 0)
  if (reversed.length) console.log('  反向：' + reversed.map(row => `${row.file}:${row.delta}`).join('；'))
}

process.exitCode = report() ? 1 : 0
