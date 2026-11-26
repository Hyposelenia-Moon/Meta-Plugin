/**
 * 回归套件运行器：`pnpm test` = `node test/run.mjs`
 *
 * - 自动发现同目录下的 `*.test.mjs`，**逐个以子进程运行**（一个套件崩了不影响其它）；
 * - 任意 cwd 可跑；不启动 bot、不发真实网络；
 * - 全部通过 exit 0，否则 exit 1；
 * - GitHub Actions 里把失败套件的**报错尾巴**打进 annotation：匿名也能通过
 *   `/check-runs/<job>/annotations` 读到，不用登录翻整段 job 日志。
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

/** 取「报错尾巴」：从最后一条失败标记起往后 8 行，压成一行 */
function tailOf (out) {
  const lines = out.replace(/\r/g, '').split('\n').map(line => line.trimEnd()).filter(line => line.trim())
  if (!lines.length) return ''
  const marker = /^(✗|not ok)|\b(AssertionError|TypeError|RangeError|ReferenceError|SyntaxError)\b|^Error\b|^Error: /
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (marker.test(lines[i])) { start = i; break }
  }
  const picked = start >= 0 ? lines.slice(start, start + 8) : lines.slice(-6)
  // workflow command 里 `%` 是转义前缀，换行已压平；再兜一层长度
  return picked.join(' ⏎ ').replace(/%/g, '％').slice(0, 1200)
}

const failed = []
for (const f of files) {
  console.log(`\n===== ${f} =====`)
  const r = spawnSync(process.execPath, [path.join(here, f)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  process.stdout.write(out)
  const code = r.status === null ? 1 : r.status
  if (code !== 0) {
    if (r.error) console.log(`（子进程异常：${r.error.message}）`)
    failed.push({ file: f, code, tail: tailOf(out) || '（没有输出）' })
  }
}

console.log(`\n===== 汇总 =====`)
// GitHub Actions 里额外打 annotation：失败套件与报错尾巴会直接出现在 Run 页的 Annotations。
// 注意单步最多 10 条 error annotation，所以只打**一条**汇总，避免失败多时被截断。
if (failed.length && process.env.GITHUB_ACTIONS === 'true') {
  const body = failed
    .map(x => `${x.file}（退出码 ${x.code}）：${x.tail}`)
    .join(' ｜ ')
    .slice(0, 20000)
  console.log(`::error title=回归套件失败 ${failed.length} 个::${body}`)
}
for (const f of files) console.log(`${failed.some(x => x.file === f) ? '✗' : '✓'} ${f}`)
console.log(`套件：${files.length - failed.length}/${files.length} 通过`)
process.exit(failed.length ? 1 : 0)