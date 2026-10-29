/**
 * 引用来源判定（2026-10-28 复审）
 *
 * 旧实现按"最后出现 / 重复字符"推断引用副本，两个真实反例：
 *   - 引用「矮灵」时，`#危战 矮灵 n7` 被删成 `#危战 n7`；
 *   - 引用「2」时，`#DPS 22金 页2` 被删成第 1 页。
 * 现在只剥离**边界可证明**的完整引用块：开头块后必须换行 + `#` 命令；结尾块前必须有换行边界，
 * 或"空白 + 我们的整块输出指纹"。短词、数字、命令前缀、重复本身都不触发删除。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot } from './_helper.mjs'

const { push, ok, report } = createChecks('引用来源判定（边界矩阵）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const QG = await load('modules/quoteGuard.js')
const { RULES } = await load('components/constants.js')

const replyOf = (text) => ({ reply_id: 'q', getReply: async () => ({ message: [{ type: 'text', text }] }) })

// ---------- 1. 开头引用块：只认「引用\n#命令」 ----------
{
  const hit = { ...replyOf('上一条回复正文'), msg: '上一条回复正文\n#危战 矮灵 n7' }
  ok('开头块 + 换行 + #命令 → 剥掉引用', (await QG.stripQuotedBlock(hit, hit.msg)) === '#危战 矮灵 n7')

  const noCommand = { ...replyOf('上一条回复正文'), msg: '上一条回复正文\n随便说说' }
  ok('开头块后没有 # 命令 → 不剥', (await QG.stripQuotedBlock(noCommand, noCommand.msg)) === noCommand.msg)

  const inline = { ...replyOf('上一条回复正文'), msg: '上一条回复正文 #危战 矮灵 n7' }
  ok('开头块后是空格（无换行）→ 不剥', (await QG.stripQuotedBlock(inline, inline.msg)) === inline.msg)
}

// ---------- 2. 结尾引用块：换行边界 / 输出指纹 ----------
{
  const line = { ...replyOf('胡桃 12金 主C 绿玩'), msg: '胡桃 12金 主C 绿玩 页1\n胡桃 12金 主C 绿玩' }
  ok('结尾块前有换行 → 剥掉引用、保留自身参数',
    (await QG.stripQuotedBlock(line, line.msg)) === '胡桃 12金 主C 绿玩 页1')

  const spaced = { ...replyOf('胡桃 12金 主C 绿玩'), msg: '胡桃 12金 主C 绿玩 页1 胡桃 12金 主C 绿玩' }
  ok('结尾块只有空格且非输出指纹 → 不剥', (await QG.stripQuotedBlock(spaced, spaced.msg)) === spaced.msg)

  const echo = {
    ...replyOf('标签：满级\n数据：原神DPS数据库 · 抓取于 2026-10-15'),
    msg: '七七 标签：满级\n数据：原神DPS数据库 · 抓取于 2026-10-15'
  }
  ok('结尾块命中输出指纹（整块回帖）→ 剥掉', (await QG.stripQuotedBlock(echo, echo.msg)) === '七七')
}

// ---------- 3. 短词 / 数字 / 重复：不得触发 ----------
{
  const word = { ...replyOf('矮灵'), msg: '#危战 矮灵 n7' }
  ok('引用「矮灵」不删自身命令里的同名词', (await QG.stripQuotedBlock(word, word.msg)) === word.msg)
  ok('隔离全文保留自身命令', (await QG.isolatedText(word)) === '#危战 矮灵 n7')

  const digit = { ...replyOf('2'), msg: '#DPS 22金 页2' }
  ok('引用「2」不删自身 22金/页2', (await QG.stripQuotedBlock(digit, digit.msg)) === digit.msg)

  const repeated = { ...replyOf('n7'), msg: '#危战 矮灵 n7 n7' }
  ok('重复 token 本身不算来源证据', (await QG.stripQuotedBlock(repeated, repeated.msg)) === repeated.msg)

  const whole = { ...replyOf('胡桃 12金'), msg: '胡桃 12金' }
  ok('引用与全文完全相同（没有前缀）→ 原样保留', (await QG.stripQuotedBlock(whole, whole.msg)) === '胡桃 12金')
}

// ---------- 4. isolatedText 优先自身 message 段 ----------
{
  const e = { message: [{ type: 'text', text: '#危战 矮灵 n7' }], msg: '#危战 矮灵 n7\n请用 n6', ...replyOf('请用 n6') }
  ok('有自身段时直接用自身文本', (await QG.isolatedText(e)) === '#危战 矮灵 n7')
  ok('无自身段时走边界剥离', (await QG.isolatedText({ msg: '#危战 矮灵 n7\n请用 n6', ...replyOf('请用 n6') })) === '#危战 矮灵 n7')
}

// ---------- 5. resolveCommandArgs：先隔离全文再匹配 ----------
{
  const noOwn = { msg: '#DPS 胡桃 12金\n胡桃 12金 页1', ...replyOf('胡桃 12金 页1') }
  const r = await QG.resolveCommandArgs(noOwn, RULES.rank)
  ok('无自身段：隔离后只取自身命令的参数', r.echo === false && r.text === '胡桃 12金', JSON.stringify(r))

  const echoMsg = { msg: '#DPS 每 4 金一档的最高伤害队伍\n数据来自 mhydps.cn', ...replyOf('x') }
  const re = await QG.resolveCommandArgs(echoMsg, RULES.rank)
  ok('隔离后仍命中输出指纹 → echo（自环/转发）', re.echo === true)

  /*
   * 2026-10-29 复审：引用块后可能带传输空白（空格/换行）；完整块仍必须被剥离，
   * 否则整条命令被当成回灌，handler 静默返回 false、零回复。
   */
  const quoted = '#胡桃 · 各金档最高伤害队伍\n数据来自 mhydps.cn'
  for (const tail of [' ', '\n', '\n ', '  ']) {
    const msg = `#DPS 胡桃 12金\n${quoted}${tail}`
    const e = { msg, ...replyOf(quoted) }
    const isolated = await QG.stripQuotedBlock(e, msg)
    ok(`尾空白 ${JSON.stringify(tail)}：完整引用块仍被剥离`, isolated === '#DPS 胡桃 12金', isolated)
    const r = await QG.resolveCommandArgs(e, RULES.rank)
    ok(`尾空白 ${JSON.stringify(tail)}：不再误判回灌`, r.echo === false && r.text === '胡桃 12金', JSON.stringify(r))
  }
}

