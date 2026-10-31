import type { TeamRunResult } from './teamRun.js'
import { evaluateGolden, type GoldenActual, type GoldenCase } from './metrics.js'
import { gateReactionFamily } from './reactionFamilies.js'

/**
 * 发布闸门：把「能不能对外说这是个结果」拆成几条必须同时成立的硬条件。
 * 只要有一条被拦，整轮就是 blocked；没有任何一条被拦、但有条件还没数据，就是 insufficient-data。
 * 这三态不是措辞游戏：pass 才能拿出去，insufficient-data 说明证据不够而不是结果错了。
 */
export type ReleaseGateStatus = 'pass' | 'blocked' | 'insufficient-data'

export interface ReleaseGateCheck {
  id: string
  status: ReleaseGateStatus
  detail: string
}

export interface ReleaseGateVerdict {
  status: ReleaseGateStatus
  checks: ReleaseGateCheck[]
  /** 被拦的条件 id，按出现顺序。 */
  blocking: string[]
}

export interface ReleaseGateInput {
  result: TeamRunResult
  /** 触发到的反应家族；不传则从结算行里推导。 */
  reactions?: string[]
  /** 黄金集；缺省视为 0 例。 */
  golden?: { cases: GoldenCase[]; actuals: GoldenActual[] }
  /** 计入闸门的最少用例数，缺省 10。 */
  minimumCases?: number
}

const statusOf = (checks: ReleaseGateCheck[]): ReleaseGateStatus => {
  if (checks.some(check => check.status === 'blocked')) return 'blocked'
  if (checks.some(check => check.status === 'insufficient-data')) return 'insufficient-data'
  return 'pass'
}

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateVerdict {
  const checks: ReleaseGateCheck[] = []
  const result = input?.result
  checks.push(!result || result.status !== 'calculated'
    ? { id: 'run', status: 'blocked', detail: `本轮状态是 ${String(result?.status)}，没有可发布的结算结果` }
    : { id: 'run', status: 'pass', detail: '本轮结算成功' })

  if (!result || result.status !== 'calculated') {
    return { status: statusOf(checks), checks, blocking: checks.filter(check => check.status === 'blocked').map(check => check.id) }
  }

  checks.push(result.mode === 'dps-standard'
    ? { id: 'mode', status: 'pass', detail: '按 DPS 标准口径运行' }
    : { id: 'mode', status: 'blocked', detail: '诊断口径不能作为发布结论：目标、窗口、起手能量都可能不是标准值' })

  const approximate = result.timeline.approximateItems ?? []
  const unmodeled = (result.unmodeled ?? []).map(item => `${item.id}（${item.reason}）`)
  checks.push(result.timeline.accuracy === 'verified' && !approximate.length && !unmodeled.length
    ? { id: 'accuracy', status: 'pass', detail: '没有近似项' }
    : { id: 'accuracy', status: 'blocked', detail: `仍有未建模/近似项：${[...approximate, ...unmodeled].join('、') || '未标注'}` })

  const rows = result.damage.status === 'calculated' ? result.damage.rows : []
  const reactions = input.reactions ?? [...new Set(rows.map(row => row.reaction?.kind).filter((kind): kind is string => typeof kind === 'string'))]
  const blockedReactions = reactions.filter(kind => gateReactionFamily(kind).status !== 'ok')
  checks.push(!blockedReactions.length
    ? { id: 'reactions', status: 'pass', detail: reactions.length ? `用到的反应家族都已有 fixture：${reactions.join('、')}` : '本轮没有用到反应' }
    : { id: 'reactions', status: 'blocked', detail: `这些反应家族还没有 fixture：${blockedReactions.join('、')}` })

  const violations = (result.plan?.checks ?? []).filter(check => check.status === 'violation')
  checks.push(!violations.length
    ? { id: 'resources', status: 'pass', detail: '机制资源检查没有违规' }
    : { id: 'resources', status: 'blocked', detail: violations.map(check => `${check.id}: ${check.message}`).join('；') })

  const minimum = Number.isInteger(input.minimumCases) && (input.minimumCases as number) > 0 ? input.minimumCases as number : 10
  const cases = input.golden?.cases ?? []
  const actuals = input.golden?.actuals ?? []
  if (cases.length < minimum) {
    checks.push({ id: 'golden', status: 'insufficient-data', detail: `黄金集只有 ${cases.length} 例，差 ${minimum - cases.length} 例（至少 ${minimum} 例合格场景）` })
  } else {
    const report = evaluateGolden(cases, actuals)
    checks.push(report.gate === 'pass'
      ? { id: 'golden', status: 'pass', detail: `黄金集 ${report.counted} 例计入闸门，中位误差 ${report.median === null ? '—' : report.median}` }
      : { id: 'golden', status: 'blocked', detail: `黄金集未过闸门：${report.reason}` })
  }

  return { status: statusOf(checks), checks, blocking: checks.filter(check => check.status === 'blocked').map(check => check.id) }
}

/** 把闸门结论排成可读行；`pass` 之外都写明卡在哪一条。 */
export function formatReleaseGate(verdict: ReleaseGateVerdict): string[] {
  const lines = [`发布闸门：${verdict.status}`]
  for (const check of verdict.checks) lines.push(`  ${check.id}=${check.status} · ${check.detail}`)
  if (verdict.blocking.length) lines.push(`  阻断项：${verdict.blocking.join('、')}`)
  return lines
}
