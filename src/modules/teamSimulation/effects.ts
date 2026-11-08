/**
 * P1 效果表：数据声明「命中触发什么」，内核按帧结算生效区间。
 *
 * 这里不做数值平衡判断，也不替数据补默认值：数值由数据给，内核只保证同一帧的生效顺序、
 * 到期时刻与叠加层数可复现。触发者自己被自己触发的效果加成——同一次命中先结算伤害，
 * 再结算它携带的触发，所以「给自己上攻击力」的那一下不会吃到自己的加成。
 */
import type { Issue, PermanentStats } from './types.js'
import { REACTIONS, isSpecialKind, type ReactiveKind, type SpecialKind } from './reactions.js'

/**
 * 面板键：只有这些键可以加到结算面板上。
 * `atkPct / hpPct / defPct` 是按**基础面板**（角色+武器白值）折算的百分比加成，结算时由 `applyPanelModifiers` 换算；
 * `normalDmg`…`burstDmg` 是技能类型伤害加成（4 件套等静态效果直接加进 A 乘区）。
 */
export const PANEL_STAT_KEYS = ['hp', 'atk', 'def', 'mastery', 'cpct', 'cdmg', 'recharge', 'dmg', 'phy', 'heal', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro', 'normalDmg', 'chargedDmg', 'plungeDmg', 'skillDmg', 'burstDmg', 'normalCpct', 'chargedCpct', 'plungeCpct', 'skillCpct', 'burstCpct', 'atkPct', 'hpPct', 'defPct'] as const
export type PanelStatKey = typeof PANEL_STAT_KEYS[number]

/** 面板增量：最终面板值或按白值折算的百分比（pct 类需要调用方提供 base）。 */
export type PanelModifiers = Partial<Record<PanelStatKey, number>>

export interface EnemyModifiers {
  resistanceReduction: number
  defenseReduction: number
  defenseIgnore: number
  /** 分元素抗性削减：只对该元素的命中生效（翠绿之影、深林的记忆一类）。 */
  resistanceByElement?: Partial<Record<ElementKey, number>>
}

export const NO_ENEMY_MODIFIERS: EnemyModifiers = { resistanceReduction: 0, defenseReduction: 0, defenseIgnore: 0 }

/** 分元素抗性削减用的元素键；与命中元素保持一致（不含 clear）。 */
export const ELEMENT_KEYS = ['physical', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'] as const
export type ElementKey = typeof ELEMENT_KEYS[number]

/**
 * 反应加成：不进面板、只作用于月反应与星烁的结算乘区。
 * 多个效果同时生效时按加法叠加（与面板加成一致），层数照常相乘。
 */
export interface ReactionBonus {
  /** 专用反应加成（月曜反应伤害提升一类），加在等级系数上。 */
  fypct?: number
  /** 提升乘区。 */
  elevated?: number
  /** 反应系数乘区：这里按加法叠加，缺省视为 0（最终乘区 = 1 + 合计）。 */
  kNum?: number
  /** 按反应族的伤害加成（如雷 4 件套一类），剧变反应按 1 + 合计 放大。 */
  dmg?: Partial<Record<ReactiveKind | SpecialKind, number>>
}

export const NO_REACTION_BONUS: ReactionBonus = { fypct: 0, elevated: 0, kNum: 0 }

export type EffectTarget = 'self' | 'team' | 'enemy'
export type StackingPolicy = 'refresh' | 'stack' | 'ignore'

/**
 * 效果触发时机：动作起手（施放战技/爆发）、命中、岩元素伤害命中、后台自动计时。
 *
 * - `hit`：装备者任意命中（水仙之梦「镜中水仙」这类多来源共用池）；
 * - `normal-hit` / `charged-hit` / `plunge-hit` / `skill-hit`：按动作类型命中触发；
 * - `geo-hit`：命中元素为岩时触发（华馆「魄力」）；
 * - `off-field-tick`：角色不在场时每 `tickFrames` 帧触发一次（华馆后台叠层）；
 * - `always`：开局即生效、持续到窗口结束。配 `offFieldOnly` 就是「只在后台生效」的常驻效果
 *   （黄金剧团「处于队伍后台时再 +25%」）。
 * 命中类触发都可配 `icdFrames` 限制触发间隔。
 */
export type EffectTriggerKind =
  | 'cast-skill' | 'cast-burst'
  | 'hit' | 'normal-hit' | 'charged-hit' | 'plunge-hit' | 'skill-hit' | 'geo-hit'
  | 'particle' | 'reaction' | 'off-field-tick' | 'always' | 'energy-zero' | 'hp-change'
  | 'bond-change'
  | 'nightsoul-consume'
  | 'shard-pickup'

/** 允许配 `icdFrames` 的命中类触发 */
export const HIT_TRIGGER_KINDS: ReadonlyArray<EffectTriggerKind> = ['hit', 'normal-hit', 'charged-hit', 'plunge-hit', 'skill-hit', 'geo-hit']

export const EFFECT_TRIGGER_KINDS: ReadonlyArray<EffectTriggerKind> = [
  'cast-skill', 'cast-burst', 'hit', 'normal-hit', 'charged-hit', 'plunge-hit', 'skill-hit', 'geo-hit', 'particle', 'reaction', 'off-field-tick', 'always', 'energy-zero', 'hp-change', 'bond-change', 'nightsoul-consume', 'shard-pickup'
]

/**
 * 效果定义。`self` 与 `team` 加面板，`enemy` 减抗减防；两者互斥，避免「一个效果既加面板又减抗」这种口径不清的写法。
 * `durationFrames` 省略表示持续到测量窗口结束：不写到期时间就是一直有效，内核不会猜一个有限的默认值。
 * `trigger` 省略表示常驻（开局就生效）；写 `cast-skill` / `cast-burst` 时由时间轴在对应动作起手时激活。
 */
export interface EffectSpec {
  id: string
  target: EffectTarget
  stats?: PanelModifiers
  enemy?: { resistanceReduction?: number; defenseReduction?: number; defenseIgnore?: number; resistanceByElement?: Partial<Record<ElementKey, number>> }
  durationFrames?: number
  /** 重复触发时的策略，缺省 refresh（刷新到期时刻，不叠层）。 */
  stacking?: StackingPolicy
  /** 仅 `stacking: 'stack'` 可用：层数上限。 */
  maxStacks?: number
  /** 反应加成：只影响月反应与星烁的结算，不进面板。 */
  reactionBonus?: ReactionBonus
  /** 按反应族的伤害加成（剧变反应的等级系数按 1 + 合计 放大）。 */
  reactionDmg?: Partial<Record<ReactiveKind | SpecialKind, number>>
  /**
   * 只在这些反应族触发时激活（翠绿的扩散、血红的星扩散一类）。
   * 不写表示任何反应都触发；写了但本次反应不在列表里就不激活。
   */
  reactionKinds?: Array<ReactiveKind | SpecialKind>
  /** 触发时机；给定时不再常驻，只在对应动作起手被激活。 */
  trigger?: EffectTriggerKind
  /** 命中类触发的元素过滤：只在这些元素的命中上触发（深林的记忆一类）。 */
  hitElements?: ElementKey[]
  /**
   * 只在装备者处于队伍后台时计入（黄金剧团 4 件套的后台 +25%）。
   * 判定发生在命中结算当帧：命中者不是当前前台角色时视为后台。
   */
  offFieldOnly?: boolean
  /**
   * 只在敌人当前附着这些元素之一时计入（冰风迷途的勇士：攻击处于冰元素影响下的敌人）。
   * 判定在命中当帧：`simulated` 模式读附着状态机，`declared` 模式读该命中声明的反应光环。
   * 没有附着信息（两种模式都拿不到）时按不满足处理，不静默加算。
   */
  requiresEnemyAura?: ElementKey[]
  /**
   * 只在装备者当前生命值比例低于该值时计入（战狂：生命值低于 70% 时暴击率 +36%）。
   * 生命值比例由轴/调用方给出，内核不模拟敌人伤害，缺省按满血处理。
   */
  requiresHpBelow?: number
  /** 只在装备者当前生命值比例高于该值时计入。 */
  requiresHpAbove?: number
  /**
   * 只在装备者处于护盾庇护下时计入（逆飞的流星：护盾下普攻/重击 +40%）。
   * 护盾状态由调用方按帧声明（`shielded`），内核不模拟护盾吸收与破碎。
   */
  requiresShield?: boolean
  /**
   * 只在指定月相下计入（纺月/晨星/穹境：月兆初辉与满辉的数值不同）。
   * 月相由调用方声明，缺省 `initial`。
   */
  requiresMoonPhase?: 'initial' | 'full'
  /**
   * 元素动态增伤：触发时确定一个元素（反应光环 / 装备者元素），只加该元素的伤害。
   * 存的是「元素 + 数值 + 到期帧」，命中当帧按元素取用。
   */
  elementDmg?: { value: number; from: 'reaction-aura' | 'wearer-element' | 'shard-element' }
  /**
   * 元素定向减抗（翠绿之影）：触发时确定元素，只降低该元素的敌人抗性。
   * 与 `elementDmg` 同样按「触发当帧定元素 + 到期帧」取用。
   */
  resistanceShred?: { value: number; from: 'reaction-aura' | 'wearer-element' | 'shard-element' }
  /**
   * 按队伍元素构成给面板加成（饰金之梦：同元素队友每个 +14% 攻击、异元素队友每个 +50 精通）。
   * 触发当帧用 `elements` 计算一次，之后按到期帧生效；没有 `elements` 时按 0 计。
   */
  scalesWithTeamElements?: {
    same: { stat: 'atkPct'; value: number }
    different: { stat: 'mastery'; value: number }
  }
  /** 同一效果除主触发外还接受哪些触发（华馆：岩伤命中 + 后台计时共用同一个叠层池）。 */
  extraTriggers?: EffectTriggerKind[]
  /** 触发冷却（帧）：`geo-hit` 一类高频触发用，0.3 秒 = 18 帧。 */
  icdFrames?: number
  /** 后台计时间隔（帧）：`off-field-tick` 必填，3 秒 = 180 帧。 */
  tickFrames?: number
  /**
   * 按触发来源给不同层数（长夜之誓：下落 +1、重击 +2、战技 +2）。
   * 没写的来源按 1 层算。
   */
  stacksPerTrigger?: Partial<Record<EffectTriggerKind, number>>
  /**
   * 触发时消耗的能量（追忆之注连：施放战技时若能量 ≥15 则流失 15 点）。
   * 只对 `cast-skill` / `cast-burst` 有意义；能量不足时本次不触发，并记 `skipped: energy`。
   */
  energyCost?: number
  /**
   * 触发后回能（流放者：施放爆发后每 2 秒给全队回 2 点）。
   * `everyFrames + times` 表示按间隔补发几次；不写间隔就立刻补一次。
   */
  energyRestore?: {
    amount: number
    target: 'team' | 'self'
    excludeSelf?: boolean
    everyFrames?: number
    times?: number
  }
  /**
   * 命中时附加的固定基础伤害（来歆余响：普通攻击命中时按攻击力的 70% 加一段伤害）。
   * 数值 = `scaling` 对应的面板 × `ratio`，加进本发命中的基伤后再走防御/抗性/增伤/暴击。
   * 只能挂在命中类触发上；概率型效果由数据侧折算成期望值，内核不掷骰。
   */
  flatDamage?: {
    scaling: 'atk' | 'def' | 'hp' | 'mastery'
    ratio: number
  }
  /**
   * 记录队伍治疗量并折算成队伍伤害加成（昔时之歌：每记录 1000 点治疗量，队伍伤害 +3%，至多 +15%）。
   * 折算发生在命中当帧：时间轴累计治疗量后传入，内核不另存历史快照。
   */
  healRecord?: {
    /** 每多少点治疗量折算一档。 */
    perHeal: number
    /** 每档给多少增伤。 */
    ratio: number
    /** 增伤上限。 */
    max: number
  }
  /**
   * 治疗时生成海染泡沫（海染砗磲）：`delayFrames` 后按「治疗量 × ratio」造成一次固定伤害。
   * 泡沫伤害不吃面板增伤与暴击，仍走防御与抗性；`icdFrames` 是泡沫触发冷却。
   */
  healBubble?: {
    ratio: number
    delayFrames: number
    icdFrames?: number
  }
}

export interface TriggerRecord {
  frame: number
  actorId: string
  effectId: string
  stacks: number
  startsAt: number
  expiresAt: number
}

export interface ActiveEffectState {
  effectId: string
  target: EffectTarget
  /** `self` 只有触发者本人；`team` 是登记过的全部角色；`enemy` 为空数组。 */
  actorIds: string[]
  stacks: number
  startedAt: number
  expiresAt: number
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
const statKeySet = new Set<string>(PANEL_STAT_KEYS)

/** 校验单个效果定义。路径用 `effects.<键>`，与数据包里的键对齐。 */
export function validateEffectSpec(effect: unknown, key: string): Issue[] {
  const issues: Issue[] = []
  const p = `effects.${key}`
  const add = (code: Issue['code'], path: string, message: string) => issues.push({ code, path, message })
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return [{ code: 'invalid', path: p, message: '效果必须是对象' }]
  const spec = effect as Partial<EffectSpec>
  if (typeof spec.id !== 'string' || !spec.id.trim()) add('missing', `${p}.id`, '效果必须有稳定 id')
  else if (spec.id !== key) add('invalid', `${p}.id`, `效果 id 必须与键一致，收到 ${spec.id}`)
  if (spec.target !== 'self' && spec.target !== 'team' && spec.target !== 'enemy') add('unsupported', `${p}.target`, `未知作用对象 ${String(spec.target)}`)

  if (spec.stats !== undefined) {
    if (spec.target === 'enemy') add('invalid', `${p}.stats`, '作用于敌人的效果不能带面板加成：两者口径不同')
    else if (!spec.stats || typeof spec.stats !== 'object' || Array.isArray(spec.stats)) add('invalid', `${p}.stats`, '面板加成必须是对象')
    else {
      const entries = Object.entries(spec.stats)
      if (!entries.length) add('invalid', `${p}.stats`, '空面板加成没有意义，不需要这个效果就别写')
      for (const [stat, value] of entries) {
        if (!statKeySet.has(stat)) add('unsupported', `${p}.stats.${stat}`, `未知面板键 ${stat}：只能加 hp/atk/def/mastery/cpct/cdmg/recharge/dmg/phy/heal 与元素加成`)
        else if (!isFiniteNumber(value)) add('invalid', `${p}.stats.${stat}`, '面板增量必须是有限数值')
      }
    }
  } else if ((spec.target === 'self' || spec.target === 'team') && !spec.energyRestore && !spec.flatDamage && !spec.reactionDmg && !spec.healRecord && !spec.healBubble && !spec.elementDmg && !spec.resistanceShred && !spec.scalesWithTeamElements) {
    add('missing', `${p}.stats`, '作用于己方的效果必须给面板加成')
  }

  if (spec.enemy !== undefined) {
    if (spec.target !== 'enemy') add('invalid', `${p}.enemy`, '只有作用于敌人的效果才能削减抗性与防御')
    else if (!spec.enemy || typeof spec.enemy !== 'object' || Array.isArray(spec.enemy)) add('invalid', `${p}.enemy`, '敌人减益必须是对象')
    else {
      const entries = Object.entries(spec.enemy)
      if (!entries.length) add('invalid', `${p}.enemy`, '空敌人减益没有意义')
      for (const [field, value] of entries) {
        if (field === 'resistanceByElement') {
          if (!value || typeof value !== 'object' || Array.isArray(value)) add('invalid', `${p}.enemy.${field}`, '分元素减抗必须是元素到数值的映射')
          else for (const [element, amount] of Object.entries(value)) {
            if (!ELEMENT_KEYS.includes(element as ElementKey)) add('unsupported', `${p}.enemy.${field}.${element}`, `未知元素 ${element}`)
            else if (!isFiniteNumber(amount)) add('invalid', `${p}.enemy.${field}.${element}`, '减益必须是有限数值')
          }
          continue
        }
        if (!['resistanceReduction', 'defenseReduction', 'defenseIgnore'].includes(field)) add('unsupported', `${p}.enemy.${field}`, `未知敌人减益 ${field}`)
        else if (!isFiniteNumber(value)) add('invalid', `${p}.enemy.${field}`, '减益必须是有限数值')
      }
    }
  } else if (spec.target === 'enemy') {
    add('missing', `${p}.enemy`, '作用于敌人的效果必须给至少一项减益')
  }

  if (spec.durationFrames !== undefined && (!isInteger(spec.durationFrames) || spec.durationFrames <= 0)) add('invalid', `${p}.durationFrames`, '持续帧数必须是正整数；要一直有效就省略这个字段')
  if (spec.stacking !== undefined && !['refresh', 'stack', 'ignore'].includes(spec.stacking)) add('unsupported', `${p}.stacking`, `未知叠加策略 ${String(spec.stacking)}`)
  if (spec.trigger !== undefined && !EFFECT_TRIGGER_KINDS.includes(spec.trigger)) add('unsupported', `${p}.trigger`, `未知触发时机 ${String(spec.trigger)}`)
  if (spec.trigger !== undefined && spec.trigger !== 'always' && spec.trigger !== 'energy-zero' && spec.durationFrames === undefined) add('missing', `${p}.durationFrames`, '触发式效果必须给持续时间：常驻到窗口结束的那套写法只适用于开局即生效的效果')
  if (spec.offFieldOnly !== undefined && typeof spec.offFieldOnly !== 'boolean') add('invalid', `${p}.offFieldOnly`, '后台限定必须是布尔值')
  if (spec.trigger === 'always') {
    if (spec.icdFrames !== undefined) add('invalid', `${p}.icdFrames`, '常驻效果没有触发节奏，不需要触发冷却')
    if (spec.tickFrames !== undefined) add('invalid', `${p}.tickFrames`, '常驻效果没有计时触发，不需要计时间隔')
    if (spec.stacksPerTrigger !== undefined) add('invalid', `${p}.stacksPerTrigger`, '常驻效果不按触发叠层')
    if (spec.energyCost !== undefined) add('invalid', `${p}.energyCost`, '常驻效果不消耗能量')
    if (spec.energyRestore !== undefined) add('invalid', `${p}.energyRestore`, '常驻效果不按触发回能')
    if (spec.flatDamage !== undefined) add('invalid', `${p}.flatDamage`, '常驻效果不附加命中伤害')
  }
  if (spec.icdFrames !== undefined && (!isInteger(spec.icdFrames) || spec.icdFrames < 0)) add('invalid', `${p}.icdFrames`, '触发冷却必须是非负整数帧')
  if (spec.tickFrames !== undefined && (!isInteger(spec.tickFrames) || spec.tickFrames <= 0)) add('invalid', `${p}.tickFrames`, '计时间隔必须是正整数帧')
  if (spec.extraTriggers !== undefined) {
    if (!Array.isArray(spec.extraTriggers) || spec.extraTriggers.length === 0) add('invalid', `${p}.extraTriggers`, '附加触发必须是非空数组')
    else for (const [index, kind] of spec.extraTriggers.entries()) {
      if (!EFFECT_TRIGGER_KINDS.includes(kind)) add('unsupported', `${p}.extraTriggers.${index}`, `未知触发时机 ${String(kind)}`)
    }
  }
  const allTriggers = [spec.trigger, ...(spec.extraTriggers ?? [])].filter((kind): kind is EffectTriggerKind => Boolean(kind))
  if (allTriggers.includes('off-field-tick') && spec.tickFrames === undefined) add('missing', `${p}.tickFrames`, '后台计时触发必须给计时间隔')
  if (!allTriggers.includes('off-field-tick') && spec.tickFrames !== undefined) add('invalid', `${p}.tickFrames`, '只有后台计时触发才需要计时间隔')
  if (spec.hitElements !== undefined) {
    if (!allTriggers.some(kind => HIT_TRIGGER_KINDS.includes(kind))) add('invalid', `${p}.hitElements`, '只有命中类触发才能按元素过滤')
    else if (!Array.isArray(spec.hitElements) || !spec.hitElements.length) add('invalid', `${p}.hitElements`, '元素过滤必须是非空数组')
    else for (const element of spec.hitElements) if (!ELEMENT_KEYS.includes(element)) add('unsupported', `${p}.hitElements`, `未知元素 ${String(element)}`)
  }
  for (const key of ['requiresHpBelow', 'requiresHpAbove'] as const) {
    const value = spec[key]
    if (value === undefined) continue
    if (!isFiniteNumber(value) || value <= 0 || value > 1) add('invalid', `${p}.${key}`, '生命值比例必须是 (0, 1] 的有限数')
  }
  if (spec.requiresShield !== undefined && typeof spec.requiresShield !== 'boolean') add('invalid', `${p}.requiresShield`, '护盾条件必须是布尔值')
  if (spec.reactionKinds !== undefined) {
    if (!Array.isArray(spec.reactionKinds) || !spec.reactionKinds.length) add('invalid', `${p}.reactionKinds`, '反应族过滤必须是非空数组')
    else for (const kind of spec.reactionKinds) if (!(kind in REACTIONS) && !isSpecialKind(kind)) add('unsupported', `${p}.reactionKinds`, `未知反应族 ${String(kind)}`)
  }
  if (spec.requiresMoonPhase !== undefined && spec.requiresMoonPhase !== 'initial' && spec.requiresMoonPhase !== 'full') add('unsupported', `${p}.requiresMoonPhase`, '月相只能是 initial 或 full')
  if (spec.resistanceShred !== undefined) {
    const s = spec.resistanceShred
    if (!s || typeof s !== 'object' || Array.isArray(s)) add('invalid', `${p}.resistanceShred`, '元素定向减抗必须是对象')
    else {
      if (!isFiniteNumber(s.value) || s.value <= 0) add('invalid', `${p}.resistanceShred.value`, '减抗数值必须是正有限数')
      if (!['reaction-aura', 'wearer-element', 'shard-element'].includes(String(s.from))) add('unsupported', `${p}.resistanceShred.from`, '减抗元素来源只能是 reaction-aura / wearer-element / shard-element')
    }
  }
  if (spec.scalesWithTeamElements !== undefined) {
    const s = spec.scalesWithTeamElements
    if (!s || typeof s !== 'object' || Array.isArray(s)) add('invalid', `${p}.scalesWithTeamElements`, '队伍元素计数必须是对象')
    else {
      if (!isFiniteNumber(s.same?.value) || s.same.value <= 0) add('invalid', `${p}.scalesWithTeamElements.same.value`, '同元素队友加成必须是正有限数')
      if (!isFiniteNumber(s.different?.value) || s.different.value <= 0) add('invalid', `${p}.scalesWithTeamElements.different.value`, '异元素队友加成必须是正有限数')
    }
  }
  if (spec.elementDmg !== undefined) {
    if (!spec.elementDmg || typeof spec.elementDmg !== 'object') add('invalid', `${p}.elementDmg`, '元素动态增伤必须是对象')
    else {
      if (!isFiniteNumber(spec.elementDmg.value) || spec.elementDmg.value <= 0) add('invalid', `${p}.elementDmg.value`, '元素动态增伤数值必须是正有限数')
      if (!['reaction-aura', 'wearer-element', 'shard-element'].includes(spec.elementDmg.from)) add('unsupported', `${p}.elementDmg.from`, '元素来源只能是 reaction-aura / wearer-element / shard-element')
    }
  }
  if (spec.requiresEnemyAura !== undefined) {
    if (!Array.isArray(spec.requiresEnemyAura) || !spec.requiresEnemyAura.length) add('invalid', `${p}.requiresEnemyAura`, '敌人附着条件必须是非空数组')
    else for (const element of spec.requiresEnemyAura) if (!ELEMENT_KEYS.includes(element)) add('unsupported', `${p}.requiresEnemyAura`, `未知元素 ${String(element)}`)
  }
  if (!allTriggers.some(kind => HIT_TRIGGER_KINDS.includes(kind)) && !allTriggers.includes('particle') && !allTriggers.includes('reaction') && spec.icdFrames !== undefined) add('invalid', `${p}.icdFrames`, '只有命中类、产球与反应触发才需要触发冷却')
  if (spec.stacking === 'stack') {
    if (!isInteger(spec.maxStacks) || spec.maxStacks <= 0) add('invalid', `${p}.maxStacks`, '叠层策略必须给出正整数层数上限')
  } else if (spec.maxStacks !== undefined) {
    add('invalid', `${p}.maxStacks`, '只有叠层策略才需要层数上限，其余策略写上限会被静默忽略')
  }
  if (spec.stacksPerTrigger !== undefined) {
    if (!isInteger(spec.maxStacks) || spec.stacking !== 'stack') add('invalid', `${p}.stacksPerTrigger`, '按来源给层数只对叠层策略有意义')
    else if (!spec.stacksPerTrigger || typeof spec.stacksPerTrigger !== 'object' || Array.isArray(spec.stacksPerTrigger)) add('invalid', `${p}.stacksPerTrigger`, '按来源给层数必须是对象')
    else for (const [kind, amount] of Object.entries(spec.stacksPerTrigger)) {
      if (!EFFECT_TRIGGER_KINDS.includes(kind as EffectTriggerKind)) add('unsupported', `${p}.stacksPerTrigger.${kind}`, `未知触发时机 ${kind}`)
      else if (!allTriggers.includes(kind as EffectTriggerKind)) add('invalid', `${p}.stacksPerTrigger.${kind}`, `来源 ${kind} 不在这个效果的触发列表里`)
      else if (!isInteger(amount) || amount <= 0) add('invalid', `${p}.stacksPerTrigger.${kind}`, '每层数必须是正整数')
    }
  }
  if (spec.energyCost !== undefined) {
    if (!isInteger(spec.energyCost) || spec.energyCost <= 0) add('invalid', `${p}.energyCost`, '触发消耗必须是正整数能量')
    else if (!allTriggers.some(kind => kind === 'cast-skill' || kind === 'cast-burst')) add('invalid', `${p}.energyCost`, '消耗能量只适用于起手触发（cast-skill / cast-burst）')
  }
  if (spec.energyRestore !== undefined) {
    const r = spec.energyRestore
    if (!r || typeof r !== 'object' || Array.isArray(r)) add('invalid', `${p}.energyRestore`, '回能必须是对象')
    else {
      if (!isFiniteNumber(r.amount) || r.amount <= 0) add('invalid', `${p}.energyRestore.amount`, '回能量必须是正数')
      if (r.target !== 'team' && r.target !== 'self') add('unsupported', `${p}.energyRestore.target`, `未知回能对象 ${String(r.target)}`)
      if (r.excludeSelf !== undefined && typeof r.excludeSelf !== 'boolean') add('invalid', `${p}.energyRestore.excludeSelf`, 'excludeSelf 必须是布尔值')
      if (r.everyFrames !== undefined && (!isInteger(r.everyFrames) || r.everyFrames <= 0)) add('invalid', `${p}.energyRestore.everyFrames`, '回能间隔必须是正整数帧')
      if (r.times !== undefined && (!isInteger(r.times) || r.times <= 0)) add('invalid', `${p}.energyRestore.times`, '回能次数必须是正整数')
      if (r.everyFrames !== undefined && r.times === undefined) add('missing', `${p}.energyRestore.times`, '按间隔回能必须给次数')
      if (r.times !== undefined && r.everyFrames === undefined) add('missing', `${p}.energyRestore.everyFrames`, '多次回能必须给间隔')
    }
  }
  if (spec.flatDamage !== undefined) {
    const f = spec.flatDamage
    if (!f || typeof f !== 'object' || Array.isArray(f)) add('invalid', `${p}.flatDamage`, '固定值伤害必须是对象')
    else {
      if (!['atk', 'def', 'hp', 'mastery'].includes(String(f.scaling))) add('unsupported', `${p}.flatDamage.scaling`, `未知折算属性 ${String(f.scaling)}`)
      if (!isFiniteNumber(f.ratio) || f.ratio <= 0) add('invalid', `${p}.flatDamage.ratio`, '固定值伤害倍率必须是正数')
      if (!allTriggers.some(kind => HIT_TRIGGER_KINDS.includes(kind))) add('invalid', `${p}.flatDamage`, '固定值伤害只能挂在命中类触发上')
    }
  }
  if (spec.healRecord !== undefined) {
    const r = spec.healRecord
    if (!r || typeof r !== 'object' || Array.isArray(r)) add('invalid', `${p}.healRecord`, '治疗量折算必须是对象')
    else {
      if (!isFiniteNumber(r.perHeal) || r.perHeal <= 0) add('invalid', `${p}.healRecord.perHeal`, '每档治疗量必须是正数')
      if (!isFiniteNumber(r.ratio) || r.ratio <= 0) add('invalid', `${p}.healRecord.ratio`, '每档增伤必须是正数')
      if (!isFiniteNumber(r.max) || r.max <= 0) add('invalid', `${p}.healRecord.max`, '增伤上限必须是正数')
      if (isFiniteNumber(r.max) && isFiniteNumber(r.ratio) && r.max < r.ratio) add('invalid', `${p}.healRecord.max`, '增伤上限小于一档增量，永远不会按上限截断')
    }
  }
  if (spec.healBubble !== undefined) {
    const b = spec.healBubble
    if (!b || typeof b !== 'object' || Array.isArray(b)) add('invalid', `${p}.healBubble`, '海染泡沫必须是对象')
    else {
      if (!isFiniteNumber(b.ratio) || b.ratio <= 0) add('invalid', `${p}.healBubble.ratio`, '泡沫倍率必须是正数')
      if (!isInteger(b.delayFrames) || b.delayFrames < 0) add('invalid', `${p}.healBubble.delayFrames`, '泡沫延迟必须是非负整数帧')
      if (b.icdFrames !== undefined && (!isInteger(b.icdFrames) || b.icdFrames < 0)) add('invalid', `${p}.healBubble.icdFrames`, '泡沫冷却必须是非负整数帧')
    }
  }
  return issues
}

export function validateEffects(effects: unknown): Issue[] {
  if (effects === undefined) return []
  if (!effects || typeof effects !== 'object' || Array.isArray(effects)) return [{ code: 'invalid', path: 'effects', message: '效果表必须是对象' }]
  const issues: Issue[] = []
  for (const [key, effect] of Object.entries(effects)) issues.push(...validateEffectSpec(effect, key))
  return issues
}

interface Entry {
  spec: EffectSpec
  key: string
  actorId?: string
  stacks: number
  startedAt: number
  expiresAt: number
}

export interface EffectRuntime {
  /** 效果是否登记在表里；未登记时由调用方报 unsupported，而不是在这里静默忽略。 */
  has(effectId: string): boolean
  /** 取效果定义（触发冷却、计时间隔等在时间轴侧读取）。 */
  specOf(effectId: string): EffectSpec | undefined
  /** 在 `frame` 帧由 `actorId` 触发，返回本次实际生效的记录；叠层已满或 ignore 命中时返回 undefined。 */
  trigger(effectId: string, frame: number, actorId: string, amount?: number): TriggerRecord | undefined
  /**
   * 该角色在该帧实际吃的面板增量、全局敌人减益与反应加成。
   * `options.offField` 表示该角色当帧是否在后台：`offFieldOnly` 的效果只在后台计入。
   * `options.enemyAura` 表示敌人当帧附着的元素：`requiresEnemyAura` 的效果按它过滤。
   * `options.healingTotal` 是截至该帧的累计治疗量：`healRecord` 的效果按它折算增伤。
   */
  modifiersAt(actorId: string, frame: number, options?: { offField?: boolean; enemyAura?: ElementKey | null; hpRatio?: number; healingTotal?: number; hasShield?: boolean; moonPhase?: 'initial' | 'full' }): { stats: PanelModifiers; enemy: EnemyModifiers; reaction: ReactionBonus }
  /**
   * 该效果在该帧的层数；没生效返回 0。
   * 月反应与星烁的叠层计数由这里读，引擎不猜「命中几次就该几层」。
   */
  stacksAt(effectId: string, actorId: string, frame: number): number
  /**
   * 该角色在该帧「在场」的效果 id，按字典序排好。
   * 只回答谁在场，不回答谁贡献了多少伤害——连续乘区下把总伤按来源拆账需要反事实重算，P0/P1 不做。
   */
  activeAt(actorId: string, frame: number): string[]
  /**
   * 卡肉冻结：`frame` 帧之后的一切顺延 `delta` 帧。仍在生效的到期时间（以及对应触发记录里的到期帧）
   * 一起后移，所以冻结期间效果不流逝。
   */
  shiftAfter(frame: number, delta: number): void
  snapshot(): ActiveEffectState[]
}

/**
 * 创建一个按帧查询的效果运行时。`endFrame` 只用来把「持续到窗口结束」展开成有限的到期帧，
 * 好让结果里能直接读出到期时刻，而不是留一个 Infinity 让调用方自己解释。
 */
export function createEffectRuntime(effects: Record<string, EffectSpec> | undefined, actorIds: string[], endFrame: number): EffectRuntime {
  const table = effects ?? {}
  const entries = new Map<string, Entry>()
  const triggers: TriggerRecord[] = []

  const expiryOf = (spec: EffectSpec, frame: number): number => frame + (spec.durationFrames ?? Math.max(1, endFrame - frame + 1))
  const entryKey = (spec: EffectSpec, actorId: string): string => spec.target === 'self' ? `${spec.id}@${actorId}` : spec.id

  return {
    has: effectId => Object.prototype.hasOwnProperty.call(table, effectId),
    specOf: effectId => table[effectId],
    trigger(effectId, frame, actorId, amount = 1) {
      const spec = table[effectId]
      if (!spec) return undefined
      const key = entryKey(spec, actorId)
      const expiresAt = expiryOf(spec, frame)
      const existing = entries.get(key)
      const policy: StackingPolicy = spec.stacking ?? 'refresh'
      const gain = Math.max(1, Math.trunc(amount))
      const cap = spec.maxStacks ?? 1
      // 旧记录已经到期就按新状态重来：否则叠层会带着上一轮的层数与起点继续累，层数封顶后永远回不到 1。
      if (existing && frame >= existing.expiresAt) entries.delete(key)
      const live = entries.get(key)
      if (live) {
        if (policy === 'ignore') return undefined
        if (policy === 'stack') {
          live.stacks = Math.min(cap, live.stacks + gain)
          live.expiresAt = expiresAt
        } else {
          live.stacks = 1
          live.expiresAt = expiresAt
        }
        const record: TriggerRecord = { frame, actorId, effectId, stacks: live.stacks, startsAt: live.startedAt, expiresAt: live.expiresAt }
        triggers.push(record)
        return record
      }
      const entry: Entry = { spec, key, actorId: spec.target === 'self' ? actorId : undefined, stacks: Math.min(cap, gain), startedAt: frame, expiresAt }
      entries.set(key, entry)
      const record: TriggerRecord = { frame, actorId, effectId, stacks: entry.stacks, startsAt: frame, expiresAt }
      triggers.push(record)
      return record
    },
    modifiersAt(actorId, frame, options) {
      const stats: PanelModifiers = {}
      const enemy: EnemyModifiers = { ...NO_ENEMY_MODIFIERS }
      const reaction: ReactionBonus = { ...NO_REACTION_BONUS }
      for (const entry of entries.values()) {
        if (frame >= entry.expiresAt) continue
        const { spec } = entry
        if (spec.offFieldOnly && !options?.offField) continue
        // 敌人附着条件（冰风迷途的勇士一类）：拿不到附着或元素不符时整条跳过。
        if (spec.requiresEnemyAura && !(options?.enemyAura && spec.requiresEnemyAura.includes(options.enemyAura))) continue
        // 生命值条件（战狂）：比例由调用方给，缺省满血。
        if (spec.requiresHpBelow !== undefined && !((options?.hpRatio ?? 1) < spec.requiresHpBelow)) continue
        if (spec.requiresHpAbove !== undefined && !((options?.hpRatio ?? 1) > spec.requiresHpAbove)) continue
        // 护盾条件（逆飞的流星）：护盾状态由调用方按帧声明，缺省按无盾处理。
        if (spec.requiresShield && !options?.hasShield) continue
    if (spec.requiresMoonPhase && (options?.moonPhase ?? 'initial') !== spec.requiresMoonPhase) continue
        if (spec.target === 'enemy') {
          const mods = spec.enemy ?? {}
          enemy.resistanceReduction += (mods.resistanceReduction ?? 0) * entry.stacks
          enemy.defenseReduction += (mods.defenseReduction ?? 0) * entry.stacks
          enemy.defenseIgnore += (mods.defenseIgnore ?? 0) * entry.stacks
          for (const [element, amount] of Object.entries(mods.resistanceByElement ?? {})) {
            const key = element as ElementKey
            enemy.resistanceByElement = { ...(enemy.resistanceByElement ?? {}), [key]: (enemy.resistanceByElement?.[key] ?? 0) + (amount ?? 0) * entry.stacks }
          }
          continue
        }
        if (spec.target === 'self' && entry.actorId !== actorId) continue
        for (const [key, value] of Object.entries(spec.stats ?? {})) {
          const stat = key as PanelStatKey
          stats[stat] = (stats[stat] ?? 0) + value * entry.stacks
        }
        // 治疗量折算（昔时之歌）：按截至当帧的累计治疗量给「伤害加成」，封顶 max。
        if (spec.healRecord) {
          const total = options?.healingTotal ?? 0
          const stacks = total > 0 ? Math.floor(total / spec.healRecord.perHeal) : 0
          if (stacks > 0) {
            const bonus = Math.min(spec.healRecord.max, stacks * spec.healRecord.ratio)
            stats.dmg = (stats.dmg ?? 0) + bonus * entry.stacks
          }
        }
        if (spec.reactionDmg) {
          reaction.dmg = { ...(reaction.dmg ?? {}) }
          for (const [kind, value] of Object.entries(spec.reactionDmg)) {
            const key = kind as ReactiveKind
            reaction.dmg[key] = (reaction.dmg[key] ?? 0) + (value ?? 0) * entry.stacks
          }
        }
        const bonus = spec.reactionBonus
        if (bonus) {
          reaction.fypct = (reaction.fypct ?? 0) + (bonus.fypct ?? 0) * entry.stacks
          reaction.elevated = (reaction.elevated ?? 0) + (bonus.elevated ?? 0) * entry.stacks
          reaction.kNum = (reaction.kNum ?? 0) + (bonus.kNum ?? 0) * entry.stacks
        }
      }
      return { stats, enemy, reaction }
    },
    stacksAt(effectId, actorId, frame) {
      const spec = table[effectId]
      if (!spec) return 0
      const entry = entries.get(entryKey(spec, actorId))
      if (!entry || frame >= entry.expiresAt) return 0
      return entry.stacks
    },
    activeAt(actorId, frame) {
      const ids = new Set<string>()
      for (const entry of entries.values()) {
        if (frame >= entry.expiresAt) continue
        const { spec } = entry
        if (spec.target === 'self' && entry.actorId !== actorId) continue
        ids.add(spec.id)
      }
      return [...ids].sort()
    },
    shiftAfter(frame, delta) {
      if (delta <= 0) return
      for (const entry of entries.values()) if (entry.expiresAt > frame) entry.expiresAt += delta
      for (const record of triggers) if (record.expiresAt > frame) record.expiresAt += delta
    },
    snapshot() {
      return [...entries.values()].map(entry => ({
        effectId: entry.spec.id,
        target: entry.spec.target,
        actorIds: entry.spec.target === 'self' ? [entry.actorId as string] : entry.spec.target === 'team' ? [...actorIds] : [],
        stacks: entry.stacks,
        startedAt: entry.startedAt,
        expiresAt: entry.expiresAt
      }))
    }
  }
}

/** 基础面板（角色+武器白值）：`atkPct` 一类百分比按它折算；不给就说明调用方没建模这部分。 */
export interface PanelBase {
  hp: number
  atk: number
  def: number
}

/**
 * 把面板增量加到一个已算好的面板上，返回新对象；不改调用方那份。
 *
 * `atkPct / hpPct / defPct` 按 `base` 折算成点数；`base` 缺省时这三项记 0，
 * 但调用方（hitDamage）会先校验、缺 base 直接报错，不会静默少算。
 */
export function applyPanelModifiers(stats: PermanentStats, modifiers: PanelModifiers | undefined, base?: PanelBase): PermanentStats {
  if (!modifiers) return { ...stats }
  const merged: PermanentStats = { ...stats }
  for (const [key, value] of Object.entries(modifiers)) {
    if (key === 'atkPct') { merged.atk += (base?.atk ?? 0) * value; continue }
    if (key === 'hpPct') { merged.hp += (base?.hp ?? 0) * value; continue }
    if (key === 'defPct') { merged.def += (base?.def ?? 0) * value; continue }
    // 可选键（技能类型加成/暴击）在面板里可能没有初始化，先按 0 起算，避免 undefined + x = NaN。
    merged[key as Exclude<PanelStatKey, 'atkPct' | 'hpPct' | 'defPct'>] =
      (merged[key as Exclude<PanelStatKey, 'atkPct' | 'hpPct' | 'defPct'>] ?? 0) + value
  }
  return merged
}
