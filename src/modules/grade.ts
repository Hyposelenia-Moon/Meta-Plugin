/**
 * grade — 练度评分器（v3 P2「提升指南」的核心）
 *
 * 设计口径：
 *   - **综合（2026-10-15 用户定）**：面板与圣遗物**合并成一维**，以**圣遗物有效词条**为主 ——
 *     `miao 评分档位 × 0.8 + 套装符合度 × 0.2`。理由：面板本来就是武器与圣遗物词条的产物，
 *     分两维等于把同一件事算两次；用户口径是"以圣遗物词条数为主，毕业面板不设严格限制"。
 *   - **面板目标不计分**：攻略里的面板区间只在对比表里作**参考**展示（`verdict: 'info'`），
 *     不参与总分、不设门槛。
 *   - **总体练度**：三维加权（综合 / 武器 / 天赋）→ 0~100 → `MAX…D` 九档
 *   - **毕业档**（大毕业 / 毕业 / 小毕业）：按**综合（词条）分**判定；等级不足时最高「小毕业」
 *   - **命座不计分**（抽卡结果，不是"练"出来的），只作提示
 *   - **攻略缺该项不扣分**：该维度不计入分母（权重重归一）
 *   - **圣遗物评分走 miao 的规则**（`ArtisMark.getMarkDetail()`：有效词条加权分 + MAX…D 档位），
 *     页脚口径行写明这一点。
 *
 * 本模块**纯函数**：不读文件、不联网、不引 miao —— 攻略目标与玩家配装都由调用方准备好，
 * 因此可以用合成数据完整单测（`test/grade.test.mjs`）。
 */

/** 评分维度 */
export type GradeDimKey = 'comprehensive' | 'weapon' | 'talent'

/**
 * 默认权重（配置项 `gradeWeights` 可覆盖；权重会按"可评维度"归一）
 *
 * `comprehensive` = 旧「面板 30 + 圣遗物 35」合并而来（读旧配置时自动相加，见 `components/config.ts`）。
 */
export const DEFAULT_WEIGHTS: Record<GradeDimKey, number> = {
  comprehensive: 65,
  weapon: 20,
  talent: 15
}

/** 旧配置里的两个维度键（读入时合并进 `comprehensive`，只为向后兼容） */
export const LEGACY_WEIGHT_KEYS = ['panel', 'artifact'] as const

/** 面板三档阈值（配置项 `gradePanelTiers` 可覆盖） */
/**
 * 综合（圣遗物）维度的**达标线**（2026-10-18 用户反馈：40 多词条、miao 评分 ACE 仍被要求"继续提升"）。
 *
 * 原有 `ratio >= 1` 等于"必须 miao 满分（MAX）才算达标"，而综合分 = 0.8×词条档 + 0.2×套装，
 * ACE(0.95) + 推荐套装(1) 只有 0.96 → 永远判未达标，跟进阶建议互相打脸。
 * 现在按 miao 的 **ACE 档**作为达标线；武器 / 天赋仍按 100% 判（它们本来就是离散档位）。
 */
export const COMPREHENSIVE_MET_RATIO = 0.95

export const DEFAULT_PANEL_TIERS = { big: 0.9, normal: 0.6, small: 0.3 }

/** 九档阈值：分数 ≥ 阈值即该档（配置项 `gradeRankThresholds` 可覆盖） */
export const DEFAULT_RANK_THRESHOLDS: Array<[string, number]> = [
  ['MAX', 95], ['ACE', 88], ['SSS', 80], ['SS', 72], ['S', 64], ['A', 55], ['B', 45], ['C', 30]
]

/** miao 圣遗物评分档位 → 0~1（与 miao `ArtisMark.getMarkClass` 的档位一一对应） */
export const MIAO_MARK_SCORE: Record<string, number> = {
  MAX: 1, ACE: 0.95, SSS: 0.9, SS: 0.8, S: 0.7, A: 0.55, B: 0.4, C: 0.25, D: 0.1
}

/* ------------------------------------------------------------------ *
 * 评分规则（2026-10-27：直接使用 miao 面板激活的评分规则）
 * ------------------------------------------------------------------ */

/** 综合维度的四个独立分量（词条 / 套装 / 主词条 / 面板） */
export type PartKey = 'mark' | 'set' | 'main' | 'panel'

/** 角色分档（只在 miao 规则读不到时，按攻略「定位」兜底） */
export type GradeRole = 'dps' | 'support'

/** 内置预设名 */
export type RuleName = 'dps' | 'subdps' | 'support'

/**
 * 一条评分规则
 *
 * 规则是**纯数据**：`weights` 决定参与加权的分量，`floors` 决定达标下限。
 *
 * 2026-10-27：角色用哪套预设**不再由本插件维护** —— 直接读 miao 面板当前激活的评分规则
 * （`getArtisMark(true).charWeight`，来源 `artis_user.js` > `artis.js` > `usefulAttr` 默认表），
 * 按「输出向权重占比」自动分档，见 `deriveRuleFromCharWeight()` / `resolveGradeRule()`。
 */
export interface GradeRule {
  /** 参与加权的分量（相对权重，自动归一）；未列出的分量不计入综合分 */
  weights: Partial<Record<PartKey, number>>
  /** 各分量必须达到的下限（0~1）；只对「参与且有数据」的分量生效 */
  floors: Partial<Record<PartKey, number>>
  /** mark 取不到时是否直接判「待评」（默认 = weights 里写了 mark） */
  requireMark?: boolean
  /** 至少需要几个可用分量才计分（默认 2，防止「只有一个分量凑出满分」） */
  minParts?: number
}

const PART_KEYS: PartKey[] = ['mark', 'set', 'main', 'panel']

/** 内置预设（主C / 副C / 辅助三档；由 miao 规则的输出向权重占比自动选中） */
export const GRADE_RULE_PRESETS: Record<RuleName, GradeRule> = {
  dps: { weights: { mark: 80, set: 20 }, floors: { mark: 0.95, set: 0.8 }, requireMark: true, minParts: 2 },
  subdps: { weights: { mark: 45, set: 25, panel: 30 }, floors: { mark: 0.8, set: 0.8, panel: 0.9 }, requireMark: true, minParts: 2 },
  support: { weights: { set: 40, main: 30, panel: 30 }, floors: { set: 0.8, main: 1, panel: 0.9 }, requireMark: false, minParts: 2 }
}

/** 是否内置预设名 */
export function isRuleName (value: unknown): value is RuleName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GRADE_RULE_PRESETS, value)
}

/**
 * 归一配置里的规则写法（2026-10-27：只接受预设名）
 *
 * 内联规则对象随 `data/gi/_grade-rules.json` 一起移除 —— 口径唯一来源改为 miao 面板的激活规则，
 * 本插件只保留「全局强制」与「逐角色覆盖」两个逃生阀。
 */
export function normalizeGradeRule (raw: unknown): GradeRule | null {
  if (!isRuleName(raw)) return null
  const preset = GRADE_RULE_PRESETS[raw]
  return { ...preset, weights: { ...preset.weights }, floors: { ...preset.floors } }
}

const ROLE_DPS_RE = /主C|主c|主\/|主／|站场|前台输出|输出/
const ROLE_SUP_RE = /辅|奶|盾|拐|治疗|副C|副c|位|挂|专|减抗|增伤|加攻/

/**
 * 按攻略「定位」判断口径（**只作 miao 规则读不到时的兜底**）
 *
 * 定位是自由文本，靠关键词只能近似；真正生效的是 miao 面板当前激活的评分规则。
 * 兜底信号：面板目标含暴击率 / 暴击伤害（输出向）优先按 dps。
 */
export function classifyGradeRole (input: {
  roleText?: string
  panel?: PanelTarget[]
  mainStats?: MainStatTarget[]
}): GradeRole {
  const text = String(input.roleText ?? '').trim()
  const panel = input.panel || []
  const mainStats = input.mainStats || []
  const critPanel = panel.some(t => t.attrKey === 'cpct' || t.attrKey === 'cdmg')
  const critMain = mainStats.some(t => {
    const views = t.optionViews?.length ? t.optionViews : t.options.map(o => parseCondMark(o))
    return views.some(v => /暴击/.test(String(v.name || '')))
  })
  const crit = critPanel || critMain
  if (!text || text === '___') return crit ? 'dps' : 'support'
  const dpsTok = ROLE_DPS_RE.test(text)
  const supTok = ROLE_SUP_RE.test(text)
  if (dpsTok && supTok) return crit ? 'dps' : 'support'
  if (dpsTok) return 'dps'
  if (supTok) return 'support'
  if (/C$/i.test(text)) return 'dps'
  return crit ? 'dps' : 'support'
}

/**
 * miao 评分规则里的「输出向」与「功能向」属性键
 *
 * 与 `ArtisMarkCfg` 的 `attrs` 一致（hp / atk / def / mastery / cpct / cdmg / dmg / phy / recharge / heal）。
 */
const OUTPUT_WEIGHT_KEYS = ['atk', 'cpct', 'cdmg', 'dmg', 'phy'] as const
const UTILITY_WEIGHT_KEYS = ['hp', 'def', 'mastery', 'recharge', 'heal'] as const

