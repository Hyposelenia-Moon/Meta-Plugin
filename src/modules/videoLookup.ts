/**
 * videoLookup — 「按名次取一条记录的视频链接」的共用逻辑
 *
 * 三个入口共用这一份实现（用户 2026-10-15 定：`#视频` / `#危战视频` 之外，
 * 榜单命令本身也支持**后缀式**写法）：
 *   - `#视频 <名次> [筛选]`      —— 原来的前缀式（保留兼容）
 *   - `#危战视频 <名次> [筛选]`  —— 同上
 *   - `#DPS榜 … 视频N` / `#危战 … [n6|n7] 视频N` —— 后缀式：前面的筛选词原样喂给榜单解析器
 *
 * 名次口径：**在当前筛选之内**（含金数/角色/首领等）按榜单排序从 1 起的序号。
 * DPS 榜按伤害降序，所以"48金视频1" = 金数限定之后伤害最高的那条；
 * 危战榜按全榜排序（金数升序 → 同金比耗时），与档页每行标的「全榜 #N」同一个序号。
 */
import { getProxy } from '../components/config.js'
import { entryText } from './formatText.js'
import { parseRaidArgs, parseRankArgs } from './queryArgs.js'
import { findRankEntry } from './rankQuery.js'
import { findRaidEntry } from './raidQuery.js'
import { suggestLine } from './respond.js'

/** 事件回复函数的最小签名（避免为一个类型引入框架依赖） */
interface Replyable { reply: (msg: string) => unknown }

/** DPS 榜：取当前筛选下第 N 名的视频链接 */
export async function replyRankVideo (e: Replyable, rest: string, rankNo: number): Promise<boolean> {
  const result = await findRankEntry(parseRankArgs(rest), rankNo, { proxy: getProxy() })
  if (!result.ok) {
    await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`)
    return true
  }
  await e.reply(entryText(result, 'rank'))
  return true
}

/**
 * 危战榜：取当前筛选下第 N 名的视频链接
 *
 * ⚠ 档位（`n6` / `n7`）是**展示口径**、不是筛选条件：`parseRaidArgs` 会把它解析成 `tier`，
 *   这里显式摘掉，避免混进 `filterRaids`（与 `raidTiersQuery` 同一处理）。
 */
export async function replyRaidVideo (e: Replyable, rest: string, rankNo: number): Promise<boolean> {
  const { tier: _tier, ...filters } = parseRaidArgs(rest) as unknown as Record<string, unknown> & { tier?: unknown }
  const result = await findRaidEntry(filters, rankNo, { proxy: getProxy() })
  if (!result.ok) {
    await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`)
    return true
  }
  await e.reply(entryText(result, 'raid'))
  return true
}
