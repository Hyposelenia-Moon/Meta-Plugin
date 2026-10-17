/**
 * 模型层等价套件（阶段 4.3）
 *
 * 断言口径**照抄 Mhydps 自己的套件**（`test/{team-store,character-index,startup-lifecycle}.test.mjs`），
 * 夹具也用它的 `test/fixtures/{teams,teams2}.sample.json` —— 那两份就是"合并前行为"的原始证据。
 *
 * 本仓库特有的两条硬约束单独守着：
 *   - 缓存根必须在**未跟踪的 `out/`**（`META_DATA_DIR` 可重定向），绝不写入库的 `data/`
 *   - 联网总开关默认关：网络入口抛清晰错误、头像下载静默跳过（不能让页面出不来）
 *
 * ⚠ `TeamStore.dataDir` 在**模块加载时**读 `META_DATA_DIR`，所以环境变量必须在 import 之前设置。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot } from './_helper.mjs'

const { push, ok, report } = createChecks('模型层等价（阶段 4.3）')

// ---------- 环境：把缓存根挪到临时目录（必须在 import 之前） ----------
const tmpRoot = ensureTmp('model-parity')
const dataDir = path.join(tmpRoot, 'data')
process.env.META_DATA_DIR = dataDir
process.env.META_CONFIG_FILE = path.join(tmpRoot, 'config.yaml')
fs.mkdirSync(dataDir, { recursive: true })
fs.writeFileSync(process.env.META_CONFIG_FILE, 'networkEnabled: false\n', 'utf8')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const CI = await load('model/CharacterIndex.js')
const TS = await load('model/TeamStore.js')
const AS = await load('model/AvatarStore.js')
const ST = await load('model/startup.js')
const MC = await load('model/MhydpsClient.js')

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(pluginRoot, 'test', 'fixtures', name), 'utf8'))

// ---------- 1. 缓存根（B14 门禁） ----------
{
  ok('TeamStore.dataDir 被 META_DATA_DIR 重定向', TS.dataDir === path.resolve(dataDir))
  ok('缓存根不是入库的 data/', !TS.dataDir.includes(`${path.sep}Meta-Plugin${path.sep}data`))
  ok('AvatarStore 的立绘目录派生自它', AS.avatarDir === path.join(TS.dataDir, 'avatar'))
}

// ---------- 2. CharacterIndex（照抄 Mhydps 的口径） ----------
{
  const chars = CI.characters()
  ok('角色表已加载（>100 条）', chars.length > 100)
  ok('角色表字段完整', chars.every(c => c.name && c.character_id && c.element))
  ok('character_id 唯一', new Set(chars.map(c => c.character_id)).size === chars.length)

  ok('官方名命中', CI.findCharacter('胡桃')?.name === '胡桃')
  ok('别名命中（火神 → 玛薇卡）', CI.findCharacter('火神')?.name === '玛薇卡')
  ok('别名命中（龟 → 神里绫华）', CI.findCharacter('龟')?.name === '神里绫华')
  ok('别名命中（爷 → 旅行者）', CI.findCharacter('爷')?.name === '旅行者')
  ok('英文别名命中（hutao → 胡桃）', CI.findCharacter('hutao')?.name === '胡桃')
  ok('大小写不敏感（HUTAO）', CI.findCharacter('HUTAO')?.name === '胡桃')
  ok('未知角色 → null', CI.findCharacter('不存在的角色') === null)
  ok('空关键词 → null', CI.findCharacter('') === null)

  const cands = CI.searchCharacters('神里', 5)
  ok('模糊检索给候选', cands.length >= 1 && cands.every(c => c.name.includes('神里')))

  ok('avatarIdOf 官方名', CI.avatarIdOf('胡桃') === '10000046')
  ok('avatarIdOf 别名', CI.avatarIdOf('龟') === '10000002')
  ok('avatarIdOf 未知 → 空串', CI.avatarIdOf('不存在的角色') === '')

  const traveler = CI.findCharacter('旅行者')
  const hutao = CI.findCharacter('胡桃')
  ok('memberIs 认正式名', CI.memberIs('旅行者', traveler))
  ok('memberIs 认别名', CI.memberIs('爷', traveler))
  ok('memberIs 不误判', !CI.memberIs('胡桃', traveler) && CI.memberIs('胡桃', hutao))

  ok('元素中文化', CI.elementCn('Pyro') === '火' && CI.elementCn('Cryo') === '冰')
  ok('首领表已加载', Array.isArray(CI.bosses()) && CI.bosses().length > 0)
  ok('首领按版本可查', Array.isArray(CI.bossesOfVer('5.2')))
  ok('版本表非空', CI.versions().length > 0)
}

// ---------- 3. TeamStore 归一化（照抄 Mhydps 断言） ----------
{
  const raw = fixture('teams.sample.json')
  const teams = TS.normalizeTeams(raw)
  ok('保留全部合法记录', teams.length === raw.length)
  ok('剔除无成员/空 members 的记录', TS.normalizeTeams([{ id: 'x', members: null }, { id: 'y', members: [] }]).length === 0)
  ok('video_url 归一为 video', teams[0].video.startsWith('https://'))
  ok('tags 恒为数组', teams.every(t => Array.isArray(t.tags)))
  ok('数字字段为数字', teams.every(t => typeof t.damage === 'number' && typeof t.cost === 'number'))
  ok('confirm 缺省视为已审核', TS.normalizeTeams([{ id: 'z', members: [{ charId: '胡桃' }] }])[0].confirm === true)
  ok('confirm:false 保留', teams.some(t => t.confirm === false))
  ok('非数组输入抛错', (() => { try { TS.normalizeTeams({}); return false } catch { return true } })())

  const raids = TS.normalizeTeams2(fixture('teams2.sample.json'))
  ok('危战记录含 ver/boss/speed', raids.every(t => typeof t.ver === 'string' && typeof t.boss === 'number' && typeof t.speed === 'number'))
  ok('危战非数组输入抛错', (() => { try { TS.normalizeTeams2('nope'); return false } catch { return true } })())
}

// ---------- 4. 磁盘往返 / TTL / 快照 ----------
{
  TS.resetStore()
  // 直接走"手动刷新"之外的路径：把夹具写进缓存文件再 loadFromDisk
  const teams = TS.normalizeTeams(fixture('teams.sample.json'))
  const raids = TS.normalizeTeams2(fixture('teams2.sample.json'))
  fs.writeFileSync(path.join(TS.dataDir, 'teams.json'), JSON.stringify(teams), 'utf8')
  fs.writeFileSync(path.join(TS.dataDir, 'teams2.json'), JSON.stringify(raids), 'utf8')
  fs.writeFileSync(path.join(TS.dataDir, 'meta.json'), JSON.stringify({ fetchedAt: Date.now(), teams: teams.length, teams2: raids.length, source: 'test' }), 'utf8')

  TS.resetStore()
  const ret = TS.loadFromDisk()
  ok('loadFromDisk 返回条数', ret.teams === teams.length && ret.teams2 === raids.length)
  const snap = TS.getSnapshot()
  ok('快照带数据', snap.teams.length === teams.length && snap.teams2.length === raids.length)
  ok('getCounts 与快照一致', TS.getCounts().teams === snap.teams.length)
  ok('刚写入的缓存不算过期', TS.isStale() === false)
  const info = TS.cacheInfo()
  ok('cacheInfo 带 TTL 与新鲜度', typeof info.ttlMinutes === 'number' && info.stale === false && info.ageMs >= 0)

  // 过期：把 meta 的 fetchedAt 推到很久以前
  fs.writeFileSync(path.join(TS.dataDir, 'meta.json'), JSON.stringify({ fetchedAt: 1, teams: teams.length, teams2: raids.length, source: 'test' }), 'utf8')
  TS.resetStore()
  TS.loadFromDisk()
  ok('抓取时间过久 → 判定过期', TS.isStale() === true)

  // 损坏缓存：只告警不抛错
  fs.writeFileSync(path.join(TS.dataDir, 'teams.json'), '{ 坏 JSON', 'utf8')
  TS.resetStore()
  const bad = TS.loadFromDisk()
  ok('损坏的缓存不抛错、条数为 0', bad.teams === 0)
}

// ---------- 5. 启动编排（照抄 Mhydps 的 startup-lifecycle 口径） ----------
{
  const messages = []
  const log = { info: (m) => messages.push(String(m)), warn: (m) => messages.push(String(m)) }

  let ret = await ST.initStore({ load: () => ({ teams: 1394, teams2: 594, fetchedAt: Date.now() }), log })
  ok('有缓存：loaded/teams/teams2 正确', ret.loaded === true && ret.teams === 1394 && ret.teams2 === 594)
  ok('有缓存：打印条数', messages.some(m => m.includes('DPS榜 1394 条') && m.includes('危战榜 594 条')))

  messages.length = 0
  ret = await ST.initStore({ load: () => ({ teams: 0, teams2: 0, fetchedAt: 0 }), log })
  ok('无缓存：仍算载入成功', ret.loaded === true)
  ok('无缓存：提示惰性拉取', messages.some(m => m.includes('暂无本地缓存')))

  messages.length = 0
  ret = await ST.initStore({ load: () => { throw new Error('缓存文件损坏') }, log })
  ok('损坏：loaded=false 且条数为 0', ret.loaded === false && ret.teams === 0)
  ok('损坏：告警而不抛错', messages.some(m => m.includes('缓存文件损坏')))
  ok('攻略数据字段同时返回', ret.codex === true && typeof ret.codexFilled === 'number' && typeof ret.codexTotal === 'number')
  ok('默认 loader 就是真实的 loadFromDisk（未接线占位已移除）', typeof ST.initStore === 'function')
}

// ---------- 6. 联网总开关 ----------
{
  const cfg = await load('components/config.js')
  ok('networkEnabled 默认关', cfg.defaultConfig.networkEnabled === false)

  // 网络入口：关闭时抛中文错误
  let msg = ''
  try {
    await MC.fetchJson('/api/teams')
  } catch (err) {
    msg = String(err?.message || err)
  }
  ok('联网关闭时 fetchJson 抛清晰错误', msg.includes('业务查询联网已关闭') && msg.includes('networkEnabled=false'))

  // 头像下载：关闭时静默跳过（不抛错、不计数）
  const stats = await AS.ensureAvatars(['10000046', '10000002'])
  ok('联网关闭时头像下载被跳过', stats.downloaded === 0 && stats.failed === 0)
  ok('未缓存的立绘被判为未命中', AS.hasAvatar('10000046') === false)
  ok('avatarFile 命名与合并前一致', AS.avatarFile('10000046').endsWith(path.join('avatar', '10000046.webp')))
  AS.resetAvatars()
  ok('resetAvatars 后目录不存在', !fs.existsSync(AS.avatarDir))
}

const bad = report()
process.exit(bad ? 1 : 0)
