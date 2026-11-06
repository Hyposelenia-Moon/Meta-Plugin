import type { CharacterBuild, Failure, Issue, PermanentData } from './types.js'
import type { EffectSpec, EffectTriggerKind } from './effects.js'
import { buildPermanentStats, validateCharacterBuild, type PermanentDataExpectation } from './build.js'
import { simulateTimeline, type TimelineResult } from './timeline.js'
import { calculateTimelineDamage, type CritPolicy, type DamageContext, type DamageDebuffs, type TimelineDamageResult } from './hitDamage.js'
import { validateDataPack, type DataPack } from './dataPack.js'
import { validateRotation, type RotationSpec } from './rotation.js'
import { checkDpsStandard, type DpsStandardViolation } from './dpsStandard.js'
import { planMechanisms, type MechanismPlan } from './mechanisms.js'

export interface TeamMemberInput {
  build: CharacterBuild
  permanentData: PermanentData
}

/**
 * `dps-standard`：默认口径，必须满足 110 级小宝、10% 抗性、120 秒、0 初始能量，才能报 DPS。
 * `diagnostic`：内部诊断用，跑非标准窗口不报 DPS，报告里会写明口径——不是给对外结论用的。
 */
export type TeamRunMode = 'dps-standard' | 'diagnostic'

export interface TeamRunInput {
  pack: DataPack
  rotation: RotationSpec
  members: TeamMemberInput[]
  /** 永久数据包的三元组期望值；与实际数据不一致时整轮拒绝。 */
  expected: PermanentDataExpectation
  targetPresetId: string
  crit: CritPolicy
  debuffs: DamageDebuffs
  /** 缺省按 DPS 标准口径强制校验；诊断模式必须显式声明。 */
  mode?: TeamRunMode
  /** 打开后逐关记录耗时（毫秒），用于性能报告；关掉时结果为 null，不引入额外开销。 */
  instrument?: boolean
  /**
   * 反应来源：缺省仍按数据包逐条声明；`simulated` 由附着状态机推导。
   * 切换会改变反应次数，闸门与黄金基线需要重算。
   */
  auraMode?: 'declared' | 'simulated'
}

export interface TeamRunCheck {
  stage: 'data-pack' | 'versions' | 'rotation' | 'dps-standard' | 'members' | 'mechanisms' | 'timeline' | 'damage'
  status: string
  issues: Issue[]
}

export type TeamRunResult = {
  status: 'calculated'
  scope: 'team-run-no-reaction'
  simulationReady: false
  mode: TeamRunMode
  checks: TeamRunCheck[]
  /** 两侧版本必须一致才跑；结果里再透出一次，方便核对用到的是哪份数据。 */
  versions: { pack: string; panels: string }
  timeline: TimelineResult
  damage: TimelineDamageResult
  plan: MechanismPlan
  /** 只有标准口径才给 DPS；诊断模式为 null。 */
  dps: { total: number; windowSeconds: number; value: number } | null
  /** 静态部分已计入、但条件/运行时部分没建模的效果；披露用，不放行。 */
  unmodeled: { actorId: string; id: string; reason: string }[]
  /** 每个角色在窗口结束时的能量与上限，外加起手能量；能量披露用。 */
  energy: { actorId: string; start: number; end: number; max: number }[]
  /** 逐关耗时（毫秒）；未开 `instrument` 时为 null。 */
  timings: Record<string, number> | null
  issues: []
} | (Failure & { checks: TeamRunCheck[] })

const fail = (status: 'invalid' | 'unsupported' | 'incomplete', checks: TeamRunCheck[], issues: Issue[]): TeamRunResult => ({ status, checks, issues })

/**
 * 关状态与整轮状态用同一套归类：有 unsupported 先报 unsupported，其次 invalid，
 * 只剩缺字段才算 incomplete——缺字段与写错值是两种不同的修法，不能都塞进 invalid。
 */
const statusOf = (issues: Issue[]): 'ok' | 'invalid' | 'unsupported' | 'incomplete' =>
  !issues.length ? 'ok'
    : issues.some(issue => issue.code === 'unsupported') ? 'unsupported'
      : issues.some(issue => issue.code === 'invalid') ? 'invalid'
        : 'incomplete'

const dpsViolationToIssue = (violation: DpsStandardViolation): Issue => ({ code: 'invalid', path: violation.path, message: violation.message })

/**
 * 编排：数据包 → 轴 → DPS 口径 → 每个成员的面板 → 机制规划 → 时间线 → 每段命中结算。
 * 任何一关不过就整轮拒绝，不拿默认值降级；结果里保留每关的 issues 便于定位。
 */
