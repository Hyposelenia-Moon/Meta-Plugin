/**
 * MiaoPanel — 用 miao-plugin 的面板渲染 **akasha 的数据**
 *
 * 需求：练度查询的画面对齐 miao 的面板（版式/图标/布局都用 miao 的代码），
 * 但**数据只来自 akasha.cv**（不碰 mhydps 的 Enka 代理，也不让 miao 自己去拉 Enka）。
 *
 * 做法：
 *   1) 把 akasha 的 `/api/builds`（等级/命座/天赋/武器/套装主词条）与
 *      `/api/getCalculationsForUser`（名次/伤害/武器）拼成 miao 的 **Avatar** ——
 *      复用 miao 的 `Avatar.create()` + `setAvatar(ds)`（`ds` 的形状与它自己的 `EnkaData` 一致）；
 *   2) 面板数值用 **akasha 的 `stats`**（它自己的聚合结果），不启用 miao 的属性推算
 *      （miao 推算需要圣遗物副词条，而 akasha 的接口不提供，见下）；
 *   3) 用 miao 的 `Common.render('character/profile-detail', …)` 出图。
 *
 * 已知缺口（**不要编数字**）：
 *   akasha 只给每件圣遗物的**主词条 key**，不给副词条，也不给圣遗物与角色的归属关系，
 *   因此面板的 5 张圣遗物卡与「圣遗物总分/评级」**留空**，并由调用方在文本里说明原因。
 *
 * ── 合并到 Meta-Plugin 时的三处**类型化**改动（逻辑/字符串/导出名逐字未动）──
 *   a. `miaoPluginDir()` 的"当前目录"：源码取 `process.cwd()`，这里改取 `dir.ts` 的 `botRoot`
 *      （= 插件根的上一级）—— `cwd` 在框架里依赖启动方式，而 `botRoot` 是唯一权威；两者
 *      在标准布局下是同一个目录，`<bot>/plugins/miao-plugin` 的解析结果不变。
 *   b. 配置读取：源码用 `components/config.js` 的 `getPluginConfig()`；本工程的对应物是
 *      `components/config.ts` 的 `loadConfig()`（同样是"逐字段合并默认值"的语义，且配置文件缺失时
 *      按默认值返回）。`getAkashaEnabled()` 的判定 `!== false` 同样内联为对 `akashaEnabled` 的判定。
 *   c. 本仓库**没有** akasha 客户端模块来提供 `loadFromDisk` 之类的启动加载 —— 本文件不做启动
 *      加载（它本来也只被查询路径使用），启动职责统一在 `model/startup.ts`。
 *   ⚠ miao-plugin 是外部无类型依赖：从它动态 import 的模型/组件在类型上用本文件内的窄接口描述，
 *     用不到的成员一概不声明（不引 `any`）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { botRoot } from '../dir.js'
import { loadConfig } from '../components/config.js'

/* ============================================================
 *  与 miao-plugin 的对接面（窄接口：只声明本文件真正用到的成员）
 * ============================================================ */

/** miao 的格式化器（`components/Format`）中本文件用到的两个方法 */
interface MiaoFormat {
  comma: (value: number, digits?: number) => string
  pct: (value: number, digits?: number) => string
}

/** miao 的角色模型面向对象（本文件只用 `create/get` 与 `elem`/`name`/`id`/`weapon`） */
interface MiaoCharacter {
  id?: number | string
  name?: string
  elem?: string
  weapon?: string
}

/** miao 的武器模型 */
interface MiaoWeapon {
  name?: string
}

/** miao 的圣遗物模型 */
interface MiaoArtifact {
  getArtisKeyTitle: (game: string) => string
}

/** miao 的 Avatar 实例（只声明本文件调用的成员） */
interface MiaoAvatar {
  uid?: string
  char?: MiaoCharacter
  setAvatar: (ds: unknown, game: string) => void
  getData: (keys: string) => Record<string, unknown>
  getWeaponDetail?: () => unknown
  getArtisMark?: () => Record<string, unknown>
}

/** `models/index.js` 的导出面 */
interface MiaoModels {
  Avatar: { create: (char: { id: unknown }, game: string) => MiaoAvatar | null }
  Character: { get: (id: unknown) => MiaoCharacter | null }
  Weapon: { get: (id: unknown, game?: string) => MiaoWeapon | null }
  Artifact: MiaoArtifact
}

/** `components/index.js` 的导出面 */
interface MiaoComponents {
  Common: { render: (tpl: string, data: unknown, opts: { e: YunzaiEvent, scale: number }) => Promise<unknown> }
  Format: MiaoFormat
}

