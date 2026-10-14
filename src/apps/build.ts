/**
 * `#DPS练度查询 [角色…] [UID]` —— 数据源 akasha.cv，画面用 miao-plugin 的面板
 *
 * 合并自 `Mhydps-Plugin/apps/build.js`：
 *   `#DPS练度查询 123456789`      该 UID 练度最好的那个角色的面板
 *   `#DPS练度查询 胡桃`           只看胡桃（UID 取配置 `akashaDefaultUid`）
 *   `#DPS练度查询 胡桃 123456789` 两者都给
 *
 * 面板里的数值全部来自 akasha：等级/命座/天赋/武器/面板 `stats`；
 * 圣遗物区刻意留空（akasha 不提供副词条），由文本说明原因，不编数字。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getAkashaEnabled, getAkashaMaxChars, getPluginConfig } from '../components/config.js'
import { AKASHA_NAME, DPS_COMMANDS, DPS_RULES } from '../components/constants.js'
import { fetchAkashaProfile, fetchAkashaTranslations, setTransport } from '../model/AkashaClient.js'
import { akashaBrowserTransport } from '../model/AkashaBrowser.js'
import { akashaAttr, buildAkashaAvatar, loadMiao, renderMiaoPanel, toPanelData } from '../model/MiaoPanel.js'
import type { AkashaStats as AkashaStatsInput } from '../model/MiaoPanel.js'
import { findCharacter } from '../model/CharacterIndex.js'
import { buildAkashaView, collectNameWords, filterAkashaChars } from '../modules/akashaQuery.js'
import { akashaText } from '../modules/formatText.js'
import { parseBuildArgs } from '../modules/queryArgs.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'

const META = DPS_COMMANDS.find(c => c.rules.includes('build'))!

const TITLE = '#DPS练度查询'

const USAGE = [
  `${TITLE} <UID> — 用 miao 的面板展示该 UID 在 akasha 上的练度`,
  `${TITLE} <角色> [UID] — 只看指定角色（可写多个，如「胡桃 夜兰」）`,
  '例：#DPS练度查询 胡桃　#DPS练度查询 胡桃 123456789',
  '未填 UID 时用配置项 akashaDefaultUid（锅巴 → 数据源二 · akasha.cv）'
].join('\n')

export class MetaBuild extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: DPS_RULES.build, fnc: 'handleBuild', permission: META.permission }
      ]
    })
  }

  /**
   * 练度查询：akasha 取数（浏览器会话）→ miao 面板出图 → 失败回退文本
   */
  async handleBuild (e: YunzaiEvent): Promise<boolean> {
    const text = (String(e.msg).match(DPS_RULES.build) || [])[1] || ''
    const args = parseBuildArgs(text)
    const uid = args.uid || String(getPluginConfig()?.akashaDefaultUid || '').trim()

    if (!getAkashaEnabled()) {
      await e.reply('[Meta] 练度查询已关闭（锅巴 → 数据源二 · akasha.cv → 启用练度查询）')
      return true
    }
    if (!uid) {
      await e.reply(USAGE)
      return true
    }
    if (!/^\d{9}$/.test(uid)) {
      await e.reply(`[Meta] UID 需要是 9 位数字，收到的是「${uid}」`)
      return true
    }

    const records = args.names.map(n => findCharacter(n)).filter((r): r is NonNullable<typeof r> => Boolean(r))
    const notices: string[] = []
    if (args.unknown.length) notices.push(`未识别的参数：${args.unknown.join('、')}`)

    let profile
    try {
      setTransport(akashaBrowserTransport)
      profile = await fetchAkashaProfile(uid)
    } catch (err) {
      logger?.error?.(`[Meta] akasha 练度查询失败：${(err as Error)?.message || String(err)}`)
      await e.reply([
        `[Meta] 练度查询失败：${(err as Error)?.message || String(err)}`,
        `数据源：${AKASHA_NAME}（该站 /api/ 在 Cloudflare 后面，需要本机有可用浏览器）`
      ].join('\n'))
      return true
    }

    let translations: Record<string, string> = {}
    try {
      translations = await fetchAkashaTranslations(collectNameWords(profile.calculations))
    } catch (err) {
      logger?.warn?.(`[Meta] akasha 名字中文化失败（保留英文）：${(err as Error)?.message || String(err)}`)
    }

    // 指定角色时**先在全量角色上筛选、再应用展示上限**（2026-10-15 审核 P2 #9）：
    // 之前是先取默认前 N 个再筛，目标排在第 N+1 位时即使有记录也会误报"akasha 上没有该角色"
    const view = buildAkashaView(profile, { translations, max: records.length ? Number.MAX_SAFE_INTEGER : undefined })
    let chars = view.chars
    if (records.length) {
      chars = filterAkashaChars(chars, records).slice(0, getAkashaMaxChars())
      notices.push(chars.length
        ? `已按 ${args.names.join('、')} 筛选（命中 ${chars.length} 个）`
        : `akasha 上没有 ${args.names.join('、')} 的记录（该号收录 ${view.total} 个角色）`)
    }
    if (!chars.length) {
      await e.reply([notices.join('\n'), akashaText({ ...view, chars: [] }, TITLE)].filter(Boolean).join('\n'))
      return true
    }

    // miao 面板一屏一角色：取名次最好的那个（角色名命中时通常就一个）
    const target = chars[0]
    const builds = profile.builds as Array<Record<string, unknown>>
    const build = builds.find(b => String(b?.characterId) === String(target.id)) || null

    let painted = false
    if (!build) {
      notices.push('akasha 没有返回该角色的 build 数据（等级/天赋/武器），本次不出面板')
    } else {
      try {
        const miao = await loadMiao()
        if (miao) {
          const avatar = await buildAkashaAvatar(target.id, { ...build, uid })
          if (avatar) {
            const panelData = await toPanelData({
              uid,
              avatar,
              attr: akashaAttr(build.stats as AkashaStatsInput, miao.Format)
            })
            if (panelData) painted = await renderMiaoPanel(e, panelData)
          }
        }
      } catch (err) {
        logger?.error?.(`[Meta] miao 面板渲染失败：${(err as Error)?.message || String(err)}`)
      }
    }

    // 面板留空的圣遗物区必须说明原因（akasha 不提供副词条），不编数字
    const notes = [
      ...notices,
      '面板数据源：akasha.cv（名次/伤害为 akasha 口径，与本站 DPS 榜不同）',
      '圣遗物区留空：akasha 的接口只给主词条、不给副词条，故不渲染圣遗物卡与总分'
    ].filter(Boolean)

    if (painted) {
      await e.reply(notes.join('\n'))
      return true
    }

    await e.reply([notes.join('\n'), akashaText({ ...view, chars }, TITLE)].join('\n'))
    return true
  }
}
