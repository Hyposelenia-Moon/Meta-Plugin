/**
 * akasha 浏览器：冷启动并发、proxy 落地、UID 从 query 取（2026-10-15 审核 P2 #12 + 附加项）
 *
 * 浏览器不能在开发工作区里真启（需要 bot 环境与 chromium），所以这里是：
 *  1. 行为层 —— 用一个可控的"启动桩"复现"并发各自启动"与"共享同一次启动"的差异；
 *  2. 结构层 —— 断言真实实现共享启动 Promise、失败清空、proxy 进启动参数、UID 认 query。
 */
import path from 'node:path'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('akasha 浏览器启动与取数')

// ---------- 1. 行为层：共享启动 Promise 的差异 ----------
const makeLauncher = () => {
  let launches = 0
  const launch = async () => { launches++; await new Promise(r => setTimeout(r, 5)); return { id: launches } }
  return { launch, count: () => launches }
}

// 旧写法：每个并发调用各自 launch
{
  const L = makeLauncher()
  const getBrowserOld = async () => { const b = await L.launch(); return b }
  const got = await Promise.all([1, 2, 3].map(getBrowserOld))
  // （旧写法的对照：并发各自 launch，仅作说明，不做门禁 —— 语言层的 Promise 语义已确定）
}
// 新写法：共享同一次启动 Promise
{
  const L = makeLauncher()
  let shared = null
  const getBrowserNew = async () => {
    if (!shared) {
      shared = (async () => {
        try { return await L.launch() } finally { shared = null }
      })()
    }
    return await shared
  }
  const got = await Promise.all([1, 2, 3].map(getBrowserNew))
  ok('修复：三个并发只启动一次且拿到同一个实例', L.count() === 1 && new Set(got.map(b => b.id)).size === 1, `launch ${L.count()} 次`)
}
// 失败后能重试
{
  let attempt = 0
  let shared = null
  const launch = async () => { attempt++; if (attempt === 1) throw new Error('boom'); return { id: attempt } }
  const getBrowser = async () => {
    if (!shared) shared = (async () => { try { return await launch() } finally { shared = null } })()
    return await shared
  }
  let firstFailed = false
  try { await getBrowser() } catch { firstFailed = true }
  const second = await getBrowser()
  ok('启动失败后状态被清空，下一次能重试', firstFailed && second.id === 2, `attempt=${attempt}`)
}

// ---------- 2. 结构层 ----------
const src = readText(path.join(pluginRoot, 'src', 'model', 'AkashaBrowser.ts'))
ok('启动调用点收敛到一处（并发入口唯一）', (src.match(/puppeteer\.launch\(/g) || []).length === 1)
ok('#12 用共享的 launching Promise', /let launching: Promise<BrowserLike> \| null = null/.test(src) && /if \(!launching\) \{/.test(src) && /launching = \(async/.test(src))
ok('#12 成功/失败都清空启动状态', /finally \{\s*\n\s*launching = null/.test(src))
ok('#12 启动完成即赋给 ownBrowser（并发者直接复用）', /ownBrowser = browser\s+\/\/ 在这里赋值/.test(src))
ok('proxy 进启动参数（之前只被接收）', /--proxy-server=\$\{proxy\}/.test(src) && /String\(loadConfig\(\)\.proxy \|\| ''\)/.test(src))
ok('UID 认 query（builds 这类接口）', /const uidFromQuery = String\(parsed\.searchParams\.get\('uid'\)/.test(src) && /const uid = \/\^\\d\{9,10\}\$\/\.test\(uidFromQuery\) \? uidFromQuery : uidFromPath/.test(src))
ok('/api/builds/ 可被拦截', /leaderboards\|builds\)/.test(src))
ok('有 UID 时页面地址仍是个人页（保证 builds 会被站点自己请求）', /uid \? `https:\/\/akasha\.cv\/profile\/\$\{uid\}` : 'https:\/\/akasha\.cv\/'/.test(src))

const bad = report()
process.exit(bad ? 1 : 0)