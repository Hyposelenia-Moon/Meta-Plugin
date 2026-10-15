/**
 * 状态页代理凭据泄露防护（2026-10-15 审核 P1）
 *
 * 审核点：`#meta状态` 对所有人开放，展示数据保存完整 `getProxy()` → 代理含认证时，
 * 图片、文本回退、"无缓存"提示都会暴露用户名/密码。
 *
 * 覆盖方式：
 *  1. **行为层**：`lib/components/proxy.js` 是无框架依赖的纯模块 → 直接 import 做真实断言；
 *  2. **结构层**：app 本体（`extends` 框架 plugin）在开发工作区不能 import（见 help-app 套件说明），
 *     所以对 `src/apps/status.ts` 做源码断言，保证三个输出路径都不再插值裸代理串。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('状态页代理脱敏')

const P = await import(pathToFileURL(path.join(libDir, 'components', 'proxy.js')).href)

// ---------- 1. 行为层 ----------
const FAKE = 'http://user:pass$&word@127.0.0.1:7890'
const NOAUTH = 'http://127.0.0.1:7890'
ok('proxySafe 去掉用户名与密码', !/user|pass|word/.test(P.proxySafe(FAKE)) && P.proxySafe(FAKE).includes('127.0.0.1:7890'), P.proxySafe(FAKE))
ok('proxySafe 保留无认证代理的 host:port', P.proxySafe(NOAUTH).includes('127.0.0.1:7890') && !P.proxySafe(NOAUTH).includes('@'), P.proxySafe(NOAUTH))
ok('proxySafe 空值/缺失 → 空串', P.proxySafe('') === '' && P.proxySafe(null) === '' && P.proxySafe(undefined) === '')
ok('proxySafe 兜底处理非 URL 写法', !/user|pass/.test(P.proxySafe('socks5://user:pass@127.0.0.1:1080')), P.proxySafe('socks5://user:pass@127.0.0.1:1080'))
ok('proxySafe 不破坏无认证的 socks 写法', P.proxySafe('socks5://127.0.0.1:1080') === 'socks5://127.0.0.1:1080', P.proxySafe('socks5://127.0.0.1:1080'))
ok('proxyHasAuth 只回答有没有', P.proxyHasAuth(FAKE) === true && P.proxyHasAuth(NOAUTH) === false && P.proxyHasAuth('') === false)

// ---------- 2. 结构层：app 三个输出路径 ----------
const src = readText(path.join(pluginRoot, 'src', 'apps', 'status.ts'))
ok('app 复用纯模块（不再自带副本）', src.includes("from '../components/proxy.js'") && !/export function proxySafe/.test(src))
push('不再把裸 proxy 放进展示字段', src.match(/proxy:\s*proxy\s*\|\|/g) || [], [])
ok('公共页只回显"是否配置"（主人也只多给 host:port）', /proxyShown = master \? proxySafe\(proxy\) : \(proxy \? '已配置' : ''\)/.test(src))
ok('展示字段带 proxyConfigured / proxyAuth', src.includes('proxyConfigured:') && src.includes('proxyAuth:'))
ok('按 e.isMaster 分级', src.includes('isMaster === true'))
ok('无缓存提示与文本回退都不插值裸 proxy', !/data\.proxy \|\| '未设置（直连）'/.test(src) && (src.match(/proxyConfigured/g) || []).length >= 3)
ok('图片与文本回退同源（一处生成、两处消费）', /respond\(e, 'status', data/.test(src) && /this\.textOf\(data\)/.test(src))
ok('凭据一旦出现会被替换为说明文案', /凭据不显示/.test(src))

const bad = report()
process.exit(bad ? 1 : 0)