/** 一次加载的结果（进程内复用） */
interface MiaoLoaded {
  dir: string
  models: MiaoModels
  Common: MiaoComponents['Common']
  Format: MiaoFormat
}

/* ============================================================
 *  定位与加载 miao-plugin
 * ============================================================ */

/**
 * 目录"像不像 miao-plugin"（能力判定，不看目录名）
 *
 * `models/index.js` 是导入入口；再要一个 miao 特有的资源/应用目录，避免误判其它插件。
 */
function looksLikeMiao (dir: string): boolean {
  return fs.existsSync(path.join(dir, 'models', 'index.js')) &&
    (fs.existsSync(path.join(dir, 'resources', 'meta-gs')) ||
     fs.existsSync(path.join(dir, 'apps', 'profile')))
}

/** `plugins/*` 里所有目录（扫描用；读不到就返回空数组） */
function pluginDirs (): string[] {
  const base = path.join(botRoot, 'plugins')
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(base, d.name))
  } catch {
    return []
  }
}

/**
 * 本机 miao-plugin 目录（可用 `META_MIAO_PLUGIN` 环境变量或配置 `miaoPluginDir` 覆盖）
 *
 * ⚠ 修正（2026-10-14）：`dir.ts` 的 `botRoot` 是 **bot 根**（如 `D:\...\Yunzai`），
 *   不是 `<bot>/plugins` —— 原实现少拼了一层 `plugins`，于是永远找不到 miao。
 *   另外阿修 fork 版可能装成别的目录名，所以最后**扫描 `plugins/*` 做能力判定**兜底。
 */
export function miaoPluginDir (): string {
  const cfg = loadConfig() as unknown as { miaoPluginDir?: unknown }
  const candidates: string[] = [
    String(process.env.META_MIAO_PLUGIN || ''),
    String(cfg.miaoPluginDir || '').trim(),
    path.join(botRoot, 'plugins', 'miao-plugin'),
    path.join(botRoot, 'miao-plugin')
  ]
  for (const p of candidates) {
    if (!p) continue
    const dir = path.resolve(p)
    if (looksLikeMiao(dir)) return dir
  }
  // 兜底：目录名被改过（fork / 自定义）时按能力找
  for (const dir of pluginDirs()) {
    const name = path.basename(dir).toLowerCase()
    if (name.includes('meta') || name.includes('atlas') || name.includes('mhydps')) continue
    if (looksLikeMiao(dir)) return dir
  }
  return ''
}

let loaded: MiaoLoaded | null = null
let loadError = ''

/** 上一次加载失败的原因（排查用） */
export function miaoLoadError (): string {
  return loadError
}

/** 加载 miao 的模型与渲染入口（进程内一次） */
export async function loadMiao (): Promise<MiaoLoaded | null> {
  if (loaded) return loaded
  const dir = miaoPluginDir()
  if (!dir) {
    loadError = 'not found'
    return null
  }
  try {
    const url = (rel: string): string => pathToFileURL(path.join(dir, rel)).href
    // `import()` 的边界：specifier 由 `url()` 在运行时刻算出，tsc 拿到的是未类型化模块
    // （所以这里既没有编译错误、也没有 `@ts-expect-error` 可压）。显式断言成窄接口、不用 `any`，
    // 断言的正确性由 miao-plugin 的导出名保证。
    const models = (
      await import(url('models/index.js'))
    ) as MiaoModels
    const components = (
      await import(url('components/index.js'))
    ) as MiaoComponents
    loaded = { dir, models, Common: components.Common, Format: components.Format }
    return loaded
  } catch (err) {
    loadError = String((err as Error)?.message || err)
    logger?.warn?.(`[Meta] 加载 miao-plugin 失败：${loadError}`)
    return null
  }
}

/* ============================================================
 *  akasha 数据 → miao Avatar
 * ============================================================ */

/** akasha 的英文属性名 → miao/面板用的字段名 */
const STAT_KEY: Record<string, string> = {
  hp: 'hp',
  // ⚠ `maxHp` 才是**总生命**（akasha 样本里只有它，没有 `hp`）：漏了它面板的生命值会整格空着
  //（2026-10-15 四项目复核 P2）；两个都在时以 `maxHp` 为准，故排在后面
  maxHp: 'hp',
  baseHp: 'hpBase',
  atk: 'atk',
  baseAtk: 'atkBase',
  def: 'def',
  baseDef: 'defBase',
  elementalMastery: 'mastery',
  critRate: 'cpct',
  critDamage: 'cdmg',
  energyRecharge: 'recharge',
  healingBonus: 'heal'
}

