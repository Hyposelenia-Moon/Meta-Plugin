import type { Failure, Issue, OrdinaryDamageResult, OrdinaryHit, PermanentStats } from './types.js'
import { calculateOrdinaryHit, resistanceMultiplier, TARGET_PRESETS } from './formula.js'
import { applyPanelModifiers, type EnemyModifiers, type PanelBase, type PanelModifiers, type ReactionBonus } from './effects.js'
import type { FlatBaseBonus, ReactionDeclaration, TimelineHit, TimelineResult } from './timeline.js'
import type { MechanismPlan, StatWindow, EnemyWindow } from './mechanisms.js'
import {
  isReactiveKind,
  isSpecialKind,
  reactionClass,
  reactionCoefficient,
  specialMasteryFactor,
  specialMultiplier,
  transformativeBase,
  type ReactiveKind,
  type SpecialKind
} from './reactions.js'

export type CritPolicy = 'expected' | 'critical' | 'non-critical'

/**
 * 队伍减益：调用方传入的常驻减益。P1 的减防/减抗来源必须走机制窗口（钟离护盾），
 * 这里仍要求显式传 0，非 0 一律拒绝——避免有人把未建模的数值直接塞进这一层。
 */
export interface DamageDebuffs {
  defenseReduction: number
  defenseIgnore: number
  resistanceReduction: number
}

export interface DamageContext {
  /** 角色等级，参与防御区计算；必须与算面板时用的等级一致。 */
  level: number
  stats: PermanentStats
  /**
   * 基础面板（角色+武器白值）：`atkPct / hpPct / defPct` 一类百分比增量按它折算。
   * 不提供时只允许面板增量里出现最终值；出现百分比会直接报错，不静默少算。
   */
  base?: PanelBase
  /** 只接受 TARGET_PRESETS 里的只读目标口径。 */
  targetPresetId: string
  crit: CritPolicy
  gameVersion: string
  source: string
  debuffs: DamageDebuffs
}

export interface DamageRow {
  frame: number
  actorId: string
  actionId: string
  hitIndex: number
  element: TimelineHit['element']
  scaling: TimelineHit['scaling']
  motionValue: number
  damage: number
  /** `action`：动作自带的命中；`summon`：召唤物在结算层展开的命中；`reaction`：剧变反应额外的一段。 */
  origin: 'action' | 'summon' | 'reaction'
  /**
   * 这一发结算时「在场」的效果与机制窗口 id，按字典序。
   * 只说明谁在场，不说明谁贡献了多少伤害：连续乘区下要拆账得做反事实重算，P1 不做。
   */
  effects: string[]
  /** 这一发的元素反应：`damage` 是本条记录里反应贡献的那部分；剧变反应单独成行。 */
  reaction?: { kind: string; damage: number }
}

export type TimelineDamageResult = {
  status: 'calculated'
  scope: 'timeline-damage-no-reaction' | 'timeline-damage-with-reaction'
  simulationReady: false
  total: number
  rows: DamageRow[]
  perActor: Record<string, number>
  perAction: Record<string, number>
  target: { id: string; level: number; resistance: number }
  gameVersion: string
  source: string
  issues: Issue[]
} | Failure

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 命中类型（来自动作 id）：技能类型伤害加成按它取键。 */
type DamageKind = 'normal' | 'charged' | 'plunge' | 'skill' | 'burst'

const DAMAGE_KIND_BONUS: Record<DamageKind, keyof PermanentStats> = {
  normal: 'normalDmg',
  charged: 'chargedDmg',
  plunge: 'plungeDmg',
  skill: 'skillDmg',
  burst: 'burstDmg'
}

/** 技能类型暴击率：与 `cpct` 加算（行者之心「重击的暴击率 +30%」这类）。 */
const DAMAGE_KIND_CRIT: Record<DamageKind, keyof PermanentStats> = {
  normal: 'normalCpct',
  charged: 'chargedCpct',
  plunge: 'plungeCpct',
  skill: 'skillCpct',
  burst: 'burstCpct'
}

function critRateFor (stats: PermanentStats, kind: DamageKind | null): number {
  const base = Number(stats.cpct ?? 0)
  if (!kind) return base
  return base + Number(stats[DAMAGE_KIND_CRIT[kind]] ?? 0)
}

