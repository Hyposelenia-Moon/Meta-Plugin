import type { ReactionClass } from './reactions.js'

/**
 * P3 的逐家族覆盖门槛。
 *
 * 方案文档的两条硬要求（`docs`/方案第 56、659 行）：
 * 1. 每个反应家族要有独立的来源、公式、触发、资源、暴击排序与归属 fixture；
 * 2. 没有实测与 fixture 的家族必须 gate（拒绝正式模拟），不能混进普通蒸发公式。
 *
 * 这张表是 gate 的唯一依据：`coverage` 为 `blocked` 的家族，数据包一旦声明就必须被拒绝。
 */
export type ReactionFamily = 'amplifying' | 'catalyze' | 'transformative' | 'lunar' | 'stellar'

export interface ReactionFamilySpec {
  readonly family: ReactionFamily
  readonly label: string
  /** 对应的普通反应类别；月反应/星烁不是普通家族的变体，单独两条。 */
  readonly cls: ReactionClass | null
  readonly coverage: 'fixture-covered' | 'blocked'
  /** 已覆盖的家族指向测试文件名；blocked 的写清缺什么。 */
  readonly evidence: string
  readonly reason?: string
}

export const REACTION_FAMILIES: Readonly<Record<ReactionFamily, ReactionFamilySpec>> = {
  amplifying: {
    family: 'amplifying',
    label: '增幅（蒸发/融化）',
    cls: 'amplifying',
    coverage: 'fixture-covered',
    evidence: 'test/team-sim-reactions.test.mjs'
  },
  catalyze: {
    family: 'catalyze',
    label: '激化（超激化/蔓激化）',
    cls: 'catalyze',
    coverage: 'fixture-covered',
    evidence: 'test/team-sim-reactions.test.mjs'
  },
  transformative: {
    family: 'transformative',
    label: '剧变（超载/感电/超导/扩散/绽放/燃烧）',
    cls: 'transformative',
    coverage: 'fixture-covered',
    evidence: 'test/team-sim-reactions.test.mjs'
  },
  lunar: {
    family: 'lunar',
    label: '月反应',
    cls: null,
    coverage: 'blocked',
    evidence: 'docs/队伍模拟-P3-月反应与星烁.md',
    reason: '月反应有专用加成(fypct)、提升乘区与多贡献者，精通系数为 6×EM/(EM+2000) 而非剧变的 16；公式已从 miao 提取到文档，但契约字段与计数资源还没实现'
  },
  stellar: {
    family: 'stellar',
    label: '星烁',
    cls: null,
    coverage: 'blocked',
    evidence: 'docs/队伍模拟-P3-月反应与星烁.md',
    reason: '星烁含星超导/星扩散/星辉冰旋三支，倍率依赖叠层计数且暴击是显式乘区；资料已提取，计数与契约字段未实现'
  }
}

export const BLOCKED_FAMILIES: ReactionFamily[] = (Object.keys(REACTION_FAMILIES) as ReactionFamily[])
  .filter(family => REACTION_FAMILIES[family].coverage === 'blocked')

export interface FamilyGateResult {
  /** `ok`：声明落在已覆盖家族；`blocked`：声明落在被 gate 的家族；`unknown`：不认识的家族名。 */
  status: 'ok' | 'blocked' | 'unknown'
  family?: ReactionFamily
  message?: string
}

/** 数据包声明某个家族前先过这道门；`unknown` 与 `blocked` 都不允许继续。 */
export function gateReactionFamily(name: unknown): FamilyGateResult {
  if (typeof name !== 'string' || !(name in REACTION_FAMILIES)) {
    return { status: 'unknown', message: `未知反应家族 ${String(name)}` }
  }
  const family = name as ReactionFamily
  const spec = REACTION_FAMILIES[family]
  if (spec.coverage === 'blocked') {
    return { status: 'blocked', family, message: `${spec.label}尚未建模：${spec.reason ?? '缺少 fixture 与实测'}` }
  }
  return { status: 'ok', family }
}

/** 覆盖率自检：任何 `fixture-covered` 的家族都必须在测试里被点名。 */
export function familyCoverage(): { covered: number; blocked: number; total: number } {
  const all = Object.values(REACTION_FAMILIES)
  return {
    covered: all.filter(spec => spec.coverage === 'fixture-covered').length,
    blocked: all.filter(spec => spec.coverage === 'blocked').length,
    total: all.length
  }
}