export function simulateTeam(input: TeamRunInput): TeamRunResult {
  const checks: TeamRunCheck[] = []
  if (!input || typeof input !== 'object') return fail('invalid', checks, [{ code: 'invalid', path: 'input', message: '输入必须是对象' }])
  const mode: TeamRunMode = input.mode ?? 'dps-standard'
  if (mode !== 'dps-standard' && mode !== 'diagnostic') {
    return fail('unsupported', checks, [{ code: 'unsupported', path: 'mode', message: `未知运行模式 ${String(mode)}` }])
  }

  const timings: Record<string, number> = {}
  let lapStart = input.instrument ? performance.now() : 0
  const lap = (stage: string): void => {
    if (!input.instrument) return
    const now = performance.now()
    timings[stage] = Math.round((now - lapStart) * 1000) / 1000
    lapStart = now
  }

  const packResult = validateDataPack(input.pack)
  checks.push({ stage: 'data-pack', status: packResult.status, issues: packResult.issues })
  lap('data-pack')
  if (packResult.status !== 'ok') return fail(packResult.status === 'version-mismatch' ? 'invalid' : packResult.status, checks, packResult.issues)

  // 包与面板必须同版本：帧表来自一份版本、属性表来自另一份，跑出来的数没有统一基准。
  const panelsVersion = typeof input.expected?.gameVersion === 'string' ? input.expected.gameVersion : ''
  const versionIssues: Issue[] = []
  if (!panelsVersion) versionIssues.push({ code: 'missing', path: 'expected.gameVersion', message: '必须给出面板数据版本，才能与数据包版本比对' })
  else if (packResult.pack.gameVersion !== panelsVersion) versionIssues.push({ code: 'invalid', path: 'pack.gameVersion', message: `数据包版本 ${packResult.pack.gameVersion} 与面板数据版本 ${panelsVersion} 不一致：跨版本混跑没有意义` })
  const versionsStatus = statusOf(versionIssues)
  checks.push({ stage: 'versions', status: versionsStatus, issues: versionIssues })
  lap('versions')
  if (versionsStatus !== 'ok') return fail(versionsStatus, checks, versionIssues)

  const rotationIssues = validateRotation(input.rotation, packResult.pack)
  const rotationStatus = statusOf(rotationIssues)
  checks.push({ stage: 'rotation', status: rotationStatus, issues: rotationIssues })
  lap('rotation')
  if (rotationStatus !== 'ok') return fail(rotationStatus, checks, rotationIssues)

  // DPS 标准口径：对外只认 110 级小宝、10% 抗性、120 秒、0 初始能量。诊断模式显式跳过，并在结果里标出来。
  if (mode === 'dps-standard') {
    const violations = checkDpsStandard({
      frameTier: input.rotation.frameTier,
      targetPresetId: input.targetPresetId,
      measurementEndFrame: input.rotation.measurementEndFrame,
      actors: input.rotation.actors
    })
    const dpsIssues = violations.map(dpsViolationToIssue)
    const dpsStatus = statusOf(dpsIssues)
    checks.push({ stage: 'dps-standard', status: dpsStatus, issues: dpsIssues })
    lap('dps-standard')
    if (dpsStatus !== 'ok') return fail(dpsStatus, checks, dpsIssues)
  }

  const members = input.members
  if (!Array.isArray(members) || !members.length) {
    const issues: Issue[] = [{ code: 'missing', path: 'members', message: '至少要有一个成员的配装与永久数据' }]
    checks.push({ stage: 'members', status: 'incomplete', issues })
    return fail('incomplete', checks, issues)
  }
  const memberIssues: Issue[] = []
  const contexts: Record<string, DamageContext> = {}
  const builds: Record<string, CharacterBuild> = {}
  const unmodeled: { actorId: string; id: string; reason: string }[] = []
  const permanentByActor: Record<string, PermanentData> = {}
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
    builds[build.actorId] = build
    permanentByActor[build.actorId] = member.permanentData as PermanentData
    for (const item of permanent.unmodeled) unmodeled.push({ actorId: build.actorId, id: item.id, reason: item.reason })
    contexts[build.actorId] = {
      level: build.level,
      stats: permanent.stats,
      // 白值：atkPct/hpPct/defPct 一类百分比加成的折算基准（武器白值含在 atk 里）
      base: { hp: permanent.base.hp, atk: permanent.base.atk, def: permanent.base.def },
      targetPresetId: input.targetPresetId,
      crit: input.crit,
      gameVersion: permanent.gameVersion,
      source: permanent.bundleId,
      debuffs: input.debuffs
    }
  })
  // 轴上出手的角色必须有面板，否则命中无法结算；只有切人经过的角色可以没有面板，但必须在 rotation.actors 登记（由 validateRotation 把关）。
  for (const step of input.rotation.steps) {
    if (step.kind === 'action' && step.actorId && !contexts[step.actorId]) {
      memberIssues.push({ code: 'unsupported', path: 'members', message: `轴上出手的角色 ${step.actorId} 没有可用的面板` })
    }
  }
  const memberStatus = statusOf(memberIssues)
  checks.push({ stage: 'members', status: memberStatus, issues: memberIssues })
  lap('members')
  if (memberStatus !== 'ok') return fail(memberStatus, checks, memberIssues)

  const { plan, issues: mechanismIssues } = planMechanisms({
    pack: packResult.pack,
    rotation: input.rotation,
    builds,
    contexts,
    tier: input.rotation.frameTier
  })
  const violationIssues: Issue[] = plan.checks
    .filter(check => check.status === 'violation')
    .map(check => ({ code: 'invalid', path: `mechanisms.${check.id}`, message: check.message }))
  const allMechanismIssues = [...mechanismIssues, ...violationIssues]
  const mechanismStatus = statusOf(allMechanismIssues)
  checks.push({ stage: 'mechanisms', status: mechanismStatus, issues: allMechanismIssues })
  lap('mechanisms')
  if (mechanismStatus !== 'ok') return fail(mechanismStatus, checks, allMechanismIssues)

  /*
   * 4 件套触发式（2026-11-02）：只并入真正穿在身上的套装的运行时效果。
   * 永久数据是按角色+武器一次生成的，里面包含全部 63 套的 `runtimeEffects`；
   * 这里用本队实际圣遗物的 setId 过滤，避免「没穿也触发」。
   */
  const effects: Record<string, EffectSpec> = { ...(packResult.pack.effects ?? {}) }
  const effectTriggers: Array<{ effectId: string; actorId: string; on: EffectTriggerKind }> = []
  for (const [actorId, data] of Object.entries(permanentByActor)) {
    const setCounts = new Map<string, number>()
    for (const artifact of builds[actorId].artifacts) setCounts.set(artifact.setId, (setCounts.get(artifact.setId) ?? 0) + 1)
    for (const [effectId, spec] of Object.entries(data.runtimeEffects ?? {})) {
      const setId = /^artifact-set:([^:]+):/.exec(effectId)?.[1]
      if (!setId || (setCounts.get(setId) ?? 0) < 4) continue
      effects[effectId] = spec
      effectTriggers.push({ effectId, actorId, on: spec.trigger })
      for (const extra of spec.extraTriggers ?? []) effectTriggers.push({ effectId, actorId, on: extra })
    }
  }
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
    stateFlags: input.rotation.stateFlags,
    effects,
    ...(effectTriggers.length ? { effectTriggers } : {}),
    ...(input.auraMode ? { auraMode: input.auraMode } : {})
  })
  checks.push({ stage: 'timeline', status: timeline.status === 'simulated' ? 'ok' : timeline.status, issues: timeline.issues })
  lap('timeline')
  if (timeline.status !== 'simulated') return fail('invalid', checks, timeline.issues)

  const damage = calculateTimelineDamage({ timeline, contexts, plan })
  checks.push({ stage: 'damage', status: damage.status === 'calculated' ? 'ok' : damage.status, issues: damage.issues })
  lap('damage')
  if (damage.status !== 'calculated') return fail(damage.status, checks, damage.issues)

  const windowSeconds = input.rotation.measurementEndFrame / input.rotation.frameTier.fps
  return {
    status: 'calculated',
    scope: 'team-run-no-reaction',
    simulationReady: false,
    mode,
    checks,
    versions: { pack: packResult.pack.gameVersion, panels: panelsVersion },
    timeline,
    damage,
    plan,
    dps: mode === 'dps-standard' ? { total: damage.total, windowSeconds, value: damage.total / windowSeconds } : null,
    unmodeled,
    energy: (input.rotation.actors ?? []).map(actor => {
      const final = timeline.actors.find(item => item.actorId === actor.actorId)
      return { actorId: actor.actorId, start: actor.energy, end: final?.energy ?? actor.energy, max: actor.energyMax }
    }),
    timings: input.instrument ? timings : null,
    issues: []
  }
}