/** 分档阈值（输出向权重占比；经验值，可用 `gradeRuleOverrides` 逐角色纠正） */
export const MIAO_RULE_DPS_SHARE = 0.65
export const MIAO_RULE_SUBDPS_SHARE = 0.5

/**
 * 用 miao 面板当前激活的评分规则（`charWeight`）自动定档
 *
 * 输出向 = 攻击 / 暴击率 / 暴击伤害 / 伤害加成 / 物理伤害；功能向 = 生命 / 防御 / 精通 / 充能 / 治疗。
 * 返回 null 表示拿不到规则（miao 缺失 / 面板没有属性权重），调用方回落到「定位」兜底。
 */
export function deriveRuleFromCharWeight (
  weights?: Record<string, number> | null
): { name: RuleName, share: number } | null {
  if (!weights || typeof weights !== 'object') return null
  const sum = (keys: readonly string[]): number => keys.reduce((s, k) => s + (Number(weights[k]) || 0), 0)
  const out = sum(OUTPUT_WEIGHT_KEYS)
  const util = sum(UTILITY_WEIGHT_KEYS)
  if (out + util <= 0) return null
  const share = out / (out + util)
  const name: RuleName = share >= MIAO_RULE_DPS_SHARE
    ? 'dps'
    : share >= MIAO_RULE_SUBDPS_SHARE ? 'subdps' : 'support'
  return { name, share: Number(share.toFixed(4)) }
}

/** 规则来源（状态与 detail 用） */
export type RuleSource = 'override' | 'global' | 'miao' | 'auto'

export interface RuleResolution {
  rule: GradeRule
  /** 规则名（预设名 / `auto`） */
  name: string
  source: RuleSource
  /** miao 规则的输出向权重占比（拿不到规则时缺省） */
  share?: number
}

/**
 * 取某个角色要跑的规则
 *
 * 优先级（高 → 低）：
 *   ① 配置 `gradeRuleOverrides`（逐角色临时纠偏）
 *   ② 配置 `gradeRule`（全局强制，整站回退用）
 *   ③ **miao 面板当前激活的评分规则**（`charWeight` → 输出向权重占比）
 *   ④ 读不到 miao 规则时，按攻略「定位」兜底
 */
export function resolveGradeRule (input: {
  charName?: string
  role?: GradeRole
  charWeight?: Record<string, number> | null
  globalRule?: string
  overrides?: Record<string, string> | null
}): RuleResolution {
  const name = String(input.charName || '').trim()
  const overrides = input.overrides || {}
  if (name && overrides[name]) {
    const rule = normalizeGradeRule(overrides[name])
    if (rule) return { rule, name: String(overrides[name]), source: 'override' }
  }
  const global = String(input.globalRule || 'auto').trim()
  if (global && global !== 'auto') {
    const rule = normalizeGradeRule(global)
    if (rule) return { rule, name: global, source: 'global' }
  }
  const derived = deriveRuleFromCharWeight(input.charWeight)
  if (derived) {
    return { rule: normalizeGradeRule(derived.name)!, name: derived.name, source: 'miao', share: derived.share }
  }
  const preset: RuleName = input.role === 'support' ? 'support' : 'dps'
  return { rule: normalizeGradeRule(preset)!, name: 'auto', source: 'auto' }
}

/** 面板属性名 → 玩家侧属性键（miao 面板 `attr` 的键；元素伤害统一取 `dmg`） */
const PANEL_ATTR_KEY: Record<string, string> = {
  生命值: 'hp',
  攻击力: 'atk',
  防御力: 'def',
  元素精通: 'mastery',
  元素充能效率: 'recharge',
  暴击率: 'cpct',
  暴击伤害: 'cdmg',
  治疗加成: 'heal',
  物理伤害加成: 'phy',
  元素伤害加成: 'dmg'
}

const ELEM_DMG_RE = /^(火|水|雷|草|风|岩|冰)元素伤害加成$/

/* ------------------------------------------------------------------ *
 * 攻略目标
 * ------------------------------------------------------------------ */

export interface PanelTarget {
  /** 攻略里的原文，如 `暴击率：70-80%` */
  raw: string
  /** 展示用名称 */
  name: string
  /** 玩家侧属性键 */
  attrKey: string
  /** 目标下限 / 上限（单值型时两者相同） */
  min: number
  max: number
  /**
   * 方向（攻略行标签：`输出向` / `辅助向` / 空）
   *
   * 2026-10-15 审核意见 4.3：原实现把方向丢了，于是"输出向 生命值 35000"和"辅助向 生命值 35000"
   * 变成两条同名目标（页面参考区重复）。方向是**筛选目标的一部分**，必须随目标一起保留。
   */
  groups: string[]
  /** 百分比类目标（当前值展示时要补 `%`） */
  percent: boolean
  /** 目标值上的条件标注（`元素充能效率：185%（满命）` → consMin=6） */
  cond?: CondMark
}

export interface TalentTarget {
  key: 'A' | 'E' | 'Q'
  target: number
  crown: boolean
}

export interface MainStatTarget {
  slot: string
  /** 该部位可接受的主词条（攻略用 `/` 分隔）—— **展示原文**，条件标注保留 */
  options: string[]
  /**
   * 逐项的解析结果（2026-10-15 真机反馈修）：`生命值（二命）` 这类**条件项**必须分开处理 ——
   * 比对时用 `name`（去掉标注），可用性看 `consMin`（命座门槛）。
   * 少了这一层就会出现"6 命玩家戴生命头被判未达标"（用户现场）。
   */
  optionViews: CondMark[]
}

/**
 * 攻略目标项上的条件标注（`（二命）` / `（4 命）` / `（满命）` / `（高命）` / `（随命座）` / `（按其生命上限 6%）`）
 *
 * 全库实测形态（`data/gi/*.json`）：`（二命）`×9、`（4 命）`×2、`（满命）`×2、
 * `（高命）`×2、`（随命座）`×2、`（按其生命上限 6%）`×2。只有前三种能判数值，
 * 其余按"无法判定的条件"或"纯说明"处理 —— **不因为判不了就把玩家判成未达标**。
 */
export interface CondMark {
  /** 去掉标注后的名字（比对用）：`生命值（二命）` → `生命值` */
  name: string
  /** 标注原文（含括号，展示用）；无标注为空串 */
  mark: string
  /** 需要的命座数（可判定时）：`满命` → 6、`4 命` → 4、`二命` → 2 */
  consMin?: number
  /** 判不出数值的条件原文（`高命` / `随命座`）—— 视为**满足**，但把原文展示给用户 */
  vague?: string
  /** 与命座无关的括注（如 `按其生命上限 6%`），不影响可用性 */
  note?: string
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 解析目标项上的条件标注（`生命值（二命）` → name=生命值, consMin=2） */
export function parseCondMark (raw: unknown): CondMark {
  const text = String(raw ?? '').trim()
  // 攻略源用中文括号 `（二命）`，展示层（`buildV2Sections` 归一）会把它转成六角括号 `〔二命〕`——
  // 两条路都要认，否则"按显示标签"的那条回退路径又会漏掉条件。
  const m = text.match(/[（(〔]([^）)〕]*)[）)〕]\s*$/)
  if (!m) return { name: text, mark: '' }
  const inner = m[1].trim()
  const name = text.slice(0, m.index).trim()
  const mark = text.slice(m.index).trim()
  // 满命 / 六命 / 6命 → 6；四命 / 4 命 → 4；二命 / 2命 → 2
  const num = inner.match(/(\d+)\s*命/)
  const cn = inner.match(/([一二两三四五六七八九十]+)\s*命/)
  if (inner.includes('满命')) return { name, mark, consMin: 6 }
  if (num) return { name, mark, consMin: Number(num[1]) }
  if (cn) return { name, mark, consMin: CN_NUM[cn[1]] || undefined, vague: CN_NUM[cn[1]] ? undefined : inner }
  if (/高命|随命座|命座/.test(inner)) return { name, mark, vague: inner }
  return { name, mark, note: inner }
}

/** 条件是否满足（没有命座门槛即视为满足；无法判定的条件不做惩罚） */
export function condSatisfied (view: CondMark | undefined, cons: number): boolean {
  const need = Number(view?.consMin)
  if (!Number.isFinite(need) || need <= 0) return true
  return Number(cons) >= need
}

/** 主词条是否可接受：命中某个候选名 **且** 该候选的命座条件满足 */
export function mainStatAcceptable (target: MainStatTarget, actual: string, cons: number): boolean {
  const wanted = String(actual || '').trim()
  if (!wanted) return false
  const views = target.optionViews?.length
    ? target.optionViews
    : target.options.map(o => parseCondMark(o))
  const hit = views.find(v => v.name === wanted || v.name.includes(wanted) || wanted.includes(v.name))
  if (!hit) return false
  return condSatisfied(hit, cons)
}

