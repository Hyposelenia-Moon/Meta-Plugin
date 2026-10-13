/**
 * akasha 接口层：端点拼装、取数注入、缓存往返、错误映射
 *
 * 全程离线：用 setTransport() 注入假取数实现（真实取数要么被 Cloudflare 挡、要么需要浏览器会话，
 * 都不该出现在回归套件里）。fixtures 是从真实响应脱敏裁出来的。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, installFrameworkStubs, loadFixture, mod, requireDeps, tempDataDir } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const dataDir = tempDataDir('akasha-client-data')
process.env.META_DATA_DIR = dataDir
process.env.META_CONFIG_FILE = path.join(tempDataDir('akasha-client-config'), 'config.yaml')
// 本套件用注入的假 transport 测解析与缓存（不发真实请求）→ 需要显式开联网开关
fs.mkdirSync(path.dirname(process.env.META_CONFIG_FILE), { recursive: true })
fs.writeFileSync(process.env.META_CONFIG_FILE, 'networkEnabled: true\n', 'utf8')

const {
  setTransport,
  akashaGet,
  fetchAkashaAccount,
  fetchAkashaCalculations,
  fetchAkashaProfile,
  readAkashaCache,
  writeAkashaCache,
  clearAkashaCache,
  akashaCacheFile,
  AKASHA_ERROR
} = await import(mod('model/AkashaClient.js'))

const { check, finish } = checker()

const account = loadFixture('akasha.account.sample.json')
const calc = loadFixture('akasha.calc.sample.json')

/** 记录调用并回放 fixture 的假取数 */
const calls = []
const replay = (routes) => async (url, opts = {}) => {
  calls.push({ url, opts })
  for (const [match, body, status = 200] of routes) {
    if (url.includes(match)) return { status, text: typeof body === 'string' ? body : JSON.stringify(body) }
  }
  return { status: 404, text: '{"error":"not found"}' }
}

// ---- 端点拼装 ----
setTransport(replay([
  ['/api/user/100000000', account],
  ['/api/getCalculationsForUser/100000000', calc],
  ['/api/textmap/', { translation: { 'hu tao': '胡桃', 'ballad of the fjords': '峡湾长歌' } }]
]))
await fetchAkashaAccount('100000000')
check('账号端点是 /api/user/<uid>', calls.at(-1).url === 'https://akasha.cv/api/user/100000000', calls.at(-1).url)
check('请求头带浏览器标识与 Referer', /Chrome/.test(calls.at(-1).opts.headers['User-Agent']) && calls.at(-1).opts.headers.Referer === 'https://akasha.cv/')
check('取数走注入的 transport（默认直连不会真的发请求）', typeof calls.at(-1).opts.timeoutMs === 'number')

await fetchAkashaCalculations('100000000')
check('练度端点是 /api/getCalculationsForUser/<uid>', calls.at(-1).url.includes('/api/getCalculationsForUser/100000000'), calls.at(-1).url)

const trans = await akashaGet('textmap/zh-CN', { 'words[]': ['Hu Tao', 'Ballad of the Fjords'] })
check('textmap 的 words[] 是重复参数', calls.at(-1).url.includes('words%5B%5D=Hu+Tao') && calls.at(-1).url.includes('words%5B%5D=Ballad'), decodeURIComponent(calls.at(-1).url))
check('textmap 返回 translation 映射', trans?.translation?.['hu tao'] === '胡桃', JSON.stringify(trans))

// ---- 错误映射 ----
setTransport(async () => ({ status: 403, text: '<!DOCTYPE html><html><head><title>Just a moment...</title>' }))
let err = null
try { await fetchAkashaAccount('100000000') } catch (e) { err = e }
check('Cloudflare 挑战页 → AKASHA_BLOCKED', err?.code === AKASHA_ERROR.blocked, err?.message || 'no error')

setTransport(async () => ({ status: 404, text: '{"error":"no such user"}' }))
err = null
try { await fetchAkashaCalculations('100000000') } catch (e) { err = e }
check('404 → AKASHA_NOT_FOUND', err?.code === AKASHA_ERROR.notFound, err?.message || 'no error')

setTransport(async () => ({ status: 200, text: 'not json at all' }))
err = null
try { await akashaGet('user/1') } catch (e) { err = e }
check('非 JSON → AKASHA_PARSE', err?.code === AKASHA_ERROR.parse, err?.message || 'no error')

// ---- 缓存往返 ----
clearAkashaCache()
check('未缓存时读缓存为 null', readAkashaCache('100000000') === null)
check('写缓存成功', writeAkashaCache('100000000', { account: account.data.account, calculations: calc.data }) === true)
check('缓存文件落在 data/akasha/<uid>.json', fs.existsSync(akashaCacheFile('100000000')), akashaCacheFile('100000000'))
const hit = readAkashaCache('100000000')
check('缓存读回账号与角色', Boolean(hit?.account?.playerInfo) && hit.calculations.length === 2)
check('缓存过期（TTL 为负）视为未命中', readAkashaCache('100000000', -1) === null, '负 TTL 应过期')

// 命中缓存时不再发请求
clearAkashaCache()
writeAkashaCache('100000000', { account: account.data.account, calculations: calc.data })
calls.length = 0
setTransport(replay([['/api/', '{"data":null}']]))
const fromCache = await fetchAkashaProfile('100000000')
check('命中缓存时不发请求', fromCache.cached === true && calls.length === 0, `${calls.length} 次请求`)

// force 时强制刷新
setTransport(replay([
  ['/api/user/', { data: { account: account.data.account } }],
  ['/api/getCalculationsForUser/', { data: calc.data }],
  ['/api/textmap/', { translation: {} }]
]))
calls.length = 0
const forced = await fetchAkashaProfile('100000000', { force: true })
check('force=true 时重新取数', forced.cached === false && calls.length >= 2, `${calls.length} 次请求`)

// 缓存损坏不影响功能
fs.writeFileSync(akashaCacheFile('100000000'), '{ 坏 JSON', 'utf8')
check('损坏缓存视为未命中（不抛错）', readAkashaCache('100000000') === null)

clearAkashaCache('100000000')
check('清缓存后文件消失', !fs.existsSync(akashaCacheFile('100000000')))

setTransport(null)
finish()
