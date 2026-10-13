/**
 * DPS 榜筛选与排序：角色（含别名）/ 主C / 金数 / 标签 / 绿玩 与名次编号
 *
 * 用离线样例（test/fixtures/teams.sample.json）跑纯函数，不发网络请求。
 */
import { checker, installFrameworkStubs, loadFixture, mod, requireDeps } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const { normalizeTeams } = await import(mod('model/TeamStore.js'))
const { filterTeams, sortTeams, buildRows } = await import(mod('modules/rankQuery.js'))
const { findCharacter } = await import(mod('model/CharacterIndex.js'))

const { check, finish } = checker()

const teams = normalizeTeams(loadFixture('teams.sample.json'))
check('样例已归一化', teams.length === 6, `${teams.length} 条`)

// ---- 站点数据口径：cost = limitcost + normalcost ----
check('金数恒等式成立', teams.every(t => t.limitcost + t.normalcost === t.cost))

// ---- 角色筛选 ----
let hit = filterTeams(teams, { character: findCharacter('玛薇卡') })
check('按角色名筛选', hit.length === 3, `命中 ${hit.length}`)

hit = filterTeams(teams, { character: findCharacter('胡桃') })
check('按角色名筛选（无别名）', hit.length === 1 && hit[0].id === 't-002')

hit = filterTeams(teams, { character: findCharacter('火神') })
check('按别名筛选命中玛薇卡记录', hit.length === 3, `命中 ${hit.length}`)

hit = filterTeams(teams, { character: findCharacter('旅行者') })
check('“爷”所在记录按旅行者也能筛到', hit.length === 1 && hit[0].id === 't-004')

hit = filterTeams(teams, { character: findCharacter('玛薇卡'), mainOnly: true })
check('主C 限定只匹配第一位（别名同样算命中）', hit.length === 3 && hit.every(t => ['玛薇卡', '火神'].includes(t.members[0].charId)), `命中 ${hit.length}`)

// ---- 金数筛选 ----
hit = filterTeams(teams, { costMax: 12 })
check('costMax 上限筛选', hit.length === 3 && hit.every(t => t.cost <= 12), `命中 ${hit.length}`)

hit = filterTeams(teams, { costMin: 12 })
check('costMin 下限筛选', hit.length === 4 && hit.every(t => t.cost >= 12), `命中 ${hit.length}`)

hit = filterTeams(teams, { costMin: 8, costMax: 12 })
check('金数区间筛选', hit.length === 2 && hit.every(t => t.cost >= 8 && t.cost <= 12), `命中 ${hit.length}`)

// ---- 标签与绿玩 ----
hit = filterTeams(teams, { tag: '宏' })
check('标签筛选', hit.length === 2, `命中 ${hit.length}`)

hit = filterTeams(teams, { tag: '总伤杯' })
check('标签子串筛选', hit.length === 1 && hit[0].id === 't-003')

hit = filterTeams(teams, { cleanOnly: true })
check('绿玩筛选', hit.length === 4 && hit.every(t => t.clean), `命中 ${hit.length}`)

hit = filterTeams(teams, { character: findCharacter('玛薇卡'), cleanOnly: true, costMax: 10 })
check('多条件叠加', hit.length === 1 && hit[0].id === 't-006', `命中 ${hit.length}`)

check('无命中返回空数组', filterTeams(teams, { character: findCharacter('胡桃'), cleanOnly: true, costMax: 4 }).length === 0)

// ---- 排序 ----
let sorted = sortTeams(teams, 'damage')
check('默认按伤害降序', sorted[0].id === 't-001' && sorted[sorted.length - 1].id === 't-004', sorted.map(t => t.damage).join('>'))

sorted = sortTeams(teams, 'costAsc')
check('按金数升序（同金数比伤害）', sorted[0].cost === 4 && sorted[1].cost === 8, sorted.map(t => t.cost).join(','))

sorted = sortTeams(teams, 'costDesc')
check('按金数降序', sorted[0].cost === 48)

check('排序不改动原数组', teams[0].id === 't-001')
check('未知排序键回落默认', sortTeams(teams, 'nonsense')[0].id === 't-001')

// ---- 视图行 ----
const rows = buildRows(sortTeams(teams, 'damage').slice(0, 3), 4)
check('名次从 startRank 连续编号', rows.map(r => r.rank).join(',') === '4,5,6', rows.map(r => r.rank).join(','))
check('伤害文本已格式化', rows[0].damageText.includes('万'), rows[0].damageText)
check('成员视图含命座文本', rows[0].chars[0].cText === 'C6')
check('命座 0 不输出角标', buildRows([teams.find(t => t.id === 't-002')])[0].chars[0].cText === '')
check('成员视图不再带元素（榜单不显示元素标签）', rows[0].chars[0].elementCn === undefined)
check('标签视图只含站点标签（绿玩/满级由模板按字段渲染）', buildRows([teams.find(t => t.id === 't-002')])[0].tags.length === 0)
check('未审核记录带标记', buildRows([teams.find(t => t.id === 't-005')])[0].tags.includes('未审核'))
check('站点标签原样保留', buildRows([teams.find(t => t.id === 't-003')])[0].tags.includes('总伤杯S3.N'))
check('绿玩/满级走独立字段', (() => {
  const row = buildRows([teams.find(t => t.id === 't-002')])[0]
  return row.clean === true && row.lvl === true
})())
check('视频链接透传', rows[0].video.includes('bilibili.com'))

finish()