export interface GuideTargets {
  charName: string
  /** 角色定位原文（`meta.定位`），用于数据表缺条目时的兜底分档 */
  roleText?: string
  /** 兜底分档结果（数据表里有条目时以表为准，见 `resolveGradeRule()`） */
  gradeRole?: GradeRole
  /** 建议等级下限（解析自 `建议等级：81-90级`） */
  levelMin: number | null
  levelText: string
  panel: PanelTarget[]
  weapon: { recommend: string[], optional: string[], transition: string[] }
  artifact: { recommend: string[], optional: string[] }
  mainStats: MainStatTarget[]
  talent: TalentTarget[]
  /** 关键命座（只提示） */
  consKeys: number[]
}

/** `buildCodexView` 产物的最小结构（只声明用到的字段，避免耦合渲染层） */
export interface CodexLikeView {
  metaRows?: Array<{ label?: string, value?: string }>
  sections?: Array<{
    title?: string
    rows?: Array<{
      label?: string
      items?: Array<{ text?: string, note?: string, talentLevel?: number, crown?: boolean }>
    }>
  }>
}

/** 解析 `70-80%` / `150` / `32000` / `81-90级` 这类目标值 */
export function parseTargetRange (raw: string): { min: number, max: number } | null {
  // ⚠ 目标值不会是负数：这里**不能**把区间里的连字符当负号（`70-80%` 曾解析成 min=-80）
  const text = String(raw || '').replace(/[，,、~～—–－至到]/g, '-')
  const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])).filter(Number.isFinite)
  if (!nums.length) return null
  const min = Math.min(...nums.slice(0, 2))
  const max = nums.length > 1 ? Math.max(nums[0], nums[1]) : min
  return { min, max }
}

/** 结构化攻略源（只声明用到的字段）：`v2.artifacts` 带 `kind`，比显示标签可靠 */
export interface GuideSourceShape {
  v2?: { artifacts?: Array<Record<string, any>> }
}

/**
 * 把攻略条目拆成候选名
 *
 * 攻略里的组合项写成 `冲浪时光\真语秘匣\万世流涌大典`（`v2` 的 `ref`/`name` 就是这种整串），
 * 逐项与实装名比对才能命中（2026-10-15 外部复核第 6 项发现：评分与比较表口径不一致）。
 */
export function guideCandidates (entry: string): string[] {
  return String(entry || '').split(/[\\|]/).map(s => s.trim()).filter(Boolean)
}

/** 实装名是否命中攻略列表（逐候选：完全相同 / 互相包含） */
export function matchesGuideName (name: string, list: readonly string[]): boolean {
  const target = String(name || '').trim()
  if (!target) return false
  return list.some(entry => guideCandidates(entry).some(c => c === target || c.includes(target) || target.includes(c)))
}

/**
 * 从攻略视图抽取评分目标（结构不匹配的行直接跳过，绝不抛错）
 *
 * @param guide 原始攻略数据（可选）：带 `v2.artifacts` 时**按结构化 `kind` 分桶**，
 *              没有才退回按显示标签（推荐/可选）判定 —— 自定义标签（如「月结晶/月感电」「月绽放」）
 *              只有结构化路径认得（2026-10-15 外部复核第 3 项发现）。
 */
export function extractTargets (view: CodexLikeView, charName = '', guide?: GuideSourceShape | null): GuideTargets {
  const targets: GuideTargets = {
    charName,
    roleText: '',
    gradeRole: 'dps',
    levelMin: null,
    levelText: '',
    panel: [],
    weapon: { recommend: [], optional: [], transition: [] },
    artifact: { recommend: [], optional: [] },
    mainStats: [],
    talent: [],
    consKeys: []
  }

  // 建议等级（门槛）
  for (const row of view.metaRows || []) {
    if (String(row.label || '').includes('等级')) {
      const r = parseTargetRange(String(row.value || ''))
      targets.levelText = String(row.value || '')
      targets.levelMin = r ? r.min : null
      break
    }
  }

  const section = (title: string) => (view.sections || []).find(s => String(s.title || '') === title)

  // 面板
  for (const row of section('面板')?.rows || []) {
    // 方向取自**行标签**（`输出向` / `辅助向`）；同一属性在不同方向下目标可能不同，不能丢
    const groupName = String(row.label || '').trim()
    for (const item of row.items || []) {
      const text = String(item.text || '').trim()
      const idx = text.search(/[:：]/)
      if (idx < 0) continue
      const name = text.slice(0, idx).trim()
      const attrKey = PANEL_ATTR_KEY[name] || (ELEM_DMG_RE.test(name) ? 'dmg' : '')
      if (!attrKey) continue
      const valuePart = text.slice(idx + 1)
      const range = parseTargetRange(valuePart)
      if (!range) continue
      /*
       * 目标值上的条件标注（`元素充能效率：185%（满命）`）：解析出来随行走，
       * 因为同一属性在不同命座下目标不同 —— 页面上必须能看到条件，不能当成普适目标。
       */
      const cond = parseCondMark(valuePart)
      /*
       * 去重规则（2026-10-15 审核意见 4.3）：
       *   - **同方向**里完全相同的目标只留一条；
       *   - **跨方向**同名同值（哥伦比娅「输出向/辅助向」都写 生命值 35000）合并成一条，
       *     方向记进 `groups`，页面显示"输出/辅助"联合标签 —— 而不是按属性名一刀切去重。
       */
      const same = targets.panel.find(t => t.name === name && t.min === range.min && t.max === range.max)
      if (same) {
        if (groupName && !same.groups.includes(groupName)) same.groups.push(groupName)
        continue
      }
      targets.panel.push({
        raw: text,
        name,
        attrKey,
        min: range.min,
        max: range.max,
        groups: groupName ? [groupName] : [],
        // 百分比看目标原文（`70%` / `130%以上`），不靠属性名猜
        percent: /%|％/.test(valuePart),
        ...(cond.consMin || cond.vague || cond.note ? { cond } : {})
      })
    }
  }

  // 武器（按档位行；`sig` 专武标记只作展示，不加分）
  for (const row of section('武器')?.rows || []) {
    const label = String(row.label || '').trim()
    const bucket = label === '推荐' ? targets.weapon.recommend : label === '可选' ? targets.weapon.optional : label === '过渡' ? targets.weapon.transition : null
    if (!bucket) continue
    for (const item of row.items || []) {
      const name = String(item.text || '').trim()
      if (name) bucket.push(name)
    }
  }

  // 圣遗物套装 + 主词条
  const v2Artifacts = Array.isArray(guide?.v2?.artifacts) ? guide?.v2?.artifacts : null
    if (v2Artifacts) {
      // 结构化口径：按 `kind` 的语义分桶（`preferred` → 推荐、`optional`/`transition` → 可选），
      // 标签（如「月结晶/月感电」）只负责显示 —— 只认「推荐/可选」字面量会漏掉自定义标签
      for (const row of v2Artifacts) {
        const kind = String(row?.kind || '').trim()
        const sets = Array.isArray(row?.sets) ? row.sets : []
        const sep = String(row?.sep || '')
        if (sets.length && ['preferred', 'optional', 'transition', ''].includes(kind)) {
          const bucket = kind === 'preferred' || kind === '' ? targets.artifact.recommend : targets.artifact.optional
          /*
           * 2026-10-18 复审 R1 + 2026-10-27 复审 R1：
           * `sep` 里的 `+` 表示**组合**、`/` / `>` 表示**备选**，真实数据会混在同一行：
           *   优菈：`苍白之火 / 2染血 + 2攻击`（4 件套 或 2+2）
           *   妮露：`2生命 + 2生命 + 教官`（前两项是效果型 2+2，教官是另一种搭配）
           * 旧代码只在"整行恰好两个 2 前缀"时组合，混合行会被拆成三个"四件套目标"——
           * 永远命不中，还建议"凑『2生命』4 件"。
           *
           * 规则：行内含 `+` 且恰好有**两个 2 前缀条目** → 这两项合成一条 pair（效果型同名也算），
           * 其余条目按原顺序作为备选；不满足条件时整行都是备选（4 件套）。
           */
          const names = sets.map((s: Record<string, any> | string) => String((s as Record<string, any>)?.name ?? s ?? '').trim()).filter(Boolean)
          const pairNames = names.filter(n => /^(?:2|两)\s*/.test(n))
          const specs: string[] = []
          if (/\+|＋/.test(sep) && pairNames.length === 2) {
            let inserted = false
            for (const name of names) {
              if (pairNames.includes(name)) {
                if (!inserted) { specs.push(pairNames.join(' + ')); inserted = true }
                continue
              }
              specs.push(name)
            }
          } else {
            specs.push(...names)
          }
          for (const spec of specs) bucket.push(spec)
          continue
        }
        if (kind === 'main') {
          const stats = (row?.stats && typeof row.stats === 'object') ? row.stats as Record<string, unknown> : {}
          for (const [slot, raw] of Object.entries(stats)) {
          const options = (Array.isArray(raw) ? raw : [raw]).map(x => String(x).trim()).filter(Boolean)
          const slotName = String(slot).trim()
          if (slotName && options.length) targets.mainStats.push({ slot: slotName, options, optionViews: options.map(parseCondMark) })
        }
      }
      }
      // `sub` / `text`：副词条与自由文本只用于展示与建议，不参与这里的评分口径
  } else {
    for (const row of section('圣遗物')?.rows || []) {
      const label = String(row.label || '').trim()
      if (label === '推荐' || label === '可选') {
        const bucket = label === '推荐' ? targets.artifact.recommend : targets.artifact.optional
        for (const item of row.items || []) {
          const name = String(item.text || '').trim()
          if (name) bucket.push(name)
        }
        continue
      }
      if (label.includes('主词条')) {
        for (const item of row.items || []) {
          const text = String(item.text || '').trim()
          const idx = text.search(/[:：]/)
          if (idx < 0) continue
          const options = text.slice(idx + 1).split('/').map(s => s.trim()).filter(Boolean)
          targets.mainStats.push({
            slot: text.slice(0, idx).trim(),
            options,
            optionViews: options.map(parseCondMark)
          })
        }
      }
    }
  }

  // 天赋（目标等级 + 皇冠）
  for (const row of section('天赋')?.rows || []) {
    for (const item of row.items || []) {
      const key = String(item.text || '').trim().toUpperCase()
      if (!['A', 'E', 'Q'].includes(key)) continue
      const level = Number(item.talentLevel)
      if (!Number.isFinite(level) || level <= 0) continue
      targets.talent.push({ key: key as 'A' | 'E' | 'Q', target: level, crown: item.crown === true })
    }
  }

  // 关键命座（只提示）
  for (const row of section('命座')?.rows || []) {
    const m = String(row.label || '').match(/(\d+)/)
    if (m) targets.consKeys.push(Number(m[1]))
  }

  /*
   * 兜底分档（2026-10-27）：读 `meta.定位` + 已解析的面板/主词条。
   * 真正生效的口径来自 miao 面板当前激活的评分规则（`charWeight`），
   * 这里只在拿不到 miao 规则时被 `resolveGradeRule()` 取用。
   */
  const roleRow = (view.metaRows || []).find(r => String(r.label || '').includes('定位'))
  targets.roleText = String(roleRow?.value || '').trim()
  targets.gradeRole = classifyGradeRole({ roleText: targets.roleText, panel: targets.panel, mainStats: targets.mainStats })

  return targets
}

