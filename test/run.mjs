/**
 * 回归套件运行器：`pnpm test` = `node test/run.mjs`
 *
 * - 自动发现同目录下的 `*.test.mjs`，**逐个以子进程运行**（一个套件崩了不影响其它）；
 * - 任意 cwd 可跑；不启动 bot、不发真实网络；
 * - 全部通过 exit 0，否则 exit 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const files = fs.readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort()

if (!files.length) {
  console.log('没有找到任何 *.test.mjs')
  process.exit(0)
}

const failed = []
for (const f of files) {
  console.log(`\n===== ${f} =====`)
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: 'inherit' })
  const code = r.status === null ? 1 : r.status
  if (code !== 0) failed.push(f)
}

console.log(`\n===== 汇总 =====`)
// GitHub Actions 里额外打一条 annotation：失败套件会直接出现在 Run 页的 Annotations，
// 不必登录去翻整段 job 日志（匿名调 API 也能读到 `/check-runs/<job>/annotations`）。
if (failed.length && process.env.GITHUB_ACTIONS === 'true') {
  for (const f of failed.slice(0, 10)) {
    console.log(`::error title=回归套件失败：${f}::node test/${f} 退出码非 0，完整输出见本步骤日志`)
  }
}
for (const f of files) console.log(`${failed.includes(f) ? '✗' : '✓'} ${f}`)
console.log(`套件：${files.length - failed.length}/${files.length} 通过`)
process.exit(failed.length ? 1 : 0)
