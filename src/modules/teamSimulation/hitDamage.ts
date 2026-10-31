import type { Failure, Issue, OrdinaryDamageResult, OrdinaryHit, PermanentStats } from './types.js'
import { calculateOrdinaryHit, TARGET_PRESETS } from './formula.js'
import type { TimelineHit, TimelineResult } from './timeline.js'

export type CritPolicy = 'expected' | 'critical' | 'non-critical'

/**
 * 队伍减益：P1 没有建模任何减防、减抗或无视防御来源（钟离护盾减抗也不在 P1 范围）。
 * 接口保留是为了以后接入时不用改调用方，但数值必须显式传 0，非 0 一律拒绝。
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
}

export type TimelineDamageResult = {
  status: 'calculated'
  scope: 'timeline-damage-no-reaction'
  simulationReady: false
  total: number
  rows: DamageRow[]
  perActor: Record<string, number>
  target: { id: string; level: number; resistance: number }
  gameVersion: string
  source: string
  issues: Issue[]
} | Failure

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 元素命中只读该元素的加成键，物理命中只读物理键；`dmg` 是通用元素伤害加成。 */
function damageBonusFor(element: TimelineHit['element'], stats: PermanentStats): number {
  return element === 'physical' ? stats.phy : stats.dmg + stats[element]
}

function statFor(scaling: TimelineHit['scaling'], stats: PermanentStats): number {
  return scaling === 'atk' ? stats.atk : scaling === 'hp' ? stats.hp : stats.def
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
      else if (debuffs[key] !== 0) add('unsupported', `${prefix}.debuffs.${key}`, 'P1 没有建模队伍减防/减抗，不能把未建模的数值传进来')
    }
  }
  return issues
}

/**
 * 把时间内核排出的每段命中接到普通直伤公式上。
 * 只做映射与汇总：倍率乘哪一项面板、元素加成读哪个键、目标口径与减益全部来自显式输入。
 * 面板按 actorId 分开取，四人队每人的面板不能混用。
 */
export function calculateTimelineDamage(input: { timeline: TimelineResult; contexts: Record<string, DamageContext> }): TimelineDamageResult {
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
  const rows: DamageRow[] = []
  const perActor: Record<string, number> = {}
  let total = 0
  for (const [index, hit] of timeline.hits.entries()) {
    const context = contexts[hit.actorId]
    if (!context) {
      return { status: 'invalid', issues: [{ code: 'missing', path: `contexts.${hit.actorId}`, message: `命中来自 ${hit.actorId}，但没有提供该角色的面板` }] }
    }
    const spec: OrdinaryHit = {
      kind: 'ordinary',
      reaction: 'none',
      gameVersion: context.gameVersion,
      source: context.source,
      targetId: preset.id,
      scaling: [{ stat: statFor(hit.scaling, context.stats), multiplier: hit.motionValue }],
      additiveBase: 0,
      damageBonus: damageBonusFor(hit.element, context.stats),
      canCrit: hit.canCrit,
      crit: context.crit,
      critRate: context.stats.cpct,
      critDamage: context.stats.cdmg,
      attackerLevel: context.level,
      enemyLevel: preset.level,
      defenseReduction: context.debuffs.defenseReduction,
      defenseIgnore: context.debuffs.defenseIgnore,
      resistance: preset.resistance,
      resistanceReduction: context.debuffs.resistanceReduction
    }
    const result: OrdinaryDamageResult = calculateOrdinaryHit(spec)
    if (result.status !== 'calculated') {
      return { status: result.status === 'unsupported' ? 'unsupported' : 'invalid', issues: result.issues.map(issue => ({ ...issue, path: `hits.${index}.${issue.path}` })) }
    }
    total += result.damage
    perActor[hit.actorId] = (perActor[hit.actorId] ?? 0) + result.damage
    rows.push({ frame: hit.frame, actorId: hit.actorId, actionId: hit.actionId, hitIndex: hit.hitIndex, element: hit.element, scaling: hit.scaling, motionValue: hit.motionValue, damage: result.damage })
  }
  return {
    status: 'calculated',
    scope: 'timeline-damage-no-reaction',
    simulationReady: false,
    total,
    rows,
    perActor,
    target: { id: preset.id, level: preset.level, resistance: preset.resistance },
    gameVersion: anchor.gameVersion,
    source: anchor.source,
    issues: []
  }
}
