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
for (const f of files) console.log(`${failed.includes(f) ? '✗' : '✓'} ${f}`)
console.log(`套件：${files.length - failed.length}/${files.length} 通过`)
process.exit(failed.length ? 1 : 0)
