/**
 * presentation — 展示层投影（2026-10-15 UI 重构「档案批注」契约）
 *
 * 职责：把业务结果（`GradeResult` / miao 来源信息）**纯函数**地投影成页面要的视图数据，
 * 集中处理四态、证据号、来源条与计分覆盖。业务口径（三维权重、九档、毕业档）**一律不在这里重算**。
 *
 * 为什么单独一层（现场核对 §三）：
 *   - 旧实现把"攻略缺该项"和"数据没取到"都写成 `pct:0`，页面看不出区别 → 这里用
 *     `AssessmentState`（met/below/unscored/unknown）+ `reason` 分开，`pct:null` 时模板不画填充条；
 *   - 建议与对比行过去只能靠中文名关联 → 这里用**稳定键**（`talent:A` / `artifact:main:时之沙` …）
 *     绑定，并把稳定键映射成当页的 `E01` 呈现号；
 *   - 时间只写可核实的来源时间；本次读取时间单独放 `observedAt`，绝不用它冒充"面板更新时间"。
 *
 * 本文件不读文件、不联网、不引框架，可用合成数据完整单测（`test/presentation.test.mjs`）。
 */
import type { AssessmentReason, AssessmentState, CompareRow, GradeDim, GradeResult } from '../modules/grade.js'

/** 内部规则版本（展示"计分口径"用；攻略目标版本另有来源，取不到就写"版本未提供"） */
export const SCORING_VERSION = 'meta-grade-v3'

export const STATE_LABEL: Record<AssessmentState, string> = {
  met: '达标',
  below: '未达标',
  unscored: '不计分',
  unknown: '未知'
}

/** 颜色之外的第二通道（色觉障碍适配，规格 §2：颜色 + 固定图形 + 中文） */
export const STATE_SYMBOL: Record<AssessmentState, string> = {
  met: '✓',
  below: '!',
  unscored: '−',
  unknown: '?'
}

export const REASON_TEXT: Record<AssessmentReason, string> = {
  'target-missing': '攻略缺该项',
  'data-missing': '未取到数据',
  'partial-data': '数据不完整',
  'fetch-failed': '取数失败'
}

/** 来源条的"数据新鲜度"文案（与颜色/时间分开，不靠一句话暗示） */
export const MODE_TEXT: Record<string, string> = {
  local: '本地数据',
  refreshed: '本次已刷新',
  cache: '缓存数据',
  fallback: '回退数据'
}

/** 来源条（规格 §3）：只写可核实字段 */
export interface SourceInfo {
  /** `miao` / `mhydps` / `local` */
  source: string
  name: string
  mode: 'local' | 'refreshed' | 'cache' | 'fallback'
  /** 新鲜度文案（模板直接用，避免模板里写映射表） */
  modeText: string
  /** 源数据更新时间**原文**；空串 = 时间未提供 */
  updatedAt: string
  /** 本次读取/计算时间（与更新时间分开，不能互相冒充） */
  observedAt: number
  reason?: string
  message?: string
}

export interface GradeDimView {
  key: string
  label: string
  state: AssessmentState
  /** 状态中文（达标/未达标/不计分/未知）与图形（✓/!/−/?）—— 模板直接用，颜色之外的第二第三通道 */
  stateLabel: string
  symbol: string
  reason?: AssessmentReason
  reasonText?: string
  ratio: number | null
  /** 0~100 的整数；`null` = 不画填充条（未知 / 不计分） */
  pct: number | null
  pctText: string
  /** 本次**实际生效**的归一权重（0~1） */
  weight: number
  weightText: string
  detail: string
}

export interface EvidenceRow {
  /** 稳定键（与建议绑定用） */
  id: string
  /** 本页呈现号 `E01` */
  eid: string
  group: string
  name: string
  target: string
  actual: string
  state: AssessmentState
  stateLabel: string
  symbol: string
  reason?: AssessmentReason
  reasonText?: string
  /** `info` 参考行 = false（不是未达标项） */
  scored: boolean
  deltaText: string
}

