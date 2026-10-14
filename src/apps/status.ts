/**
 * `#DPS状态` —— 缓存时间、条数、头像缓存与版本信息
 *
 * 合并自 `Mhydps-Plugin/apps/status.js`。图与文本回退共用 `buildData()` 一份数据。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy, loadConfig } from '../components/config.js'
import { DPS_COMMANDS, DPS_COPYRIGHT, DPS_RULES, SITE_NAME, agoText, formatTime } from '../components/constants.js'
import { avatarStats } from '../model/AvatarStore.js'
import { versions } from '../model/CharacterIndex.js'
import { cacheInfo, getCounts } from '../model/TeamStore.js'
import { codexStore } from '../model/CodexStore.js'
import { atlasRes } from '../model/AtlasRes.js'
import { miaoRes } from '../model/MiaoRes.js'
import { pluginVersion, versionText, yunzaiVersion } from '../components/pluginVersion.js'
import { respond } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'

const META = DPS_COMMANDS.find(c => c.rules.includes('status'))!

const TITLE = '#DPS状态'

/** 状态页数据（图与文本共用） */
interface StatusData {
  siteName: string
  title: string
  hasData: boolean
  dataTime: string
  ageText: string
  ttlText: string
  staleText: string
  proxy: string
  /** 联网总开关（默认关；关着就不会联网，页面只能出缓存里的数据） */
  networkEnabled: boolean
  /** 攻略数据：有内容的角色数 / 收录总数 */
  codexFilled: number
  codexTotal: number
  /** 资源来源探测（miao 必需 / Atlas 可选） */
  miaoOk: boolean
  atlasOk: boolean
  sources: Array<{ name: string, count: number }>
  versions: string
  avatar: { total: number, cached: number }
  pluginVersion: string
  yunzaiVersion: string
  versionText: string
  copyright: string
}

export class MetaStatus extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: DPS_RULES.status, fnc: 'handleStatus', permission: META.permission }
      ]
    })
  }

  /** 状态数据（图与文本回退共用一份） */
  buildData (): StatusData {
    const info = cacheInfo()
    const counts = getCounts()
    const proxy = getProxy()
    const verList = versions()

    // 阶段 5：状态页一次覆盖两侧（攻略数据 + 资源来源 + 联网开关）
    let codexFilled = 0
    let codexTotal = 0
    try {
      codexFilled = Number(codexStore.stats().filled) || 0
      codexTotal = codexStore.listAll().length
    } catch { /* 攻略数据读不动不影响状态页 */ }
    let miaoOk = false
    try {
      miaoOk = miaoRes.counts().character > 0
    } catch { /* miao 缺失时不报错 */ }

    return {
      siteName: SITE_NAME,
      title: TITLE,
      hasData: counts.teams > 0,
      dataTime: info.fetchedAt ? formatTime(info.fetchedAt) : '尚未抓取',
      ageText: info.fetchedAt ? agoText(info.ageMs) : '—',
      ttlText: `${info.ttlMinutes} 分钟`,
      staleText: info.stale ? '已过期（下次查询会自动刷新）' : '有效',
      proxy: proxy || '',
      networkEnabled: loadConfig().networkEnabled === true,
      codexFilled,
      codexTotal,
      miaoOk,
      atlasOk: atlasRes.present === true,
      sources: [
        { name: 'DPS数据库', count: counts.teams },
        { name: '危战榜单', count: counts.teams2 }
      ],
      versions: `${verList.length} 个版本（${verList[verList.length - 1] || '-'} ~ ${verList[0] || '-'}）`,
      avatar: avatarStats(),
      pluginVersion,
      yunzaiVersion,
      versionText,
      copyright: DPS_COPYRIGHT
    }
  }

  /** `#DPS状态` — 缓存时间、条数、头像缓存与版本信息 */
  async handleStatus (e: YunzaiEvent): Promise<boolean> {
    const data = this.buildData()

    if (!data.hasData) {
      await e.reply(
        '[Meta] 还没有本地数据。\n' +
        '· 主人执行 #DPS更新 立即拉取\n' +
        '· 直接查询（#DPS榜 / #DPS危战榜）也会自动拉取\n' +
        `· 若拉取失败，检查配置里的 proxy（当前：${data.proxy || '未设置（直连）'}）`
      )
      return true
    }

    return await respond(e, 'status', data as unknown as Record<string, unknown>, () => this.textOf(data))
  }

  /** 文本回退 */
  textOf (data: StatusData): string {
    return [
      `${data.title}｜${SITE_NAME}`,
      `数据时间：${data.dataTime}（${data.ageText}）· 缓存有效期 ${data.ttlText} · ${data.staleText}`,
      ...data.sources.map(s => `· ${s.name}：${s.count} 条`),
      `· 危战版本：${data.versions}`,
      `· 立绘缓存：${data.avatar.cached}/${data.avatar.total} 张`,
      `· 代理：${data.proxy || '未设置（直连）'}`,
      `· 联网开关：${data.networkEnabled ? '已开启' : '已关闭（不联网）'}　攻略数据：${data.codexFilled}/${data.codexTotal} 个角色有内容`,
      `· 资源来源：miao ${data.miaoOk ? '已安装' : '未找到'}｜Atlas ${data.atlasOk ? '已安装（可选）' : '未安装'}`,
      `· ${versionText}`
    ].join('\n')
  }
}