/** 动作 id 形如 `itto.normal-1` / `itto.charged-1` / `bennett.skill` / `bennett.burst`。 */
function damageKindOf (actionId: string): DamageKind | null {
  if (/\.normal(?:-|$)/.test(actionId)) return 'normal'
  if (/\.charged(?:-|$)/.test(actionId)) return 'charged'
  if (/\.plunge(?:-|$)/.test(actionId)) return 'plunge'
  if (/\.skill$/.test(actionId)) return 'skill'
  if (/\.burst$/.test(actionId)) return 'burst'
  return null
}

/** 元素命中只读该元素的加成键，物理命中只读物理键；`dmg` 是通用元素伤害加成。 */
function damageBonusFor (element: TimelineHit['element'], stats: PermanentStats, kind: DamageKind | null): number {
  const base = element === 'physical' ? stats.phy : stats.dmg + stats[element]
  if (!kind) return base
  // 4 件套这类「普攻/重击/战技/爆发伤害 +X%」直接加算进 A 乘区。
  return base + Number(stats[DAMAGE_KIND_BONUS[kind]] ?? 0)
}

function statFor(scaling: TimelineHit['scaling'] | 'mastery', stats: PermanentStats): number {
  if (scaling === 'mastery') return stats.mastery
  return scaling === 'atk' ? stats.atk : scaling === 'hp' ? stats.hp : stats.def
}

function windowStats(plan: MechanismPlan | undefined, actorId: string, frame: number): StatWindow[] {
  if (!plan) return []
  return plan.statWindows.filter(window => window.actorId === actorId && frame >= window.fromFrame && frame < window.toFrame)
}

function windowEnemies(plan: MechanismPlan | undefined, frame: number): EnemyWindow[] {
  if (!plan) return []
  return plan.enemyWindows.filter(window => frame >= window.fromFrame && frame < window.toFrame)
}

/** 把当帧的面板增量与机制窗口叠加成一份新对象，不改动调用方的面板。 */
function mergedStats(base: PanelModifiers, extra: PanelModifiers[]): PanelModifiers {
  const out: PanelModifiers = { ...base }
  for (const delta of extra) {
    for (const [key, value] of Object.entries(delta) as [keyof PanelModifiers, number][]) {
      if (typeof value !== 'number') continue
      out[key] = (out[key] ?? 0) + value
    }
  }
  return out
}

function mergedEnemy(base: EnemyModifiers, extra: EnemyModifiers[]): EnemyModifiers {
  const out: EnemyModifiers = { ...base }
  for (const delta of extra) {
    out.resistanceReduction += delta.resistanceReduction
    out.defenseReduction += delta.defenseReduction
    out.defenseIgnore += delta.defenseIgnore
    for (const [element, amount] of Object.entries(delta.resistanceByElement ?? {})) {
      const key = element as keyof NonNullable<EnemyModifiers['resistanceByElement']>
      out.resistanceByElement = { ...(out.resistanceByElement ?? {}), [key]: (out.resistanceByElement?.[key] ?? 0) + (amount ?? 0) }
    }
  }
  return out
}

/** 当帧在场的 id：效果表里触发的效果 + 机制层按帧开出的窗口，去重排序。 */
function activeIds(plan: MechanismPlan | undefined, actorId: string, frame: number, effects: string[] | undefined): string[] {
  const ids = new Set<string>(effects ?? [])
  // 机制窗口的 id 带实例后缀（同一来源可以开多个窗口），归因用来源名，同一来源只算一项。
  for (const window of windowStats(plan, actorId, frame)) ids.add(window.source)
  for (const window of windowEnemies(plan, frame)) ids.add(window.source)
  return [...ids].sort()
}