/** 天赋位次（akasha 的 `talentsLevelMap` 键）→ miao 的 a/e/q */
const TALENT_KEY: Record<string, string> = {
  normalAttacks: 'a',
  elementalSkill: 'e',
  elementalBurst: 'q'
}

/**
 * akasha `/api/builds` 里本文件用到的字段
 *
 * akasha 是外部接口，字段可能变；这里只声明"读了哪些路径"，其余保持 `unknown`（不做任何假设）。
 */
interface AkashaBuild {
  uid?: unknown
  constellation?: unknown
  costumeId?: unknown
  propMap?: Record<string, { val?: unknown } | undefined>
  talentsLevelMap?: Record<string, { level?: unknown } | undefined>
  fetterInfo?: { expLevel?: unknown }
  weapon?: {
    weaponId?: unknown
    name?: unknown
    weaponInfo?: { level?: unknown, promoteLevel?: unknown, refinementLevel?: { value?: unknown } }
  }
}

/** akasha `stats` 的形态：`{ [英文属性名]: { value: number } }` */
export type AkashaStats = Record<string, { value?: number | null } | undefined>

/** 从 akasha 的 build 对象拼出 miao Avatar 需要的 `ds`（形状与 miao 的 `EnkaData` 一致） */
export async function buildAkashaAvatar (charId: string | number, build: AkashaBuild = {}): Promise<MiaoAvatar | null> {
  const miao = await loadMiao()
  if (!miao) return null
  const { Avatar, Character, Weapon } = miao.models
  const char = Character.get(charId)
  if (!char) return null

  const weaponId = build?.weapon?.weaponId
  let weaponName = String(build?.weapon?.name || '')
  let weapon: MiaoWeapon | null = null
  try {
    // 保留源码的短路写法（`weaponId && …` 在 JS 里返回的是 falsy 值本身，这里显式写成三元，语义一致）
    weapon = (weaponId ? Weapon.get(weaponId) : null) || (weaponName ? Weapon.get(weaponName, 'gs') : null) || null
  } catch { /* 找不到就退回英文名 */ }
  if (weapon?.name) weaponName = weapon.name

  const talent: Record<string, number> = {}
  for (const [key, one] of Object.entries(build?.talentsLevelMap || {})) {
    const mapped = TALENT_KEY[key] || (key === 'elementalSkill' ? 'e' : null)
    if (mapped) talent[mapped] = Number(one?.level) || 0
  }

  const ds = {
    level: Number(build?.propMap?.level?.val) || 0,
    promote: Number(build?.propMap?.ascension?.val) || 0,
    cons: Number(build?.constellation) || 0,
    fetter: Number(build?.fetterInfo?.expLevel) || 0,
    costume: Number(build?.costumeId) || 0,
    elem: char.elem,
    weapon: {
      name: weaponName,
      level: Number(build?.weapon?.weaponInfo?.level) || 0,
      promote: Number(build?.weapon?.weaponInfo?.promoteLevel) || 0,
      affix: Number(build?.weapon?.weaponInfo?.refinementLevel?.value ?? 0) + 1
    },
    talent,
    // akasha 不提供圣遗物副词条 → 刻意留空（不编数字）
    artis: {}
  }

  const avatar = Avatar.create({ id: char.id }, 'gs')
  if (!avatar) return null
  avatar.uid = String(build?.uid || '')
  avatar.setAvatar(ds, 'enka')
  return avatar
}

/* ============================================================
 *  akasha stats → 面板数值
 * ============================================================ */

/** miao 面板里以**百分数**展示的属性键（其余是平铺值） */
const MIAO_RATIO_ATTRS = new Set(['cpct', 'cdmg', 'recharge', 'heal', 'dmg'])

/**
 * akasha 的 stats → 面板的 attr 结构
 *
 * ⚠ 两处单位/分槽修正（2026-10-15 四项目复核 P2）：
 *  1. akasha 的比例键（`critRate` / `critDamage` / `energyRecharge` …）是 **0~1 比例**，
 *     而 miao `Format.pct()` 只拼 `%` 不乘 100 → 必须走 `Format.percent()`（或自己 ×100）；
 *  2. 总值与基础值**分槽**：`atk`（总攻击）与 `atkBase`（基础攻击）各归各位 ——
 *     原实现把 `baseAtk` 写进 `attr.atk`，等于拿基础攻击顶替总攻击，还漏了 `maxHp`。
 */