/* ------------------------------------------------------------------ *
 * 玩家配装
 * ------------------------------------------------------------------ */

export interface BuildArtifact {
  /** 部位：生之花 / 死之羽 / 时之沙 / 空之杯 / 理之冠 */
  slot: string
  set: string
  /** 主词条名称（中文，与攻略同口径） */
  mainName: string
  level?: number
}

export interface BuildSnapshot {
  charName: string
  level: number
  cons: number
  weapon: { name: string, affix: number, rarity?: number } | null
  talent: { A: number, E: number, Q: number }
  /** 天赋**原始**等级（miao `talent.original`：现等级 − 命座加成）；面板的 `talent-plus` / `talent-crown` 判据 */
  talentOriginal?: { A: number, E: number, Q: number }
  /** 角色元素（miao `char.elem`，如 `hydro`）；立绘行的天赋图标圆环按元素取图 */
  elem?: string
  artis: BuildArtifact[]
  /** miao 圣遗物评分（`ArtisMark.getMarkDetail` 的产物） */
  artiMark: { total: number, markClass: string } | null
  /**
   * miao 面板「评分规则：xxx」的标题（`ArtisMarkCfg.classTitle`）
   *
   * 2026-10-27：练度口径直接跟 miao 面板当前激活的评分规则走，页面上要能对上规则名。
   */
  artiRuleTitle?: string
  /** 词条当量总和（五件副词条 `eff` 之和；与 miao 面板一致，拿不到时为 0） */
  substatRolls?: number
  /** miao 面板行的文本映射（`profile.attr`：`hp` / `hpBase` / `hpPlus` …）；无则回落到本插件自行格式化 */
  attrText?: Record<string, string>
  /**
   * 「数据到底有没有取到」的标记（2026-10-15 UI 重构契约）
   *
   * 旧实现把"没读到"与"真实的 0"混在一起（武器缺失给 0 分、天赋缺失当 0 级），
   * 展示层无法区分"未达标"和"未知"。取数层把这三个标记显式带出来，四态才立得住。
   */
  hasWeapon?: boolean
  hasTalent?: boolean
  hasMark?: boolean
  /** 角色对各属性的权重（miao 面板行 `.weight`，`>= 80` 显示为金色）；与有效词条过滤同源 */
  charWeight?: Record<string, number>
  /** 面板属性（miao `attr` 口径：cpct / cdmg / hp / …） */
  attrs: Record<string, number>
}

export interface GradeOptions {
  weights?: Partial<Record<GradeDimKey, number>>
  /** 效果词 → 提供该两件套效果的套装名（由 app 注入；本模块保持纯函数，不读 miao） */
  effectSets?: (effect: string) => string[]
  panelTiers?: { big: number, normal: number, small: number }
  rankThresholds?: Array<[string, number]>
  /** 本角色绑定的评分规则（缺省 = `resolveGradeRule()` 的定位兜底） */
  rule?: GradeRule
  /** 规则名与来源（写进结果，供状态页与套件断言） */
  ruleName?: string
  ruleSource?: RuleSource
  /** 四分量（由 `gradeBuild` 算好后传给对比行/建议，避免三处各判一次） */
  parts?: PartScores
}

export interface CompareRow {
  group: string
  name: string
  target: string
  actual: string
  verdict: 'ok' | 'warn' | 'off' | 'info'
  /** **稳定键**（新契约：证据号与建议绑定用它，中文名或顺序都不参与关联） */
  id?: string
  /** 四态（由 `verdict` 投影：ok→met、warn→below、off→unknown、info→unscored） */
  state?: AssessmentState
  /** 是否计分（`info` 参考行为 false —— 它们不是未达标项） */
  scored?: boolean
}

/**
 * 四态（2026-10-15 UI 重构契约，见 `docs` 里的设计规格 §3）
 *
 *  `met` 达标 / `below` 未达标 / `unscored` 攻略缺该项（不计分）/ `unknown` 数据缺失
 *
 * ⚠ 与旧字段的关系：`ratio === null` 以前把"不计分"和"未知"混成同一个值（现场核对 §三），
 *   现在用 `state` + `reason` 分开；`ratio`/`pct` 仍保留（旧模板与文本回退继续用）。
 */
export type AssessmentState = 'met' | 'below' | 'unscored' | 'unknown'

/** 非达标状态的原因（展示层据此写"缺攻略/未取到数据/取数失败"） */
export type AssessmentReason = 'target-missing' | 'data-missing' | 'partial-data' | 'fetch-failed'

export interface GradeDim {
  key: GradeDimKey
  label: string
  /** 0~1；null = 不计分（`state` 说明是"攻略缺项"还是"数据缺失"） */
  ratio: number | null
  weight: number
  detail: string
  /** 四态（新契约；旧模板不看这个字段） */
  state: AssessmentState
  /** 非 met/below 时的原因 */
  reason?: AssessmentReason
}

