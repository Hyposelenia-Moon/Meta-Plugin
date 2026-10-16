/**
 * 配置读取（三层结构）
 *
 *   `defSet/config.yaml`          ← 锅巴模板（`${meta_*}` 占位符 + 注释）
 *   `guoba/index.js`              ← 读模板 → 替换变量 → 写 `config/config.yaml`
 *   `config/config.yaml`          ← 运行时配置（**不入库**）
 *   `config/config.yaml.example`  ← 参考默认值（入库，首次启动自动复制）
 *
 * 键名与旧 Mhydps-Plugin 的对照见设计文档 §14.8（变量前缀统一 `${meta_*}`）。
 * `META_CONFIG_FILE` 可指向别处：回归套件用它构造临时配置，避免动仓库里的 `config/config.yaml`。
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { configDir } from '../dir.js'
import { MAX_PAGE_SIZE } from './constants.js'

/**
 * 模块功能开关的键（**功能层**：该模块的命令是否响应）
 *
 * 与另外两层正交，三者关系见 `AGENTS.md` 硬约束 8：
 *   - `modules.*`（本层）：功能是否可用 —— 关闭时命令不响应
 *   - `networkEnabled`（查询联网层）：业务查询是否允许**远程访问/刷新**（阿修 2026-10-15 的定义）
 *   - `akashaEnabled`（数据通道层）：是否允许走阿卡莎通道（浏览器会话）
 *
 * 一个键对应一个 app（模块边界 = 代码边界，最好维护）。
 */
export const MODULE_KEYS = [
  'codex', 'help', 'rank', 'raidTiers',
  'build', 'grade', 'teamDamage', 'video', 'status', 'admin'
] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]

/** 模块中文名（状态页 / 关闭提示 / 锅巴标签共用一处） */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  codex: '角色攻略',
  help: '帮助页',
  rank: 'DPS 榜',
  raidTiers: '危战分档',
  build: '练度榜',
  grade: '练度提升指南',
  teamDamage: '队伍伤害',
  video: '榜单视频',
  status: '状态页',
  admin: '榜单刷新'
}

/** 默认全开；`teamDamage`（队伍伤害）暂时默认关闭（用户 2026-10-15 要求） */
export const defaultModules: Record<ModuleKey, boolean> = Object.fromEntries(
  MODULE_KEYS.map(key => [key, key !== 'teamDamage'])
) as Record<ModuleKey, boolean>

/** 运行时配置的形状（新增键时：同轮同步 defSet 模板、example、guoba 的 TEMPLATE_VARS/DEFAULTS） */
export interface MetaConfig {
  /** 常规查询 app 的优先级（抢占 app 的优先级写死为 -100000，不在此配置） */
  priority: number
  /** 渲染缩放 */
  renderScale: number
  /**
   * 模块功能开关（功能层）：`{ codex: true, teamDamage: false, … }`，键见 `MODULE_KEYS`
   *
   * 关闭的模块**命令不响应**：非接管类回一条统一提示，接管类（攻略 / 帮助）不认领、放行给其他插件。
   */
  modules: Record<ModuleKey, boolean>
  /**
   * 业务查询联网开关（**不是**整个插件的全局联网禁令）
   *
   * 只管辖 DPS 榜 / 危战 / 练度等**查询类**远程访问与刷新（mhydps / akasha / miao 面板 / 队伍 /
   * 榜单头像下载）；别名服务、可选插件探测、依赖安装等其他网络操作不受它限制（阿修 2026-10-15 口径）。
   */
  networkEnabled: boolean
  /** mhydps.cn 代理（站点需代理才能访问） */
  proxy: string
  /** 榜单缓存 TTL（分钟） */
  dpsCacheTtlMinutes: number
  /** 榜单每页条数 */
  dpsPageSize: number
  /** 榜单请求超时（毫秒） */
  dpsTimeoutMs: number
  /** 榜单是否带头像 */
  dpsAvatarEnabled: boolean
  /** 练度查询开关 */
  akashaEnabled: boolean
  /** 练度默认 UID */
  akashaDefaultUid: string
  /** akasha 代理 */
  akashaProxy: string
  /** akasha 请求超时（毫秒） */
  akashaTimeoutMs: number
  /** akasha 缓存 TTL（分钟） */
  akashaCacheTtlMinutes: number
  /** akasha 单次最多展示的角色数 */
  akashaMaxChars: number
  /**
   * 练度评分权重（紧凑写法 `comprehensive:65,weapon:20,talent:15`）
   *
   * 只对"攻略里有目标"的维度加权，其余维度不计入分母（见 modules/grade.ts）。
   * ⚠ 2026-10-15 起面板与圣遗物合并成 `comprehensive`；旧配置里的 `panel` + `artifact` 会**自动相加**
   *   折进 `comprehensive`（见 `getGradeWeights()`），所以老配置文件不用改。
   */
  gradeWeights: string
  /** 面板三档阈值（`big:0.9,normal:0.6,small:0.3`） */
  gradePanelTiers: string
  /**
   * 队伍伤害的**序号轴**（2026-10-15 用户定）
   *
   * 写法：`序号:名称=轴定义`，逗号分隔；轴定义 = `关键词×次数@窗口s`（多段用 `+`），
   * `默认` 或留空 = 保守轴（每人最高单次 ×1／20s）。例：`1:保守轴=默认,2:重击轴=重击×8@20s`
   */
  teamDamageAxes: string
  /** 总体练度九档阈值（`MAX:95,ACE:88,…`，低于最后一项记 D） */
  gradeRankThresholds: string
}

