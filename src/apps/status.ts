/**
 * `#meta状态` —— 缓存时间、条数、头像缓存与版本信息
 *
 * 合并自 `Mhydps-Plugin/apps/status.js`。图与文本回退共用 `buildData()` 一份数据。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { disabledModules, getGradeRule, getGradeRuleOverrides, getPluginConfig, getProxy, isQueryNetworkEnabled, MODULE_LABELS } from '../components/config.js'
import { proxyHasAuth, proxySafe } from '../components/proxy.js'
import { COMMANDS, DPS_COPYRIGHT, RULES, SITE_NAME, agoText, formatTime } from '../components/constants.js'
import { avatarFillStatus, avatarStats } from '../model/AvatarStore.js'
import { versions } from '../model/CharacterIndex.js'
import { cacheInfo, getCounts } from '../model/TeamStore.js'
import { codexStore } from '../model/CodexStore.js'
import { atlasRes } from '../model/AtlasRes.js'
import { miaoRes } from '../model/MiaoRes.js'
import { pluginVersion, versionText, yunzaiVersion } from '../components/pluginVersion.js'
import { respond } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'
import { moduleGateReply } from '../modules/moduleGate.js'

const META = COMMANDS.find(c => c.rules.includes('status'))!

const TITLE = '#meta状态'

/**
 * 最近一次补图的文案
 *
 * 补图失败原来的表现只是「页面没有头像」，看不出是联网关着、站点挂了还是写盘失败；
 * 这里把开关关闭 / 全部命中 / 成功与失败张数 / 首条错误写出来，省得去翻日志。
 */
function avatarFillText (): string {
  const fill = avatarFillStatus()
  if (!fill) return '尚未补过图'
  const at = fill.at ? formatTime(fill.at) : ''
  switch (fill.reason) {
    case 'network-off':
      return '联网已关闭，跳过下载（页面改用本地头像）'
    case 'all-cached':
      return `${fill.total} 张全部已缓存`
    case 'no-targets':
      return '本次没有要补的头像'
    default: {
      const head = fill.failed
        ? `成功 ${fill.downloaded} / 失败 ${fill.failed}`
        : `成功 ${fill.downloaded} 张（已缓存 ${fill.cached}/${fill.total}）`
      // 状态页只放首条错误的前 60 字（完整内容在 logger.warn 里），否则会把卡片撑成一整段
      const err = fill.error ? (fill.error.length > 60 ? `${fill.error.slice(0, 60)}…` : fill.error) : ''
      return `${head}${at ? `　${at}` : ''}${fill.failed && err ? `　首条：${err}` : ''}`
    }
  }
}

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
  proxyConfigured: boolean
  proxyAuth: boolean
  /** 业务查询联网开关（默认关；关着时查询类远程访问一律不发，页面只能出缓存里的数据） */
  networkEnabled: boolean
  /** 已关闭的模块（功能层；标签串，逗号顿号分隔，空串表示全开） */
  disabledModules: string
  /** 攻略数据：有内容的角色数 / 收录总数 */
  codexFilled: number
  codexTotal: number
  /** 评分规则（不是数据表：跟随 miao 面板 / 全局强制 / 逐角色覆盖） */
  gradeRuleText: string
  /** 资源来源探测（miao 必需 / Atlas 可选） */
  miaoOk: boolean
  atlasOk: boolean
  sources: Array<{ name: string, count: number }>
  versions: string
  avatar: { total: number, cached: number }
  /** 最近一次补图的结果（文案；从未补过图为空） */
  avatarFillText: string
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
        { reg: RULES.status, fnc: 'handleStatus', permission: META.permission }
      ]
    })
  }

  /** 状态数据（图与文本回退共用一份） */
  buildData (master = false): StatusData {
    const info = cacheInfo()
    const counts = getCounts()
    const proxy = getProxy()
    // 公共页面只回显"是否配置"；主人也只多看到 host:port（凭据一律不显示）
    const proxyShown = master ? proxySafe(proxy) : (proxy ? '已配置' : '')
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

    // 评分规则（2026-10-27：直接用 miao 面板激活的规则）：全局强制 / 逐角色覆盖
    const globalGradeRule = getGradeRule()
    const gradeOverrideCount = Object.keys(getGradeRuleOverrides()).length
    const gradeRuleText = (globalGradeRule === 'auto'
      ? '跟随 miao 面板'
      : `全局强制 ${globalGradeRule}`)
      + (gradeOverrideCount ? `（逐角色覆盖 ${gradeOverrideCount} 个）` : '')

    return {
      siteName: SITE_NAME,
      title: TITLE,
      hasData: counts.teams > 0,
      dataTime: info.fetchedAt ? formatTime(info.fetchedAt) : '尚未抓取',
      ageText: info.fetchedAt ? agoText(info.ageMs) : '—',
      ttlText: `${info.ttlMinutes} 分钟`,
      staleText: info.stale ? '已过期（下次查询会自动刷新）' : '有效',
      proxy: proxyShown,
      proxyConfigured: !!proxy,
      proxyAuth: proxyHasAuth(proxy),
      networkEnabled: isQueryNetworkEnabled(),
      disabledModules: disabledModules().map(key => MODULE_LABELS[key]).join('、'),
      codexFilled,
      codexTotal,
      gradeRuleText,
      miaoOk,
      atlasOk: atlasRes.present === true,
      sources: [
        { name: 'DPS数据库', count: counts.teams },
        { name: '危战榜单', count: counts.teams2 }
      ],
      versions: `${verList.length} 个版本（${verList[verList.length - 1] || '-'} ~ ${verList[0] || '-'}）`,
      avatar: avatarStats(),
      avatarFillText: avatarFillText(),
      pluginVersion,
      yunzaiVersion,
      versionText,
      copyright: DPS_COPYRIGHT
    }
  }

  /** `#meta状态` — 缓存时间、条数、头像缓存与版本信息 */
  async handleStatus (e: YunzaiEvent): Promise<boolean> {
    if (await moduleGateReply('status', e)) return true
    const data = this.buildData((e as unknown as { isMaster?: boolean }).isMaster === true)

    if (!data.hasData) {
      await e.reply(
        '[Meta] 还没有本地数据。\n' +
        '· 主人执行 #榜单刷新 立即拉取\n' +
        '· 直接查询（#DPS / #危战）也会自动拉取\n' +
        `· 若拉取失败，检查配置里的 proxy（当前：${data.proxyConfigured ? (data.proxy || '已配置') : '未设置（直连）'}${data.proxyAuth ? '（含认证，凭据不显示）' : ''}）`
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
      `· 立绘缓存：${data.avatar.cached}/${data.avatar.total} 张　上次补图：${data.avatarFillText}`,
      `· 代理：${data.proxyConfigured ? (data.proxy || '已配置') : '未设置（直连）'}${data.proxyAuth ? '（含认证，凭据不显示）' : ''}`,
      `· 业务查询联网：${data.networkEnabled ? '已开启' : '已关闭（查询类远程访问不发请求）'}　模块关闭：${data.disabledModules || '无'}　攻略数据：${data.codexFilled}/${data.codexTotal} 个角色有内容`,
      `· 评分规则：${data.gradeRuleText}`,
      `· 资源来源：miao ${data.miaoOk ? '已安装' : '未找到'}｜Atlas ${data.atlasOk ? '已安装（可选）' : '未安装'}`,
      `· ${versionText}`
    ].join('\n')
  }
}