/**
 * 队伍 DPS 的固定标准（2026-11-01 作者定，**不允许更改**）
 *
 * - 目标：110 级遗迹守卫（小宝），10% 抗性
 * - 窗口：120 秒现实时间（换帧率档位时按帧率折算帧数，秒数不变）
 * - 开局能量：0
 *
 * 意义：三个数字写死在这里，搜索器与摘要只能引用、不能覆盖。任何"换个目标试试"
 * 都必须走别的口径，并且不得再叫 DPS 标准；要改本文件就要同步文档与套件。
 */
import type { FrameTier } from './timeline.js'

export interface DpsStandard {
  /** 目标口径 id，对应 `TARGET_PRESETS` 里的条目 */
  readonly targetId: string
  readonly enemyLevel: number
  readonly resistance: number
  /** 现实时间窗口（秒） */
  readonly windowSeconds: number
  /** 开局能量（点） */
  readonly initialEnergy: number
}

export const DPS_STANDARD: DpsStandard = {
  targetId: 'ruin-guard-lv110',
  enemyLevel: 110,
  resistance: 0.1,
  windowSeconds: 120,
  initialEnergy: 0
}

/** 120 秒窗口在给定档位下折算成多少帧（帧是调度单位，档位决定一秒有几帧）。 */
export function dpsWindowFrames(tier: FrameTier): number {
  return Math.round(DPS_STANDARD.windowSeconds * tier.fps)
}

export interface DpsStandardViolation {
  path: string
  message: string
}

interface StandardInput {
  frameTier?: FrameTier
  targetPresetId?: string
  measurementEndFrame?: number
  actors?: { actorId?: unknown; energy?: unknown }[]
}

/**
 * 核对一轮轴是否符合 DPS 标准。返回空数组才算合格；任何一条不符都点名，不自动修正。
 *
 * 刻意要求 `energy` 显式写 0：缺省与 0 在语义上不同（前者是"没写"，后者是"确认从 0 起"）。
 */
export function checkDpsStandard(input: StandardInput | null | undefined): DpsStandardViolation[] {
  const out: DpsStandardViolation[] = []
  const tier = input?.frameTier
  if (!tier || typeof tier.fps !== 'number' || !Number.isFinite(tier.fps) || tier.fps <= 0) {
    return [{ path: 'frameTier', message: '缺少帧率档位，无法把 120 秒折算成帧' }]
  }
  if (input?.targetPresetId !== DPS_STANDARD.targetId) {
    out.push({
      path: 'targetPresetId',
      message: `DPS 标准目标必须是 ${DPS_STANDARD.targetId}（${DPS_STANDARD.enemyLevel} 级、${DPS_STANDARD.resistance * 100}% 抗性），实际 ${String(input?.targetPresetId)}`
    })
  }
  const expected = dpsWindowFrames(tier)
  if (input?.measurementEndFrame !== expected) {
    out.push({
      path: 'measurementEndFrame',
      message: `DPS 标准窗口是 ${DPS_STANDARD.windowSeconds} 秒，在 ${tier.id} 档应为 ${expected} 帧，实际 ${String(input?.measurementEndFrame)}`
    })
  }
  const actors = Array.isArray(input?.actors) ? input.actors : []
  if (!actors.length) {
    out.push({ path: 'actors', message: 'DPS 标准要求每个角色都显式登记开局能量，不能空表' })
  }
  actors.forEach((actor, index) => {
    const energy = actor?.energy
    if (typeof energy !== 'number' || !Number.isFinite(energy)) {
      out.push({ path: `actors.${index}.energy`, message: '开局能量必须显式写 0，缺省不算合格' })
    } else if (energy !== DPS_STANDARD.initialEnergy) {
      out.push({ path: `actors.${index}.energy`, message: `开局能量必须是 0，实际 ${energy}` })
    }
  })
  return out
}
