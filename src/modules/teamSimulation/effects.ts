/**
 * P1 效果表：数据声明「命中触发什么」，内核按帧结算生效区间。
 *
 * 这里不做数值平衡判断，也不替数据补默认值：数值由数据给，内核只保证同一帧的生效顺序、
 * 到期时刻与叠加层数可复现。触发者自己被自己触发的效果加成——同一次命中先结算伤害，
 * 再结算它携带的触发，所以「给自己上攻击力」的那一下不会吃到自己的加成。
 */
import type { Issue, PermanentStats } from './types.js'

/** 面板键：只有这些键可以加到结算面板上，`hpPct` 这类构筑期百分比不在其中。 */
export const PANEL_STAT_KEYS = ['hp', 'atk', 'def', 'mastery', 'cpct', 'cdmg', 'recharge', 'dmg', 'phy', 'heal', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'] as const
export type PanelStatKey = typeof PANEL_STAT_KEYS[number]

/** 面板增量必须与 `PermanentStats` 的键一一对应，类型上防止有人把构筑期百分比当面板加成。 */
export type PanelModifiers = Partial<Record<PanelStatKey, number>>

export interface EnemyModifiers {
  resistanceReduction: number
  defenseReduction: number
  defenseIgnore: number
}

export const NO_ENEMY_MODIFIERS: EnemyModifiers = { resistanceReduction: 0, defenseReduction: 0, defenseIgnore: 0 }

export type EffectTarget = 'self' | 'team' | 'enemy'
export type StackingPolicy = 'refresh' | 'stack' | 'ignore'

/**
 * 效果定义。`self` 与 `team` 加面板，`enemy` 减抗减防；两者互斥，避免「一个效果既加面板又减抗」这种口径不清的写法。
 * `durationFrames` 省略表示持续到测量窗口结束：不写到期时间就是一直有效，内核不会猜一个有限的默认值。
 */
export interface EffectSpec {
  id: string
  target: EffectTarget
  stats?: PanelModifiers
  enemy?: { resistanceReduction?: number; defenseReduction?: number; defenseIgnore?: number }
  durationFrames?: number
  /** 重复触发时的策略，缺省 refresh（刷新到期时刻，不叠层）。 */
  stacking?: StackingPolicy
  /** 仅 `stacking: 'stack'` 可用：层数上限。 */
  maxStacks?: number
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
  } else if (spec.target === 'self' || spec.target === 'team') {
    add('missing', `${p}.stats`, '作用于己方的效果必须给面板加成')
  }

  if (spec.enemy !== undefined) {
    if (spec.target !== 'enemy') add('invalid', `${p}.enemy`, '只有作用于敌人的效果才能削减抗性与防御')
    else if (!spec.enemy || typeof spec.enemy !== 'object' || Array.isArray(spec.enemy)) add('invalid', `${p}.enemy`, '敌人减益必须是对象')
    else {
      const entries = Object.entries(spec.enemy)
      if (!entries.length) add('invalid', `${p}.enemy`, '空敌人减益没有意义')
      for (const [field, value] of entries) {
        if (!['resistanceReduction', 'defenseReduction', 'defenseIgnore'].includes(field)) add('unsupported', `${p}.enemy.${field}`, `未知敌人减益 ${field}`)
        else if (!isFiniteNumber(value)) add('invalid', `${p}.enemy.${field}`, '减益必须是有限数值')
      }
    }
  } else if (spec.target === 'enemy') {
    add('missing', `${p}.enemy`, '作用于敌人的效果必须给至少一项减益')
  }

  if (spec.durationFrames !== undefined && (!isInteger(spec.durationFrames) || spec.durationFrames <= 0)) add('invalid', `${p}.durationFrames`, '持续帧数必须是正整数；要一直有效就省略这个字段')
  if (spec.stacking !== undefined && !['refresh', 'stack', 'ignore'].includes(spec.stacking)) add('unsupported', `${p}.stacking`, `未知叠加策略 ${String(spec.stacking)}`)
  if (spec.stacking === 'stack') {
    if (!isInteger(spec.maxStacks) || spec.maxStacks <= 0) add('invalid', `${p}.maxStacks`, '叠层策略必须给出正整数层数上限')
  } else if (spec.maxStacks !== undefined) {
    add('invalid', `${p}.maxStacks`, '只有叠层策略才需要层数上限，其余策略写上限会被静默忽略')
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
  /** 在 `frame` 帧由 `actorId` 触发，返回本次实际生效的记录；叠层已满或 ignore 命中时返回 undefined。 */
  trigger(effectId: string, frame: number, actorId: string): TriggerRecord | undefined
  /** 该角色在该帧实际吃的面板增量与全局敌人减益。 */
  modifiersAt(actorId: string, frame: number): { stats: PanelModifiers; enemy: EnemyModifiers }
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
    trigger(effectId, frame, actorId) {
      const spec = table[effectId]
      if (!spec) return undefined
      const key = entryKey(spec, actorId)
      const expiresAt = expiryOf(spec, frame)
      const existing = entries.get(key)
      const policy: StackingPolicy = spec.stacking ?? 'refresh'
      if (existing) {
        if (policy === 'ignore') return undefined
        if (policy === 'stack') {
          existing.stacks = Math.min(spec.maxStacks ?? 1, existing.stacks + 1)
          existing.expiresAt = expiresAt
        } else {
          existing.stacks = 1
          existing.expiresAt = expiresAt
        }
        const record: TriggerRecord = { frame, actorId, effectId, stacks: existing.stacks, startsAt: existing.startedAt, expiresAt: existing.expiresAt }
        triggers.push(record)
        return record
      }
      const entry: Entry = { spec, key, actorId: spec.target === 'self' ? actorId : undefined, stacks: 1, startedAt: frame, expiresAt }
      entries.set(key, entry)
      const record: TriggerRecord = { frame, actorId, effectId, stacks: 1, startsAt: frame, expiresAt }
      triggers.push(record)
      return record
    },
    modifiersAt(actorId, frame) {
      const stats: PanelModifiers = {}
      const enemy: EnemyModifiers = { ...NO_ENEMY_MODIFIERS }
      for (const entry of entries.values()) {
        if (frame >= entry.expiresAt) continue
        const { spec } = entry
        if (spec.target === 'enemy') {
          const mods = spec.enemy ?? {}
          enemy.resistanceReduction += (mods.resistanceReduction ?? 0) * entry.stacks
          enemy.defenseReduction += (mods.defenseReduction ?? 0) * entry.stacks
          enemy.defenseIgnore += (mods.defenseIgnore ?? 0) * entry.stacks
          continue
        }
        if (spec.target === 'self' && entry.actorId !== actorId) continue
        for (const [key, value] of Object.entries(spec.stats ?? {})) {
          const stat = key as PanelStatKey
          stats[stat] = (stats[stat] ?? 0) + value * entry.stacks
        }
      }
      return { stats, enemy }
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

/** 把面板增量加到一个已算好的面板上，返回新对象；不改调用方那份。 */
export function applyPanelModifiers(stats: PermanentStats, modifiers: PanelModifiers | undefined): PermanentStats {
  if (!modifiers) return { ...stats }
  const merged: PermanentStats = { ...stats }
  for (const [key, value] of Object.entries(modifiers)) {
    const stat = key as PanelStatKey
    merged[stat] += value
  }
  return merged
}
