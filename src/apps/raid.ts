/**
 * `#DPS危战榜` —— 危战榜单（合并自 `Mhydps-Plugin/apps/raid.js`）
 *
 * 例：`#DPS危战榜` / `#DPS危战榜 7.1` / `#DPS危战榜 版本:7.1 首领:矮灵雕刻师`
 *
 * 默认排序是站点口径：金数升序 → 同金数比耗时。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js'
import { DPS_COMMANDS, DPS_COPYRIGHT, DPS_RULES, SITE_NAME, formatTime } from '../components/constants.js'
import { parseRaidArgs } from '../modules/queryArgs.js'
import { queryRaid } from '../modules/raidQuery.js'
import { raidText } from '../modules/formatText.js'
import { respond, suggestLine } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'

const META = DPS_COMMANDS.find(c => c.rules.includes('raid'))!

const TITLE = '#DPS危战榜'

export class MetaRaid extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: DPS_RULES.raid, fnc: 'handleRaid', permission: META.permission }
      ]
    })
  }

  /**
   * `#DPS危战榜` — 危战榜单（默认按金数升序、同金数比耗时）
   */
  async handleRaid (e: YunzaiEvent): Promise<boolean> {
    const text = (String(e.msg).match(DPS_RULES.raid) || [])[1] || ''
    const args = parseRaidArgs(text)

    const result = await queryRaid(args, { proxy: getProxy() })

    if (!result.ok) {
      await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`)
      return true
    }

    const data = {
      siteName: SITE_NAME,
      title: TITLE,
      subtitle: result.subtitle,
      fetchedAt: formatTime(result.fetchedAt),
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      rows: result.rows,
      copyright: DPS_COPYRIGHT
    }

    return await respond(e, 'raid', data, () => raidText(result, TITLE))
  }
}
