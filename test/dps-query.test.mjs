/**
 * 查询层等价套件（阶段 4.4）
 *
 * 断言口径**照抄 Mhydps 自己的四个套件**：`query-args`（两条写法落到同一组参数）、
 * `rank-filter`（角色/别名/主C/金数/标签/绿玩 + 名次编号）、`raid-filter`（版本/首领/金数 +
 * 站点默认排序）、`text-fallback`（出图不可用时文字版必须含的关键信息）。
 * 夹具用它的 `test/fixtures/*.json`（已复制）。
 *
 * 另外钉住本仓库特有的两点：
 *   - 离线（`networkEnabled: false`）时查询入口**降级不抛错**（返回空结果，由 app 层提示）；
 *   - 视频查询的报错文案已按 B15 改成 `#DPS视频` / `#DPS危战视频`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot } from './_helper.mjs'

const { push, ok, report } = createChecks('查询层等价（阶段 4.4）')

// 环境要在 import 之前设：TeamStore 在模块加载时读 META_DATA_DIR
const tmpRoot = ensureTmp('dps-query')
process.env.META_DATA_DIR = path.join(tmpRoot, 'data')
process.env.META_CONFIG_FILE = path.join(tmpRoot, 'config.yaml')
fs.mkdirSync(process.env.META_DATA_DIR, { recursive: true })
fs.writeFileSync(process.env.META_CONFIG_FILE, 'networkEnabled: false\ndpsPageSize: 10\n', 'utf8')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const QA = await load('modules/queryArgs.js')
const TS = await load('model/TeamStore.js')
const CI = await load('model/CharacterIndex.js')
const RQ = await load('modules/rankQuery.js')
const DQ = await load('modules/raidQuery.js')
const FT = await load('modules/formatText.js')
const AQ = await load('modules/akashaQuery.js')

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(pluginRoot, 'test', 'fixtures', name), 'utf8'))
const teams = TS.normalizeTeams(fixture('teams.sample.json'))
const raids = TS.normalizeTeams2(fixture('teams2.sample.json'))

// ---------- 1. 参数解析（照抄 query-args.test.mjs） ----------
{
  let a = QA.parseRankArgs('')
  ok('空参数取默认值', a.char === '' && a.page === 1 && a.costMax === null && !a.cleanOnly && !a.mainOnly)
  ok('单角色', QA.parseRankArgs('胡桃').char === '胡桃')
  ok('“12金” → costMax', QA.parseRankArgs('胡桃 12金').costMax === 12)
  ok('“金12” → costMax', QA.parseRankArgs('胡桃 金12').costMax === 12)
  ok('“金≤12” → costMax', QA.parseRankArgs('胡桃 金≤12').costMax === 12)
  ok('“金≥8” → costMin', QA.parseRankArgs('胡桃 金≥8').costMin === 8)
  a = QA.parseRankArgs('胡桃 8-12金')
  push('“8-12金” → 区间', [a.costMin, a.costMax], [8, 12])
  a = QA.parseRankArgs('胡桃 主C 绿玩 -p2')
  ok('主C / 绿玩 / 翻页 组合', a.char === '胡桃' && a.mainOnly && a.cleanOnly && a.page === 2)
  ok('“第3页” → page', QA.parseRankArgs('胡桃 第3页').page === 3)
  ok('“页:4” → page', QA.parseRankArgs('胡桃 页:4').page === 4)
  a = QA.parseRankArgs('胡桃 总伤杯S3.N')
  ok('多词标签归并到 tag', a.char === '胡桃' && a.tag === '总伤杯S3.N')
  a = QA.parseRankArgs('角色:胡桃 金:12 标签:宏 页:5 绿玩 主C')
  ok('显式键值全字段', a.char === '胡桃' && a.costMax === 12 && a.tag === '宏' && a.page === 5 && a.cleanOnly && a.mainOnly)
  ok('全角冒号可解析', QA.parseRankArgs('角色：胡桃').char === '胡桃')
  a = QA.parseRankArgs('DPS榜')
  ok('未知 token 进 unknown', a.char === '' && a.unknown.includes('DPS榜'))

  let r = QA.parseRaidArgs('7.1')
  ok('版本号识别', r.ver === '7.1' && r.char === '')
  r = QA.parseRaidArgs('矮灵雕刻师')
  ok('首领名识别', r.boss === '矮灵雕刻师' && r.unknown.length === 0)
  r = QA.parseRaidArgs('7.1 矮灵雕刻师 玛薇卡 金≤4 -p2')
  ok('版本+首领+角色+金数+翻页', r.ver === '7.1' && r.boss === '矮灵雕刻师' && r.char === '玛薇卡' && r.costMax === 4 && r.page === 2)
  r = QA.parseRaidArgs('版本:7.0 首领:重拳出击鸭 角色:胡桃')
  ok('危战显式键值', r.ver === '7.0' && r.boss === '重拳出击鸭' && r.char === '胡桃')
  ok('不存在的版本仍被识别为版本', QA.parseRaidArgs('7.2').ver === '7.2')
  r = QA.parseRaidArgs('玛薇卡 版本:7.1')
  ok('键值与位置混用', r.char === '玛薇卡' && r.ver === '7.1')

  let b = QA.parseBuildArgs('')
  ok('练度：空参数 = 全部角色', b.uid === '' && b.names.length === 0 && b.unknown.length === 0)
  b = QA.parseBuildArgs('100000000')
  ok('练度：9 位数字当 UID', b.uid === '100000000' && b.names.length === 0)
  b = QA.parseBuildArgs('胡桃 100000000')
  ok('练度：角色名在前、UID 在后', b.uid === '100000000' && b.names.join(',') === '胡桃')
  b = QA.parseBuildArgs('100000000 胡桃')
  ok('练度：UID 在前、角色名在后', b.uid === '100000000' && b.names.join(',') === '胡桃')
  b = QA.parseBuildArgs('胡桃、夜兰 100000000')
  ok('练度：顿号分隔多角色', b.names.join(',') === '胡桃,夜兰' && b.uid === '100000000')
  b = QA.parseBuildArgs('uid:100000000 桃')
  ok('练度：显式 uid: + 别名', b.uid === '100000000' && b.names.join(',') === '桃')
  b = QA.parseBuildArgs('12345678')
  ok('练度：位数不对的数字进 unknown', b.uid === '' && b.unknown.includes('12345678'))
  b = QA.parseBuildArgs('100000000 100000001')
  ok('练度：只取第一个 UID', b.uid === '100000000' && b.unknown.includes('100000001'))

  const t = QA.takeRankNo('3 胡桃 绿玩')
  ok('takeRankNo 摘出名次并保留其余', t.rankNo === 3 && t.rest === '胡桃 绿玩')
  ok('takeRankNo 无数字时名次为 0', QA.takeRankNo('胡桃').rankNo === 0)
}

// ---------- 2. DPS 榜筛选与排序（照抄 rank-filter.test.mjs） ----------
{
  ok('样例已归一化', teams.length === 6)
  ok('金数恒等式成立', teams.every(t => t.limitcost + t.normalcost === t.cost))

  let hit = RQ.filterTeams(teams, { character: CI.findCharacter('玛薇卡') })
  ok('按角色名筛选', hit.length === 3)
  hit = RQ.filterTeams(teams, { character: CI.findCharacter('胡桃') })
  ok('按角色名筛选（无别名）', hit.length === 1 && hit[0].id === 't-002')
  hit = RQ.filterTeams(teams, { character: CI.findCharacter('火神') })
  ok('按别名筛选命中玛薇卡记录', hit.length === 3)
  hit = RQ.filterTeams(teams, { character: CI.findCharacter('旅行者') })
  ok('“爷”所在记录按旅行者也能筛到', hit.length === 1 && hit[0].id === 't-004')
  hit = RQ.filterTeams(teams, { character: CI.findCharacter('玛薇卡'), mainOnly: true })
  ok('主C 限定只匹配第一位（别名同样算命中）', hit.length === 3 && hit.every(t => ['玛薇卡', '火神'].includes(t.members[0].charId)))

  hit = RQ.filterTeams(teams, { costMax: 12 })
  ok('costMax 上限筛选', hit.length === 3 && hit.every(t => t.cost <= 12))
  hit = RQ.filterTeams(teams, { costMin: 12 })
  ok('costMin 下限筛选', hit.length === 4 && hit.every(t => t.cost >= 12))
  hit = RQ.filterTeams(teams, { costMin: 8, costMax: 12 })
  ok('金数区间筛选', hit.length === 2)

  ok('标签筛选', RQ.filterTeams(teams, { tag: '宏' }).length === 2)
  hit = RQ.filterTeams(teams, { tag: '总伤杯' })
  ok('标签子串筛选', hit.length === 1 && hit[0].id === 't-003')
  hit = RQ.filterTeams(teams, { cleanOnly: true })
  ok('绿玩筛选', hit.length === 4 && hit.every(t => t.clean))
  hit = RQ.filterTeams(teams, { character: CI.findCharacter('玛薇卡'), cleanOnly: true, costMax: 10 })
  ok('多条件叠加', hit.length === 1 && hit[0].id === 't-006')
  ok('无命中返回空数组', RQ.filterTeams(teams, { character: CI.findCharacter('胡桃'), cleanOnly: true, costMax: 4 }).length === 0)

  let sorted = RQ.sortTeams(teams, 'damage')
  ok('默认按伤害降序', sorted[0].id === 't-001' && sorted[sorted.length - 1].id === 't-004')
  sorted = RQ.sortTeams(teams, 'costAsc')
  ok('按金数升序（同金数比伤害）', sorted[0].cost === 4 && sorted[1].cost === 8)
  ok('按金数降序', RQ.sortTeams(teams, 'costDesc')[0].cost === 48)
  ok('排序不改动原数组', teams[0].id === 't-001')
  ok('未知排序键回落默认', RQ.sortTeams(teams, 'nonsense')[0].id === 't-001')

  const rows = RQ.buildRows(RQ.sortTeams(teams, 'damage').slice(0, 3), 4)
  ok('名次从 startRank 连续编号', rows.map(r => r.rank).join(',') === '4,5,6')
  ok('伤害文本已格式化', rows[0].damageText.includes('万'))
  ok('成员视图含命座文本', rows[0].chars[0].cText === 'C6')
  ok('命座 0 不输出角标', RQ.buildRows([teams.find(t => t.id === 't-002')])[0].chars[0].cText === '')
  ok('成员视图不再带元素（榜单不显示元素标签）', rows[0].chars[0].elementCn === undefined)
  ok('标签视图只含站点标签', RQ.buildRows([teams.find(t => t.id === 't-002')])[0].tags.length === 0)
  ok('未审核记录带标记', RQ.buildRows([teams.find(t => t.id === 't-005')])[0].tags.includes('未审核'))
  ok('站点标签原样保留', RQ.buildRows([teams.find(t => t.id === 't-003')])[0].tags.includes('总伤杯S3.N'))
  {
    const row = RQ.buildRows([teams.find(t => t.id === 't-002')])[0]
    ok('绿玩/满级走独立字段', row.clean === true && row.lvl === true)
  }
  ok('视频链接透传', rows[0].video.includes('bilibili.com'))
}

// ---------- 3. 危战榜筛选与排序（照抄 raid-filter.test.mjs） ----------
{
  ok('危战样例已归一化', raids.length === 4)
  ok('危战金数恒等式成立', raids.every(t => t.limitcost + t.normalcost === t.cost))

  let hit = DQ.filterRaids(raids, { ver: '7.1' })
  ok('按版本筛选', hit.length === 3)
  hit = DQ.filterRaids(raids, { ver: '7.0' })
  ok('另一版本', hit.length === 1 && hit[0].id === 'r-004')
  ok('未知版本无命中', DQ.filterRaids(raids, { ver: '1.0' }).length === 0)

  hit = DQ.filterRaids(raids, { bossRecord: CI.findBoss('矮灵雕刻师') })
  ok('按首领筛选', hit.length === 1 && hit[0].id === 'r-001')
  hit = DQ.filterRaids(raids, { bossRecord: CI.findBoss('重拳出击鸭') })
  ok('按首领名简称筛选', hit.length === 1 && hit[0].id === 'r-004')

  ok('旅行者命中两条（含“爷”写法）', DQ.filterRaids(raids, { character: CI.findCharacter('旅行者') }).length === 2)
  hit = DQ.filterRaids(raids, { character: CI.findCharacter('玛薇卡') })
  ok('按角色筛选', hit.length === 1 && hit[0].id === 'r-004')

  hit = DQ.filterRaids(raids, { costMax: 4 })
  ok('金数上限', hit.length === 2 && hit.every(t => t.cost <= 4))
  ok('版本与金数叠加', DQ.filterRaids(raids, { ver: '7.1', costMax: 12 }).length === 3)

  ok('默认排序：金数升序 → 同金比耗时',
    DQ.sortRaids(raids, 'costAsc').map(t => `${t.cost}/${t.speed}`).join(' ') === '0/24 4/99 12/110 48/4')
  {
    const s = DQ.sortRaids(raids, 'speed')
    ok('按耗时升序', s[0].speed === 4 && s[s.length - 1].speed === 110)
  }
  ok('按金数降序', DQ.sortRaids(raids, 'costDesc')[0].cost === 48)
  ok('排序不改动原数组', raids[0].id === 'r-001')

  const rows = DQ.buildRows(DQ.sortRaids(raids, 'costAsc').slice(0, 2), 1)
  ok('名次连续编号', rows.map(r => r.rank).join(',') === '1,2')
  ok('耗时文本带单位', rows[0].speedText === '24s')
  ok('首领名已解析', rows[0].bossName === '矮灵雕刻师')
  ok('版本透传', rows[0].ver === '7.1')
  {
    const twelve = DQ.buildRows(raids, 1).find(r => r.cost === 12)
    ok('限定金与常驻金拆分正确', twelve.limitcost === 10 && twelve.normalcost === 2)
    const unknownBoss = DQ.buildRows([{ ...raids[0], boss: 999999 }], 1)
    ok('未知首领不报错且给出兜底文案', unknownBoss[0].bossName.includes('999999'))
  }
}

// ---------- 4. 文本回退（照抄 text-fallback.test.mjs） ----------
{
  const one = TS.normalizeTeams([{
    id: 'a',
    damage: 3230000,
    cost: 48,
    limitcost: 46,
    normalcost: 2,
    clean: false,
    lvl: true,
    confirm: true,
    tags: ['宏'],
    video_url: 'https://www.bilibili.com/video/BV1',
    members: [{ charId: '玛薇卡', constellation: 6 }, { charId: '尼可', constellation: 0 }]
  }])
  const rankResult = {
    ok: true,
    total: 1,
    page: 2,
    totalPages: 3,
    rows: RQ.buildRows(one, 11),
    subtitle: '玛薇卡 · 按期望DPS降序',
    fetchedAt: Date.now(),
    stale: false
  }
  const rk = FT.rankText(rankResult)
  ok('榜单文本含标题与摘要', rk.includes('#DPS榜') && rk.includes('玛薇卡 · 按期望DPS降序'))
  ok('榜单文本含分页与总数', rk.includes('共 1 条') && rk.includes('第 2/3 页'))
  ok('榜单文本含名次', rk.includes('#11'))
  ok('榜单文本含伤害与金数', rk.includes('323.0 万') && rk.includes('48金') && rk.includes('限46/常2'))
  ok('榜单文本含成员与命座', rk.includes('玛薇卡(C6)'))
  ok('榜单文本含标签与视频', rk.includes('满级') && rk.includes('宏') && rk.includes('bilibili.com'))
  ok('榜单文本含数据来源', rk.includes('原神DPS数据库'))
  ok('缓存过期会提示', FT.rankText({ ...rankResult, stale: true }).includes('缓存已过期'))
  ok('空结果有兜底文案', FT.rankText({ ...rankResult, rows: [], total: 0 }).includes('没有符合条件的记录'))

  const oneRaid = TS.normalizeTeams2([{
    id: 'r',
    speed: 24,
    ver: '7.1',
    boss: 711,
    cost: 0,
    limitcost: 0,
    normalcost: 0,
    clean: true,
    lvl: false,
    confirm: true,
    video_url: '',
    members: [{ charId: '旅行者', constellation: 0 }]
  }])
  const raidResult = {
    ok: true,
    total: 1,
    page: 1,
    totalPages: 1,
    rows: DQ.buildRows(oneRaid, 1),
    subtitle: '版本 7.1 · 按金数升序',
    fetchedAt: Date.now(),
    stale: false
  }
  const rd = FT.raidText(raidResult)
  ok('危战文本含耗时与版本首领', rd.includes('24s') && rd.includes('7.1') && rd.includes('矮灵雕刻师'))
  ok('危战文本含绿玩标签', rd.includes('绿玩'))
  ok('危战文本含标题', rd.includes('#DPS危战榜'))

  const entry = FT.entryText({ row: rankResult.rows[0], rank: 3, total: 9, fetchedAt: Date.now() }, 'rank')
  ok('单条文本含名次与总数', entry.includes('第 3 名') && entry.includes('共 9 条'))
  ok('单条文本含阵容与视频', entry.includes('阵容：') && entry.includes('bilibili.com'))
  const entryNoVideo = FT.entryText({ row: { ...rankResult.rows[0], video: '' }, rank: 1, total: 1, fetchedAt: Date.now() }, 'raid')
  ok('无视频时给兜底文案', entryNoVideo.includes('没有留下视频链接'))
}

// ---------- 5. akasha 视图（口径抽样；完整迁移见 4.7） ----------
{
  const account = fixture('akasha.account.sample.json')
  const calc = fixture('akasha.calc.sample.json')
  const player = AQ.readAccount(account.data.account)
  ok('账号画像取到昵称与 UID', player.uid.length > 0 && typeof player.nickname === 'string')
  ok('账号画像字段为数字', Number.isFinite(player.level) && Number.isFinite(player.abyss.stars))

  const view = AQ.buildAkashaView({ account: account.data.account, calculations: calc.data }, { max: 12 })
  ok('视图含角色列表', Array.isArray(view.chars) && view.chars.length > 0)
  ok('角色带练度主赛道', view.chars.every(c => c.best === null || (typeof c.best.topText === 'string' && typeof c.best.damageText === 'string')))
  ok('top 文本格式正确', AQ.topPercentText(8205, 1035102) === 'top 0.79%')
  ok('top 文本边界（非法值）', AQ.topPercentText(0, 100) === '-' && AQ.topPercentText(5, 0) === '-')
  ok('大数字格式化', AQ.bigNumText(3230000) === '323.0 万' && AQ.bigNumText(123456789) === '1.23 亿')
  ok('需要中文化的词来自套装与武器', Array.isArray(AQ.collectNameWords(calc.data)))
  const text = FT.akashaText(view)
  ok('练度文本含 UID 与口径声明', text.includes('UID') && text.includes('akasha 口径'))
}

// ---------- 6. 查询入口：离线降级（不发网络、不抛错） ----------
{
  const notFound = await RQ.queryRank({ char: '不存在的角色' })
  ok('角色没找到 → ok:false + 候选', notFound.ok === false && Array.isArray(notFound.suggestions))

  const empty = await RQ.queryRank({ char: '胡桃' }, { downloadAvatars: false })
  ok('离线（无缓存）仍返回结构完整的结果', empty.ok === true && empty.total === 0 && empty.page === 1)
  ok('副标题写明筛选条件', empty.ok === true && empty.subtitle.includes('胡桃'))

  const badRaid = await DQ.queryRaid({ boss: '不存在的首领' })
  ok('首领没找到 → ok:false', badRaid.ok === false)
  const badVer = await DQ.queryRaid({ ver: '1.0' })
  ok('版本不存在 → ok:false + 版本候选', badVer.ok === false && Array.isArray(badVer.suggestions))

  const r1 = await RQ.findRankEntry({}, 0)
  ok('名次非正整数 → 报错文案为 #DPS视频', r1.ok === false && r1.error.includes('#DPS视频 3'))
  const r2 = await DQ.findRaidEntry({}, 0)
  ok('危战名次非正整数 → 文案为 #DPS危战视频', r2.ok === false && r2.error.includes('#DPS危战视频 3'))
  const r3 = await RQ.findRankEntry({}, 5, { downloadAvatars: false })
  ok('无数据时按名次查询 → 明确报"没有任何记录"', r3.ok === false && r3.error.includes('没有任何记录'))
}

const bad = report()
process.exit(bad ? 1 : 0)
