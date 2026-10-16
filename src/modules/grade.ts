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
export const DEFAULT_PANEL_TIERS = { big: 0.9, normal: 0.6, small: 0.3 }

/** 九档阈值：分数 ≥ 阈值即该档（配置项 `gradeRankThresholds` 可覆盖） */
export const DEFAULT_RANK_THRESHOLDS: Array<[string, number]> = [
  ['MAX', 95], ['ACE', 88], ['SSS', 80], ['SS', 72], ['S', 64], ['A', 55], ['B', 45], ['C', 30]
]

/** miao 圣遗物评分档位 → 0~1（与 miao `ArtisMark.getMarkClass` 的档位一一对应） */
export const MIAO_MARK_SCORE: Record<string, number> = {
  MAX: 1, ACE: 0.95, SSS: 0.9, SS: 0.8, S: 0.7, A: 0.55, B: 0.4, C: 0.25, D: 0.1
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
      if (sets.length && ['preferred', 'optional', 'transition', ''].includes(kind)) {
        const bucket = kind === 'preferred' || kind === '' ? targets.artifact.recommend : targets.artifact.optional
        for (const s of sets) {
          const name = String((s as Record<string, any>)?.name ?? s ?? '').trim()
          if (name) bucket.push(name)
        }
        continue
      }
      if (kind === 'main' && row?.stats && typeof row.stats === 'object') {
        for (const [slot, raw] of Object.entries(row.stats as Record<string, unknown>)) {
          const options = (Array.isArray(raw) ? raw : [raw]).map(x => String(x).trim()).filter(Boolean)
          const slotName = String(slot).trim()
          if (slotName && options.length) targets.mainStats.push({ slot: slotName, options, optionViews: options.map(parseCondMark) })
        }
      }
      // `sub` / `text`：副词条与自由文本只用于展示与建议，不参与这里的评分口径
    }
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
  panelTiers?: { big: number, normal: number, small: number }
  rankThresholds?: Array<[string, number]>
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
function scoreComprehensive (targets: GuideTargets, build: BuildSnapshot): GradeDim {
  const label = '综合'
  const artis = build.artis || []
  const hasSetTarget = targets.artifact.recommend.length > 0 || targets.artifact.optional.length > 0

  // 套装符合度（沿用旧口径：推荐 4 件 1.0 / 可选 4 件 0.8 / 2+2 0.7 / 不在表内 0.3）
  const count = new Map<string, number>()
  for (const a of artis) count.set(a.set, (count.get(a.set) || 0) + 1)
  const hit = (list: string[]) => [...count.entries()].filter(([set]) => list.some(s => s === set || s.includes(set) || set.includes(s)))
  const rec4 = hit(targets.artifact.recommend).find(([, n]) => n >= 4)
  const opt4 = hit(targets.artifact.optional).find(([, n]) => n >= 4)
  const pairs = [...hit(targets.artifact.recommend), ...hit(targets.artifact.optional)].filter(([, n]) => n >= 2)
  let setScore = 0.3
  let setNote = '套装不在攻略推荐内'
  if (rec4) {
    setScore = 1
    setNote = `推荐套装 4 件（${rec4[0]}）`
  } else if (opt4) {
    setScore = 0.8
    setNote = `可选套装 4 件（${opt4[0]}）`
  } else if (new Set(pairs.map(([s]) => s)).size >= 2) {
    setScore = 0.7
    setNote = `2+2 组合（${pairs.map(([s]) => s).join(' + ')}）`
  }

  // miao 评分档位（词条口径）
  const markClass = String(build.artiMark?.markClass || '').toUpperCase()
  const markScore = MIAO_MARK_SCORE[markClass]
  const hasMark = Number.isFinite(markScore)
  const markNote = hasMark
    ? `miao 词条评分 ${num(Number(build.artiMark?.total) || 0)}（${markClass}）`
    : '未取到 miao 词条评分'

  // 有词条评分 → 以它为主；没有评分但穿着推荐套装 → 只按套装算（并在 notes 里说明）
  let ratio: number | null
  if (hasMark) ratio = hasSetTarget ? 0.8 * markScore + 0.2 * setScore : markScore
  else if (hasSetTarget && artis.length) ratio = setScore
  else ratio = null

  const detail = ratio === null
    ? (artis.length ? '未取到 miao 词条评分（不计分）' : '未读取到圣遗物')
    : (hasSetTarget ? `${setNote}；${markNote}` : markNote)

  /*
   * 四态：`ratio === null` 的两种来源要分开 ——
   *   数据缺失（没读到圣遗物 / 没读到评分）→ unknown；
   *   攻略缺项（既没有推荐套装也没有评分口径）→ unscored。
   * 现场核对 §三：旧实现把两者都写成 pct:0，页面看不出区别。
   */
  const state: AssessmentState = ratio !== null
    ? (ratio >= 1 ? 'met' : 'below')
    : (artis.length || build.hasMark ? 'unknown' : 'unscored')
  const reason: AssessmentReason | undefined = state === 'met' || state === 'below'
    ? undefined
    : (state === 'unknown' ? 'data-missing' : 'target-missing')

  return { key: 'comprehensive', label, ratio, weight: 0, detail, state, reason }
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
  const dims = [scoreComprehensive(targets, build), scoreWeapon(targets, build), scoreTalent(targets, build)]

  // 只对"有目标"的维度加权（缺项不扣分），权重重归一
  const scored = dims.filter(d => d.ratio !== null)
  const weightSum = scored.reduce((s, d) => s + (Number(weights[d.key]) || 0), 0)
  for (const d of dims) d.weight = d.ratio === null ? 0 : (Number(weights[d.key]) || 0) / (weightSum || 1)

  const total = scored.length ? scored.reduce((s, d) => s + d.ratio! * d.weight, 0) * 100 : 0
  const compDim = dims.find(d => d.key === 'comprehensive')!
  const panelInfo = panelTierOf(compDim.ratio, build, targets, opts.panelTiers)

  const notes: string[] = []
  if (cappedNote(targets, build, panelInfo.capped)) {
    notes.push(`等级 ${build.level} 未达建议等级 ${targets.levelText}（毕业档按门槛最高「小毕业」）`)
  }
  for (const d of dims) if (d.ratio === null) notes.push(`${d.label}：${d.detail}（不计入总分）`)
  if (!build.artiMark) notes.push('圣遗物评分：未取到 miao 词条评分，本次只按套装计分')

  const rows = buildCompareRows(targets, build)
  const suggestionRows = buildSuggestionRows(targets, build, dims, compDim)
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
    notes
  }
}

