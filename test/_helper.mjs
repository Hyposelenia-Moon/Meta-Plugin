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
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 框架把 `logger` / `segment` 挂在全局；套件在纯 node 下跑，这里补一个静默替身，
 * 让被测模块能安全走 catch 分支（例如坏 YAML 的回落），而不是炸在 "logger is not defined"。
 */
if (!globalThis.logger) {
  globalThis.logger = { info () {}, warn () {}, error () {}, mark () {}, debug () {} }
}
if (!globalThis.segment) {
  globalThis.segment = { image: (file) => ({ type: 'image', file }) }
}

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

/** 键序无关的稳定序列化：对象按键名排序，数组保持原序（用于断言比较） */
export function stableStringify (value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const key of Object.keys(v).sort()) out[key] = walk(v[key])
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}

/** 断言收集器：`report()` 返回失败条数并打印汇总 */
export function createChecks (title) {
  const checks = []
  const push = (what, got, want) => {
    checks.push({ what, got, want, ok: stableStringify(got) === stableStringify(want) })
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

/* ============================================================
 *  从 Mhydps-Plugin 迁入的套件基建（阶段 4.7）
 *
 *  下面这一节是为了让 Mhydps 的 19 个套件**几乎原样**在本仓库跑起来：
 *  它们用 `mod('model/x.js')` / `checker()` / `installFrameworkStubs()` / `loadFixture()` 这套 API。
 *  关键差异只有一处：`mod()` 在本仓库要落到 **`lib/`**（TS 编译产物在 `lib/` 下）。
 * ============================================================ */

/** 套件目录 */
export const testDir = path.join(pluginRoot, 'test')
/** bot 根（插件在 `plugins/` 下时就是 bot 根；工作区里通常不是 bot） */
export const appRoot = path.resolve(pluginRoot, '..', '..')
/** 离线样例目录 */
export const fixturesDir = path.join(testDir, 'fixtures')

/**
 * 生产代码 / 资源的 file URL
 *
 * ⚠ 与 Mhydps 的差别：本仓库是 TS 工程，运行时刻的**代码**在 `lib/` 下，而 `resources/`、`config/`
 *   这些随包资源仍在插件根。这里按「哪个真实存在」来解析，于是迁移过来的套件写法不用改：
 *   `mod('model/TeamStore.js')` → `<root>/lib/model/TeamStore.js`
 *   `mod('resources/help/help-cfg.js')` → `<root>/resources/help/help-cfg.js`
 */
export const mod = (relPath) => {
  const inLib = path.join(libDir, relPath)
  const inRoot = path.join(pluginRoot, relPath)
  return pathToFileURL(fs.existsSync(inLib) ? inLib : inRoot).href
}

/** 建好临时目录并返回（Mhydps 版名字） */
export function ensureTmpDir () {
  return ensureTmp()
}

/** 读一个离线样例（JSON） */
export function loadFixture (name) {
  return readJson(path.join(fixturesDir, name))
}

/** 造一个独立的临时数据目录（每次调用清空重建） */
export function tempDataDir (name) {
  const dir = path.join(ensureTmp(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 默认把运行时数据与配置指向套件临时目录
 *
 * Mhydps 原来用的是 `MHYDPS_DATA_DIR` / `MHYDPS_CONFIG_FILE`；本仓库改名为
 * `META_DATA_DIR` / `META_CONFIG_FILE`（配置模块与 TeamStore 读的就是这两个）。
 * 具体套件在自己的 import 之前重设即可覆盖。
 */
process.env.META_DATA_DIR = process.env.META_DATA_DIR || path.join(tmpDir, 'data')
process.env.META_CONFIG_FILE = process.env.META_CONFIG_FILE || path.join(tmpDir, 'config.yaml')
fs.mkdirSync(path.dirname(process.env.META_CONFIG_FILE), { recursive: true })
if (!fs.existsSync(process.env.META_CONFIG_FILE)) {
  const example = path.join(pluginRoot, 'config', 'config.yaml.example')
  if (fs.existsSync(example)) fs.copyFileSync(example, process.env.META_CONFIG_FILE)
}

/* ---------------- 前置检查（缺则跳过、不算失败） ---------------- */

/** 依赖是否可解析（插件自己的 node_modules 或 bot 根的） */
export function hasDependency (name) {
  return [
    path.join(pluginRoot, 'node_modules', name),
    path.join(appRoot, 'node_modules', name)
  ].some(p => fs.existsSync(p))
}

/** 前置：外部依赖 */
export function requireDeps (...names) {
  const missing = names.filter(n => !hasDependency(n))
  if (missing.length) {
    skip(`缺少依赖 ${missing.join('、')}（在插件目录执行 pnpm install，或把插件放进 bot 的 plugins/ 后安装）`)
    process.exit(0)
  }
}

/** bot 环境是否具备渲染后端 */
export function hasBotRenderer () {
  return fs.existsSync(path.join(appRoot, 'lib', 'puppeteer', 'puppeteer.js'))
}

/** 找一个可用浏览器：返回路径或空串（`META_TEST_BROWSER` 可覆盖） */
export function findBrowser () {
  return [
    process.env.META_TEST_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ].filter(Boolean).find(p => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  }) || ''
}

/**
 * 前置：bot 渲染环境（渲染类套件用）
 *
 * 本仓库额外要求「插件以 `plugins/<本插件目录名>` 的形式被安装」：渲染按 cwd（bot 根）
 * 解析 `plugins/<插件>/resources/...`，工作区里跑会找不到资源 → 直接跳过。
 */
export function requireRenderEnv () {
  if (!hasBotRenderer()) {
    skip('不在 bot 环境中（插件根上两级没有 lib/puppeteer/puppeteer.js）')
    process.exit(0)
  }
  const installed = path.join(appRoot, 'plugins', path.basename(pluginRoot))
  if (!fs.existsSync(installed)) {
    skip(`插件未安装在 ${installed}（渲染按该路径解析模板与资源）`)
    process.exit(0)
  }
  if (!findBrowser()) {
    skip('找不到浏览器（可设 META_TEST_BROWSER=<可执行文件路径>）')
    process.exit(0)
  }
  if (!hasDependency('yaml')) {
    skip('缺少依赖 yaml')
    process.exit(0)
  }
}

/* ---------------- 断言计数（Mhydps 风格） ---------------- */

/**
 * 建一个断言计数器
 *
 * 与 `createChecks` 并存：迁入的套件沿用这一套（`✅/❌` + 末行「结果：通过 X / 失败 Y」），
 * 退出码语义一致（失败 → exit 1），所以 `run.mjs` 不用改。
 */
export function checker () {
  let pass = 0
  let fail = 0
  return {
    check (name, ok, extra = '') {
      ok ? pass++ : fail++
      console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`)
    },
    counts: () => ({ pass, fail }),
    finish () {
      console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
      process.exit(fail === 0 ? 0 : 1)
    }
  }
}

/* ---------------- 框架全局桩 ---------------- */

/** 套件期间收集到的日志 */
export const logs = []

/**
 * 安装框架全局桩（生产代码依赖 bot 注入的 `logger` 等全局）
 *
 * @param opts.collect 是否把日志收进 `logs`（默认 true，不打印）
 * @param opts.echoError 是否把 `logger.error` 打到 stderr
 */
export function installFrameworkStubs (opts = {}) {
  const { collect = true, echoError = false } = opts
  const record = (level) => (...args) => {
    if (collect) logs.push(args)
    if (echoError && level === 'error') console.error('[error]', ...args.map(a => (a && a.stack) || String(a)))
  }
  const paint = () => (v) => String(v ?? '')
  globalThis.logger = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    mark: record('mark'),
    debug: record('debug'),
    green: paint(),
    red: paint(),
    cyan: paint(),
    yellow: paint(),
    blue: paint(),
    gray: paint(),
    magenta: paint(),
    white: paint(),
    bold: paint()
  }
  globalThis.redis = { get: async () => null, set: async () => {}, del: async () => {} }
  globalThis.cfg = { bot: {}, renderer: {} }
  globalThis.segment = { image: (data) => ({ type: 'image', file: data }) }
}
