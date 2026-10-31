import type { TeamRunResult } from './teamRun.js'

/**
 * 机制日志：把一轮编排摊成「谁在第几帧做了什么、结算出什么」的逐行文本。
 * 只读结果对象，不重算任何数值——日志里的数就是结果里的数。
 */
export interface RunLogEntry {
  frame: number
  /** 这一帧距开跑过了多少现实毫秒（帧号 × 帧生成时间），与窗口汇总同一口径。 */
  realMs: number
  phase: string
  kind: string
  actorId: string | null
  actionId: string | null
  detail: string
}

export interface RunLog {
  status: TeamRunResult['status']
  accuracy: 'approximate' | 'verified' | null
  entries: RunLogEntry[]
  lines: string[]
}

const round1 = (value: number): number => Math.round(value * 10) / 10

const detailText = (detail: Record<string, unknown> | undefined): string => {
  if (!detail) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'number') parts.push(`${key}=${round1(value)}`)
    else if (typeof value === 'string' || typeof value === 'boolean') parts.push(`${key}=${value}`)
    else if (Array.isArray(value)) parts.push(`${key}=[${value.map(item => (typeof item === 'number' ? round1(item) : String(item))).join(',')}]`)
    else parts.push(`${key}={…}`)
  }
  return parts.join(' ')
}

export function buildRunLog(result: TeamRunResult): RunLog {
  const entries: RunLogEntry[] = []
  const lines: string[] = []
  lines.push(`队伍模拟日志：${result.status}${result.status === 'calculated' ? `（口径 ${result.mode}）` : ''}`)

  if (result.status !== 'calculated') {
    for (const issue of result.issues ?? []) lines.push(`问题：${issue.path} [${issue.code}] ${issue.message}`)
    return { status: result.status, accuracy: null, entries, lines }
  }

  const { timeline, damage } = result
  if (damage.status !== 'calculated') {
    for (const issue of damage.issues ?? []) lines.push(`问题：${issue.path} [${issue.code}] ${issue.message}`)
    return { status: result.status, accuracy: null, entries, lines }
  }
  const { timing } = timeline
  const realMs = (frame: number): number => round1(frame * timing.realMsPerFrame)
  lines.push(`窗口：${timeline.endFrame} 帧 · ${timing.tierId}（${timing.timerTickMs}ms/帧）· 现实 ${round1(timing.realMs)}ms · 游戏 ${round1(timing.gameMs)}ms`)
  lines.push(`精度：${timeline.accuracy}${timeline.approximateItems.length ? `（近似项 ${timeline.approximateItems.join('、')}）` : ''}`)

  for (const event of timeline.events) {
    const entry: RunLogEntry = {
      frame: event.frame,
      realMs: realMs(event.frame),
      phase: event.phase,
      kind: event.kind,
      actorId: event.actorId ?? null,
      actionId: event.actionId ?? null,
      detail: detailText(event.detail)
    }
    entries.push(entry)
    const who = [entry.actorId, entry.actionId].filter(Boolean).join(' / ')
    lines.push(`[${entry.frame}] ${entry.phase} ${entry.kind}${who ? ` · ${who}` : ''}${entry.detail ? ` · ${entry.detail}` : ''}`)
  }

  lines.push(`命中结算：${damage.rows.length} 段，合计 ${round1(damage.total)}`)
  for (const row of damage.rows) {
    const reaction = row.reaction ? `${row.reaction.kind} ${round1(row.reaction.damage)}` : ''
    lines.push(`[${row.frame}] damage ${row.origin} · ${row.actorId} / ${row.actionId} #${row.hitIndex} · ${row.element} 倍率 ${row.motionValue} → ${round1(row.damage)}${reaction ? ` · 反应 ${reaction}` : ''}`)
  }
  if (timeline.requests?.length) {
    const rejected = timeline.requests.filter(request => !request.ok)
    lines.push(`请求：${timeline.requests.length} 次，被拒 ${rejected.length} 次`)
    for (const request of rejected) lines.push(`  被拒 · ${request.stepId} 请求 ${request.requestedFrame} 帧：${request.reason ?? '未给原因'}`)
  }
  return { status: 'calculated', accuracy: timeline.accuracy, entries, lines }
}
