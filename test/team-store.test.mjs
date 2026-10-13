/**
 * 榜单缓存：字段归一、磁盘往返、TTL 过期判定
 *
 * 关键口径是「站点原始记录 → 本插件记录」的归一（只保留展示要用的字段），
 * 以及缓存时间戳驱动的新鲜度判定（过期才重拉，避免每次查询都打站点）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, installFrameworkStubs, loadFixture, mod, requireDeps, tempDataDir } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

// 环境变量必须在 import 之前设置：TeamStore / config 在模块加载时读取
const dataDir = tempDataDir('team-store-data')
const cfgDir = tempDataDir('team-store-config')
process.env.META_DATA_DIR = dataDir
process.env.META_CONFIG_FILE = path.join(cfgDir, 'config.yaml')

const {
  normalizeTeams,
  normalizeTeams2,
  loadFromDisk,
  getSnapshot,
  getCounts,
  isStale,
  cacheInfo,
  resetStore,
  dataDir: storeDataDir
} = await import(mod('model/TeamStore.js'))

const { check, finish } = checker()

check('数据目录可用环境变量重定向', storeDataDir === path.resolve(dataDir), storeDataDir)

// ---- 归一化 ----
const raw = loadFixture('teams.sample.json')
const teams = normalizeTeams(raw)
check('保留全部合法记录', teams.length === raw.length)
check('剔除无成员/无 members 的记录', normalizeTeams([{ id: 'x', members: null }, { id: 'y', members: [] }]).length === 0)
check('video_url 归一为 video', teams[0].video.startsWith('https://'))
check('tags 恒为数组', teams.every(t => Array.isArray(t.tags)))
check('数字字段为数字', teams.every(t => typeof t.damage === 'number' && typeof t.cost === 'number'))
check('confirm 缺省视为已审核', normalizeTeams([{ id: 'z', members: [{ charId: '胡桃' }] }])[0].confirm === true)
check('confirm:false 保留', teams.find(t => t.id === 't-005').confirm === false)
check('非数组输入抛错', (() => {
  try {
    normalizeTeams({})
    return false
  } catch {
    return true
  }
})())

const raids = normalizeTeams2(loadFixture('teams2.sample.json'))
check('危战记录归一含 ver/boss/speed', raids.every(t => typeof t.ver === 'string' && typeof t.boss === 'number' && typeof t.speed === 'number'))
check('危战非数组输入抛错', (() => {
  try {
    normalizeTeams2('nope')
    return false
  } catch {
    return true
  }
})())

// ---- 磁盘往返 ----
fs.writeFileSync(path.join(dataDir, 'teams.json'), JSON.stringify(teams), 'utf8')
fs.writeFileSync(path.join(dataDir, 'teams2.json'), JSON.stringify(raids), 'utf8')
fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify({
  fetchedAt: Date.now(),
  teams: teams.length,
  teams2: raids.length,
  source: 'https://www.mhydps.cn'
}), 'utf8')

const loaded = loadFromDisk()
check('载入磁盘缓存条数正确', loaded.teams === teams.length && loaded.teams2 === raids.length, JSON.stringify(loaded))
check('快照可读', getSnapshot().teams.length === teams.length && getSnapshot().teams2.length === raids.length)
check('计数接口正确', getCounts().teams === teams.length)
check('刚写入的缓存不过期', isStale() === false)

let info = cacheInfo()
check('cacheInfo 带 TTL 与来源', info.ttlMinutes > 0 && info.source.includes('mhydps.cn'), JSON.stringify({ ttl: info.ttlMinutes, stale: info.stale }))
check('cacheInfo 年龄可计算', info.ageMs >= 0 && info.ageMs < 60000)

// ---- 过期判定 ----
fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify({
  fetchedAt: Date.now() - 61 * 60 * 1000,
  teams: teams.length,
  teams2: raids.length
}), 'utf8')
loadFromDisk()
check('超过 TTL 判定过期', isStale() === true)
check('过期时 cacheInfo 标记 stale', cacheInfo().stale === true)

// ---- 空缓存 ----
resetStore()
fs.rmSync(path.join(dataDir, 'teams.json'), { force: true })
fs.rmSync(path.join(dataDir, 'teams2.json'), { force: true })
fs.rmSync(path.join(dataDir, 'meta.json'), { force: true })
const empty = loadFromDisk()
check('无缓存时返回 0 条', empty.teams === 0 && empty.teams2 === 0)
check('无数据视为过期（触发首次拉取）', isStale() === true)

// ---- 损坏缓存不应抛错 ----
fs.writeFileSync(path.join(dataDir, 'teams.json'), '{ 坏 JSON', 'utf8')
resetStore()
let threw = false
try {
  loadFromDisk()
} catch {
  threw = true
}
check('损坏缓存不抛错（按无数据处理）', !threw)

finish()