/** 默认配置（与 `config/config.yaml.example` 保持一致） */
export const defaultConfig: MetaConfig = {
  priority: 8000,
  renderScale: 1.5,
  modules: { ...defaultModules },
  networkEnabled: false,
  proxy: '',
  dpsCacheTtlMinutes: 30,
  dpsPageSize: 10,
  dpsTimeoutMs: 30000,
  dpsAvatarEnabled: true,
  akashaEnabled: true,
  akashaDefaultUid: '',
  akashaProxy: '',
  akashaTimeoutMs: 60000,
  akashaCacheTtlMinutes: 30,
  akashaMaxChars: 12,
  gradeWeights: 'comprehensive:65,weapon:20,talent:15',
  gradePanelTiers: 'big:0.9,normal:0.6,small:0.3',
  teamDamageAxes: '1:保守轴=默认',
  gradeRankThresholds: 'MAX:95,ACE:88,SSS:80,SS:72,S:64,A:55,B:45,C:30'
}

/** 运行时配置文件路径（`META_CONFIG_FILE` 优先） */
export function configFile (): string {
  return process.env.META_CONFIG_FILE
    ? path.resolve(process.env.META_CONFIG_FILE)
    : path.join(configDir, 'config.yaml')
}

/** 参考默认值文件路径（入库） */
export function exampleFile (): string {
  return path.join(configDir, 'config.yaml.example')
}

/** 首次启动：缺 `config.yaml` 时从 example 复制一份（与 Atlas / Mhydps 同一约定） */
export function ensureConfigFile (): void {
  try {
    if (fs.existsSync(configFile()) || !fs.existsSync(exampleFile())) return
    fs.mkdirSync(path.dirname(configFile()), { recursive: true })
    fs.copyFileSync(exampleFile(), configFile())
    logger?.info('[Meta] 已从 config.yaml.example 创建配置文件')
  } catch (err) {
    logger?.warn(`[Meta] 创建配置文件失败：${(err as Error).message}`)
  }
}

/** 深合并：运行时配置逐字段覆盖默认值（嵌套对象递归） */
function deepMerge<T> (base: T, overlay: unknown): T {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return { ...base }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
    const baseValue = result[key]
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(baseValue as Record<string, unknown>, value)
    } else {
      result[key] = value
    }
  }
  return result as T
}

/** 读取配置（文件不存在 / 解析失败 → 全默认值，只告警不抛错） */
export function loadConfig (): MetaConfig {
  try {
    const file = configFile()
    if (!fs.existsSync(file)) return { ...defaultConfig }
    const raw = YAML.parse(fs.readFileSync(file, 'utf8')) || {}
    return deepMerge(defaultConfig, raw)
  } catch (err) {
    logger?.warn(`[Meta] 配置解析失败，按默认值处理：${(err as Error).message}`)
    return { ...defaultConfig }
  }
}

/**
 * 渲染缩放的夹取（0.5 ~ 3）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `clampRenderScale()`：
 *   `null` / `undefined` / 空串视为「没配」→ 回落默认值（`Number(null)` 是 0，不特判会被夹成 0.5）。
 */