export interface SuggestionRowView {
  id: string
  text: string
  /** 绑定的证据稳定键（原样保留，便于测试与调试） */
  evidenceIds: string[]
  /** 绑定的当页证据号（可能为空 = 通用建议） */
  evidenceEids: string[]
  priority: number
  priorityBasis: string
}

export interface ScoreContext {
  /** 有没有任何维度可评；false 时页面不展示总分与字母档 */
  assessable: boolean
  scoringVersion: string
  targetVersion: string
  evaluatedKeys: string[]
  unknownKeys: string[]
  unscoredKeys: string[]
  /** 有效权重（按可评维度归一后的值） */
  weights: Record<string, number>
  /** 有维度不可评 → 说明这是"部分口径" */
  isPartial: boolean
}

export interface PresentationMeta {
  score: ScoreContext
  dims: GradeDimView[]
  /** 计分对比行（含未达标与未知，未被过滤） */
  evidence: EvidenceRow[]
  /** `info` 参考行（面板 / 命座）—— 即使有差距也不计分 */
  references: EvidenceRow[]
  /** 参考项里是否有方向（辅助/输出…）；无方向时不渲染方向列 */
  refHasDir: boolean
  /** 参考项是否只有「命座」一条（是则整块不显示） */
  refOnlyCons: boolean
  suggestions: SuggestionRowView[]
  /** 达标项覆盖说明（"其余 N 项达标"） */
  metCount: number
  metText: string
  sources: SourceInfo[]
}

/** 从字符串里抽数字（仅用于"还差多少"这类有限数字目标；拿不到就退回"未达标"） */
export function deltaTextOf (row: CompareRow): string {
  if (row.verdict === 'off') return '无数据'
  if (row.verdict === 'info') return '参考'
  const actual = Number(String(row.actual).replace(/[^\d.-]/g, ''))
  const nums = String(row.target).match(/\d+(?:\.\d+)?/g)?.map(Number) || []
  if (!Number.isFinite(actual) || !nums.length) return '未达标'
  const min = Math.min(...nums)
  const diff = Number((min - actual).toFixed(1))
  return diff > 0 ? `差 ${diff}` : '未达标'
}

/** 维度视图：四态 + 有效权重 + 不画 0 长度条 */
export function buildDims (dims: GradeDim[]): GradeDimView[] {
  return dims.map(d => {
    const state: AssessmentState = d.state
    const pct = d.ratio === null ? null : Math.round(d.ratio * 100)
    return {
      key: d.key,
      label: d.label,
      state,
      stateLabel: STATE_LABEL[state],
      symbol: STATE_SYMBOL[state],
      reason: d.reason,
      reasonText: d.reason ? REASON_TEXT[d.reason] : undefined,
      ratio: d.ratio,
      pct,
      // 不计分 / 未知都不显示百分数（旧实现显示 0%，等于把缺项说成"一点没做"）；
      // 数值列写"—"，状态由状态章表达（颜色 + 图形 + 中文三通道）
      pctText: pct === null ? '—' : `${pct}%`,
      weight: d.weight,
      weightText: d.weight > 0 ? `${Math.round(d.weight * 100)}%` : '—',
      detail: d.detail
    }
  })
}

/**
 * 证据行：按传入顺序编号 `E01…`，稳定键保持原样
 *
 * 参考行（`scored === false`）单独返回 —— 规格要求"参考项即使有差距也不计分"，
 * 而且**未知行不能被过滤掉**（旧实现把缺主词条的行丢掉了，页面还可能显示"全部达标"）。
 */