function cappedNote (targets: GuideTargets, build: BuildSnapshot, capped: boolean): boolean {
  return capped === true && !!targets.levelMin && Number(build.level) < targets.levelMin
}

/** 对比表（只列主词条，不列副词条） */
export function buildCompareRows (targets: GuideTargets, build: BuildSnapshot): CompareRow[] {
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

  // 套装 + miao 词条评分（2026-10-15 起与面板合并为「综合」组）
  if (targets.artifact.recommend.length || targets.artifact.optional.length) {
    const sets = [...new Set((build.artis || []).map(a => a.set))].filter(Boolean)
    const hit = sets.some(s => matchesGuideName(s, targets.artifact.recommend))
    push({
      id: 'artifact:set',
      group: '综合',
      name: '套装',
      target: targets.artifact.recommend.join(' / ') || '—',
      actual: sets.map(s => `${s}×${(build.artis || []).filter(a => a.set === s).length}`).join(' / ') || '—',
      verdict: hit ? 'ok' : sets.length ? 'warn' : 'off'
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

  // 面板（2026-10-15 用户定：只作参考，不设严格限制 → 判定 `info`，不进"未达标项"）
  for (const t of targets.panel) {
    const actual = build.attrs?.[t.attrKey]
    const unit = t.percent ? '%' : ''
    push({
      // 稳定键**含方向**（审核 4.3）：同一属性在不同方向下是不同目标
      id: `panel:${(t.groups.length ? t.groups : ['参考']).join('+')}:${t.attrKey}`,
      group: t.groups.length ? t.groups.join('/') : '参考',
      name: t.name,
      target: `${t.max > t.min ? `${num(t.min)}~${num(t.max)}` : num(t.min)}${unit}`,
      actual: Number.isFinite(actual) ? `${num(Number(actual))}${unit}` : '—',
      verdict: 'info'
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
export function buildSuggestionRows (targets: GuideTargets, build: BuildSnapshot, dims: GradeDim[], compDim: GradeDim): SuggestionView[] {
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

  // ③ 圣遗物词条质量（综合维度的主依据；套装覆盖与词条质量分开判断）
  if (compDim.ratio !== null && compDim.ratio < 1) {
    const counts = new Map<string, number>()
    for (const a of build.artis || []) counts.set(a.set, (counts.get(a.set) || 0) + 1)
    const covered = [...counts.entries()].some(([set, n]) => n >= 4 && matchesGuideName(set, targets.artifact.recommend))
    if (targets.artifact.recommend.length && !covered) {
      add('artifact:set', `圣遗物：凑「${targets.artifact.recommend[0]}」4 件`, ['artifact:set'])
    } else if (compDim.ratio < 0.8) {
      add('artifact:mark', '圣遗物：提升有效词条（暴击 / 爆伤 / 攻击等，按 miao 评分口径）', ['artifact:mark'])
    }
  }

  // ④ 武器
  const weaponDim = dims.find(d => d.key === 'weapon')
  if (weaponDim?.ratio !== null && weaponDim !== undefined && weaponDim.ratio < 0.75) {
    add('weapon', `武器：换到推荐档（${targets.weapon.recommend.slice(0, 2).join(' / ')}）`, ['weapon:choice'])
  }

  // 全部达标：不带证据号（页面显示"通用建议"，不编造 E 号）
  if (!out.length) add('all-met', '各维度均已达标：可继续提升圣遗物词条质量', [])
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