export interface GradeResult {
  charName: string
  /** 加权综合分 0~100（只按可评维度） */
  total: number
  /** MAX / ACE / SSS / SS / S / A / B / C / D */
  rank: string
  dims: GradeDim[]
  panelTier: '大毕业' | '毕业' | '小毕业' | '未毕业' | '无法评估'
  rows: CompareRow[]
  suggestions: string[]
  /** 建议行（带证据绑定；`suggestions` 由它派生，两者不会各自演化） */
  suggestionRows: SuggestionView[]
  /**
   * 有没有**任何**维度可评（2026-10-15 契约）
   *
   * 全部维度都不可评时，`total`/`rank` 没有意义（旧实现回落 0 分、仍给字母档），
   * 展示层据此显示"无法评估 / —"并隐藏总分，而不是画一个 0 分 D 档。
   */
  assessable: boolean
  notes: string[]
  /** 本次跑的规则名（预设名 / `auto`） */
  ruleName?: string
  /** 规则来源：配置覆盖 / 全局强制 / 数据表 / 定位兜底 */
  ruleSource?: RuleSource
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const pct = (v: number) => `${(v * 100).toFixed(0)}%`
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/* ------------------------------------------------------------------ *
 * 评分
 * ------------------------------------------------------------------ */

/**
 * 综合维度：圣遗物**有效词条**为主（miao 评分规则）+ 套装符合度
 *
 * 2026-10-15 用户定：面板与圣遗物合并成一维，且"以圣遗物词条数为主、毕业面板不设严格限制"——
 * 所以这里**不看面板数值**（面板只作参考展示），只看 miao 的圣遗物评分与套装是否穿对。
 */
/**
 * 通用套装判定（2026-10-18：计分 / 对比行 / 建议三处共用）
 *
 * @param specs   攻略条目（`炽烈的炎之魔女` / `2如雷 + 2宗室` / `2精通+2精通`）
 * @param counts  当前配装的「套装名 → 件数」
 * @param effectSets 效果词 → 提供该两件套效果的套装名（可选，由 app 注入）
 * @returns 命中的 spec；都没命中返回 null
 */
export function matchSetSpec (
  specs: string[],
  counts: Map<string, number>,
  effectSets?: (effect: string) => string[]
): SetSpec | null {
  const sameSet = (a: string, b: string) => a === b || a.includes(b) || b.includes(a)
  const groupOf = (name: string): string[] => {
    const eff = effectWordOf(name)
    return eff ? (effectSets?.(eff) ?? []) : [name]
  }
  const hasPieces = (name: string, n: number) => [...counts.entries()].some(([set, c]) => c >= n && sameSet(set, name))
  const hitGroup = (set: string, cands: string[]) => cands.some(c => sameSet(set, c))
  for (const spec of parseSetSpecs(specs)) {
    if (spec.kind !== 'pair') {
      if (hasPieces(spec.sets[0], 4)) return spec
      continue
    }
    if (spec.sets.length !== 2) continue
    const ga = groupOf(spec.sets[0])
    const gb = groupOf(spec.sets[1])
    for (const [setA, nA] of counts) {
      if (nA < 2 || !hitGroup(setA, ga)) continue
      for (const [setB, nB] of counts) {
        if (setB !== setA && nB >= 2 && hitGroup(setB, gb)) return spec
      }
    }
  }
  return null
}
/** 效果别名（攻略里的 `2精通` / `2生命`）→ 归档名；不是效果词返回空串（纯函数，不读文件） */
export function effectWordOf (name: string): string {
  const n = String(name || '').trim()
  if (!n || n.length > 4) return ''
  const hit = EFFECT_WORDS.find(w => n === w || n.includes(w))
  return hit || ''
}

/** 效果词表（与 `model/artiEffect.ts` 的桶名一致） */
const EFFECT_WORDS = ['精通', '充能', '暴击', '爆伤', '治疗', '生命', '攻击', '防御', '增伤']
/** 攻略圣遗物条目的两种合法形态：4 件套 / 2+2 配对（2026-10-18） */
export interface SetSpec {
  kind: 'pc4' | 'pair'
  /** 4 件套是 1 个名字；2+2 是两个名字 */
  sets: string[]
  /** 原文（展示用，如 `2如雷+2宗室`） */
  label: string
}

/**
 * 解析攻略里的圣遗物条目 → spec 列表
 *
 * 数据里真实的两种写法（实测 data/gi）：
 *   `推荐：炽烈的炎之魔女`   → 4 件套
 *   `推荐：2如雷 + 2宗室`    → 2+2（部分角色的毕业搭法本身就是 2+2）
 * 解析时把 `2`/`两` 前缀、`件` 后缀剥掉，只留套装名；`+`/`＋` 分隔。
 */
export function parseSetSpecs (list: string[]): SetSpec[] {
  const out: SetSpec[] = []
  for (const raw of list || []) {
    const text = String(raw || '').trim()
    if (!text) continue
    const parts = text.split(/[+＋]/).map(s => s.trim()).filter(Boolean)
    const isPair = parts.length === 2 && parts.every(s => /^(?:2|两)\s*/.test(s))
    if (isPair) {
      const names = parts.map(s => s.replace(/^(?:2|两)\s*/, '').replace(/件套?$/, '').replace(/^件/, '').trim()).filter(Boolean)
      if (names.length === 2) { out.push({ kind: 'pair', sets: names, label: text }); continue }
    }
    // 4 件套：去掉 `4件套` / `×4` 这类后缀
    const name = text.replace(/[×xX*]\s*4/g, '').replace(/4\s*件套?$/, '').trim()
    out.push({ kind: 'pc4', sets: [name || text], label: text })
  }
  return out
}
/** 单个分量的结果（综合维度的原料；对比行、证据与建议共用同一份判定） */
export interface PartScore {
  key: PartKey
  /** 0~1；null = 该分量不可评（看 state / reason） */
  ratio: number | null
  state: AssessmentState
  reason?: AssessmentReason
  detail: string
}

export interface PartScores {
  mark: PartScore
  set: PartScore
  main: PartScore
  panel: PartScore
  /** 面板计分选中的方向（多方向角色；空 = 无方向或未选中） */
  panelDirection: string[]
}

/** 分量在 detail 里的中文名（顺序固定：词条 → 套装 → 主词条 → 面板） */
const PART_LABEL: Record<PartKey, string> = { mark: '词条', set: '套装', main: '主词条', panel: '面板' }

const partNull = (key: PartKey, reason: AssessmentReason, detail: string): PartScore => ({
  key,
  ratio: null,
  state: reason === 'target-missing' ? 'unscored' : 'unknown',
  reason,
  detail
})

/**
 * 套装分（沿用 2026-10-18 的 spec 判定：4 件套 / 2+2 / 效果型）
 *
 * 与「词条评分」完全独立：这里只看穿了什么套装，不看副词条质量。
 */
function scoreSetPart (targets: GuideTargets, build: BuildSnapshot, effectSets?: (effect: string) => string[]): PartScore {
  const hasTarget = targets.artifact.recommend.length > 0 || targets.artifact.optional.length > 0
  if (!hasTarget) return partNull('set', 'target-missing', '攻略没有套装目标')
  const artis = build.artis || []
  if (!artis.length) return partNull('set', 'data-missing', '未读取到圣遗物')

  const counts = new Map<string, number>()
  for (const a of artis) counts.set(a.set, (counts.get(a.set) || 0) + 1)
  const recSpec = matchSetSpec(targets.artifact.recommend, counts, effectSets)
  const optSpec = matchSetSpec(targets.artifact.optional, counts, effectSets)
  const loosePairs = [...counts.entries()].filter(([, c]) => c >= 2).map(([s]) => s)

  let setScore = 0.3
  let setNote = '套装不在攻略推荐内'
  if (recSpec) {
    setScore = 1
    setNote = recSpec.kind === 'pair' ? `推荐 2+2（${recSpec.label}）` : `推荐套装 4 件（${recSpec.label}）`
  } else if (optSpec) {
    setScore = 0.8
    setNote = optSpec.kind === 'pair' ? `可选 2+2（${optSpec.label}）` : `可选套装 4 件（${optSpec.label}）`
  } else if (loosePairs.length >= 2) {
    setScore = 0.7
    setNote = `2+2 组合（${loosePairs.join(' + ')}）`
  }
  return { key: 'set', ratio: setScore, state: setScore >= 1 ? 'met' : 'below', detail: setNote }
}

/** 词条分（miao 评分档位；与套装无绑定关系） */
function scoreMarkPart (build: BuildSnapshot): PartScore {
  const markClass = String(build.artiMark?.markClass || '').toUpperCase()
  const markScore = MIAO_MARK_SCORE[markClass]
  if (!build.artiMark || !Number.isFinite(markScore)) {
    return partNull('mark', 'data-missing', '未取到 miao 词条评分')
  }
  // 规则标题来自 miao 面板的「评分规则：xxx」（`ArtisMarkCfg.classTitle`），让页面能对上用的是哪条规则
  const ruleTitle = String(build.artiRuleTitle || '').trim()
  return {
    key: 'mark',
    ratio: markScore,
    state: markScore >= 1 ? 'met' : 'below',
    detail: `miao 词条评分 ${num(Number(build.artiMark.total) || 0)}（${markClass}${ruleTitle ? `，规则 ${ruleTitle}` : ''}）`
  }
}

/** 主词条分：命中的目标部位 ÷ 玩家有装备的目标部位 */
export function scoreMainPart (targets: GuideTargets, build: BuildSnapshot): PartScore {
  if (!targets.mainStats.length) return partNull('main', 'target-missing', '攻略没有主词条目标')
  const artis = build.artis || []
  const pairs = targets.mainStats
    .map(t => ({ t, piece: artis.find(a => a.slot === t.slot) }))
    .filter((x): x is { t: MainStatTarget, piece: BuildArtifact } => Boolean(x.piece))
  if (!pairs.length) return partNull('main', 'data-missing', '未读取到主词条')
  const cons = Number(build.cons) || 0
  const hits = pairs.filter(x => mainStatAcceptable(x.t, x.piece.mainName, cons)).length
  const ratio = hits / pairs.length
  return { key: 'main', ratio, state: hits === pairs.length ? 'met' : 'below', detail: `主词条 ${hits}/${pairs.length}` }
}

/**
 * 面板目标达成度（多方向取达成度最高的方向）
 *
 * 条件型目标（`元素充能效率：185%（满命）`）在命座不足时跳过；取不到实际值的条目不进分母。
 */
export function panelAssessment (
  targets: GuideTargets,
  build: BuildSnapshot
): { ratio: number | null, direction: string[], met: number, total: number, detail: string } {
  const list = targets.panel || []
  if (!list.length) return { ratio: null, direction: [], met: 0, total: 0, detail: '攻略没有面板目标' }
  const cons = Number(build.cons) || 0
  const groups = new Map<string, { met: number, total: number, sum: number }>()
  let usable = 0
  for (const t of list) {
    if (!condSatisfied(t.cond, cons)) continue
    const actual = Number(build.attrs?.[t.attrKey])
    if (!Number.isFinite(actual)) continue
    const score = t.min > 0 ? clamp01(actual / t.min) : 1
    usable++
    const dirs = t.groups.length ? t.groups : ['参考']
    for (const dir of dirs) {
      const g = groups.get(dir) || { met: 0, total: 0, sum: 0 }
      g.total += 1
      g.sum += score
      if (score >= 0.999) g.met += 1
      groups.set(dir, g)
    }
  }
  if (!usable) return { ratio: null, direction: [], met: 0, total: 0, detail: '未读取到面板数据' }
  let best: { ratio: number, met: number, total: number } | null = null
  for (const g of groups.values()) {
    const ratio = g.sum / g.total
    if (!best || ratio > best.ratio + 1e-9) best = { ratio, met: g.met, total: g.total }
  }
  const direction = [...groups.entries()]
    .filter(([, g]) => Math.abs(g.sum / g.total - (best as { ratio: number }).ratio) < 1e-9)
    .map(([dir]) => dir)
  return {
    ratio: best ? best.ratio : null,
    direction,
    met: best ? best.met : 0,
    total: best ? best.total : 0,
    detail: `面板 ${best ? best.met : 0}/${best ? best.total : 0} 达标`
  }
}

function scorePanelPart (targets: GuideTargets, build: BuildSnapshot): { part: PartScore, direction: string[] } {
  const pa = panelAssessment(targets, build)
  if (pa.ratio === null) {
    return { part: partNull('panel', targets.panel.length ? 'data-missing' : 'target-missing', pa.detail), direction: [] }
  }
  return {
    part: { key: 'panel', ratio: pa.ratio, state: pa.ratio >= 0.9 ? 'met' : 'below', detail: pa.detail },
    direction: pa.direction
  }
}

/** 一次性算齐四个分量（计分 / 对比行 / 建议共用，避免三处各判一次） */
export function scoreParts (targets: GuideTargets, build: BuildSnapshot, opts: { effectSets?: (effect: string) => string[] } = {}): PartScores {
  const panel = scorePanelPart(targets, build)
  return {
    mark: scoreMarkPart(build),
    set: scoreSetPart(targets, build, opts.effectSets),
    main: scoreMainPart(targets, build),
    panel: panel.part,
    panelDirection: panel.direction
  }
}

/**
 * 综合维度：按规则聚合四个分量
 *
 * 规则决定「谁参与加权」与「谁必须过线」；加权分只用于三维条、毕业档与总分，
 * 达标由 `floors` 决定 —— 这样不会出现「综合 96% 却写未达标」这类矛盾（复审 R2）。
 */
function comprehensiveDimFromParts (parts: PartScores, rule: GradeRule): GradeDim {
  const label = '综合'
  const weightOf = (k: PartKey): number => Number(rule.weights[k]) || 0
  const active = PART_KEYS.filter(k => weightOf(k) > 0 && parts[k].ratio !== null)
  const anyTarget = PART_KEYS.some(k => parts[k].reason !== 'target-missing')
  const detailOf = (): string => PART_KEYS
    .filter(k => weightOf(k) > 0 || parts[k].ratio !== null)
    .map(k => `${PART_LABEL[k]}：${parts[k].detail}`)
    .join('；')

  if (rule.requireMark && weightOf('mark') > 0 && parts.mark.ratio === null) {
    return {
      key: 'comprehensive',
      label,
      ratio: null,
      weight: 0,
      detail: `${detailOf() || parts.mark.detail}（规则要求词条评分，暂不计分）`,
      state: 'unknown',
      reason: 'data-missing'
    }
  }
  if (active.length < (rule.minParts ?? 2)) {
    return {
      key: 'comprehensive',
      label,
      ratio: null,
      weight: 0,
      detail: detailOf() || '攻略没有可评的圣遗物目标',
      state: anyTarget ? 'unknown' : 'unscored',
      reason: anyTarget ? 'data-missing' : 'target-missing'
    }
  }
  const weightSum = active.reduce((s, k) => s + weightOf(k), 0)
  const ratio = active.reduce((s, k) => s + weightOf(k) * (parts[k].ratio as number), 0) / (weightSum || 1)
  const failed = active.filter(k => {
    const floor = Number(rule.floors[k])
    return Number.isFinite(floor) && (parts[k].ratio as number) + 1e-9 < floor
  })
  return {
    key: 'comprehensive',
    label,
    ratio,
    weight: 0,
    detail: detailOf(),
    state: failed.length === 0 ? 'met' : 'below'
  }
}

function scoreWeapon (targets: GuideTargets, build: BuildSnapshot): GradeDim {
  const label = '武器'
  const all = [...targets.weapon.recommend, ...targets.weapon.optional, ...targets.weapon.transition]
  if (!all.length) return { key: 'weapon', label, ratio: null, weight: 0, detail: '该角色攻略没有武器目标', state: 'unscored', reason: 'target-missing' }
  const name = String(build.weapon?.name || '')
  // 没读到武器是**数据缺失**，不是"用的是差武器"（旧实现给 0 分，页面显示成未达标 0%）
  if (!name) return { key: 'weapon', label, ratio: null, weight: 0, detail: '未读取到武器', state: 'unknown', reason: 'data-missing' }

  const inBucket = (list: string[]) => list.some(w => w === name || w.includes(name) || name.includes(w))
  const met = (r: number, detail: string): GradeDim => ({ key: 'weapon', label, ratio: r, weight: 0, detail, state: r >= 1 ? 'met' : 'below' })
  if (inBucket(targets.weapon.recommend)) {
    const sig = targets.weapon.recommend[0] === name
    return met(1, `推荐档：${name}${sig ? '（专武，不加分）' : ''}`)
  }
  if (inBucket(targets.weapon.optional)) return { ...met(0.75, `可选档：${name}`), state: 'met' as const }   // 可选档 = 达标（用户 2026-10-16 口径：只有过渡才是未达标）
  if (inBucket(targets.weapon.transition)) return met(0.5, `过渡档：${name}`)
  return met(0.25, `不在攻略推荐内：${name}`)
}

function scoreTalent (targets: GuideTargets, build: BuildSnapshot): GradeDim {
  const label = '天赋'
  if (!targets.talent.length) return { key: 'talent', label, ratio: null, weight: 0, detail: '该角色攻略没有天赋目标', state: 'unscored', reason: 'target-missing' }
  // 天赋一个都没读到 → 数据缺失（旧实现把 `Number(..)||0` 当 0 级，页面显示成未达标）
  if (build.hasTalent === false) {
    return { key: 'talent', label, ratio: null, weight: 0, detail: '未读取到天赋等级', state: 'unknown', reason: 'data-missing' }
  }
  let got = 0
  let want = 0
  const miss: string[] = []
  for (const t of targets.talent) {
    const actual = Number(build.talent?.[t.key]) || 0
    got += Math.min(actual, t.target)
    want += t.target
    if (actual < t.target) miss.push(`${t.key} ${actual}→${t.target}`)
  }
  const ratio = want > 0 ? clamp01(got / want) : null
  return {
    key: 'talent',
    label,
    ratio,
    weight: 0,
    detail: miss.length ? `未达标：${miss.join('、')}` : '全部达标',
    state: ratio !== null && ratio >= 1 ? 'met' : 'below'
  }
}

/**
 * 毕业档（大毕业 / 毕业 / 小毕业 / 未毕业）
 *
 * 2026-10-15 起按**综合（圣遗物词条）分**判定 —— 面板目标不再计分，也就不能拿它当门槛；
 * 等级门槛保留（未达攻略「建议等级」时最高「小毕业」）。
 */
export function panelTierOf (
  ratio: number | null,
  build: BuildSnapshot,
  targets: GuideTargets,
  tiers = DEFAULT_PANEL_TIERS
): { tier: GradeResult['panelTier'], capped: boolean } {
  if (ratio === null) return { tier: '无法评估', capped: false }
  let tier: GradeResult['panelTier'] = ratio >= tiers.big ? '大毕业' : ratio >= tiers.normal ? '毕业' : ratio >= tiers.small ? '小毕业' : '未毕业'
  let capped = false
  const need = targets.levelMin
  if (need && Number(build.level) < need && (tier === '大毕业' || tier === '毕业')) {
    tier = '小毕业'
    capped = true
  }
  return { tier, capped }
}

/** 档位判定 */
export function rankOf (total: number, thresholds = DEFAULT_RANK_THRESHOLDS): string {
  for (const [name, min] of thresholds) if (total >= min) return name
  return 'D'
}

/** 主评分：攻略目标 × 玩家配装 → 总分 / 档位 / 对比表 / 建议 */
export function gradeBuild (targets: GuideTargets, build: BuildSnapshot, opts: GradeOptions = {}): GradeResult {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) }
  /*
   * 规则（2026-10-25）：调用方传「角色绑定的规则」；没传时按定位兜底
   * （数据表 → 配置 → 全局的解析在 app 层做，见 `resolveGradeRule()`）。
   */
  const rule = opts.rule ?? resolveGradeRule({ charName: targets.charName, role: targets.gradeRole }).rule
  const parts = opts.parts ?? scoreParts(targets, build, opts)
  const compDim = comprehensiveDimFromParts(parts, rule)
  const dims = [compDim, scoreWeapon(targets, build), scoreTalent(targets, build)]

  // 只对"有目标"的维度加权（缺项不扣分），权重重归一
  const scored = dims.filter(d => d.ratio !== null)
  const weightSum = scored.reduce((s, d) => s + (Number(weights[d.key]) || 0), 0)
  for (const d of dims) d.weight = d.ratio === null ? 0 : (Number(weights[d.key]) || 0) / (weightSum || 1)

  const total = scored.length ? scored.reduce((s, d) => s + d.ratio! * d.weight, 0) * 100 : 0
  const panelInfo = panelTierOf(compDim.ratio, build, targets, opts.panelTiers)

  const notes: string[] = []
  if (cappedNote(targets, build, panelInfo.capped)) {
    notes.push(`等级 ${build.level} 未达建议等级 ${targets.levelText}（毕业档按门槛最高「小毕业」）`)
  }
  for (const d of dims) if (d.ratio === null) notes.push(`${d.label}：${d.detail}（不计入总分）`)
  // 只有规则要求词条评分时才提示（辅助口径不看词条，缺评分不是问题）
  if (!build.artiMark && (Number(rule.weights.mark) || 0) > 0) {
    notes.push('圣遗物评分：未取到 miao 词条评分（该角色规则要求词条，综合判待评）')
  }

  const rows = buildCompareRows(targets, build, { ...opts, rule, parts })
  const suggestionRows = buildSuggestionRows(targets, build, dims, compDim, { ...opts, rule, parts })
  const suggestions = suggestionRows.map(s => s.text)

  /*
   * `assessable`：只要有一个维度是**未知**（数据没取到），总分就不可信 —— 2026-10-15 UI 契约
   * （设计规格 §12.2 采用默认：必需计分数据未知时隐藏总分并标"待评"，仍展示已知维度；
   * **不改变分母**，因此这里只加标记，`total`/`rank` 的计算口径与旧版逐字一致）。
   * 攻略缺该项（`unscored`）不算未知：那是现行"不计入分母"的口径。
   */
  const assessable = scored.length > 0 && !dims.some(d => d.state === 'unknown')

  return {
    charName: targets.charName || build.charName,
    total: Number(total.toFixed(1)),
    rank: rankOf(total, opts.rankThresholds),
    dims,
    panelTier: panelInfo.tier,
    rows,
    suggestions,
    suggestionRows,
    assessable,
    notes,
    ruleName: opts.ruleName ?? 'auto',
    ruleSource: opts.ruleSource
  }
}