export function buildEvidence (rows: CompareRow[]): { evidence: EvidenceRow[], references: EvidenceRow[] } {
  const evidence: EvidenceRow[] = []
  const references: EvidenceRow[] = []
  for (const row of rows) {
    const scored = row.scored !== false && row.verdict !== 'info'
    const state: AssessmentState = row.state || (row.verdict === 'ok' ? 'met' : row.verdict === 'warn' ? 'below' : row.verdict === 'info' ? 'unscored' : 'unknown')
    const item: EvidenceRow = {
      id: String(row.id || `${row.group}:${row.name}`),
      eid: '',
      group: row.group,
      name: row.name,
      target: row.target,
      actual: row.actual,
      state,
      stateLabel: STATE_LABEL[state],
      symbol: STATE_SYMBOL[state],
      reason: state === 'unknown' ? 'data-missing' : undefined,
      reasonText: state === 'unknown' ? REASON_TEXT['data-missing'] : undefined,
      scored,
      // 只有真算得出差值时才显示"差 N"；否则留空（状态章已经写了"未达标"，不必重复一遍）
      deltaText: /^差 /.test(deltaTextOf(row)) ? deltaTextOf(row) : ''
    }
    if (scored) {
      // E 号是**本页呈现号**：只发给需要关注的行（未达标 / 未知），达标行压成摘要行，
      // 这样编号连续（E01、E02…），建议引用不会出现"跳号"（2026-10-15 本地渲染发现）。
      if (state !== 'met') {
        item.eid = `E${String(evidence.filter(e => e.eid).length + 1).padStart(2, '0')}`
      }
      evidence.push(item)
    } else {
      references.push(item)
    }
  }
  return { evidence, references }
}

/** 建议行：把稳定键映射成当页证据号；绑定不到就不编造号 */
export function buildSuggestionRows (
  rows: Array<{ id: string, text: string, evidenceIds: string[], priority: number, priorityBasis: string }>,
  evidence: EvidenceRow[]
): SuggestionRowView[] {
  const byId = new Map(evidence.map(e => [e.id, e.eid]))
  return rows.map(s => ({
    id: s.id,
    text: s.text,
    evidenceIds: [...s.evidenceIds],
    evidenceEids: s.evidenceIds.map(id => byId.get(id)).filter((x): x is string => !!x),
    priority: s.priority,
    priorityBasis: s.priorityBasis
  }))
}

/** 计分覆盖与可比性（不同覆盖/版本的分数不横向比较） */
export function buildScoreContext (
  result: Pick<GradeResult, 'assessable' | 'dims'>,
  opts: { targetVersion?: string, scoringVersion?: string } = {}
): ScoreContext {
  const weights: Record<string, number> = {}
  for (const d of result.dims) if (d.weight > 0) weights[d.key] = Number(d.weight.toFixed(4))
  return {
    assessable: result.assessable,
    scoringVersion: opts.scoringVersion || SCORING_VERSION,
    targetVersion: String(opts.targetVersion || ''),
    evaluatedKeys: result.dims.filter(d => d.state === 'met' || d.state === 'below').map(d => d.key),
    unknownKeys: result.dims.filter(d => d.state === 'unknown').map(d => d.key),
    unscoredKeys: result.dims.filter(d => d.state === 'unscored').map(d => d.key),
    weights,
    isPartial: result.dims.some(d => d.state === 'unknown' || d.state === 'unscored')
  }
}

/** miao 面板来源 → 来源条 */
export function miaoSource (
  source: { name?: string, updatedAt?: string, mode?: string, reason?: string } | undefined,
  observedAt: number
): SourceInfo {
  const mode = String(source?.mode || 'local')
  const safeMode = (['local', 'refreshed', 'cache', 'fallback'].includes(mode) ? mode : 'local') as SourceInfo['mode']
  return {
    source: 'miao',
    name: String(source?.name || 'miao 面板'),
    mode: safeMode,
    modeText: MODE_TEXT[safeMode],
    updatedAt: String(source?.updatedAt || ''),
    observedAt,
    reason: source?.reason ? String(source.reason) : undefined
  }
}

