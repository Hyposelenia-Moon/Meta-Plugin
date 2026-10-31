import type { CharacterBuild, Failure, Issue, PermanentData } from './types.js'
import { buildPermanentStats, validateCharacterBuild, type PermanentDataExpectation } from './build.js'
import { simulateTimeline, type TimelineResult } from './timeline.js'
import { calculateTimelineDamage, type CritPolicy, type DamageContext, type DamageDebuffs, type TimelineDamageResult } from './hitDamage.js'
import { validateDataPack, type DataPack } from './dataPack.js'
import { validateRotation, type RotationSpec } from './rotation.js'

export interface TeamMemberInput {
  build: CharacterBuild
  permanentData: PermanentData
}

export interface TeamRunInput {
  pack: DataPack
  rotation: RotationSpec
  members: TeamMemberInput[]
  /** 永久数据包的三元组期望值；与实际数据不一致时整轮拒绝。 */
  expected: PermanentDataExpectation
  targetPresetId: string
  crit: CritPolicy
  debuffs: DamageDebuffs
}

export interface TeamRunCheck {
  stage: 'data-pack' | 'rotation' | 'members' | 'timeline' | 'damage'
  status: string
  issues: Issue[]
}

export type TeamRunResult = {
  status: 'calculated'
  scope: 'team-run-no-reaction'
  simulationReady: false
  checks: TeamRunCheck[]
  timeline: TimelineResult
  damage: TimelineDamageResult
  issues: []
} | (Failure & { checks: TeamRunCheck[] })

const fail = (status: 'invalid' | 'unsupported' | 'incomplete', checks: TeamRunCheck[], issues: Issue[]): TeamRunResult => ({ status, checks, issues })

/**
 * 编排：数据包 → 轴 → 每个成员的面板 → 时间线 → 每段命中结算。
 * 任何一关不过就整轮拒绝，不拿默认值降级；结果里保留每关的 issues 便于定位。
 */
export function simulateTeam(input: TeamRunInput): TeamRunResult {
  const checks: TeamRunCheck[] = []
  if (!input || typeof input !== 'object') return fail('invalid', checks, [{ code: 'invalid', path: 'input', message: '输入必须是对象' }])

  const packResult = validateDataPack(input.pack)
  checks.push({ stage: 'data-pack', status: packResult.status, issues: packResult.issues })
  if (packResult.status !== 'ok') return fail(packResult.status === 'version-mismatch' ? 'invalid' : packResult.status, checks, packResult.issues)

  const rotationIssues = validateRotation(input.rotation, packResult.pack)
  checks.push({ stage: 'rotation', status: rotationIssues.length ? 'invalid' : 'ok', issues: rotationIssues })
  if (rotationIssues.length) return fail(rotationIssues.some(i => i.code === 'unsupported') ? 'unsupported' : 'invalid', checks, rotationIssues)

  const members = input.members
  if (!Array.isArray(members) || !members.length) {
    const issues: Issue[] = [{ code: 'missing', path: 'members', message: '至少要有一个成员的配装与永久数据' }]
    checks.push({ stage: 'members', status: 'incomplete', issues })
    return fail('incomplete', checks, issues)
  }
  const memberIssues: Issue[] = []
  const contexts: Record<string, DamageContext> = {}
  const actorIds = new Set<string>()
  members.forEach((member, index) => {
    const p = `members.${index}`
    const buildResult = validateCharacterBuild(member?.build)
    if (buildResult.status !== 'raw-complete') {
      memberIssues.push(...buildResult.issues.map(issue => ({ ...issue, path: `${p}.build.${issue.path}` })))
      return
    }
    const build = buildResult.build
    if (actorIds.has(build.actorId)) { memberIssues.push({ code: 'invalid', path: `${p}.build.actorId`, message: `角色实例 ${build.actorId} 重复登记` }); return }
    actorIds.add(build.actorId)
    const permanent = buildPermanentStats(build, member.permanentData, input.expected)
    if (permanent.status !== 'permanent-ready') {
      memberIssues.push(...permanent.issues.map(issue => ({ ...issue, path: `${p}.permanentData.${issue.path}` })))
      return
    }
    contexts[build.actorId] = {
      level: build.level,
      stats: permanent.stats,
      targetPresetId: input.targetPresetId,
      crit: input.crit,
      gameVersion: permanent.gameVersion,
      source: permanent.bundleId,
      debuffs: input.debuffs
    }
  })
  // 轴上出手的角色必须有面板，否则命中无法结算；只有切人经过的角色可以没有。
  for (const step of input.rotation.steps) {
    if (step.kind === 'action' && step.actorId && !contexts[step.actorId]) {
      memberIssues.push({ code: 'unsupported', path: 'members', message: `轴上出手的角色 ${step.actorId} 没有可用的面板` })
    }
  }
  checks.push({ stage: 'members', status: memberIssues.length ? 'invalid' : 'ok', issues: memberIssues })
  if (memberIssues.length) return fail(memberIssues.some(i => i.code === 'unsupported') ? 'unsupported' : 'invalid', checks, memberIssues)

  const timeline = simulateTimeline({
    scheduler: input.rotation.scheduler,
    steps: input.rotation.steps,
    actions: packResult.pack.actions,
    actors: input.rotation.actors,
    activeActorId: input.rotation.activeActorId,
    frameTier: input.rotation.frameTier,
    measurementEndFrame: input.rotation.measurementEndFrame,
    switchFrames: input.rotation.switchFrames,
    energyRecharge: input.rotation.energyRecharge,
    stateFlags: input.rotation.stateFlags
  })
  checks.push({ stage: 'timeline', status: timeline.status === 'simulated' ? 'ok' : timeline.status, issues: timeline.issues })
  if (timeline.status !== 'simulated') return fail('invalid', checks, timeline.issues)

  const damage = calculateTimelineDamage({ timeline, contexts })
  checks.push({ stage: 'damage', status: damage.status === 'calculated' ? 'ok' : damage.status, issues: damage.issues })
  if (damage.status !== 'calculated') return fail(damage.status, checks, damage.issues)

  return { status: 'calculated', scope: 'team-run-no-reaction', simulationReady: false, checks, timeline, damage, issues: [] }
}