export function clampRenderScale (value: unknown): number {
  if (value === null || value === undefined || value === '') return defaultConfig.renderScale
  const num = Number(value)
  if (!Number.isFinite(num)) return defaultConfig.renderScale
  return Math.min(3, Math.max(0.5, num))
}

/** 渲染缩放（渲染模块用） */
export function getRenderScale (): number {
  return clampRenderScale(loadConfig().renderScale)
}

/**
 * 模块是否启用（功能层）
 *
 * 缺省值：`teamDamage` 默认关闭、其余默认开启；显式 `false` 才算关闭（与 `getAkashaEnabled` 同约定）。
 */
export function isModuleEnabled (key: ModuleKey): boolean {
  const value = (loadConfig().modules || {})[key]
  if (value === undefined || value === null) return defaultModules[key]
  return value !== false
}

/** 已关闭的模块键（状态页与状态文案用） */
export function disabledModules (): ModuleKey[] {
  return MODULE_KEYS.filter(key => !isModuleEnabled(key))
}

/** 模块被关闭时给用户的统一文案（非接管类命令用） */
export function moduleOffText (key: ModuleKey): string {
  return `[Meta] 「${MODULE_LABELS[key]}」已在配置中关闭（modules.${key}）；`
    + '管理员可在 config/config.yaml 或锅巴面板里开启'
}

/**
 * 业务查询是否允许远程访问/刷新（查询联网层，阿修 2026-10-15 定义）
 *
 * ⚠ 只管 DPS 榜 / 危战 / 练度等**查询类**远程请求；**不是**整个插件的全局联网禁令 ——
 *   别名服务、可选插件探测、依赖安装等其他网络操作不受它限制。
 */
export function isQueryNetworkEnabled (): boolean {
  return loadConfig().networkEnabled === true
}

/** 查询联网关闭时的统一文案（与 `isQueryNetworkEnabled` 配套，替代各处自写措辞） */
export const QUERY_NETWORK_OFF_HINT =
  '业务查询联网已关闭（networkEnabled=false，该开关只管辖查询类远程访问）'

/**
 * 榜单缓存 TTL（分钟）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getCacheTtlMinutes()`：非法值回落默认、最小 1 分钟。
 * TeamStore 与状态页都取自这里（单一出处）。
 */
export function getDpsCacheTtlMinutes (): number {
  const value = Number(loadConfig().dpsCacheTtlMinutes)
  if (!Number.isFinite(value) || value < 1) return defaultConfig.dpsCacheTtlMinutes
  return Math.floor(value)
}

/**
 * 榜单请求超时（毫秒）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getTimeoutMs()`：夹取到 **3s ~ 120s**，
 * 避免用户把超时改得过大拖住消息处理。
 */
export function getDpsTimeoutMs (): number {
  const value = Number(loadConfig().dpsTimeoutMs)
  if (!Number.isFinite(value)) return defaultConfig.dpsTimeoutMs
  return Math.min(120000, Math.max(3000, Math.floor(value)))
}

/** 练度查询（akasha）代理：不填则直连（akasha 自己不在墙内）；首尾空白会被修剪 */
export function getAkashaProxy (): string {
  return String(loadConfig().akashaProxy ?? '').trim()
}

/**
 * 练度查询超时（毫秒）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getAkashaTimeoutMs()`：夹取 **5s ~ 180s**
 * （akasha 走浏览器会话，单次比榜单慢，上下限都比 `dpsTimeoutMs` 宽）。
 */
export function getAkashaTimeoutMs (): number {
  const value = Number(loadConfig().akashaTimeoutMs)
  if (!Number.isFinite(value)) return defaultConfig.akashaTimeoutMs
  return Math.min(180000, Math.max(5000, Math.floor(value)))
}

/** 练度缓存 TTL（分钟；非法值回落默认、最小 1） */
export function getAkashaCacheTtlMinutes (): number {
  const value = Number(loadConfig().akashaCacheTtlMinutes)
  if (!Number.isFinite(value) || value < 1) return defaultConfig.akashaCacheTtlMinutes
  return Math.floor(value)
}

/** 单次最多展示的角色数（练度查询；夹取 1 ~ 30） */
export function getAkashaMaxChars (): number {
  const value = Number(loadConfig().akashaMaxChars)
  if (!Number.isFinite(value) || value < 1) return defaultConfig.akashaMaxChars
  return Math.min(30, Math.floor(value))
}

