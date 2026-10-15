/**
 * `#DPS榜` —— DPS 数据库配队榜单（合并自 `Mhydps-Plugin/apps/rank.js`）
 *
 * 例：`#DPS榜` / `#DPS榜 胡桃` / `#DPS榜 胡桃 12金` / `#DPS榜 胡桃 主C 绿玩 -p2`
 *
 * 优先级取自 `COMMANDS`（默认 8000 = `config.priority`）：高于 Atlas（10000）；
 * 只认领自己的命令，未命中的消息自然放行给其它插件（2026-10-15 起命令表统一在 `RULES`）。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js'
import { COMMANDS, DPS_COPYRIGHT, RULES, SITE_NAME, formatTime } from '../components/constants.js'
import { parseRankArgs } from '../modules/queryArgs.js'
import { queryCharDps } from '../modules/charDpsQuery.js'
import type { CharDpsResult } from '../modules/charDpsQuery.js'
import { queryRank } from '../modules/rankQuery.js'
import { rankText } from '../modules/formatText.js'
import { respond, suggestLine } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'
import { moduleGateReply } from '../modules/moduleGate.js'

/** 本 app 的命令元数据（名称 / 文案 / 权限 / 优先级偏移都取它，见 components/constants.ts） */
const META = COMMANDS.find(c => c.rules.includes('rank'))!

const TITLE = '#DPS榜'

/** 角色档位视图的文本回退（原 `apps/charDps.ts` 的 `charDpsText`，2026-10-15 随合并迁入） */
function charDpsText (result: CharDpsResult): string {
  const lines = [`#${result.charName} · 各金档最高伤害队伍`, result.subtitle, '']
  for (const tier of result.tiers) {
    lines.push(`【${tier.cost} 金】共 ${tier.count} 条`)
    for (const row of tier.rows) {
      const team = row.chars.map(c => `${c.name}${c.constellation ? `C${c.constellation}` : ''}`).join(' + ')
      const tags = [...(row.tags || []), row.clean ? '绿玩' : '', row.lvl ? '满级' : ''].filter(Boolean).join('/')
      lines.push(`  ${row.rank}. ${team} — ${row.damageText || row.damage || '—'}｜限${row.limitcost}/常${row.normalcost}` + (tags ? `｜${tags}` : ''))
    }
  }
  if (!result.tiers.length) lines.push('没有查询到该角色的配队记录')
  return lines.join('\n')
}

export class MetaRank extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: RULES.rank, fnc: 'handleRank', permission: META.permission }
      ]
    })
  }

  /**
   * `#DPS榜` — 原神 DPS 数据库配队榜单
   */
  async handleRank (e: YunzaiEvent): Promise<boolean> {
    if (await moduleGateReply('rank', e)) return true
    const text = (String(e.msg).match(RULES.rank) || [])[1] || ''
    const args = parseRankArgs(text)

    // 2026-10-15 合并（用户定）：带角色名 → 角色档位视图（原 `#胡桃dps`，按金档分层）；不带 → 总榜
    if (args.char) return await this.replyCharTiers(e, args)

    const result = await queryRank(args, { proxy: getProxy() })

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
      pageSize: result.pageSize,
      rows: result.rows,
      copyright: DPS_COPYRIGHT
    }

    return await respond(e, 'rank', data, () => rankText(result, TITLE))
  }

  /**
   * 角色档位视图（原 `#胡桃dps`，2026-10-15 合并进榜单命令）
   *
   * 回答"这个角色在不同投入下能打到多少"：每个金档各取前几条；
   * 筛选语义（金数 / 标签 / 主C / 绿玩）与总榜完全一致。
   */
  async replyCharTiers (e: YunzaiEvent, args: ReturnType<typeof parseRankArgs>): Promise<boolean> {
    const { char: _ignoredChar, ...filters } = args
    const result = await queryCharDps(args.char, filters, { proxy: getProxy() })

    if (!result.ok) {
      await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`)
      return true
    }

    const data = {
      siteName: SITE_NAME,
      title: `#${result.charName} · 各金档 DPS`,
      subtitle: result.subtitle,
      fetchedAt: formatTime(result.fetchedAt),
      total: result.total,
      tierCount: result.tierCount,
      tiers: result.tiers,
      copyright: DPS_COPYRIGHT
    }

    return await respond(e, 'char-dps', data, () => charDpsText(result))
  }
}