function validateContext(context: DamageContext | undefined, prefix: string): Issue[] {
  const issues: Issue[] = []
  const add = (code: Issue['code'], path: string, message: string) => issues.push({ code, path, message })
  if (!context || typeof context !== 'object') return [{ code: 'missing', path: prefix, message: '伤害上下文缺失' }]
  if (!Number.isInteger(context.level) || context.level < 1) add('invalid', `${prefix}.level`, '等级必须是正整数')
  if (!['expected', 'critical', 'non-critical'].includes(context.crit)) add('unsupported', `${prefix}.crit`, `未知暴击口径 ${String(context.crit)}`)
  for (const key of ['gameVersion', 'source'] as const) {
    const value = context[key]
    if (typeof value !== 'string' || !value.trim()) add('invalid', `${prefix}.${key}`, '必须是非空字符串')
  }
  if (typeof context.targetPresetId !== 'string' || !TARGET_PRESETS[context.targetPresetId]) add('unsupported', `${prefix}.targetPresetId`, `不支持的测试目标 ${String(context.targetPresetId)}`)
  const stats = context.stats
  if (!stats || typeof stats !== 'object') add('missing', `${prefix}.stats`, '必须提供已算好的永久面板')
  else {
    for (const key of ['hp', 'atk', 'def', 'cpct', 'cdmg', 'dmg', 'phy', 'geo'] as const) {
      if (!isFiniteNumber(stats[key]) || stats[key] < 0) add('invalid', `${prefix}.stats.${key}`, '面板数值必须是非负有限值')
    }
  }
  const debuffs = context.debuffs
  if (!debuffs || typeof debuffs !== 'object') add('missing', `${prefix}.debuffs`, '必须显式提供队伍减益，P1 传 0')
  else {
    for (const key of ['defenseReduction', 'defenseIgnore', 'resistanceReduction'] as const) {
      if (!isFiniteNumber(debuffs[key])) add('missing', `${prefix}.debuffs.${key}`, '必须显式给出数值，P1 传 0')
      else if (debuffs[key] !== 0) add('unsupported', `${prefix}.debuffs.${key}`, 'P1 没有建模常驻队伍减防/减抗，减益必须走机制窗口')
    }
  }
  if (context.base !== undefined) {
    if (!context.base || typeof context.base !== 'object') add('invalid', `${prefix}.base`, '基础面板必须是对象')
    else {
      for (const key of ['hp', 'atk', 'def'] as const) {
        if (!isFiniteNumber(context.base[key]) || context.base[key] < 0) add('invalid', `${prefix}.base.${key}`, '基础面板数值必须是非负有限值')
      }
    }
  }
  return issues
}

/**
 * 把时间内核排出的每段命中接到普通直伤公式上。
 * 只做映射与汇总：倍率乘哪一项面板、元素加成读哪个键、目标口径与减益全部来自显式输入。
 * 面板按 actorId 分开取，四人队每人的面板不能混用；机制窗口按帧叠加，召唤物命中在同一层展开。
 */
