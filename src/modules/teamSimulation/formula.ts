import type { OrdinaryHit, OrdinaryDamageResult, Issue } from './types.js'

export interface TargetPreset { id: string; level: number; resistance: number; defenseRule: 'standard'; health: 'infinite'; stationary: true }
/** 只读测试目标口径：等级与抗性是固定常量，调用方不能传别的数值冒充同一目标。 */
export const TARGET_PRESETS: Record<string, TargetPreset> = {
  'dummy-lv100': { id: 'dummy-lv100', level: 100, resistance: 0.1, defenseRule: 'standard', health: 'infinite', stationary: true },
  /* 队伍 DPS 的固定标准目标：110 级遗迹守卫（小宝），10% 抗性。口径写死在常量里，调用方不得覆盖。 */
  'ruin-guard-lv110': { id: 'ruin-guard-lv110', level: 110, resistance: 0.1, defenseRule: 'standard', health: 'infinite', stationary: true }
}

/** 普通、无反应、单次直伤；输入全部显式提供，比例不按百分数猜测。 */
export function calculateOrdinaryHit(input: unknown): OrdinaryDamageResult {
  const issues: Issue[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 'invalid', issues: [{ code: 'invalid', path: 'hit', message: '伤害输入必须是对象' }] }
  }
  const h = input as OrdinaryHit
  const issue = (code: Issue['code'], path: string, message: string) => issues.push({ code, path, message })
  for (const [key, allowed] of [['kind', ['ordinary']], ['reaction', ['none']], ['crit', ['expected', 'critical', 'non-critical']]] as const) {
    const value = h[key]
    if (value === undefined) issue('missing', key, '必须显式提供')
    else if (!(allowed as readonly unknown[]).includes(value)) issue('unsupported', key, 'P0 不支持此取值')
  }
  for (const key of ['gameVersion', 'source'] as const) {
    if (h[key] === undefined) issue('missing', key, '必须显式提供')
    else if (typeof h[key] !== 'string' || !h[key].trim()) issue('invalid', key, '必须是非空字符串')
  }
  if (h.canCrit === undefined) issue('missing', 'canCrit', '必须显式提供')
  else if (typeof h.canCrit !== 'boolean') issue('invalid', 'canCrit', '必须是布尔值')
  const numeric = ['additiveBase', 'damageBonus', 'critRate', 'critDamage', 'attackerLevel', 'enemyLevel', 'defenseReduction', 'defenseIgnore', 'resistance', 'resistanceReduction'] as const
  for (const key of numeric) {
    const value = h[key]
    if (value === undefined) issue('missing', key, '必须显式提供')
    else if (typeof value !== 'number' || !Number.isFinite(value)) issue('invalid', key, '必须是有限数值')
    else if ((['additiveBase', 'critRate', 'critDamage', 'attackerLevel', 'enemyLevel', 'defenseReduction', 'defenseIgnore'] as string[]).includes(key) && value < 0) issue('invalid', key, '不得为负数')
  }
  for (const key of ['attackerLevel', 'enemyLevel'] as const) {
    if (typeof h[key] === 'number' && Number.isFinite(h[key]) && !Number.isInteger(h[key])) issue('invalid', key, '等级必须是整数')
  }
  if (h.defenseReduction > 1) issue('invalid', 'defenseReduction', '减防比例必须在 0..1；0.9以上按上限计算')
  if (h.defenseIgnore > 1) issue('invalid', 'defenseIgnore', '无视防御必须在 0..1')
  // 绑定目标口径时，等级与抗性必须等于预设值；否则结果会带着目标名字却算的是别的数值。
  const preset = h.targetId === undefined ? undefined : TARGET_PRESETS[h.targetId]
  if (h.targetId !== undefined) {
    if (typeof h.targetId !== 'string' || !preset) issue('unsupported', 'targetId', '不支持的测试目标')
    else {
      if (h.enemyLevel !== preset.level) issue('invalid', 'enemyLevel', `目标 ${preset.id} 的等级必须是 ${preset.level}`)
      if (h.resistance !== preset.resistance) issue('invalid', 'resistance', `目标 ${preset.id} 的抗性必须是 ${preset.resistance}`)
    }
  }
  if (h.damageBonus < -1) issue('invalid', 'damageBonus', '伤害加成不得使乘区为负')
  if (!Array.isArray(h.scaling)) issue(h.scaling === undefined ? 'missing' : 'invalid', 'scaling', '必须显式提供倍率数组')
  else {
    if (!h.scaling.length) issue('invalid', 'scaling', '倍率数组不得为空')
    h.scaling.forEach((term, i) => {
      for (const key of ['stat', 'multiplier'] as const) {
        const value = term && term[key]
        if (value === undefined) issue('missing', `scaling.${i}.${key}`, '必须显式提供')
        else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) issue('invalid', `scaling.${i}.${key}`, '必须是非负有限数值')
      }
    })
  }
  if (issues.length) return { status: issues.some(i => i.code === 'invalid') ? 'invalid' : issues.some(i => i.code === 'unsupported') ? 'unsupported' : 'incomplete', issues }
  const base = h.scaling.reduce((sum, term) => sum + term.stat * term.multiplier, h.additiveBase)
  const effectiveCritRate = Math.min(1, Math.max(0, h.critRate))
  const crit = !h.canCrit || h.crit === 'non-critical' ? 1 : h.crit === 'critical' ? 1 + h.critDamage : 1 + effectiveCritRate * h.critDamage
  const effectiveDefenseReduction = Math.min(0.9, h.defenseReduction)
  const defense = (h.attackerLevel + 100) / ((h.attackerLevel + 100) + (h.enemyLevel + 100) * (1 - effectiveDefenseReduction) * (1 - h.defenseIgnore))
  const effectiveResistance = h.resistance - h.resistanceReduction
  const resistance = effectiveResistance < 0 ? 1 - effectiveResistance / 2 : effectiveResistance >= 0.75 ? 1 / (1 + 4 * effectiveResistance) : 1 - effectiveResistance
  const factors = { base, damageBonus: 1 + h.damageBonus, crit, defense, resistance, effectiveCritRate, effectiveDefenseReduction, effectiveResistance }
  const damage = base * factors.damageBonus * crit * defense * resistance
  if (base < 0 || !Number.isFinite(damage) || !Object.values(factors).every(Number.isFinite)) {
    return { status: 'invalid', issues: [{ code: 'invalid', path: 'result', message: '计算产生负基础伤害或非有限数值' }] }
  }
  return { status: 'calculated', scope: 'ordinary-hit-no-reaction', damage, factors, target: { id: preset?.id ?? 'custom', level: preset?.level ?? h.enemyLevel, resistance: preset?.resistance ?? h.resistance }, gameVersion: h.gameVersion, source: h.source }
}