/** 汇总：一次生成页面需要的全部视图数据 */
export function buildPresentation (input: {
  result: GradeResult
  observedAt?: number
  targetVersion?: string
  source?: { name?: string, updatedAt?: string, mode?: string, reason?: string }
  extraSources?: SourceInfo[]
}): PresentationMeta {
  const observedAt = Number(input.observedAt) || 0
  const dims = buildDims(input.result.dims)
  const { evidence, references } = buildEvidence(input.result.rows)
  const suggestions = buildSuggestionRows(
    (input.result.suggestionRows || []).map(s => ({ id: s.id, text: s.text, evidenceIds: s.evidenceIds, priority: s.priority, priorityBasis: s.priorityBasis })),
    evidence
  )
  const metCount = evidence.filter(e => e.state === 'met').length
  /*
   * 参考项区的两条展示口径（2026-10-18 用户定）：
   *   refHasDir  —— 参考项里有没有**方向**（辅助/输出…）。没有就不为方向留列（省横向空间）；
   *   refOnlyCons —— 参考项只有「命座」一条 → 整块不显示（没有可参考的面板目标，纯占版面）。
   * 「参考」是面板无方向时的兜底 group，不算方向。
   */
  const refGroups = references.map(r => String(r.group || ''))
  const refHasDir = refGroups.some(g => g && g !== '参考' && g !== '命座')
  const refOnlyCons = references.length > 0 && refGroups.every(g => g === '命座')
  return {
    score: buildScoreContext(input.result, { targetVersion: input.targetVersion }),
    dims,
    evidence,
    references,
    refHasDir,
    refOnlyCons,
    suggestions,
    metCount,
    /*
     * 未达标项的收尾文案（2026-10-18 用户定）：没有未达标项时写「已全部达标」，
     * 而不是在"未达标项"标题下只写「其余 N 项达标」。
     */
    metText: evidence.length === 0
      ? ""
      : (evidence.every(e => e.state === "met") ? "已全部达标" : (metCount ? `其余 ${metCount} 项达标` : "")),
    sources: [miaoSource(input.source, observedAt), ...(input.extraSources || [])]
  }
}

/* ------------------------------------------------------------------ *
 * 攻略页（档案批注：章节序号 + 共享行组件 + 来源条 + 两行脚注）
 * ------------------------------------------------------------------ */

/** 攻略条目（装备/数值项）：`tone` 与 `marker` 是颜色之外的通道（色觉障碍适配） */
export interface GuideItemView {
  text: string
  /** 面板格：k：v 拆开后的**属性名**（非面板行留空） */
  k: string
  /** 面板格：拆分后的**数值**（非面板行留空） */
  v: string
  note: string
  icon: string
  /** `sig` = 专武 / `alt` = 可选档（旧页只靠红/绿两色区分） */
  tone: '' | 'sig' | 'alt'
  /** 与 `tone` 配套的固定图形（★ / ◇），图例在数据区顶部说明 */
  marker: string
  sepAfter: string
  talentLevel: number
  crown: boolean
}

export interface GuideRowView {
  label: string
  /**
   * 长标签的分行（2026-10-15 审核意见 4.4：超长标签独占一行/按语义边界换行，**不**全局加宽标签列）
   *
   * 只在标签"太长"时给出（> 6 个字符），按 `/` 这类语义分隔符切开；不切就只给一段。
   */
  labelLines: string[]
  /** 是否走"标签独占一行"的版式 */
  longLabel: boolean
  /** `stats` = 面板数值行（加粗放大）/ `talents` = 天赋三格 */
  kind: string
  items: GuideItemView[]
}

export interface GuideTeamView {
  tag: string
  text: string
  members: Array<{ name: string, icon: string, note: string }>
}

export interface GuideSectionView {
  /** 章节序号 `01…`（**按循环索引生成**，不写死为六章） */
  index: string
  title: string
  kind: string
  empty: boolean
  emptyText: string
  hint: string
  rows: GuideRowView[]
  teams: GuideTeamView[]
}

export interface CodexMeta {
  sections: GuideSectionView[]
  legend: string
  hint: string
  copyright: string
  sources: SourceInfo[]
}

