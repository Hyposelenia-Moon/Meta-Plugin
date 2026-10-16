/**
 * akashaBoard — 阿卡莎角色榜条目的归一化（v3 P5，纯函数）
 *
 * 数据来自 `/api/leaderboards?...&calculationId=<id>`（每个角色榜 20 条，含上榜者的完整配装）。
 * 字段口径（2026-10-14 用真实样本核对过，夹具见 `test/fixtures/akasha-board.sample.json`）：
 *   - 名次 `index`；身份 `uid` / `owner.nickname` / `name`（角色英文名）
 *   - 伤害 `calculation.result`（分项在 `calculation.additional[]`，英文名）
 *   - 武器 `weapon.{name, icon, weaponInfo}`（英文名，中文靠 textmap）
 *   - 圣遗物 `artifactObjects`（**按部位键控的对象**：`EQUIP_SHOES` 等 Enka 名）
 *     每件的 `mainStatKey` 是 Enka 属性名（`FIGHT_PROP_*`）→ 直接走本仓库既有的 `ENKA_PROP_CN`
 *   - 套装 `artifactSets`（英文套装名 + 件数）
 *   - 面板数值在 **`stats`**（`maxHp` / `atk` / `baseAtk` / `elementalMastery` …；`propMap` 只有 `ascension`/`level`）
 *   - 天赋 `talentsLevelMap.{normalAttacks,elementalSkill,elementalBurst}.level`
 *   - 双爆分 `critValue`
 *
 * 中文名一律走 textmap（`/api/textmap/zh-CN`：`{translation:{"<英文小写>":"<中文>"}}`）；
 * 翻不到时**回落英文原文**而不是留空。
 */
import { ENKA_PROP_CN } from '../components/constants.js'

/** Enka 部位键 → 中文部位名 */
export const SLOT_CN: Record<string, string> = {
  EQUIP_BRACER: '生之花',
  EQUIP_NECKLACE: '死之羽',
  EQUIP_SHOES: '时之沙',
  EQUIP_RING: '空之杯',
  EQUIP_DRESS: '理之冠'
}

/** 站点 `stats` 的键 → 中文（翻不到就原样显示） */
export const STAT_CN: Record<string, string> = {
  maxHp: '生命值',
  atk: '攻击力',
  def: '防御力',
  baseAtk: '基础攻击力',
  baseHp: '基础生命值',
  baseDef: '基础防御力',
  elementalMastery: '元素精通',
  critRate: '暴击率',
  critRate_: '暴击率',
  critDMG: '暴击伤害',
  critDMG_: '暴击伤害',
  critDamage: '暴击伤害',
  energyRecharge: '元素充能效率',
  healingBonus: '治疗加成',
  incomingHealingBonus: '受治疗加成',
  shieldStrength: '护盾强效',
  elementalBonus: '元素伤害加成',
  physicalBonus: '物理伤害加成',
  anemoDamageBonus: '风元素伤害加成',
  geoDamageBonus: '岩元素伤害加成',
  electroDamageBonus: '雷元素伤害加成',
  dendroDamageBonus: '草元素伤害加成',
  hydroDamageBonus: '水元素伤害加成',
  pyroDamageBonus: '火元素伤害加成',
  cryoDamageBonus: '冰元素伤害加成',
  physicalDamageBonus: '物理伤害加成'
}

export interface BoardWeapon {
  name: string
  nameCn: string
  /** 精炼（站点字段不稳定，取不到时为 0） */
  affix: number
}

export interface BoardArtifact {
  slot: string
  slotCn: string
  mainKey: string
  mainCn: string
}

export interface BoardSet {
  name: string
  nameCn: string
  count: number
}

export interface BoardEntry {
  /** 名次（站点 `index`） */
  rank: number
  uid: string
  nickname: string
  /** 角色英文名 */
  charName: string
  /** 角色中文名（textmap 翻译，翻不到回落英文） */
  charNameCn: string
  cons: number
  critValue: number
  damage: number
  weapon: BoardWeapon | null
  artis: BoardArtifact[]
  sets: BoardSet[]
  stats: Array<{ key: string, label: string, value: number }>
  talent: { A: number, E: number, Q: number }
  lastBuildUpdate: number
}

export interface Textmap {
  translation?: Record<string, string>
}

/** textmap 翻译（键是英文小写；翻不到返回原文） */
export function translate (textmap: Textmap | null | undefined, en: unknown): string {
  const text = String(en ?? '').trim()
  if (!text) return ''
  const hit = textmap?.translation?.[text.toLowerCase()]
  return hit ? String(hit) : text
}