/** 榜单每页条数（夹取 1 ~ `MAX_PAGE_SIZE`，避免用户把图撑爆） */
export function getPageSize (): number {
  const value = Number(loadConfig().dpsPageSize)
  if (!Number.isFinite(value) || value < 1) return defaultConfig.dpsPageSize
  return Math.min(MAX_PAGE_SIZE, Math.floor(value))
}

/** 练度查询开关（锅巴 → 数据源二 · akasha.cv） */
export function getAkashaEnabled (): boolean {
  return loadConfig().akashaEnabled !== false
}

/** 榜单 / 危战请求代理（不填则直连）；首尾空白会被修剪 */
export function getProxy (): string {
  return String(loadConfig().proxy ?? '').trim()
}

/**
 * 完整配置对象（查询层用）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getPluginConfig()`。
 * ⚠ 键名已按设计文档 §14.8 改名：`avatarEnabled` → **`dpsAvatarEnabled`**、
 *   `pageSize` → `dpsPageSize`、`cacheTtlMinutes` → `dpsCacheTtlMinutes`、`timeoutMs` → `dpsTimeoutMs`。
 */
export function getPluginConfig (): MetaConfig {
  return loadConfig()
}

/* ---------- 练度评分（v3 P2） ---------- */

/**
 * 评分权重
 *
 * 2026-10-15 用户定：**面板与圣遗物合并为 `comprehensive`（综合）**，以圣遗物有效词条为主、
 * 面板不设严格限制 → 默认「综合 65 / 武器 20 / 天赋 15」（综合 = 旧面板 30 + 旧圣遗物 35）。
 *
 * 向后兼容：旧配置里的 `panel` 与 `artifact` 会**相加折进** `comprehensive`；
 * 若显式写了 `comprehensive`，则以它为准（旧两键忽略）。非法项忽略、缺失项用默认值。
 */
export function getGradeWeights (): Record<string, number> {
  const parsed = parseSpecSafe(loadConfig().gradeWeights)
  const legacySum = [parsed.panel, parsed.artifact]
    .map(v => Number(v))
    .filter(v => Number.isFinite(v))
    .reduce((s, v) => s + v, 0)
  const comprehensive = Number(parsed.comprehensive)
  return {
    comprehensive: Number.isFinite(comprehensive) && comprehensive > 0 ? comprehensive : (legacySum > 0 ? legacySum : 65),
    weapon: Number.isFinite(Number(parsed.weapon)) ? Number(parsed.weapon) : 20,
    talent: Number.isFinite(Number(parsed.talent)) ? Number(parsed.talent) : 15
  }
}

/** 面板三档阈值（大毕业 / 毕业 / 小毕业） */
export function getGradePanelTiers (): { big: number, normal: number, small: number } {
  const parsed = parseSpecSafe(loadConfig().gradePanelTiers)
  const pick = (k: string, def: number) => {
    const v = Number(parsed[k])
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : def
  }
  return { big: pick('big', 0.9), normal: pick('normal', 0.6), small: pick('small', 0.3) }
}

/** 总体练度九档阈值（写法 `MAX:95,ACE:88,…`；解析失败回落默认） */
export function getGradeRankThresholds (): Array<[string, number]> {
  return parseRankThresholdsSafe(loadConfig().gradeRankThresholds)
}

/** 紧凑写法解析（本文件内部用；评分模块另有一份带默认值的实现供离线单测） */
function parseSpecSafe (spec: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of String(spec || '').split(/[,，;；\s]+/)) {
    const [k, v] = part.split(/[:：=]/)
    const key = String(k || '').trim()
    const value = Number(String(v || '').trim())
    if (!key || !Number.isFinite(value)) continue
    out[key] = value
  }
  return out
}

const RANK_ORDER: Array<[string, number]> = [
  ['MAX', 95], ['ACE', 88], ['SSS', 80], ['SS', 72], ['S', 64], ['A', 55], ['B', 45], ['C', 30]
]

function parseRankThresholdsSafe (spec: unknown): Array<[string, number]> {
  const parsed = parseSpecSafe(spec)
  if (!Object.keys(parsed).length) return RANK_ORDER
  return RANK_ORDER.map(([name, def]) => [name, Number.isFinite(parsed[name]) ? parsed[name] : def])
}