import type { DataPack } from './dataPack.js'
import type { ActionSpec } from './timeline.js'
import { simulateTeam, type TeamRunInput, type TeamRunResult } from './teamRun.js'

/**
 * 归因：把每个效果的「去掉它以后少打多少」算出来。
 *
 * 这是反事实口径，不是因果分解——效果互相叠加时，单独去掉一项的差额不等于它在总量里的份额，
 * 所以只给「有/无」两轮的差额，不给百分比排名。窗口外的命中同样计入差额，因为去掉效果本身
 * 也可能改变动作能否成立（能量、冷却），那属于真实影响。
 */
export interface AttributionRow {
  effectId: string
  /** 有该效果时的总伤害。 */
  baseline: number
  /** 去掉该效果后的总伤害。 */
  without: number
  /** baseline - without，正数表示这项效果净增伤。 */
  delta: number
  /** 该效果被触发的次数（有该效果的那一轮）。 */
  triggers: number
}

export interface AttributionResult {
  status: 'ok' | 'unavailable'
  /** 不可用时的原因：基线那轮没算出来，就不会有差额。 */
  reason?: string
  baseline: number
  rows: AttributionRow[]
  /** 去掉后那一轮失败的效果 id，差额记 0，不编数字。 */
  skipped: string[]
}

/** 深拷贝动作表并摘掉指定效果的触发标记，避免去掉效果后触发引用悬空。 */
function stripEffect(pack: DataPack, effectId: string): DataPack {
  const actions: Record<string, ActionSpec> = {}
  for (const [key, spec] of Object.entries(pack.actions)) {
    const hits = (spec.hits ?? []).map(hit => {
      if (!hit.triggerIds?.includes(effectId)) return hit
      const triggerIds = hit.triggerIds.filter(id => id !== effectId)
      return { ...hit, ...(triggerIds.length ? { triggerIds } : { triggerIds: [] }) }
    })
    actions[key] = { ...spec, hits }
  }
  const effects = { ...(pack.effects ?? {}) }
  delete effects[effectId]
  return { ...pack, actions, effects }
}

const totalOf = (result: TeamRunResult): number | null =>
  result.status === 'calculated' && result.damage.status === 'calculated' ? result.damage.total : null

export function attributeEffects(input: TeamRunInput): AttributionResult {
  const baselineRun = simulateTeam(input)
  const baseline = totalOf(baselineRun)
  if (baseline === null) {
    const issue = baselineRun.issues[0]
    return { status: 'unavailable', reason: issue ? `${issue.path}: ${issue.message}` : '基线那一轮没有算出伤害', baseline: 0, rows: [], skipped: [] }
  }

  const effectIds = Object.keys(input.pack.effects ?? {})
  const triggerCounts = new Map<string, number>()
  for (const trigger of (baselineRun as Extract<TeamRunResult, { status: 'calculated' }>).timeline.triggers ?? []) {
    triggerCounts.set(trigger.effectId, (triggerCounts.get(trigger.effectId) ?? 0) + 1)
  }

  const rows: AttributionRow[] = []
  const skipped: string[] = []
  for (const effectId of effectIds) {
    const withoutRun = simulateTeam({ ...input, pack: stripEffect(input.pack, effectId) })
    const without = totalOf(withoutRun)
    if (without === null) {
      skipped.push(effectId)
      rows.push({ effectId, baseline, without: 0, delta: 0, triggers: triggerCounts.get(effectId) ?? 0 })
      continue
    }
    rows.push({ effectId, baseline, without, delta: baseline - without, triggers: triggerCounts.get(effectId) ?? 0 })
  }

  rows.sort((a, b) => b.delta - a.delta || a.effectId.localeCompare(b.effectId))
  return { status: 'ok', baseline, rows, skipped }
}
