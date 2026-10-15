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
// 2026-10-15 审核意见 2.3：显式条件与裸词**分开存**（可信度不同，解析层不合并）
check('多词裸词归并到 tagBare（不再混进显式 tag）', a.char === '胡桃' && a.tagBare === '总伤杯S3.N' && a.tag === '', `tag=${a.tag} bare=${a.tagBare}`)

// ---- DPS 榜：显式键值 ----
a = parseRankArgs('角色:胡桃 金:12 标签:宏 页:5 绿玩 主C')
check('显式键值全字段', a.char === '胡桃' && a.costMax === 12 && a.tag === '宏' && a.tagExplicit === true && a.page === 5 && a.cleanOnly && a.mainOnly)

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

// ---- 危战档位（2026-10-15：n6 / n7 显式选档） ----
r = parseRaidArgs('矮灵雕刻师 n7')
check('档位 n7 与首领共存', r.boss === '矮灵雕刻师' && r.tier === 'n7' && r.unknown.length === 0)

r = parseRaidArgs('7.1 N6')
check('档位大小写不敏感', r.ver === '7.1' && r.tier === 'n6')

r = parseRaidArgs('胡桃 7档')
check('档位也接受「7档」写法', r.char === '胡桃' && r.tier === 'n7')

r = parseRaidArgs('n6 矮灵 金≤4')
check('档位顺序随意、不影响其它筛选', r.tier === 'n6' && r.boss === '矮灵' && r.costMax === 4)

r = parseRaidArgs('n6 n7')
check('重复档位只取第一个，多余的进 unknown', r.tier === 'n6' && r.unknown.join(',') === 'n7')

r = parseRaidArgs('6')
check('裸数字不当档位（避免与金数/名次混淆）', r.tier === null)

r = parseRaidArgs('')
check('不写档位 = null（交给 app 提示选档）', r.tier === null)

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

// ---- 引用内容隔离（2026-10-15 审核意见 2.1：只做整段精确剔除，不做词重合推断） ----
{
  const { stripQuotedArgs, quotedText, ownTextOf } = await import(mod('modules/quoteGuard.js'))
  const quotedMsg = {
    message: [
      { type: 'text', text: '标签：满级\n视频：https://www.bilibili.com/video/BV14baT6EE7i\n数据：原神DPS数据库 · 抓取于 2026-10-15 22:26' }
    ]
  }
  check('取引用消息的纯文本（段数组形态）', quotedText(quotedMsg).includes('标签：满级'))
  check('取引用消息的纯文本（raw_message 形态）', quotedText({ raw_message: '原文' }) === '原文')
  check('不是引用回复 → 原样返回', (await stripQuotedArgs({}, '胡桃 12金')) === '胡桃 12金')
  check('取不到引用消息（抛错）→ 原样返回', (await stripQuotedArgs({ reply_id: 'q1', getReply: async () => { throw new Error('no') } }, '胡桃')) === '胡桃')
  check('ownTextOf 只取当前消息自己的文本段',
    ownTextOf({ message: [{ type: 'text', text: '#dps 七七' }] }) === '#dps 七七' && ownTextOf({}) === '')

  // 引用原文**整段**出现才切（这是唯一被允许的剔除依据）
  const hitQuote = { reply_id: 'q2', getReply: async () => quotedMsg }
  check('引用原文整段出现 → 切掉该段，只留用户自己写的部分',
    (await stripQuotedArgs(hitQuote, '七七 标签：满级 视频：https://www.bilibili.com/video/BV14baT6EE7i 数据：原神DPS数据库 · 抓取于 2026-10-15 22:26')) === '七七')
  check('用户正文与引用无关时原样保留（不做任何推测）',
    (await stripQuotedArgs(hitQuote, '胡桃 12金')) === '胡桃 12金')

  /*
   * 审核意见 2.1 的两个实测反例：旧实现按"词重合"推断来源，会把**用户自己重打的**内容删掉 ——
   * 引用里出现过同样的角色名/金数/独立数字，不能证明新正文里的这些词来自引用。
   */
  const e2 = { reply_id: 'q3', getReply: async () => ({ message: [{ type: 'text', text: '刻晴(C6) 48金 队伍：兹白 C2 …' }] }) }
  check('审核反例①：用户重打 `刻晴 48金` 不再被删空（旧实现 → 空串）',
    (await stripQuotedArgs(e2, '刻晴 48金')) === '刻晴 48金')
  const e3 = { reply_id: 'q4', getReply: async () => ({ message: [{ type: 'text', text: '第 1 名（当前条件下共 7 条）' }] }) }
  check('审核反例②：`七七 视频1` 里的 `1` 不再被当成引用内容（旧实现 → `七七`）',
    (await stripQuotedArgs(e3, '七七 视频1')) === '七七 视频1')
}

finish()
