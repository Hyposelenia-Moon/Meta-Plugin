/**
 * 门禁：编译产物 `lib/` 不得落后于源码 `src/`（设计文档 §4.1 第 2 条）
 *
 * 背景：bot 侧只加载 `lib/`（编译产物，随仓库入库）。若改了 `src/` 忘了 `pnpm build`，
 * bot 跑的还是旧代码，表现为"改了没生效"——这条套件专门拦住它。
 *
 * 判定：`src` 下的每个 `.ts`（`.d.ts` 除外，它不产出 JS）都要有对应的 `lib` 侧 `.js`，
 *       且 `lib` 侧 mtime ≥ `src` 侧 mtime。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createChecks, libDir, srcDir, walkFiles } from './_helper.mjs'

const { push, ok, report } = createChecks('编译产物新鲜度（lib vs src）')

// `lib/` 入库（bot 侧只允许 git pull），所以"目录不存在"本身就是异常：直接失败，不做跳过
if (!fs.existsSync(libDir)) {
  console.log('✗ lib/ 不存在：编译产物必须入库（先跑 `pnpm build`，再把 lib/ 一起提交）')
  process.exit(1)
}

const srcFiles = walkFiles(srcDir, f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
const missing = []
const stale = []

for (const src of srcFiles) {
  const rel = path.relative(srcDir, src).replace(/\.ts$/, '.js')
  const lib = path.join(libDir, rel)
  if (!fs.existsSync(lib)) {
    missing.push(rel)
    continue
  }
  if (fs.statSync(lib).mtimeMs < fs.statSync(src).mtimeMs) stale.push(rel)
}

push('src 下的 TS 文件数 > 0', srcFiles.length > 0, true)
push('每个 src 都有对应的 lib 产物', missing, [])
push('lib 产物不比 src 旧', stale, [])
ok('lib/index.js 存在', fs.existsSync(path.join(libDir, 'index.js')))

const bad = report()
if (bad) console.log('提示：先跑 `pnpm build` 再跑套件（或把 lib/ 一起提交）')
process.exit(bad ? 1 : 0)