function cappedNote (targets: GuideTargets, build: BuildSnapshot, capped: boolean): boolean {
  return capped === true && !!targets.levelMin && Number(build.level) < targets.levelMin
}

/** 对比表（只列主词条，不列副词条） */
export function buildCompareRows (targets: GuideTargets, build: BuildSnapshot, opts: GradeOptions = {}): CompareRow[] {
  const rows: CompareRow[] = []
  /** 行统一收口：补稳定键、四态与"是否计分"（页面证据号用稳定键关联，不用中文名） */
  const push = (row: Omit<CompareRow, 'state' | 'scored'> & { id: string }): void => {
    const state: AssessmentState = row.verdict === 'ok'
      ? 'met'
      : row.verdict === 'warn'
        ? 'below'
        : row.verdict === 'info' ? 'unscored' : 'unknown'
    rows.push({ ...row, state, scored: row.verdict !== 'info' })
  }

  // 武器（与 `scoreWeapon` 共用同一套候选解析：组合项 `A\B\C` 要能命中）
  if (targets.weapon.recommend.length || targets.weapon.optional.length) {
    const name = String(build.weapon?.name || '—')
    /*
     * 档位判定（2026-10-16 用户口径）：**推荐 ∪ 可选 = 达标**，只有**过渡**才是未达标。
     * 旧实现把"可选"也写成 `warn`，导致装备可选档武器时被列进"未达标项"。
     */
    const bucket = (matchesGuideName(name, targets.weapon.recommend) || matchesGuideName(name, targets.weapon.optional))
      ? 'ok'
      : matchesGuideName(name, targets.weapon.transition) ? 'warn' : 'off'
    push({
      id: 'weapon:choice',
      group: '武器',
      name,
      target: [targets.weapon.recommend.length ? `推荐：${targets.weapon.recommend.join(' / ')}` : '', targets.weapon.optional.length ? `可选：${targets.weapon.optional.join(' / ')}` : ''].filter(Boolean).join('\n'),
      actual: name,
      verdict: bucket
    })
  }

  /*
   * 2026-10-18 复审 R1：对比行的"套装是否达标"必须与计分**同一套判定**。
   * 旧写法只按"与推荐名有交集"判 ok，认不出 2+2（`2如雷 + 2宗室`）与效果型（`2精通+2精通`），
   * 结果页面说未达标、计分却按推荐给了 1.0。
   */
  if (targets.artifact.recommend.length || targets.artifact.optional.length) {
    const counts = new Map<string, number>()
    for (const a of build.artis || []) counts.set(a.set, (counts.get(a.set) || 0) + 1)
    const hit = Boolean(matchSetSpec(targets.artifact.recommend, counts, opts.effectSets) ||
      matchSetSpec(targets.artifact.optional, counts, opts.effectSets))
    push({
      id: 'artifact:set',
      group: '综合',
      name: '套装',
      target: targets.artifact.recommend.join(' / ') || '—',
      actual: [...counts.entries()].map(([s, n]) => `${s}×${n}`).join(' / ') || '—',
      verdict: hit ? 'ok' : counts.size ? 'warn' : 'off'
    })
  }

  // 圣遗物词条评分（综合维度的主依据；走 miao 的评分规则）
  if (build.artiMark) {
    push({
      id: 'artifact:mark',
      group: '综合',
      name: '词条评分',
      target: '走 miao 规则（MAX…D）',
      actual: `${num(build.artiMark.total)}（${build.artiMark.markClass}）`,
      verdict: (MIAO_MARK_SCORE[String(build.artiMark.markClass).toUpperCase()] ?? 0) >= 0.8 ? 'ok' : 'warn'
    })
  }

  // 主词条（只展示，不单独计分）—— 条件项（`生命值（二命）`）按玩家命座判定
  for (const t of targets.mainStats) {
    const piece = (build.artis || []).find(a => a.slot === t.slot)
    const actual = piece?.mainName || '—'
    const ok = piece ? mainStatAcceptable(t, actual, Number(build.cons) || 0) : false
    push({
      id: `artifact:main:${t.slot}`,
      group: '主词条',
      name: t.slot,
      target: t.options.join(' / '),
      actual,
      verdict: ok ? 'ok' : piece ? 'warn' : 'off'
    })
  }

  // 天赋
  for (const t of targets.talent) {
    const actual = Number(build.talent?.[t.key]) || 0
    push({
      id: `talent:${t.key}`,
      group: '天赋',
      name: `${t.key}${t.crown ? '（皇冠）' : ''}`,
      target: String(t.target),
      actual: String(actual),
      verdict: actual >= t.target ? 'ok' : 'warn'
    })
  }

  // 命座（只提示，不计分）
  if (targets.consKeys.length) {
    push({
      id: 'cons:key',
      group: '命座',
      name: '关键命座',
      target: targets.consKeys.join(' / '),
      actual: `C${Number(build.cons) || 0}`,
      verdict: 'info'
    })
  }

  /*
   * 面板（2026-10-25：**由规则决定是否计分**）
   *
   * `dps` 权重里没有 panel → 只作参考（`info`，与 2026-10-15 口径一致）；
   * `subdps` / `support` / 自定义规则含 panel → 计入未达标项（多方向角色只算选中的方向）。
   */
  const rule = opts.rule
  const parts = opts.parts ?? scoreParts(targets, build, opts)
  const panelScored = Boolean(rule && (Number(rule.weights.panel) || 0) > 0)
  const panelCons = Number(build.cons) || 0
  for (const t of targets.panel) {
    const actual = build.attrs?.[t.attrKey]
    const unit = t.percent ? '%' : ''
    const dirs = t.groups.length ? t.groups : ['参考']
    const inDirection = parts.panelDirection.length === 0 || dirs.some(d => parts.panelDirection.includes(d))
    /*
     * 2026-10-27 复审（新 P2）：**命座条件不满足的目标不参与计分，也不能当作未达标证据**。
     * 计分侧用 `condSatisfied()` 过滤过（见 `panelAssessment`），这里必须复用同一判定，
     * 否则 C0 玩家会被要求达成「充能 185%（满命）」——维度已 met、差在哪却列一条不适用的 warn。
     * 不适用的目标保留条件标注、降级为参考行（`info`）。
     */
    const applicable = condSatisfied(t.cond, panelCons)
    const condMark = String(t.cond?.mark || '').trim()
    let verdict: CompareRow['verdict'] = 'info'
    if (panelScored && inDirection && applicable) {
      verdict = !Number.isFinite(actual)
        ? 'off'
        : clamp01(Number(actual) / (t.min > 0 ? t.min : 1)) >= 0.999 ? 'ok' : 'warn'
    }
    push({
      // 稳定键**含方向**（审核 4.3）：同一属性在不同方向下是不同目标
      id: `panel:${dirs.join('+')}:${t.attrKey}`,
      group: t.groups.length ? t.groups.join('/') : '参考',
      name: t.name,
      target: `${t.max > t.min ? `${num(t.min)}~${num(t.max)}` : num(t.min)}${unit}${condMark}`,
      actual: Number.isFinite(actual) ? `${num(Number(actual))}${unit}` : '—',
      verdict
    })
  }

  return rows
}