/** 归一化单条榜记录 */
export function normalizeBoardEntry (raw: Record<string, any>, textmap: Textmap | null = null): BoardEntry {
  const artis: BoardArtifact[] = []
  const objects = raw?.artifactObjects
  if (objects && typeof objects === 'object') {
    for (const [equip, piece] of Object.entries(objects as Record<string, any>)) {
      const mainKey = String(piece?.mainStatKey || piece?.main?.key || '')
      artis.push({
        slot: equip,
        slotCn: SLOT_CN[equip] || equip,
        mainKey,
        // ⚠ 实测 `mainStatKey` 不是 Enka 枚举而是英文短语（`ATK%` / `Pyro DMG Bonus` / `Crit DMG`），
        //    而 textmap 里正好有这些词的译文 → 先试 Enka 表，再走 textmap，最后回落原文
        mainCn: ENKA_PROP_CN[mainKey] || translate(textmap, mainKey)
      })
    }
    // 按固定部位顺序排（花羽沙杯冠）
    const order = Object.keys(SLOT_CN)
    artis.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot))
  }

  const sets: BoardSet[] = []
  const setObj = raw?.artifactSets
  if (setObj && typeof setObj === 'object') {
    for (const [name, ds] of Object.entries(setObj as Record<string, any>)) {
      sets.push({ name, nameCn: translate(textmap, name), count: Number(ds?.count) || 0 })
    }
    sets.sort((a, b) => b.count - a.count)
  }

  const stats: BoardEntry['stats'] = []
  const rawStats = raw?.stats
  if (rawStats && typeof rawStats === 'object') {
    for (const [key, ds] of Object.entries(rawStats as Record<string, any>)) {
      const value = Number(ds?.value ?? ds)
      if (!Number.isFinite(value)) continue
      stats.push({ key, label: STAT_CN[key] || key, value })
    }
  }

  const weaponRaw = raw?.weapon
  const weaponName = String(weaponRaw?.name || '')
  const affix = Number(
    weaponRaw?.weaponInfo?.affix ?? weaponRaw?.affix ?? weaponRaw?.refinement ?? weaponRaw?.weaponInfo?.refinement
  ) || 0

  return {
    rank: Number(raw?.index) || 0,
    uid: String(raw?.uid || ''),
    nickname: String(raw?.owner?.nickname || ''),
    charName: String(raw?.name || ''),
    charNameCn: translate(textmap, raw?.name),
    cons: Number(raw?.constellation) || 0,
    critValue: Number(raw?.critValue) || 0,
    damage: Number(raw?.calculation?.result) || 0,
    weapon: weaponName ? { name: weaponName, nameCn: translate(textmap, weaponName), affix } : null,
    artis,
    sets,
    stats,
    talent: {
      A: Number(raw?.talentsLevelMap?.normalAttacks?.level) || 0,
      E: Number(raw?.talentsLevelMap?.elementalSkill?.level) || 0,
      Q: Number(raw?.talentsLevelMap?.elementalBurst?.level) || 0
    },
    lastBuildUpdate: Number(raw?.lastBuildUpdate) || 0
  }
}

/** 归一化整页榜条目（`payload.data` 是记录数组） */
export function normalizeBoard (
  payload: Record<string, any> | null | undefined,
  textmap: Textmap | null = null
): { entries: BoardEntry[], total: number } {
  const list = Array.isArray(payload?.data) ? payload!.data as Record<string, any>[] : []
  const entries = list.map(r => normalizeBoardEntry(r, textmap)).filter(e => e.uid)
  entries.sort((a, b) => (a.rank || 999) - (b.rank || 999))
  return { entries, total: entries.length }
}

/** 按名次取一条（名次从 1 开始；取不到返回 null） */
export function pickByRank (entries: BoardEntry[], rank: number): BoardEntry | null {
  const want = Math.max(1, Math.floor(Number(rank) || 1))
  const sorted = [...(entries || [])].sort((a, b) => (a.rank || 999) - (b.rank || 999))
  return sorted[want - 1] || null
}

/** `#练度榜 <角色> [名次]` 的参数（2026-10-16 合并 `#配装` 后只有一个参数面） */
export interface BoardArgs {
  /** 角色名 token（阿卡莎榜只认单角色；多个 token 由调用方 join 后交给取数层报错） */
  names: string[]
  /** 名次（1~50；没写时 = 1） */
  rank: number
  /** 是否显式写了名次：`false` = 列表视图（前 size 条），`true` = 该名次的配装详情 */
  rankGiven: boolean
  /** 出现过"不像名次的纯数字"（如 9 位 UID）→ app 据此**静默不回复** */
  sawNumericOnly: boolean
}

