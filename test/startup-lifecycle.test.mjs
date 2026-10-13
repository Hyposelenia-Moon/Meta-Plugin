/**
 * 启动编排：只载入磁盘缓存、不发网络请求，缓存缺失/损坏都不能阻断插件加载
 *
 * 用注入的 load/log 跑，不碰真实磁盘：这条路径错了会导致整个插件加载失败，
 * 而它原本最容易踩的坑就是「启动时去打网络」。
 */
import { checker, installFrameworkStubs, mod, requireDeps } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const { initStore } = await import(mod('model/startup.js'))

const { check, finish } = checker()

const messages = []
const log = {
  info: (m) => messages.push(String(m)),
  warn: (m) => messages.push(String(m)),
  error: (m) => messages.push(String(m))
}

// ---- 有缓存 ----
let ret = initStore({ load: () => ({ teams: 1394, teams2: 594, fetchedAt: Date.now() }), log })
check('返回载入结果', ret.loaded === true && ret.teams === 1394 && ret.teams2 === 594)
check('打印条数', messages.some(m => m.includes('DPS榜 1394 条') && m.includes('危战榜 594 条')), messages.join(' | '))

// ---- 无缓存 ----
messages.length = 0
ret = initStore({ load: () => ({ teams: 0, teams2: 0, fetchedAt: 0 }), log })
check('无缓存仍算载入成功', ret.loaded === true)
check('提示首次会惰性拉取', messages.some(m => m.includes('暂无本地缓存')), messages.join(' | '))

// ---- 损坏缓存 ----
messages.length = 0
ret = initStore({ load: () => { throw new Error('缓存文件损坏') }, log })
check('损坏时返回 loaded:false', ret.loaded === false && ret.teams === 0)
check('损坏时给出告警而不抛错', messages.some(m => m.includes('缓存文件损坏')), messages.join(' | '))

// ---- 默认依赖：注入的 load 不被调用之外的路径碰到 ----
messages.length = 0
ret = initStore({ load: () => ({ teams: 0, teams2: 0, fetchedAt: 0 }), log })
check('重复调用幂等', ret.teams === 0 && ret.teams2 === 0)

finish()