/**
 * 建议行（新契约：带证据绑定）
 *
 * `evidenceIds` 用对比行的**稳定键**（`talent:A` / `artifact:main:时之沙` / `weapon:choice` …），
 * 页面再把它们映射成本页的 `E01` 号 —— 不靠中文名或顺序做关联（现场核对 §三：聚合多天赋/多主词条时
 * 中文名无法稳定一对一）。`priority` 沿用既有步骤顺序（成本启发式），**不宣称算过边际收益**。
 */
export interface SuggestionView {
  id: string
  text: string
  evidenceIds: string[]
  priority: number
  priorityBasis: 'cost-step'
}

/** 提升建议（按"投入产出"排序，最多 4 条） —— 返回带证据绑定的行；字符串版由它派生 */
export function buildSuggestionRows (targets: GuideTargets, build: BuildSnapshot, dims: GradeDim[], compDim: GradeDim, opts: GradeOptions = {}): SuggestionView[] {
  const out: SuggestionView[] = []
  const add = (id: string, text: string, evidenceIds: string[]): void => {
    out.push({ id, text, evidenceIds: evidenceIds.filter(Boolean), priority: out.length + 1, priorityBasis: 'cost-step' })
  }

  // ① 天赋（投入最小）
  const talentMiss = targets.talent.filter(t => (Number(build.talent?.[t.key]) || 0) < t.target)
  if (talentMiss.length) {
    add('talent', `天赋：${talentMiss.map(t => `${t.key} ${Number(build.talent?.[t.key]) || 0}→${t.target}`).join('、')}（投入最小）`,
      talentMiss.map(t => `talent:${t.key}`))
  }

  // ② 主词条（圣遗物里最直接的一步）—— 与对比行同一判据（含命座条件），避免"页面说达标、建议让换"
  const mainMiss = targets.mainStats.filter(t => {
    const piece = (build.artis || []).find(a => a.slot === t.slot)
    return piece && !mainStatAcceptable(t, piece.mainName, Number(build.cons) || 0)
  })
  if (mainMiss.length) {
    add('mainstat', `主词条：${mainMiss.map(t => `${t.slot}换「${t.optionViews[0]?.name || t.options[0]}」`).join('、')}`,
      mainMiss.map(t => `artifact:main:${t.slot}`))
  }

  /*
   * ③ 综合（2026-10-25：按规则给「套装 / 词条 / 面板」里真正没过闸的那几项）
   *
   * 权重从高到低取最多 2 条；判据与对比行、计分完全同源（`scoreParts()`），
   * 不再出现「页面说达标、建议让换」或「未达标却建议提升词条」。
   */
  {
    const rule = opts.rule
    const parts = opts.parts ?? scoreParts(targets, build, opts)
    if (compDim.ratio !== null && rule) {
      const weightOf = (k: PartKey): number => Number(rule.weights[k]) || 0
      const floorOf = (k: PartKey): number => Number(rule.floors[k])
      const ratioOf = (k: PartKey): number => (parts[k].ratio === null ? 1 : (parts[k].ratio as number))
      const items: Array<{ id: string, weight: number, text: string, evidence: string[] }> = []

      if (weightOf('set') > 0 && Number.isFinite(floorOf('set')) && ratioOf('set') < floorOf('set')) {
        const want = targets.artifact.recommend[0] || targets.artifact.optional[0] || ''
        const first = parseSetSpecs([want])[0]
        items.push({
          id: 'artifact:set',
          weight: weightOf('set'),
          text: first?.kind === 'pair' ? `圣遗物：凑推荐 2+2（${first.label}）` : `圣遗物：凑「${want}」4 件`,
          evidence: ['artifact:set']
        })
      }

      if (weightOf('mark') > 0 && Number.isFinite(floorOf('mark')) && ratioOf('mark') < floorOf('mark')) {
        items.push({
          id: 'artifact:mark',
          weight: weightOf('mark'),
          text: '圣遗物：提升有效词条（暴击 / 爆伤 / 攻击等，按 miao 评分口径）',
          evidence: ['artifact:mark']
        })
      }

      if (weightOf('panel') > 0 && Number.isFinite(floorOf('panel')) && ratioOf('panel') < floorOf('panel')) {
        const cons = Number(build.cons) || 0
        const gaps: Array<{ text: string, id: string }> = []
        for (const t of targets.panel) {
          if (!condSatisfied(t.cond, cons)) continue
          const actual = Number(build.attrs?.[t.attrKey])
          if (!Number.isFinite(actual)) continue
          const dirs = t.groups.length ? t.groups : ['参考']
          // 只给「计分方向」内的缺口提建议（另一方向仍在参考区，不催）
          if (parts.panelDirection.length && !dirs.some(d => parts.panelDirection.includes(d))) continue
          if (t.min > 0 && actual / t.min >= 0.999) continue
          const unit = t.percent ? '%' : ''
          gaps.push({
            text: `${t.name} ${num(Number(actual))}${unit}→${num(t.min)}${unit}`,
            id: `panel:${dirs.join('+')}:${t.attrKey}`
          })
        }
        if (gaps.length) {
          items.push({
            id: 'panel',
            weight: weightOf('panel'),
            text: `面板：${gaps.slice(0, 2).map(g => g.text).join('、')}`,
            evidence: gaps.slice(0, 2).map(g => g.id)
          })
        }
      }

      items.sort((a, b) => b.weight - a.weight)
      for (const item of items.slice(0, 2)) add(item.id, item.text, item.evidence)
    }
  }

  // ④ 武器
  const weaponDim = dims.find(d => d.key === 'weapon')
  if (weaponDim?.ratio !== null && weaponDim !== undefined && weaponDim.ratio < 0.75) {
    add('weapon', `武器：换到推荐档（${targets.weapon.recommend.slice(0, 2).join(' / ')}）`, ['weapon:choice'])
  }

  // 全部达标：不带证据号（页面显示"通用建议"，不编造 E 号）
  /*
   * 2026-10-17 复审修复（#1）：只有**全部维度都真的达标**才说"均已达标"；
   * 有维度是 unknown（数据没取到）时给补数据提示，绝不把"没数据"说成"已达标"。
   */
  if (!out.length) {
    const hasUnknown = dims.some(d => d.state === 'unknown')
    const below = dims.filter(d => d.state === 'below')
    /*
     * 2026-10-18 复审 R2：兜底文案必须跟**维度真实状态**一致 ——
     * 之前只排除 unknown，`综合 92% (below)` + 武器/天赋达标 时会打出「各维度均已达标」，
     * 与 02 三维里的「!未达标」自相矛盾。现在低于达标线的维度一律不算"已达标"。
     */
    if (hasUnknown) add('data-gap', '数据不全：先补上缺失的装备 / 圣遗物信息再评估，暂不判定达标', ['data-gap'])
    else if (below.length) add('below-kept', `未达标：${below.map(d => `${d.label} ${Math.round((d.ratio ?? 0) * 100)}%`).join('、')}（按上面的对比项逐条优化）`, ['below-kept'])
    else add('all-met', '各维度均已达标', [])
  }
  return out.slice(0, 4)
}