/**
 * 解析 `#练度榜 <角色> [名次]` 的参数
 *
 * 2026-10-16 用户定：第二个参数是**名次**（第 N 名），不是 UID；本命令与查询者账号**无任何关系**，
 * 不解析、不接受、不显示任何 UID。纯数字且 1~50 视为名次（`第3名` / `3位` / `#3` 也认），
 * 其余纯数字（如 9 位 UID）直接忽略并标 `sawNumericOnly`。
 *
 * ⚠ 命名与 `modules/queryArgs.ts` 的 `parseBuildArgs` **刻意区分**：那个是合并前遗留的 UID 版解析
 *   （仍被 `test/mhydps-parity.test.mjs` 冻结），语义完全不同，不要混用。
 */
export function parseBoardArgs (raw: unknown): BoardArgs {
  const args: BoardArgs = { names: [], rank: 1, rankGiven: false, sawNumericOnly: false }
  for (const token of String(raw ?? '').split(/\s+/).map(s => s.trim()).filter(Boolean)) {
    const n = Number(token.replace(/[第名位#]/g, ''))
    if (Number.isFinite(n) && n >= 1 && n <= 50) { args.rank = Math.floor(n); args.rankGiven = true; continue }
    if (/^\d+$/.test(token)) { args.sawNumericOnly = true; continue }
    args.names.push(token)
  }
  return args
}

/**
 * 交给站点 textmap 接口的英文词表（角色名 / 武器 / 套装 / **圣遗物主词条短语**）
 *
 * 站点的 `mainStatKey` 不是 Enka 枚举名，而是英文短语（`HP%` / `Crit DMG` / `Crit RATE` / `Pyro DMG Bonus`），
 * `ENKA_PROP_CN` 只覆盖枚举名 —— 所以**主词条必须一起送**给 textmap，漏送就会在页面上原样显示英文
 * （2026-10-17 用户反馈「榜单里的英文要自动翻译」时抓到的现场）。
 */
export function textmapWords (entries: BoardEntry[]): string[] {
  return (entries || []).flatMap(e => [
    e.charName,
    e.weapon?.name || '',
    ...e.sets.map(s => s.name),
    ...e.artis.map(a => a.mainKey)
  ]).filter(Boolean)
}

/**
 * akasha `stats` 里的**比例键**（值域 0~1，展示要 ×100 才是百分数）
 *
 * ⚠ miao 的 `Format.pct(n)` 只拼 `%`、**不乘 100**（乘 100 的是 `Format.percent`），
 *   所以比例换算必须自己来，否则 0.7933 会显示成 `0.8%`（2026-10-15 四项目复核 P2）。
 */
const AKASHA_RATIO_KEYS = new Set([
  'critRate', 'critDamage', 'critDMG', 'energyRecharge', 'healingBonus',
  'pyroDamageBonus', 'hydroDamageBonus', 'electroDamageBonus', 'cryoDamageBonus',
  'anemoDamageBonus', 'geoDamageBonus', 'dendroDamageBonus', 'physicalDamageBonus'
])

/** 该 stats 键是不是比例（容忍 `critRate_` 这类结尾下划线变体） */
export function isAkashaRatioKey (key: string): boolean {
  const k = String(key || '').trim().replace(/_+$/, '')
  return AKASHA_RATIO_KEYS.has(k) || /DamageBonus$/.test(k)
}

/** 按单位格式化一条 akasha stats：比例 → `79.3%`；平铺值 → 千分位（元素精通留一位小数） */
export function formatAkashaValue (key: string, value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  if (isAkashaRatioKey(key)) return `${(n * 100).toFixed(1)}%`
  if (String(key) === 'elementalMastery') return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return Math.round(n).toLocaleString('en-US')
}

/** 面板摘要（页面用：挑几个常用项，按固定顺序） */
export function panelSummary (entry: BoardEntry): Array<{ label: string, value: string }> {
  // 单位统一走 `formatAkashaValue`：比例键 ×100、平铺键千分位（2026-10-15 四项目复核 P2）
  const pick = (keys: string[], label: string) => {
    for (const k of keys) {
      const hit = entry.stats.find(s => s.key === k)
      if (hit) return { label, value: formatAkashaValue(k, hit.value) }
    }
    return null
  }
  return [
    pick(['maxHp', 'baseHp'], '生命值'),
    pick(['atk', 'baseAtk'], '攻击力'),
    pick(['critRate', 'critRate_'], '暴击率'),
    pick(['critDMG', 'critDMG_', 'critDamage'], '暴击伤害'),
    pick(['elementalMastery'], '元素精通'),
    // ⚠ 标签**逐字照抄 miao** `resources/character/profile-detail.html` 的属性表（`recharge: '元素充能'`）：
    //   6 字的「元素充能效率」在页面行组件的 88px 标签列（`meta-ui.css` 的 `.mx-guide-row`）里会折成两行。
    pick(['energyRecharge'], '元素充能')
  ].filter(Boolean) as Array<{ label: string, value: string }>
}
