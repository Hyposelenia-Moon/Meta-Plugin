/**
 * 危战榜筛选与排序：版本 / 首领 / 角色 / 金数，以及站点默认排序口径（金数升序 → 耗时升序）
 */
import { checker, installFrameworkStubs, loadFixture, mod, requireDeps } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const { normalizeTeams2 } = await import(mod('model/TeamStore.js'))
const { filterRaids, sortRaids, buildRows } = await import(mod('modules/raidQuery.js'))
const { findCharacter, findBoss } = await import(mod('model/CharacterIndex.js'))

const { check, finish } = checker()

const teams2 = normalizeTeams2(loadFixture('teams2.sample.json'))
check('样例已归一化', teams2.length === 4, `${teams2.length} 条`)
check('金数恒等式成立', teams2.every(t => t.limitcost + t.normalcost === t.cost))

// ---- 版本筛选 ----
let hit = filterRaids(teams2, { ver: '7.1' })
check('按版本筛选', hit.length === 3, `命中 ${hit.length}`)

hit = filterRaids(teams2, { ver: '7.0' })
check('另一版本', hit.length === 1 && hit[0].id === 'r-004')

check('未知版本无命中', filterRaids(teams2, { ver: '1.0' }).length === 0)

// ---- 首领筛选 ----
hit = filterRaids(teams2, { bossRecord: findBoss('矮灵雕刻师') })
check('按首领筛选', hit.length === 1 && hit[0].id === 'r-001')

hit = filterRaids(teams2, { bossRecord: findBoss('重拳出击鸭') })
check('按首领名简称筛选', hit.length === 1 && hit[0].id === 'r-004')

// ---- 角色筛选（含别名与同队重复名） ----
hit = filterRaids(teams2, { character: findCharacter('旅行者') })
check('旅行者命中两条（含“爷”写法）', hit.length === 2, `命中 ${hit.length}`)

hit = filterRaids(teams2, { character: findCharacter('玛薇卡') })
check('按角色筛选', hit.length === 1 && hit[0].id === 'r-004')

// ---- 金数筛选 ----
hit = filterRaids(teams2, { costMax: 4 })
check('金数上限', hit.length === 2 && hit.every(t => t.cost <= 4), `命中 ${hit.length}`)

hit = filterRaids(teams2, { ver: '7.1', costMax: 12 })
check('版本与金数叠加', hit.length === 3, `命中 ${hit.length}`)

// ---- 排序 ----
let sorted = sortRaids(teams2, 'costAsc')
check('默认：金数升序 → 同金比耗时', sorted.map(t => `${t.cost}/${t.speed}`).join(' ') === '0/24 4/99 12/110 48/4', sorted.map(t => `${t.cost}/${t.speed}`).join(' '))

sorted = sortRaids(teams2, 'speed')
check('按耗时升序', sorted[0].speed === 4 && sorted[sorted.length - 1].speed === 110, sorted.map(t => t.speed).join(','))

sorted = sortRaids(teams2, 'costDesc')
check('按金数降序', sorted[0].cost === 48)

check('排序不改动原数组', teams2[0].id === 'r-001')

// ---- 视图行 ----
const rows = buildRows(sortRaids(teams2, 'costAsc').slice(0, 2), 1)
check('名次连续编号', rows.map(r => r.rank).join(',') === '1,2')
check('耗时文本带单位', rows[0].speedText === '24s', rows[0].speedText)
check('首领名已解析', rows[0].bossName === '矮灵雕刻师', rows[0].bossName)
check('版本透传', rows[0].ver === '7.1')

const all = buildRows(teams2, 1)
const twelve = all.find(r => r.cost === 12)
check('限定金与常驻金拆分正确', twelve.limitcost === 10 && twelve.normalcost === 2)

const unknownBoss = buildRows([{ ...teams2[0], boss: 999999 }], 1)
check('未知首领不报错且给出兜底文案', unknownBoss[0].bossName.includes('999999'), unknownBoss[0].bossName)

finish()