/** 兼容入口：只要文本（旧模板 / 文本回退用） */
export function buildSuggestions (targets: GuideTargets, build: BuildSnapshot, dims: GradeDim[], compDim: GradeDim): string[] {
  return buildSuggestionRows(targets, build, dims, compDim).map(s => s.text)
}

/** 把配置里的 `panel:30,weapon:20` 这类紧凑写法解析成对象（非法项忽略） */export function parseSpec (spec: unknown, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of String(spec || '').split(/[,，;；\s]+/)) {
    const [k, v] = part.split(/[:：=]/)
    const key = String(k || '').trim()
    const value = Number(String(v || '').trim())
    if (!key || !Number.isFinite(value) || !keys.includes(key)) continue
    out[key] = value
  }
  return out
}

/** 解析九档阈值写法 `MAX:95,ACE:88,…`（失败则回落默认） */
export function parseRankThresholds (spec: unknown): Array<[string, number]> {
  const parsed = parseSpec(spec, DEFAULT_RANK_THRESHOLDS.map(([n]) => n))
  if (!Object.keys(parsed).length) return DEFAULT_RANK_THRESHOLDS
  return DEFAULT_RANK_THRESHOLDS.map(([name, def]) => [name, Number.isFinite(parsed[name]) ? parsed[name] : def])
}
