/**
 * `#DPS视频 <名次>` / `#DPS危战视频 <名次>` —— 取榜单第 N 名的视频链接
 *
 * 合并自 `Mhydps-Plugin/apps/video.js`。名次与榜单图编号同口径（当前筛选与排序下从 1 起、跨页连续），
 * 其余筛选词与榜单命令完全一致。
 *
 * ⚠ 与合并前的**唯一差异（用户 2026-10-13 定，B15）**：帮助文案已从 `#DPS榜视频` 改成与正则一致的
 *   `#DPS视频`（文案在 `DPS_COMMANDS` 里），**正则保持逐字不变**，所以行为与合并前一致。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js'
import { DPS_COMMANDS, DPS_RULES } from '../components/constants.js'
import { parseRankArgs, parseRaidArgs, takeRankNo } from '../modules/queryArgs.js'
import { findRankEntry } from '../modules/rankQuery.js'
import { findRaidEntry } from '../modules/raidQuery.js'
import { entryText } from '../modules/formatText.js'
import { suggestLine } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'

const META = DPS_COMMANDS.find(c => c.rules.includes('video'))!

export class MetaVideo extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      // 7900 < 榜单类入口(8000)：`#DPS视频` 先由本插件接管（与合并前同一偏移）
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: DPS_RULES.video, fnc: 'handleRankVideo', permission: META.permission },
        { reg: DPS_RULES.raidVideo, fnc: 'handleRaidVideo', permission: META.permission }
      ]
    })
  }

  /** `#DPS视频` — 取 DPS 榜第 N 名的视频链接（支持与榜单相同的筛选） */
  async handleRankVideo (e: YunzaiEvent): Promise<boolean> {
    const { rankNo, rest } = takeRankNo((String(e.msg).match(DPS_RULES.video) || [])[1] || '')
    if (!rankNo) {
      await e.reply('[Meta] 用法：#DPS视频 <名次>，例如 #DPS视频 3（可加角色/金数等筛选）')
      return true
    }

    const result = await findRankEntry(parseRankArgs(rest), rankNo, { proxy: getProxy() })
    if (!result.ok) {
      await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`)
      return true
    }

    await e.reply(entryText(result, 'rank'))
    return true
  }

  /** `#DPS危战视频` — 取危战榜第 N 名的视频链接（支持版本/首领等筛选） */
  async handleRaidVideo (e: YunzaiEvent): Promise<boolean> {
    const { rankNo, rest } = takeRankNo((String(e.msg).match(DPS_RULES.raidVideo) || [])[1] || '')
    if (!rankNo) {
      await e.reply('[Meta] 用法：#DPS危战视频 <名次>，例如 #DPS危战视频 3（可加版本/首领筛选）')
      return true
    }

    const result = await findRaidEntry(parseRaidArgs(rest), rankNo, { proxy: getProxy() })
    if (!result.ok) {
      await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`)
      return true
    }

    await e.reply(entryText(result, 'raid'))
    return true
  }
}
