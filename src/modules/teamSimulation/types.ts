import type { ReactiveKind } from './reactions.js'
import type { EffectSpec, EffectTriggerKind } from './effects.js'

/** 队伍模拟 P0 契约。百分比为比例（20%=0.2），属性为点数；不接管现有命令。 */
export const SCHEMA_VERSION = 1 as const
export type StatKey = 'hp' | 'atk' | 'def' | 'hpPct' | 'atkPct' | 'defPct' | 'mastery' | 'cpct' | 'cdmg' | 'recharge' | 'dmg' | 'phy' | 'heal' | 'pyro' | 'hydro' | 'electro' | 'cryo' | 'anemo' | 'geo' | 'dendro' | 'normalDmg' | 'chargedDmg' | 'plungeDmg' | 'skillDmg' | 'burstDmg'
export interface StatValue { key: StatKey; value: number }
export type ArtifactSlot = 'flower' | 'plume' | 'sands' | 'goblet' | 'circlet'
export interface SourceInfo {
  provider: string
  providerVersion: string | null
  sourceTime: string | number | null
}
export interface BuildArtifact {
  slot: ArtifactSlot
  name: string
  setId: string
  rarity: number
  level: number
  main: StatValue
  sub: StatValue[]
}
export interface MechanicSource {
  id: string
  kind: 'character' | 'weapon' | 'artifact-set' | 'constellation'
}
export type TalentKey = 'normal' | 'skill' | 'burst'
/** 天赋等级加成的来源。只有能指认来源时才登记；省略表示未建模，不代表游戏里没有加成。 */
export interface TalentModifier { source: string; talent: TalentKey; levels: number }
export interface CharacterBuild {
  schemaVersion: 1
  actorId: string
  characterId: string
  name: string
  element: string
  level: number
  ascension: number
  constellation: number
  talents: { normal: number; skill: number; burst: number; modifiers?: TalentModifier[] }
  weapon: { id: string; name: string; level: number; ascension: number; refinement: number }
  artifacts: BuildArtifact[]
  /** 只有合成后最终面板、无法重建原始配装时的输入资格；P0 明确拒绝这条路径。 */
  panelCheck?: { stats: Record<string, number>; includedEffects: { known: true; ids: string[] } | { known: false } }
  /** 原始配装完整不代表装备/天赋机制已支持，数据构建时必须逐项审计。 */
  requiredEffects: MechanicSource[]
  provenance: SourceInfo
}
export interface Issue {
  code: 'missing' | 'invalid' | 'unsupported' | 'version-mismatch' | 'unverified-effect'
  path: string
  message: string
}
export type Failure = { status: 'incomplete' | 'invalid' | 'unsupported'; issues: Issue[] }
export type BuildAdaptResult = { status: 'raw-complete'; build: CharacterBuild; simulationReady: false } | Failure
export interface TeamBuildResult {
  status: 'raw-complete' | 'incomplete' | 'invalid' | 'unsupported'
  members: BuildAdaptResult[]
  issues: Issue[]
  simulationReady: false
}
/** 等级曲线求值由维护者提供的、版本化基础数据负责。禁止用最终面板反推白值。 */
export interface PermanentData {
  gameVersion: string
  bundleId: string
  source: string
  /** `bonuses` 保留字段但 P0 必须是空数组：静态加成一律登记到 `effects` 的 modifiers，不能走无审计通道。 */
  character: { id: string; level: number; ascension: number; base: { hp: number; atk: number; def: number }; bonuses: StatValue[] }
  weapon: { id: string; level: number; ascension: number; baseAtk: number; bonuses: StatValue[] }
  /** 必须覆盖 requiredEffects 的每一个 id，空数组明确表示无静态属性，非未知。 */
  effects: Record<string, {
    status: 'verified-static' | 'known-no-static' | 'unsupported'
    modifiers: StatValue[]
    runtimeRequired: boolean
    /**
     * 该效果中「运行时才算得出来」的部分，人工写明没建模的是什么。
     * 只允许出现在 verified-static / known-no-static 上：算得出静态部分、但条件部分没进内核，
     * 结果会被当成偏低估披露，发布闸门照拦。
     */
    unmodeled?: string
  }>
  /**
   * 运行时触发效果（4 件套「施放战技/爆发后」一类）：`trigger` 必填，
   * 时间轴在该角色起手对应动作时激活。只有真正穿在身上的套装才会被并进这次模拟。
   */
  runtimeEffects?: Record<string, EffectSpec & { trigger: EffectTriggerKind }>
}
export interface PermanentStats {
  hp: number; atk: number; def: number
  mastery: number; cpct: number; cdmg: number; recharge: number
  dmg: number; phy: number; heal: number
  pyro: number; hydro: number; electro: number; cryo: number; anemo: number; geo: number; dendro: number
  /** 技能类型伤害加成（加算进 A 乘区）：普攻 / 重击 / 下落 / 战技 / 爆发 */
  normalDmg?: number; chargedDmg?: number; plungeDmg?: number; skillDmg?: number; burstDmg?: number
}
export type PermanentBuildResult = {
  status: 'permanent-ready'
  scope: 'permanent-stats'
  simulationReady: false
  stats: PermanentStats
  base: { hp: number; atk: number; def: number; weaponAtk: number }
  setCounts: Record<string, number>
  runtimeEffects: string[]
  /** 静态部分已计入、但条件/运行时部分没建模的效果；披露用，不放行。 */
  unmodeled: { id: string; reason: string }[]
  trace: { source: string; key: string; value: number }[]
  gameVersion: string
  bundleId: string
} | Failure
/** 普通无反应直伤。所有乘区显式输入；不在 P0 接受反应或未建模的独立乘区。 */
export interface OrdinaryHit {
  kind: 'ordinary'
  /** 
one 是普通直伤；其余取值走 reactions.ts 的算术。 */
  reaction: 'none' | ReactiveKind
  gameVersion: string
  source: string
  /** 可选：绑定只读测试目标口径；指定后等级与抗性必须与预设一致。 */
  targetId?: string
  scaling: { stat: number; multiplier: number }[]
  additiveBase: number
  damageBonus: number
  canCrit: boolean
  crit: 'expected' | 'critical' | 'non-critical'
  critRate: number
  critDamage: number
  attackerLevel: number
  enemyLevel: number
  defenseReduction: number
  defenseIgnore: number
  resistance: number
  resistanceReduction: number
  /** 反应的触发元素；eaction !== 'none' 时必填，取值同 TimelineHit.element。 */
  element?: string
  /** 目标身上的附着元素；eaction !== 'none' 时必填。 */
  aura?: string
  /** 触发反应的角色精通；eaction !== 'none' 时必填。 */
  mastery?: number
}
export type OrdinaryDamageResult = {
  status: 'calculated'
  scope: 'ordinary-hit-no-reaction' | 'ordinary-hit-with-reaction'
  damage: number
  factors: { base: number; damageBonus: number; crit: number; defense: number; resistance: number; effectiveCritRate: number; effectiveDefenseReduction: number; effectiveResistance: number }
  target: { id: string; level: number; resistance: number }
  gameVersion: string
  source: string
} | Failure
/** 旧关键词轴聚合结果：只标记口径，不做单位换算，也不进入正式模拟。 */
export interface LegacyResult {
  status: 'legacy-estimate'
  mode: 'legacy'
  simulationReady: false
  gameVersion: string | null
  source: string
  rows: { title: string; value: number }[]
  notes: string[]
}
/** 构造旧口径结果，防止以 raw-complete 或 simulationReady:true 的形态冒充新引擎输出。 */
export function legacyEstimate(input: { rows: { title: string; value: number }[]; notes?: string[]; gameVersion?: string | null; source: string }): LegacyResult {
  return {
    status: 'legacy-estimate', mode: 'legacy', simulationReady: false,
    gameVersion: input.gameVersion ?? null, source: input.source,
    rows: input.rows.map(row => ({ title: row.title, value: row.value })),
    notes: [...(input.notes ?? [])]
  }
}
