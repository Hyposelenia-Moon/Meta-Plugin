/**
 * 插件回归套件共用工具
 *
 * 约定（与 Mhydps-Plugin 的 test/ 一致）：
 *  - `pnpm test` = `node test/run.mjs`，**任意 cwd 可跑**；
 *  - 不启动 bot、不发真实网络请求（真实接口只由人工验证）；
 *  - 缺前置 → 打印「跳过」并 exit 0；
 *  - 临时产物写 `test/.test-tmp/`（gitignore），套件不得改动仓库里的源数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const srcDir = path.join(pluginRoot, 'src')
export const libDir = path.join(pluginRoot, 'lib')
export const dataDir = path.join(pluginRoot, 'data')
export const resourcesDir = path.join(pluginRoot, 'resources')
export const tmpDir = path.join(pluginRoot, 'test', '.test-tmp')

/** 建好临时目录并返回路径 */
export function ensureTmp () {
  fs.mkdirSync(tmpDir, { recursive: true })
  return tmpDir
}

/** 读 JSON（容忍 BOM） */
export function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
}

/** 读文本（容忍 BOM） */
export function readText (file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
}

/** 递归列出某目录下的文件（返回绝对路径数组） */
export function walkFiles (dir, filter = () => true) {
  const out = []
  const walk = (d) => {
    if (!fs.existsSync(d)) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (filter(full)) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

/** 前置缺失时打印「跳过」 */
export function skip (why) {
  console.log(`跳过：${why}`)
}

/** 断言收集器：`report()` 返回失败条数并打印汇总 */
export function createChecks (title) {
  const checks = []
  const push = (what, got, want) => {
    checks.push({ what, got, want, ok: JSON.stringify(got) === JSON.stringify(want) })
  }
  const ok = (what, pass) => checks.push({ what, got: !!pass, want: true, ok: !!pass })
  const report = () => {
    for (const c of checks) {
      console.log(`${c.ok ? '✓' : '✗'} ${c.what}${c.ok ? '' : `：${JSON.stringify(c.got)}（期望 ${JSON.stringify(c.want)}）`}`)
    }
    const bad = checks.filter(c => !c.ok).length
    console.log(`${title}：${checks.length - bad}/${checks.length}${bad ? ' ← 有失败' : ' 全通过'}`)
    return bad
  }
  return { checks, push, ok, report }
}