// ---------- 6. 多档冲突识别（handler 闸门的数据层） ----------
{
  const RQ = await load('modules/raidTiersQuery.js')
  ok('n7 … n6 被判定为多档冲突', RQ.hasMultipleTiers('n7 … n6') === true)
  ok('只有 n7 不冲突', RQ.hasMultipleTiers('n7') === false)
  ok('版本号 7.1 + n6 不把 7.1 当档位', RQ.hasMultipleTiers('7.1 n6') === false)
  ok('同一档位重复不算多档', RQ.hasMultipleTiers('n7 / n7') === false)
  ok('档位词提取去重', JSON.stringify(RQ.tierTokensOf('n7 6档 N6')) === JSON.stringify(['7', '6']))
  // 2026-10-29 复审：命令正则支持裸 6/7，档位扫描必须同语法，否则会绕过闸门按引用改档。
  ok('裸 7 是档位词', RQ.tierTokensOf('#危战 矮灵 7').join(',') === '7')
  ok('裸 7 单独不误报多档', RQ.hasMultipleTiers('#危战 矮灵 7') === false && RQ.hasMultipleTiers('#危战 矮灵 n7 视频3') === false)
  ok('n7 + 裸 6 → 多档冲突', RQ.hasMultipleTiers('#危战 矮灵 n7 请用 6') === true)
  ok('裸 7 + n6 → 多档冲突', RQ.hasMultipleTiers('#危战 矮灵 7 请用 n6') === true)
  ok('裸 7 + 裸 6 → 多档冲突', RQ.hasMultipleTiers('#危战 矮灵 7 请用 6') === true)
  ok('视频后缀 n7视频3 / 7视频2 都识别为档位', RQ.tierTokensOf('n7视频3 7视频2').join(',') === '7')
  ok('版本号/长数字/英文词不误判',
    ['7.1', '17', 'n70', 'n7foo', '16', '67'].every(t => RQ.tierTokensOf(t).length === 0),
    JSON.stringify(['7.1', '17', 'n70', 'n7foo', '16', '67'].map(t => RQ.tierTokensOf(t))))

  // 边界：隔离后只剩一个档位 → 不触发多档闸门；inline 的 n7 … n6 无法归因 → 触发
  const ambiguous = { msg: '#危战 矮灵 n7 请用 n6', ...replyOf('请用 n6') }
  const isolatedAmbiguous = await QG.isolatedText(ambiguous)
  ok('inline 引用无法剥块（保留原文）', isolatedAmbiguous === ambiguous.msg)
  ok('inline n7 … n6 → 多档冲突', RQ.hasMultipleTiers(isolatedAmbiguous) === true)

  const bounded = { msg: '#危战 矮灵 n7\n请用 n6', ...replyOf('请用 n6') }
  const isolatedBounded = await QG.isolatedText(bounded)
  ok('换行引用块被剥掉后只剩一个档位', isolatedBounded === '#危战 矮灵 n7' && RQ.hasMultipleTiers(isolatedBounded) === false)

  const appSrc = fs.readFileSync(path.join(pluginRoot, 'src', 'apps', 'raidTiers.ts'), 'utf8')
  const guards = appSrc.match(/hasMultipleTiers\((?:full|isolated)\)/g) || []
  ok('两个 handler 入口都装了多档闸门', guards.length >= 2, String(guards.length))
  ok('闸门命中时提示重发（不查询、不回图）', /请重新发送 #危战/.test(appSrc))
}

const bad = report()
process.exit(bad ? 1 : 0)