/**
 * 整值占位符识别（2026-10-15 审核意见 4.4；2026-10-17 扩到「带单位 / 前缀」的写法）
 *
 * 数据里确实存在 `100级提升: ___%` 这类**未填写的占位值**，页面原样显示会像"有内容但坏掉"。
 * 认这几种形态：
 *   - 全下划线（可带 `%`）：`___%`、`__`
 *   - 全破折号：`——`、`--`、`—`
 *   - 空串 / 全空白
 *   - **带单位 / 前缀的空占位**：`___级`、`约 ___%`、`__~__级`（用户 2026-10-17 定：
 *     建议等级的数字是占位就整行不显示）—— 判据是「一个数字都没有、又含占位符字符」
 * **不碰**合法的 `0`、`0%`、`70-80%`、`约 7.2%~7.8%`、`60级突破`（都含数字）。
 *
 * 放在展示层（而不是各模板里）：图片与文本回退消费同一份归一结果。
 */
export function isPlaceholderValue (raw: unknown): boolean {
  const text = String(raw ?? '').trim()
  if (!text) return true
  if (/\d/.test(text)) return false
  if (/^[_＿]+%?$/.test(text) || /^[-－—–~～]+%?$/.test(text)) return true
  // 走到这里已经确定"没有数字"：只要出现占位符字符，就当占位（`___级` / `约 ___%` / `__ ~ __`）
  return /[_＿\-－—–~～]/.test(text)
}

/** 占位值归一：占位 → 空串（由调用方决定显示"未提供"还是整行省略） */
export function normalizeMetaValue (raw: unknown): string {
  return isPlaceholderValue(raw) ? '' : String(raw ?? '').trim()
}

/** 行内 `名称：值` 里的值若是占位符 → 换成"未提供"（视图层改一次，两条渲染路径同源） */
/**
 * 备注斜体：把文本里的括号备注（全角 `（）` / 半角 `()`）切成
 * `<span class="codex-note">…</span>`，供模板用 `{{@…}}` 原样输出。
 *
 * 只处理**括号内容**（本仓库攻略数据的备注约定就是括号，见现场核对）；
 * 其他 HTML 字符一律转义，避免数据里出现尖括号时破坏结构。
 */
export function noteSpansOf (raw: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return String(raw ?? '').replace(/[（(]([^）)]*)[）)]/g, (m, inner) => `<span class="codex-note">${esc(m)}</span>`)
}

export function normalizeItemText (raw: unknown): string {
  const text = String(raw ?? '').trim()
  const m = text.match(/^(.+?)[：:]\s*(.+)$/)
  if (!m) return text
  return isPlaceholderValue(m[2]) ? `${m[1]}：未提供` : text
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {})
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** 长标签判定（> 6 字符）：攻略里有 `月结晶/月感电` 这类双方案标签，窄列会被拆成半截 */
export function isLongLabel (label: string): boolean {
  return String(label || '').trim().length > 6
}

/**
 * 长标签按**语义边界**分行（`月结晶/月感电` → `月结晶` / `月感电`）
 *
 * 只按分隔符切；切不出多段就原样一段（模板据此让它独占一行，不再挤压右列）。
 */
/**
 * 行标签的语义分类（2026-10-17 用户定：**不同颜色便于快速定位**）
 *
 *   核心（金色 `--gold`）：推荐 / 主词条 / 命之座 / 首选 / 毕业 / 专武
 *   备选（蓝色 `--accent`）：可选 / 副词条 / 次选 / 备选 / 替代
 *   过程（灰色 `--muted`）：过渡 / 其他 / 过渡用
 *   未识别（正文色）：其余标签照正文色显示，不额外上色（避免"什么都上色"反而看不出重点）
 *
 * 归类只看标签文本，不碰数据结构；同一份映射给模板与套件共用。
 */
export type LabelTone = 'core' | 'alt' | 'muted' | 'plain'

const TONE_WORDS: Array<[LabelTone, RegExp]> = [
  ['core', /推荐|主词条|命之座|首选|毕业|专武|核心|月结晶|月感电|月绽放/],
  ['alt', /可选|副词条|次选|备选|替代/],
  ['muted', /过渡|其他|通用|输出向|辅助向/]
]