export function akashaAttr (stats: AkashaStats = {}, Format: MiaoFormat): Record<string, string> {
  const attr: Record<string, string> = {}
  const asPercent = (n: number): string => {
    const withPercent = (Format as unknown as { percent?: (v: number, fix?: number) => string }).percent
    return typeof withPercent === 'function' ? withPercent.call(Format, n) : Format.pct(n * 100)
  }
  for (const [from, to] of Object.entries(STAT_KEY)) {
    const raw = stats?.[from]?.value
    if (raw === undefined || raw === null) continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    attr[to] = MIAO_RATIO_ATTRS.has(to) ? asPercent(value) : Format.comma(value, 1)
    attr[`${to}Base`] = '-'
    attr[`${to}Plus`] = '-'
  }
  return attr
}

/** miao 面板的属性表需要的 8 项键（缺的补 `-`） */
const ATTR_KEYS = ['hp', 'atk', 'def', 'mastery', 'cpct', 'cdmg', 'recharge', 'dmg']

/** `toPanelData` 的入参 */
export interface PanelInput {
  uid: unknown
  avatar: MiaoAvatar
  attr?: Record<string, string>
  costumeSplash?: string
}

/** miao 面板模板的 renderData（结构照 miao 的 `ProfileDetail.render`） */
export interface PanelData {
  save_id: unknown
  uid: string
  game: string
  data: Record<string, unknown>
  attr: Record<string, string>
  elem: string
  hsr_paths: string
  dmgCalc: { dmgData: unknown[] }
  artisDetail: Record<string, unknown>
  artisKeyTitle: string
  bodyClass: string
  mode: string
  wCfg: Record<string, unknown>
  changeProfile: boolean
}

/** 组装 miao 面板模板的 renderData（数值来自 akasha） */
export async function toPanelData ({ uid, avatar, attr = {}, costumeSplash = '' }: PanelInput): Promise<PanelData | null> {
  const miao = await loadMiao()
  if (!miao || !avatar) return null
  const { Artifact } = miao.models
  const { Format } = miao

  const full: Record<string, string> = {}
  for (const key of ATTR_KEYS) {
    full[key] = attr[key] ?? '-'
    full[`${key}Base`] = attr[`${key}Base`] ?? '-'
    full[`${key}Plus`] = attr[`${key}Plus`] ?? '-'
  }

  const data = avatar.getData('name,abbr,cons,level,talent,imgs,costumeSplash')
  if (costumeSplash) data.costumeSplash = costumeSplash
  try {
    data.weapon = avatar.getWeaponDetail?.()
  } catch {
    data.weapon = null
  }

  // 圣遗物区留空：akasha 不提供副词条，强行渲染只会得到空卡或假数字
  const artisDetail: Record<string, unknown> = {}
  try {
    Object.assign(artisDetail, avatar.getArtisMark?.() || {})
  } catch { /* 没有圣遗物时 miao 可能直接抛错，忽略 */ }
  artisDetail.artis = {}
  artisDetail.allAttr = Array.from({ length: 9 }, () => ({}))
  artisDetail.mark = ''
  artisDetail.markClass = ''
  if (Format?.comma === undefined) return null

  return {
    save_id: uid,
    uid: String(uid),
    game: 'gs',
    data,
    attr: full,
    elem: avatar.char?.elem || '',
    hsr_paths: avatar.char?.weapon || '',
    dmgCalc: { dmgData: [] },
    artisDetail,
    artisKeyTitle: Artifact.getArtisKeyTitle('gs'),
    bodyClass: `char-${avatar.char?.name || ''}`,
    mode: 'profile',
    wCfg: {},
    changeProfile: false
  }
}

/** 调 miao 自己的渲染入口出图（模板/样式/图标/缩放都是 miao 的） */
export async function renderMiaoPanel (e: YunzaiEvent, panelData: PanelData | null, scale = 1.6): Promise<boolean> {
  const miao = await loadMiao()
  if (!miao || !panelData) return false
  await miao.Common.render('character/profile-detail', panelData, { e, scale })
  return true
}

/** 面板是否可用（配置 + miao 是否就位） */
export async function miaoPanelReady (): Promise<boolean> {
  // 等于源码的 `getAkashaEnabled()`：只有显式 `akashaEnabled: false` 才算关闭
  if (loadConfig().akashaEnabled === false) return false
  return Boolean(await loadMiao())
}
