/**
 * 文本回退：渲染不可用时，榜单/练度文字版必须包含关键信息
 *
 * 出图依赖浏览器；回退文案是降级环境下唯一的信息出口，因此对「角色名、伤害、金数、
 * 名次、分页、数据时间」这些关键项逐一钉住。
 */
import { checker, installFrameworkStubs, mod, requireDeps } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const { rankText, raidText } = await import(mod('modules/formatText.js'))
const { normalizeTeams, normalizeTeams2 } = await import(mod('model/TeamStore.js'))
const { buildRows } = await import(mod('modules/rankQuery.js'))
const { buildRows: buildRaidRows } = await import(mod('modules/raidQuery.js'))

const { check, finish } = checker()

const teams = normalizeTeams([
  {
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
  }
])

const rankResult = {
  ok: true,
  total: 1,
  page: 2,
  totalPages: 3,
  rows: buildRows(teams, 11),
  subtitle: '玛薇卡 · 按期望DPS降序',
  fetchedAt: Date.now(),
  stale: false
}

const rk = rankText(rankResult)
check('榜单文本含标题与摘要', rk.includes('#DPS榜') && rk.includes('玛薇卡 · 按期望DPS降序'))
check('榜单文本含分页与总数', rk.includes('共 1 条') && rk.includes('第 2/3 页'))
check('榜单文本含名次', rk.includes('#11'))
check('榜单文本含伤害与金数', rk.includes('323.0 万') && rk.includes('48金') && rk.includes('限46/常2'))
check('榜单文本含成员与命座', rk.includes('玛薇卡(C6)'))
check('榜单文本含标签与视频', rk.includes('满级') && rk.includes('宏') && rk.includes('bilibili.com'))
check('榜单文本含数据来源', rk.includes('原神DPS数据库'))

const staleResult = { ...rankResult, stale: true }
check('缓存过期会提示', rankText(staleResult).includes('缓存已过期'))

const emptyResult = { ...rankResult, rows: [], total: 0 }
check('空结果有兜底文案', rankText(emptyResult).includes('没有符合条件的记录'))

const raids = normalizeTeams2([
  {
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
  }
])

const raidResult = {
  ok: true,
  total: 1,
  page: 1,
  totalPages: 1,
  rows: buildRaidRows(raids, 1),
  subtitle: '版本 7.1 · 按金数升序',
  fetchedAt: Date.now(),
  stale: false
}

const rd = raidText(raidResult)
check('危战文本含耗时与版本首领', rd.includes('24s') && rd.includes('7.1') && rd.includes('矮灵雕刻师'))
check('危战文本含绿玩标签', rd.includes('绿玩'))
check('危战文本含标题', rd.includes('#DPS危战榜'))

finish()