export function labelToneOf (label: string): LabelTone {
  const text = String(label || '').trim()
  if (!text) return 'plain'
  for (const [tone, re] of TONE_WORDS) if (re.test(text)) return tone
  return 'plain'
}

/** 面板格文本 `暴击率：80-90%` → `{ k: '暴击率', v: '80-90%' }`；没有冒号时 k 留空、v 原样 */
/**
 * `属性：数值` → 三瓣（2026-10-17 复审修复 #10）
 *
 * 攻略里的面板行有**方向前缀**：`辅助：暴击率：70%` / `输出：暴击率：90%`。
 * 旧实现只按**第一个**冒号切 → `k = 辅助`、`v = 暴击率：70%`：方向是出现了，但属性名和数值被挤在
 * 同一格里、两种方向的两行看起来只是"标签不同"，读不出"这是辅助档 / 输出档"。
 * 两个及以上冒号时按 **方向 : 属性 : 数值** 切；只有一个冒号时维持 `属性 : 数值`。
 */
const DIRECTION_WORDS = /^(?:辅助|输出|治疗|生存|主c|副c|主C|副C|输出向|辅助向|双修|盾)(?:向)?$/i

export function splitStatCell (text: string): { group: string, k: string, v: string } {
  const raw = String(text || '').trim()
  const all = [...raw.matchAll(/[：:]/g)].map(m => m.index ?? -1).filter(i => i > 0)
  if (!all.length) return { group: '', k: '', v: raw }
  if (all.length >= 2) {
    const g = raw.slice(0, all[0]).trim()
    const k = raw.slice(all[0] + 1, all[1]).trim()
    const v = raw.slice(all[1] + 1).trim()
    /*
     * 只有首段确实是"方向词"才当 group（数据里实测只有：辅助 / 输出 / 输出向 / 辅助向 / 主c …）。
     * 否则像 `备注：时间 12:30` 这种「值里带冒号」的行会被误拆成三瓣 —— 旧口径只切第一个冒号，必须保留。
     */
    if (DIRECTION_WORDS.test(g) && k && v) return { group: g, k, v }
  }
  const at = all[0]
  return { group: '', k: raw.slice(0, at).trim(), v: raw.slice(at + 1).trim() }
}

export function labelLinesOf (label: string): string[] {
  const text = String(label || '').trim()
  if (!text) return []
  if (!isLongLabel(text)) return [text]
  const parts = text.split(/[／/｜|、]/).map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts : [text]
}

/**
 * 圣遗物套装表述（纯函数，2026-10-15 用户定；2026-10-17 从 `apps/grade.ts` 提成共享）
 *
 * 规则：**只写 4 件套 / 2+2 / 2 件套；凑不出套装加成就写「散件」，不列单件散件**。
 * （曾经写成 `魔女×4 + 乐团×1` 会把单件散件也列出来。）
 *
 * @param sets 每套的**展示名**与件数（名一律由调用方给中文；按入参顺序做稳定排序，排名相同的保序）
 */