export function calculateTimelineDamage(input: { timeline: TimelineResult; contexts: Record<string, DamageContext>; plan?: MechanismPlan }): TimelineDamageResult {
  if (!input || typeof input !== 'object') return { status: 'invalid', issues: [{ code: 'invalid', path: 'input', message: '输入必须是对象' }] }
  const timeline = input.timeline
  if (!timeline || typeof timeline !== 'object' || !Array.isArray(timeline.hits)) {
    return { status: 'invalid', issues: [{ code: 'missing', path: 'timeline', message: '必须先跑时间内核' }] }
  }
  if (timeline.status !== 'simulated') {
    return { status: 'invalid', issues: timeline.issues?.length ? timeline.issues : [{ code: 'invalid', path: 'timeline.status', message: '时间内核没有排出可结算的轴' }] }
  }
  const contexts = input.contexts
  if (!contexts || typeof contexts !== 'object' || Array.isArray(contexts) || !Object.keys(contexts).length) {
    return { status: 'incomplete', issues: [{ code: 'missing', path: 'contexts', message: '必须按 actorId 提供每个出手角色的面板' }] }
  }
  const issues: Issue[] = []
  for (const [actorId, context] of Object.entries(contexts)) issues.push(...validateContext(context, `contexts.${actorId}`))
  if (!issues.length) {
    // 同一次模拟必须使用同一版本、同一目标与同一减益口径，否则汇总出来的总数没有意义。
    const [firstId, first] = Object.entries(contexts)[0]
    for (const [actorId, context] of Object.entries(contexts)) {
      if (context.gameVersion !== first.gameVersion || context.source !== first.source) issues.push({ code: 'invalid', path: `contexts.${actorId}`, message: `版本与来源必须与 ${firstId} 一致` })
      if (context.targetPresetId !== first.targetPresetId) issues.push({ code: 'invalid', path: `contexts.${actorId}.targetPresetId`, message: `目标口径必须与 ${firstId} 一致` })
      if (JSON.stringify(context.debuffs) !== JSON.stringify(first.debuffs)) issues.push({ code: 'invalid', path: `contexts.${actorId}.debuffs`, message: `队伍减益必须与 ${firstId} 一致` })
    }
  }
  if (issues.length) return { status: issues.some(i => i.code === 'unsupported') ? 'unsupported' : issues.some(i => i.code === 'invalid') ? 'invalid' : 'incomplete', issues }
  const anchor = Object.values(contexts)[0]
  const preset = TARGET_PRESETS[anchor.targetPresetId]
  const plan = input.plan
  const rows: DamageRow[] = []
  const perActor: Record<string, number> = {}
  const perAction: Record<string, number> = {}
  let total = 0

  const settle = (options: {
    frame: number
    actorId: string
    actionId: string
    hitIndex: number
    motionValue: number
    scaling: TimelineHit['scaling']
    element: TimelineHit['element']
    canCrit: boolean
    origin: DamageRow['origin']
    stats: PanelModifiers
    enemy: EnemyModifiers
    /** 效果表提供的反应加成（专用加成、提升乘区、反应系数乘区），按加法叠加。 */
    reactionBonus?: ReactionBonus
    /** 命中当帧由效果附加的固定基础伤害（来歆余响）。 */
    flatBase?: FlatBaseBonus[]
    /** 不按面板折算的固定伤害（海染泡沫）：直接进基伤。 */
    fixedDamage?: number
    effects: string[]
    reaction?: ReactionDeclaration
    path: string
  }): Issue[] => {
    const context = contexts[options.actorId]
    if (!context) return [{ code: 'missing', path: `contexts.${options.actorId}`, message: `命中来自 ${options.actorId}，但没有提供该角色的面板` }]
    const hasPct = ['atkPct', 'hpPct', 'defPct'].some(key => {
      const value = (options.stats as Record<string, unknown> | undefined)?.[key]
      return typeof value === 'number' && Math.abs(value) > 1e-12
    })
    if (hasPct && !context.base) {
      return [{ code: 'missing', path: `contexts.${options.actorId}.base`, message: '面板增量含 atkPct / hpPct / defPct，但上下文没有提供基础面板 base，无法折算' }]
    }
    const stats = applyPanelModifiers(context.stats, options.stats, context.base)
    const flatBase = (options.flatBase ?? []).reduce((sum, flat) => sum + statFor(flat.scaling, stats) * flat.ratio, 0) + (options.fixedDamage ?? 0)
    const defenseReduction = context.debuffs.defenseReduction + options.enemy.defenseReduction
    const defenseIgnore = context.debuffs.defenseIgnore + options.enemy.defenseIgnore
    const resistanceReduction = context.debuffs.resistanceReduction + options.enemy.resistanceReduction + (options.enemy.resistanceByElement?.[options.element] ?? 0)
    const spec: OrdinaryHit = {
      kind: 'ordinary',
      reaction: 'none',
      gameVersion: context.gameVersion,
      source: context.source,
      targetId: preset.id,
      scaling: [{ stat: statFor(options.scaling, stats), multiplier: options.motionValue }],
      additiveBase: flatBase,
      damageBonus: damageBonusFor(options.element, stats, damageKindOf(options.actionId)),
      canCrit: options.canCrit,
      crit: context.crit,
      critRate: critRateFor(stats, damageKindOf(options.actionId)),
      critDamage: stats.cdmg,
      attackerLevel: context.level,
      enemyLevel: preset.level,
      defenseReduction,
      defenseIgnore,
      resistance: preset.resistance,
      resistanceReduction
    }
    const base: OrdinaryDamageResult = calculateOrdinaryHit(spec)
    if (base.status !== 'calculated') {
      return base.issues.map(issue => ({ ...issue, path: `${options.path}.${issue.path}` }))
    }
    let damage = base.damage
    let reactionRecord: DamageRow['reaction']
    let reactionRow: DamageRow | undefined
    // 月反应与星烁是独立的一段伤害，不能挂在直伤行上（否则会被读成「这一发被强化了」）。
    let specialRow: DamageRow | undefined
    // 月反应与星烁：官方口径的倍率取决于天赋与叠层计数，精通曲线也与剧变不同（6 而不是 16），
    // 所以单独成段而不是复用剧变分支。公式见 docs/队伍模拟-P3-月反应与星烁.md。
    const special = options.reaction && isSpecialKind(options.reaction.kind) ? options.reaction : undefined
    if (special) {
      const kind = special.kind as SpecialKind
      const coefficient = reactionCoefficient(context.level)
      if (coefficient === undefined) return [{ code: 'unsupported', path: `${options.path}.reaction`, message: `等级 ${context.level} 不在反应系数表内` }]
      const multiplier = specialMultiplier(kind, { talent: special.talent, count: special.count })
      // 数据写死的加成与效果表提供的加成相加；数据里的 kNum 是乘数，效果里的是加数（最终 1 + 合计）。
      const bonus = options.reactionBonus
      const fypct = (special.fypct ?? 0) + (bonus?.fypct ?? 0)
      const fyplus = special.fyplus ?? 0
      const elevated = (special.elevated ?? 0) + (bonus?.elevated ?? 0)
      const kNum = (special.kNum ?? 1) * (1 + (bonus?.kNum ?? 0))
      const critRate = Math.min(1, Math.max(0, stats.cpct))
      const critDamage = Math.max(0, stats.cdmg)
      const critFactor = options.canCrit ? 1 + critRate * critDamage : 1
      // 按反应族的加成（晨星、血红、炉火一类：「星扩散伤害 +40%」）直接放大这一段月/星伤害。
      const kindBonus = options.reactionBonus?.dmg?.[kind] ?? 0
      const reactionDamage =
        (coefficient * (1 + fypct) * multiplier * specialMasteryFactor(stats.mastery) + fyplus) *
        (1 + kindBonus) *
        (1 + elevated) *
        kNum *
        critFactor *
        resistanceMultiplier(preset.resistance - resistanceReduction)
      specialRow = {
        frame: options.frame,
        actorId: options.actorId,
        actionId: options.actionId,
        hitIndex: options.hitIndex,
        element: options.element,
        scaling: options.scaling,
        motionValue: options.motionValue,
        damage: reactionDamage,
        origin: 'reaction',
        effects: options.effects,
        reaction: { kind, damage: reactionDamage }
      }
    } else {
          const declared = options.reaction && isReactiveKind(options.reaction.kind) ? options.reaction : undefined
    if (declared) {
      const kind = declared.kind as ReactiveKind
      const cls = reactionClass(kind)
      if (cls === 'transformative') {
        // 剧变：不吃防御、不吃增伤、不暴击，只乘抗性区，单独成一段。
        const reactionElement: TimelineHit['element'] = kind === 'swirl' ? declared.aura as TimelineHit['element']
          : kind === 'overloaded' || kind === 'burning' ? 'pyro'
            : kind === 'electro-charged' ? 'electro'
              : kind === 'superconduct' ? 'cryo' : 'dendro'
        const reactionResistanceReduction = context.debuffs.resistanceReduction + options.enemy.resistanceReduction + (options.enemy.resistanceByElement?.[reactionElement] ?? 0)
        const coefficient = transformativeBase(kind, context.level, stats.mastery)
        if (coefficient === undefined) return [{ code: 'unsupported', path: `${options.path}.reaction`, message: `等级 ${context.level} 不在反应系数表内` }]
        const reactionBonus = options.reactionBonus?.dmg?.[kind] ?? 0
        const reactionDamage = coefficient * (1 + reactionBonus) * resistanceMultiplier(preset.resistance - reactionResistanceReduction)
        reactionRecord = { kind, damage: reactionDamage }
        reactionRow = {
          frame: options.frame,
          actorId: options.actorId,
          actionId: options.actionId,
          hitIndex: options.hitIndex,
          element: reactionElement,
          scaling: options.scaling,
          motionValue: options.motionValue,
          damage: reactionDamage,
          origin: 'reaction',
          effects: options.effects,
          reaction: reactionRecord
        }
      } else {
        // 增幅与激化：走同一条直伤公式，反应只是换了基础伤害区的算法。
        const withReaction: OrdinaryHit = { ...spec, reaction: kind, element: options.element, aura: declared.aura, mastery: stats.mastery }
        const reacted = calculateOrdinaryHit(withReaction)
        if (reacted.status !== 'calculated') {
          return reacted.issues.map(issue => ({ ...issue, path: `${options.path}.reaction.${issue.path}` }))
        }
        damage = reacted.damage
        reactionRecord = { kind, damage: reacted.damage - base.damage }
      }
    }
    }

    const row: DamageRow = {
      frame: options.frame,
      actorId: options.actorId,
      actionId: options.actionId,
      hitIndex: options.hitIndex,
      element: options.element,
      scaling: options.scaling,
      motionValue: options.motionValue,
      damage,
      origin: options.origin,
      effects: options.effects,
      ...(reactionRecord ? { reaction: reactionRecord } : {})
    }
    const add = (target: DamageRow) => {
      total += target.damage
      perActor[target.actorId] = (perActor[target.actorId] ?? 0) + target.damage
      const actionKey = `${target.actorId}/${target.actionId}`
      perAction[actionKey] = (perAction[actionKey] ?? 0) + target.damage
      rows.push(target)
    }
    add(row)
    if (reactionRow) add(reactionRow)
    if (specialRow) add(specialRow)
    return []
  }

  for (const [index, hit] of timeline.hits.entries()) {
    // 命中自带当帧生效的面板增量与敌人减益：内核已经按帧算好，这里只做加法，不回查效果表。
    const modifiers = hit.modifiers
    if (!modifiers || typeof modifiers !== 'object' || !modifiers.enemy || typeof modifiers.stats !== 'object' || modifiers.stats === null) {
      return { status: 'invalid', issues: [{ code: 'missing', path: `hits.${index}.modifiers`, message: '命中缺少生效修饰快照，无法确定这一发吃到了哪些效果' }] }
    }
    const stats = mergedStats(modifiers.stats, windowStats(plan, hit.actorId, hit.frame).map(window => window.stats))
    const enemy = mergedEnemy(modifiers.enemy, windowEnemies(plan, hit.frame).map(window => window.enemy))
    const hitIssues = settle({
      frame: hit.frame,
      actorId: hit.actorId,
      actionId: hit.actionId,
      hitIndex: hit.hitIndex,
      motionValue: hit.motionValue,
      scaling: hit.scaling,
      element: hit.element,
      canCrit: hit.canCrit,
      origin: 'action',
      stats,
      enemy,
      effects: activeIds(plan, hit.actorId, hit.frame, hit.activeEffects),
      ...(hit.flatBase ? { flatBase: hit.flatBase } : {}),
      ...(hit.fixedDamage !== undefined ? { fixedDamage: hit.fixedDamage } : {}),
      reaction: hit.reaction,
      reactionBonus: modifiers.reaction,
      path: `hits.${index}`
    })
    if (hitIssues.length) return { status: hitIssues.some(i => i.code === 'unsupported') ? 'unsupported' : 'invalid', issues: hitIssues }
  }

  // 召唤物命中：主线没有把它排进事件队列（见文档已知限制），这里按帧展开再结算。
  // 窗口边界由 plan 负责裁剪（施放点 + 持续，且不超过测量窗口），结算层不再拿动作结束帧拦。
  for (const [index, summon] of (plan?.summonHits ?? []).entries()) {
    const stats = mergedStats({}, windowStats(plan, summon.ownerId, summon.atFrame).map(window => window.stats))
    const enemy = mergedEnemy({ resistanceReduction: 0, defenseReduction: 0, defenseIgnore: 0 }, windowEnemies(plan, summon.atFrame).map(window => window.enemy))
    const summonIssues = settle({
      frame: summon.atFrame,
      actorId: summon.ownerId,
      actionId: 'summon',
      hitIndex: -1 - index,
      motionValue: summon.motionValue,
      scaling: summon.scaling,
      element: summon.element,
      canCrit: summon.canCrit,
      origin: 'summon',
      stats,
      enemy,
      effects: activeIds(plan, summon.ownerId, summon.atFrame, undefined),
      path: `summons.${index}`
    })
    if (summonIssues.length) return { status: summonIssues.some(i => i.code === 'unsupported') ? 'unsupported' : 'invalid', issues: summonIssues }
  }

  rows.sort((a, b) => a.frame - b.frame || (a.origin === b.origin ? 0 : a.origin === 'action' ? -1 : 1))
  return {
    status: 'calculated',
    scope: rows.some(row => row.reaction) ? 'timeline-damage-with-reaction' : 'timeline-damage-no-reaction',
    simulationReady: false,
    total,
    rows,
    perActor,
    perAction,
    target: { id: preset.id, level: preset.level, resistance: preset.resistance },
    gameVersion: anchor.gameVersion,
    source: anchor.source,
    issues: []
  }
}
