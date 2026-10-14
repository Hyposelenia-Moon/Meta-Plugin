/**
 * `#配装 胡桃 [名次]` —— 阿卡莎角色榜上榜者的配装（v3 P5）
 *
 * 例：`#配装 胡桃`（默认第 1 名）/ `#配装 胡桃 3`
 *
 * 数据来自阿卡莎角色榜条目（含 uid / 命座 / 武器 / 圣遗物主词条与套装 / 面板 / 天赋 / 双爆分）。
 * ⚠ 站点在 Cloudflare 后：只能靠"浏览器会话导航 + 捕获页面自身的 XHR"，且会被间歇性拦截 ——
 *    失败时给出可读中文提示（见 `model/AkashaBoard.ts`）。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig } from '../components/config.js'
import { COPYRIGHT, ENTRY_COMMANDS, ENTRY_RULES } from '../components/constants.js'
import { panelSummary, pickByRank } from '../modules/akashaBoard.js'
import type { BoardEntry } from '../modules/akashaBoard.js'
import { fetchBoard } from '../model/AkashaBoard.js'
import { respond } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'

/** 本 app 的命令元数据（见 components/constants.ts 的 ENTRY_COMMANDS） */
const META = ENTRY_COMMANDS.find(c => c.rules.includes('akashaBuild'))!

/** 解析 `胡桃 [名次]` */
export function parseBuildArgs (raw: string): { char: string, rank: number } {
  const parts = String(raw || '').split(/\s+/).map(s => s.trim()).filter(Boolean)
  let rank = 1
  const names: string[] = []
  for (const p of parts) {
    const n = Number(p.replace(/[第名位#]/g, ''))
    if (Number.isFinite(n) && n > 0 && n <= 50) { rank = Math.floor(n); continue }
    names.push(p)
  }
  return { char: names.join(' '), rank }
}

/** 文本回退 */
export function buildText (entry: BoardEntry, rank: number): string {
  const lines = [
    `【配装】第 ${rank} 名 · ${entry.charNameCn} C${entry.cons}｜uid ${entry.uid}${entry.nickname ? `（${entry.nickname}）` : ''}`,
    `伤害 ${Math.round(entry.damage).toLocaleString('en-US')}｜双爆分 ${entry.critValue.toFixed(1)}｜天赋 A${entry.talent.A}/E${entry.talent.E}/Q${entry.talent.Q}`,
    `武器：${entry.weapon ? `${entry.weapon.nameCn}${entry.weapon.affix ? ` 精${entry.weapon.affix}` : ''}` : '—'}`
  ]
  if (entry.artis.length) lines.push('圣遗物主词条：' + entry.artis.map(a => `${a.slotCn} ${a.mainCn}`).join('｜'))
  if (entry.sets.length) lines.push('套装：' + entry.sets.map(s => `${s.nameCn}×${s.count}`).join('｜'))
  const panel = panelSummary(entry)
  if (panel.length) lines.push('面板：' + panel.map(p => `${p.label} ${p.value}`).join('｜'))
  return lines.join('\n')
}

export class MetaAkashaBuild extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: ENTRY_RULES.akashaBuild, fnc: 'handleBuild', permission: META.permission }
      ]
    })
  }

  /** `#配装 胡桃 [名次]` */
  async handleBuild (e: YunzaiEvent): Promise<boolean> {
    const match = String(e.msg).match(ENTRY_RULES.akashaBuild) || []
    const { char, rank } = parseBuildArgs(match[1] || '')
    if (!char) {
      await e.reply('[Meta] 用法：#配装 胡桃 [名次]（名次默认第 1 名；数据来自阿卡莎角色榜，需要联网与代理）')
      return true
    }

    const res = await fetchBoard(char)
    if (!res.ok) {
      await e.reply(`[Meta] ${res.error}`)
      return true
    }
    const entry = pickByRank(res.entries, rank)
    if (!entry) {
      await e.reply(`[Meta] 这个榜单只有 ${res.total} 条（你要的是第 ${rank} 名）`)
      return true
    }

    const data = {
      title: `#配装 ${entry.charNameCn}`,
      subtitle: `阿卡莎角色榜第 ${entry.rank} 名｜共收录 ${res.total} 条`,
      charName: entry.charNameCn,
      rank: entry.rank,
      uid: entry.uid,
      nickname: entry.nickname,
      cons: entry.cons,
      damageText: Math.round(entry.damage).toLocaleString('en-US'),
      critValueText: entry.critValue.toFixed(1),
      talent: entry.talent,
      weapon: entry.weapon
        ? { ...entry.weapon, text: `${entry.weapon.nameCn}${entry.weapon.affix ? ` 精${entry.weapon.affix}` : ''}` }
        : null,
      artis: entry.artis,
      sets: entry.sets,
      panel: panelSummary(entry),
      copyright: COPYRIGHT
    }

    return await respond(e, 'akasha-build', data, () => buildText(entry, rank))
  }
}