export function setSummary (sets: Array<{ name?: unknown, count?: unknown }>): string {
  const counts = (sets || [])
    .filter(s => s && String(s.name ?? '') && Number(s.count) > 0)
    .map(s => [String(s.name), Math.floor(Number(s.count))] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const four = counts.find(([, n]) => n >= 4)
  if (four) return `${four[0]}×4`
  const pairs = counts.filter(([, n]) => n >= 2).slice(0, 2)
  if (pairs.length >= 2) return `${pairs[0][0]}×2 + ${pairs[1][0]}×2`
  if (pairs.length === 1) return `${pairs[0][0]}×2`
  return '散件'
}

/**
 * 攻略页投影：给每个模块补章节序号，给条目补"颜色之外"的图形通道，并收集来源/脚注。
 *
 * **不重做归一**：`kind/items/sepAfter/talentLevel/crown` 一律照 `buildV2Sections()` 的输出消费
 * （现场核对 §一：模板里不重新展开攻略，也不解析自然语言猜语义）。
 */
export function buildCodexPresentation (view: {
  sections?: unknown
  hints?: { empty?: string, refine?: string }
}, opts: { copyright?: string, sources?: SourceInfo[] } = {}): CodexMeta {
  const sections: GuideSectionView[] = asArray(view?.sections).map((raw, i) => {
    const s = asRecord(raw)
    const rows: GuideRowView[] = asArray(s.rows).map(r => {
      const row = asRecord(r)
      const items: GuideItemView[] = asArray(row.items).map(it => {
        const item = asRecord(it)
        const sig = item.sig === true
        const alt = item.sigAlt === true
        const cell = splitStatCell(normalizeItemText(item.text))
        return {
          text: normalizeItemText(item.text),
          group: cell.group,
          k: cell.k,
          v: cell.v,
          textHtml: noteSpansOf(normalizeItemText(item.text)),
          note: String(item.note ?? ''),
          icon: String(item.icon ?? ''),
          tone: sig ? 'sig' : alt ? 'alt' : '',
          marker: sig ? '★' : alt ? '◇' : '',
          sepAfter: String(item.sepAfter ?? ''),
          talentLevel: Number(item.talentLevel ?? item.level) || 0,   // 真实数据字段是 `level`（v2.talents.order），模板用 `talentLevel`
          crown: item.crown === true || Number(item.talentLevel ?? item.level) >= 10   // 与 miao 同规则：原始等级 ≥ 10 即出冠
        }
      })
      const label = String(row.label ?? '')
      return { label, labelLines: labelLinesOf(label), longLabel: isLongLabel(label), labelTone: labelToneOf(label), kind: String(row.kind ?? ''), items }
    })
    const teams: GuideTeamView[] = asArray(s.teams).map(t => {
      const team = asRecord(t)
      return {
        tag: String(team.tag ?? ''),
        text: String(team.text ?? ''),
        members: asArray(team.members).map(m => {
          const member = asRecord(m)
          const name = String(member.name ?? '')
          /*
           * 2026-10-18 核对修复（#9 残留）：多选槽的候选写在名字里（`莫娜 / 沃雅妮莎`），
           * 旧实现只当一整个名字 → 模板只画得到首选头像、其余候选直接消失。
           * 这里拆成 `alts`，模板逐个渲染（有图标画头像、没图标画名字）。
           */
          const existing = (member as { alts?: Array<{ name: string, icon?: string }> }).alts
          const split = name.split(/[／/]/).map(s => s.trim()).filter(Boolean)
          return {
            name,
            icon: String(member.icon ?? ''),
            note: String(member.note ?? ''),
            // 上游（subViews.withIcons）已经拆好并解析过图标时直接用，避免这里把图标丢掉
            alts: Array.isArray(existing) && existing.length
              ? existing.map(a => ({ name: String(a?.name ?? ''), icon: String(a?.icon ?? '') }))
              : (split.length ? split : [name]).map(n => ({ name: n, icon: '' }))
          }
        })
      }
    })
    return {
      index: String(i + 1).padStart(2, '0'),
      title: String(s.title ?? ''),
      kind: String(s.kind ?? ''),
      empty: s.empty === true || (rows.length === 0 && teams.length === 0),
      emptyText: String(view?.hints?.empty ?? '暂无'),
      // 武器模块的精炼提示挂在**标题行**上（原来贴在卡片底部，容易被当成脚注忽略）
      hint: String(s.title ?? '') === '武器' ? String(view?.hints?.refine ?? '') : '',
      rows,
      teams
    }
  })

  return {
    sections,
    legend: '★ 专武　◇ 可选档',
    hint: String(view?.hints?.refine ?? ''),
    copyright: String(opts.copyright ?? ''),
    sources: opts.sources && opts.sources.length
      ? opts.sources
      : [{ source: 'codex', name: '本仓库攻略数据', mode: 'local', modeText: MODE_TEXT.local, updatedAt: '', observedAt: 0 }]
  }
}