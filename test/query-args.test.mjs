/**
 * 参数解析：显式键值与位置简写两条路都要落到同一组参数
 *
 * 这两条路是群友实际会打的两种写法（`#DPS榜 胡桃 12金` 与 `#DPS榜 角色:胡桃 金:12`），
 * 解析错了会静默变成「没有符合条件的结果」，所以逐种写法钉住。
 */
import { checker, installFrameworkStubs, mod } from './_helper.mjs'

installFrameworkStubs()

const { parseRankArgs, parseRaidArgs, parseBuildArgs } = await import(mod('modules/queryArgs.js'))

const { check, finish } = checker()

// ---- DPS 榜：位置简写 ----
let a = parseRankArgs('')
check('空参数取默认值', a.char === '' && a.page === 1 && a.costMax === null && !a.cleanOnly && !a.mainOnly)

a = parseRankArgs('胡桃')
check('单角色', a.char === '胡桃')

a = parseRankArgs('胡桃 12金')
check('“12金” → costMax', a.char === '胡桃' && a.costMax === 12)

a = parseRankArgs('胡桃 金12')
check('“金12” → costMax', a.char === '胡桃' && a.costMax === 12)

a = parseRankArgs('胡桃 金≤12')
check('“金≤12” → costMax', a.char === '胡桃' && a.costMax === 12)

a = parseRankArgs('胡桃 金≥8')
check('“金≥8” → costMin', a.char === '胡桃' && a.costMin === 8)

a = parseRankArgs('胡桃 8-12金')
check('“8-12金” → 区间', a.char === '胡桃' && a.costMin === 8 && a.costMax === 12)

a = parseRankArgs('胡桃 主C 绿玩 -p2')
check('主C / 绿玩 / 翻页 组合', a.char === '胡桃' && a.mainOnly && a.cleanOnly && a.page === 2)

a = parseRankArgs('胡桃 第3页')
check('“第3页” → page', a.page === 3)

a = parseRankArgs('胡桃 页:4')
check('“页:4” → page', a.page === 4)

a = parseRankArgs('胡桃 总伤杯S3.N')
check('多词标签归并到 tag', a.char === '胡桃' && a.tag === '总伤杯S3.N', `tag=${a.tag}`)

// ---- DPS 榜：显式键值 ----
a = parseRankArgs('角色:胡桃 金:12 标签:宏 页:5 绿玩 主C')
check('显式键值全字段', a.char === '胡桃' && a.costMax === 12 && a.tag === '宏' && a.page === 5 && a.cleanOnly && a.mainOnly)

a = parseRankArgs('角色：胡桃')
check('全角冒号可解析', a.char === '胡桃')

a = parseRankArgs('DPS榜')
check('未知 token 进 unknown（由查询层报错）', a.char === '' && a.unknown.includes('DPS榜'))

// ---- 危战榜：多出版本与首领 ----
let r = parseRaidArgs('7.1')
check('版本号识别', r.ver === '7.1' && r.char === '')

r = parseRaidArgs('矮灵雕刻师')
check('首领名识别', r.boss === '矮灵雕刻师' && r.unknown.length === 0)

r = parseRaidArgs('7.1 矮灵雕刻师 玛薇卡 金≤4 -p2')
check('版本+首领+角色+金数+翻页', r.ver === '7.1' && r.boss === '矮灵雕刻师' && r.char === '玛薇卡' && r.costMax === 4 && r.page === 2)

r = parseRaidArgs('版本:7.0 首领:重拳出击鸭 角色:胡桃')
check('危战显式键值', r.ver === '7.0' && r.boss === '重拳出击鸭' && r.char === '胡桃')

r = parseRaidArgs('7.2')
check('不存在的版本仍被识别为版本（查询层再校验）', r.ver === '7.2')

r = parseRaidArgs('玛薇卡 版本:7.1')
check('键值与位置混用', r.char === '玛薇卡' && r.ver === '7.1')

// ---- 练度查询：UID 与角色名（顺序随意、都可省） ----
let b = parseBuildArgs('')
check('练度：空参数 = 全部角色', b.uid === '' && b.names.length === 0 && b.unknown.length === 0)

b = parseBuildArgs('100000000')
check('练度：9 位数字当 UID', b.uid === '100000000' && b.names.length === 0)

b = parseBuildArgs('胡桃')
check('练度：单个角色名', b.uid === '' && b.names.join(',') === '胡桃')

b = parseBuildArgs('胡桃 100000000')
check('练度：角色名在前、UID 在后', b.uid === '100000000' && b.names.join(',') === '胡桃')

b = parseBuildArgs('100000000 胡桃')
check('练度：UID 在前、角色名在后', b.uid === '100000000' && b.names.join(',') === '胡桃')

b = parseBuildArgs('胡桃、夜兰 100000000')
check('练度：多个角色（顿号分隔）', b.names.join(',') === '胡桃,夜兰' && b.uid === '100000000')

b = parseBuildArgs('uid:100000000 桃')
check('练度：显式 uid: 键值 + 别名', b.uid === '100000000' && b.names.join(',') === '桃')

b = parseBuildArgs('12345678')
check('练度：位数不对的数字进 unknown（不是 UID）', b.uid === '' && b.unknown.includes('12345678'))

b = parseBuildArgs('不存在的角色')
check('练度：非角色名进 unknown', b.names.length === 0 && b.unknown.includes('不存在的角色'))

b = parseBuildArgs('100000000 100000001')
check('练度：只取第一个 UID，多余的进 unknown', b.uid === '100000000' && b.unknown.includes('100000001'))

finish()
