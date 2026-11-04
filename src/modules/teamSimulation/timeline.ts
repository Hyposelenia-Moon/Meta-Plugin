/**
 * P1 时间内核：整数帧、事件队列、动作生命周期与资源合法性。
 *
 * 这里只排时间与合法性，不算伤害；每个 hit 由调用方交给 P0 的 `calculateOrdinaryHit` 结算。
 * 帧是调度单位：所有时长以整数帧表达，小数帧不退化为四舍五入，直接拒绝。
 * 帧率不在核心里写死，由调用方显式给 `frameTier`：同一段帧序列在不同档位上对应的
 * 现实时间与游戏计时器时间不一样，给默认值等于把前提藏起来。
 */
import type { Issue } from './types.js'
import { createEffectRuntime, NO_ENEMY_MODIFIERS, type ActiveEffectState, type EffectSpec, type EnemyModifiers, type PanelModifiers, type ReactionBonus, type TriggerRecord } from './effects.js'
import { describeMismatch, describeSpecialMismatch, isReactiveKind, isSpecialKind, isStatefulKind, statefulReason, type ReactionElement } from './reactions.js'

/** 数据编帧用的标称帧率。60 档位上一帧的真实时长是 16.667ms，不是整数毫秒。 */
export const FRAME_RATE = 60

/**
 * 帧率档位：把「帧」换算成现实时间与游戏计时器时间所需的三件事。
 *
 * - `fps`：实测帧数，一帧的现实时间 = 1000 / fps 毫秒。
 * - `timerTickMs`：游戏计时器每帧推进的整数毫秒，等于 round(1000 / fps)。
 *   引擎计时器按整毫秒累加，帧时间取整后每帧多算或少算不到 1ms，长动作上会累积成可见偏差。
 * - 技能文本里的「一秒」是游戏时间，它对应的现实秒数 = (1000 / fps) / timerTickMs，
 *   也就是视频里的「计时器时间」：小于 1 是快帧，大于 1 是慢帧。
 *
 * 数值取自《原神帧率学》的计时器型帧率档位表（BV1Z8rLBGEeo）；表里第一列是在解锁插件里
 * 输入的帧数，不是游戏内常量。这里只收表内实测值，不插值、不猜。
 */
export interface FrameTier {
  readonly id: string
  readonly fps: number
  readonly timerTickMs: number
  readonly source: string
}

const tierSource = '原神帧率学 计时器型帧率档位表（BV1Z8rLBGEeo）'

export const FRAME_TIERS: Record<string, FrameTier> = {
  'fps-56': { id: 'fps-56', fps: 56.31477, timerTickMs: 18, source: tierSource },
  'fps-60': { id: 'fps-60', fps: 60.36144, timerTickMs: 17, source: tierSource },
  'fps-64': { id: 'fps-64', fps: 64.41135, timerTickMs: 16, source: tierSource },
  'fps-73': { id: 'fps-73', fps: 73.5355, timerTickMs: 14, source: tierSource },
  'fps-104': { id: 'fps-104', fps: 105.0891, timerTickMs: 10, source: tierSource },
  'fps-217': { id: 'fps-217', fps: 221.7778, timerTickMs: 5, source: tierSource },
  'fps-384': { id: 'fps-384', fps: 399.1304, timerTickMs: 3, source: tierSource },
  'fps-625': { id: 'fps-625', fps: 665.7423, timerTickMs: 2, source: tierSource }
}

/**
 * 同帧事件的相位顺序由机制规则决定，不能按角色 id 或插入顺序排。
 * 这里固定的是结算骨架：起手 → 扣费 → 施放快照 → 命中 → 伤害 → 触发 → 回能 → 其他状态。
 * 未查清且会改变结果的同帧先后，只能记歧义，不能拿这个表硬套。
 */
export const EVENT_PHASES = ['action-start', 'cost', 'snapshot', 'hit', 'damage', 'trigger', 'energy', 'state'] as const
export type EventPhase = typeof EVENT_PHASES[number]

export type ActionKind = 'normal' | 'charged' | 'plunge' | 'skill' | 'burst' | 'switch'

/** 命中元素：物理不吃元素反应，其余七种都可以。 */
export type HitElement = 'physical' | 'pyro' | 'hydro' | 'electro' | 'cryo' | 'anemo' | 'geo' | 'dendro'

const HIT_ELEMENTS: readonly HitElement[] = ['physical', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro']

/**
 * 命中上的反应声明。aura 是命中瞬间目标身上的附着，由数据声明而不是由引擎推断；
 * 月反应与星烁额外带专用加成与计数，缺省值见 reactions.ts 的说明。
 */
export interface ReactionDeclaration {
  readonly kind: string
  readonly aura: string
  /** 仅月反应与星烁：是否吃到「月曜反应伤害提升」这类天赋倍率。 */
  readonly talent?: boolean
  /** 仅星超导与星辉冰旋：叠层计数，缺省用 reactions.ts 的兜底值。与 `countFrom` 互斥。 */
  readonly count?: number
  /**
   * 从效果表的同名效果读当前层数作为计数（月反应与星烁的叠层由效果负责累加，
   * 引擎不猜「命中几次就该几层」）。与 `count` 互斥。
   */
  readonly countFrom?: string
  /** 专用反应加成，乘在等级系数上。 */
  readonly fypct?: number
  /** 固定加值，与 miao 的 fyplus 同位置。 */
  readonly fyplus?: number
  /** 提升乘区。 */
  readonly elevated?: number
  /** 反应系数乘区。 */
  readonly kNum?: number
}

export interface HitSpec {
  /** 相对动作起手帧的偏移，必须是非负整数且落在动作时长内。 */
  atFrame: number
  motionValue: number
  /** 这一段按哪一项面板属性结算：倍率乘的是攻击、生命还是防御。数据必须显式给，不设默认。 */
  scaling: 'atk' | 'hp' | 'def'
  element: HitElement
  canCrit: boolean
  /** 命中后触发的效果 id；同帧先后由规则表解析，不写死在数据里。 */
  triggerIds?: string[]
  /**
   * 这一段命中造成的卡肉（命中停顿）帧数。窗口 `[命中帧, 命中帧 + 本值)` 内游戏时钟冻结：
   * 排在这之后的事件、冷却期限、效果到期一律顺延同样帧数，现实帧照常消耗。
   * 时长来自数据，P1 不校准，用到时结果标 approximate。
   */
  /** 命中帧相对动作起手，延迟命中允许越过动作结束帧：它由后续事件触发，不受本动作收尾约束。 */
  delayed?: boolean
  hitlagFrames?: number
  /**
   * 这一发命中的元素反应。ura 是命中瞬间目标身上的附着元素，由数据声明；
   * 附着量、衰减与 ICD 不在 P1 建模范围内（见数据包文档的反应段）。
   */
  reaction?: ReactionDeclaration
}

/** 可取消窗口：动作起手后这段时间内可以接下一次动作。 */
export interface CancelWindow { fromFrame: number; toFrame: number }

export interface ParticleSpec {
  atFrame: number
  count: number
  /** 2026-11-02：粒子的元素与命中元素同一套，另加 `clear`（无元素） */
  element: HitElement | 'clear'
  /** 粒子飞到收取者所需的帧数；到达时才加能量。 */
  travelFrames: number
}

/**
 * 动作直接回能（2026-11-02）：爆发/领域在指定帧给全队（或自己）加能量，不走粒子。
 * tFrame 相对动作起手，允许超过动作时长（爆发后持续回能）。
 */
export interface EnergyRestoreSpec {
  atFrame: number
  amount: number
  /** 缺省 team：全队每人各加 amount；self 只加施放者 */
  target?: 'team' | 'self'
  /** 雷神 A4：按施放者充能效率超过 100% 的部分放大（每 1% 加 0.6%） */
  rechargeScaling?: boolean
}

/**
 * 动作时长口径。计时器型按帧数给（帧率档位不影响帧号），响应型按现实时长给：
 * `现实时长 = k × 帧生成时间 + bMs`，再按当前档位折算成整数帧——同一动作换档位帧数会变。
 * 两种口径都由数据声明，内核不猜、不插值。
 */
export type ActionTiming =
  | { type: 'frames'; frames: number }
  | { type: 'response'; k: number; bMs: number }

export interface ActionSpec {
  id: string
  actorId: string
  kind: ActionKind
  timing: ActionTiming
  hits: HitSpec[]
  cancelWindows?: CancelWindow[]
  particles?: ParticleSpec[]
  /**
   * 延迟产球（2026-11-02）：召唤物/持续效果在动作结束后产出的粒子。
   * `atFrame` 同样相对动作起手，但**允许超过动作时长**；这类事件不会被下一个动作取消。
   */
  delayedParticles?: ParticleSpec[]
  /**
   * 动作直接回能（2026-11-02）：爆发/领域在指定帧给全队或自己加能量，不走粒子。
   * `atFrame` 相对动作起手，允许超过动作时长；事件不会被下一个动作取消。
   */
  energyRestore?: EnergyRestoreSpec[]
  energyCost?: number
  cooldownFrames?: number
  cooldownId?: string
  requires?: string[]
  mechanism?: string
}

export type TimelineStep =
  | { id: string; kind: 'action'; actorId: string; actionId: string; atFrame?: number; optional?: boolean }
  | { id: string; kind: 'switch'; actorId: string; atFrame?: number }
  | { id: string; kind: 'wait'; frames: number }

export interface ActorInit {
  actorId: string
  energy: number
  energyMax: number
}

export interface TimelineInput {
  /** `fixed`：帧号必须成立，不成立就报失败帧；`asap-sequence`：按序列尽早执行，报告等待。 */
  scheduler: 'fixed' | 'asap-sequence'
  steps: TimelineStep[]
  actions: Record<string, ActionSpec>
  actors: ActorInit[]
  activeActorId: string
  /** 帧率档位：帧对应的现实时间与计时器时间都由它决定，不设缺省。 */
  frameTier: FrameTier
  /** 测量窗口终点；超过后不再执行新动作。 */
  measurementEndFrame: number
  /** 切人动画占用的帧数；数据决定，0 表示同帧可行动。 */
  switchFrames?: number
  /** 元素充能效率：粒子到达时按此倍率回能。数据给出，内核不猜。 */
  energyRecharge?: Record<string, number>
  /** 已满足的状态标记，用于 `requires` 门槛。 */
  stateFlags?: string[]
  /** 效果表：命中段的 `triggerIds` 按这张表结算，未登记的一律拒绝。 */
  effects?: Record<string, EffectSpec>
  /**
   * 动作起手触发的效果（4 件套「施放战技/爆发后」）：角色起手对应类型的动作时激活。
   * 只列真正穿在身上的套装，别把全库套装都塞进来。
   */
  effectTriggers?: Array<{ effectId: string; actorId: string; on: 'cast-skill' | 'cast-burst' | 'skill-hit' }>
}

export interface TimelineHit {
  frame: number
  actorId: string
  actionId: string
  hitIndex: number
  motionValue: number
  scaling: 'atk' | 'hp' | 'def'
  element: HitElement
  canCrit: boolean
  triggerIds: string[]
  /** 数据声明的元素反应；ura 是命中瞬间目标身上的附着。 */
  reaction?: ReactionDeclaration
  /** 该命中结算时实际生效的修饰：面板增量与全局敌人减益。触发先于伤害之外的效果不影响这一发。 */
  modifiers: { stats: PanelModifiers; enemy: EnemyModifiers; reaction: ReactionBonus }
  /** 该命中结算时「在场」的效果 id（快照早于本发携带的触发，所以自己不吃自己的加成）。 */
  activeEffects: string[]
}

export type TimelineEventKind = 'action-start' | 'hit' | 'particle' | 'energy-restore' | 'action-end' | 'switch' | 'wait' | 'rejected' | 'trigger'

export interface TimelineEvent {
  frame: number
  phase: EventPhase
  sequence: number
  kind: TimelineEventKind
  actorId?: string
  actionId?: string
  detail?: Record<string, unknown>
}

export interface TimelineRequest {
  stepId: string
  requestedFrame: number
  actualFrame: number | null
  ok: boolean
  reason?: string
}

export interface TimelineTiming {
  tierId: string
  fps: number
  timerTickMs: number
  /** 一帧在游戏计时器上推进的毫秒数。 */
  gameMsPerFrame: number
  /** 一帧占用的现实毫秒数。 */
  realMsPerFrame: number
  /** 技能文本一秒对应的现实秒数：小于 1 是快帧，大于 1 是慢帧。 */
  timerSecondsPerGameSecond: number
  /** 整轮里卡肉冻结掉的现实帧数：现实时长包含它们，游戏时长不包含。 */
  hitlagFrames: number
  /** 测量窗口结束帧对应的游戏时长与现实时长。 */
  gameMs: number
  realMs: number
  /** 内核的时间假设，必须在结果里透出，不能只写在文档里。 */
  assumptions: string[]
}

export interface TimelineResult {
  status: 'simulated' | 'invalid'
  simulationReady: false
  accuracy: 'approximate' | 'verified'
  timing: TimelineTiming
  approximateItems: string[]
  endFrame: number
  events: TimelineEvent[]
  hits: TimelineHit[]
  /** 每次实际生效的触发；叠层已满或被 ignore 策略跳过时不记录。 */
  triggers: TriggerRecord[]
  /** 窗口结束时的存续效果快照。 */
  effects: ActiveEffectState[]
  actors: { actorId: string; energy: number; energyMax: number; cooldowns: Record<string, number> }[]
  requests: TimelineRequest[]
  issues: Issue[]
}

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 校验帧率档位：帧率与计时器取整必须自洽，否则一帧到底多长没有唯一答案。 */
export function validateFrameTier(tier: FrameTier | undefined | null): Issue[] {
  if (tier === undefined || tier === null) return [{ code: 'missing', path: 'frameTier', message: '必须显式给出帧率档位：一帧的现实时长与计时器时长都由它决定' }]
  const issues: Issue[] = []
  if (typeof tier.id !== 'string' || !tier.id.trim()) issues.push({ code: 'invalid', path: 'frameTier.id', message: '档位 id 不能为空' })
  if (!isFiniteNumber(tier.fps) || tier.fps <= 0) issues.push({ code: 'invalid', path: 'frameTier.fps', message: '帧率必须是正的有限数值' })
  if (!isInteger(tier.timerTickMs) || tier.timerTickMs <= 0) issues.push({ code: 'invalid', path: 'frameTier.timerTickMs', message: '计时器每帧推进的毫秒数必须是正整数' })
  if (isFiniteNumber(tier.fps) && tier.fps > 0 && isInteger(tier.timerTickMs)) {
    const expected = Math.round(1000 / tier.fps)
    if (tier.timerTickMs !== expected) {
      issues.push({ code: 'invalid', path: 'frameTier.timerTickMs', message: `计时器取整与帧率不自洽：${1000 / tier.fps}ms 应取整为 ${expected}ms，不是 ${tier.timerTickMs}ms` })
    }
  }
  return issues
}

export interface ResolvedTiming {
  /** 折算到当前档位后的整数帧数；数据不自洽或档位缺失时为 NaN。 */
  frames: number
  /** 该动作占用的现实毫秒数。 */
  realMs: number
  model: 'timer' | 'response'
}

/**
 * 把动作时长折算成帧：计时器型直接取帧数，响应型按 `k × 帧生成时间 + bMs` 算现实时长再向上取整到帧。
 * 向上取整是因为引擎逐帧检查动作是否结束：到点后的第一帧才真正结束。
 */
export function resolveActionTiming(timing: ActionTiming | undefined, tier: FrameTier | undefined): ResolvedTiming {
  const msPerFrame = tier && isFiniteNumber(tier.fps) && tier.fps > 0 ? 1000 / tier.fps : NaN
  if (!timing || typeof timing !== 'object') return { frames: NaN, realMs: NaN, model: 'timer' }
  if (timing.type === 'frames') {
    const valid = isInteger(timing.frames) && timing.frames > 0
    return { frames: valid ? timing.frames : NaN, realMs: valid ? timing.frames * msPerFrame : NaN, model: 'timer' }
  }
  if (timing.type !== 'response') return { frames: NaN, realMs: NaN, model: 'timer' }
  const { k, bMs } = timing
  if (!isFiniteNumber(k) || !isFiniteNumber(bMs) || k < 0 || bMs < 0 || k + bMs <= 0 || !Number.isFinite(msPerFrame)) {
    return { frames: NaN, realMs: NaN, model: 'response' }
  }
  const realMs = k * msPerFrame + bMs
  return { frames: Math.ceil(realMs / msPerFrame - 1e-9), realMs, model: 'response' }
}

/** 校验单个动作数据：帧、倍率、窗口、产球与冷却。任何小数帧都不放过。 */
export function validateActionSpec(spec: ActionSpec): Issue[] {
  const issues: Issue[] = []
  const p = `actions.${spec?.id ?? '<missing>'}`
  const add = (code: Issue['code'], path: string, message: string) => issues.push({ code, path, message })
  if (!spec || typeof spec !== 'object') return [{ code: 'missing', path: p, message: '动作数据缺失' }]
  if (!spec.id) add('missing', `${p}.id`, '动作必须有稳定 id')
  if (!spec.actorId) add('missing', `${p}.actorId`, '动作必须归属一个角色')
  if (!['normal', 'charged', 'plunge', 'skill', 'burst', 'switch'].includes(spec.kind)) add('unsupported', `${p}.kind`, `未知动作类型 ${String(spec.kind)}`)
  const timing = spec.timing
  // 时长的结构校验与帧数校验分开：响应型的帧数要等档位给定后才能算，不能在这里假装知道。
  if (!timing || typeof timing !== 'object') add('missing', `${p}.timing`, '必须显式声明动作时长口径（frames 或 response）')
  else if (timing.type === 'frames') {
    if (!isInteger(timing.frames) || timing.frames <= 0) add('invalid', `${p}.timing.frames`, '动作总帧必须是正整数，帧不取整')
  } else if (timing.type === 'response') {
    if (!isFiniteNumber(timing.k) || timing.k < 0) add('invalid', `${p}.timing.k`, '响应型系数 k 必须是非负有限数值')
    if (!isFiniteNumber(timing.bMs) || timing.bMs < 0) add('invalid', `${p}.timing.bMs`, '响应型偏置 bMs 必须是非负有限毫秒')
    if (isFiniteNumber(timing.k) && isFiniteNumber(timing.bMs) && timing.k + timing.bMs <= 0) add('invalid', `${p}.timing`, 'k 与 bMs 不能同时为 0，否则动作时长为 0')
  } else {
    add('unsupported', `${p}.timing.type`, `未知时长口径 ${String((timing as { type?: unknown }).type)}`)
  }
  // 帧上界只在计时器型下可以就地判断；响应型要拿档位折算后的帧数，交给内核在模拟时校验。
  const bound = timing && timing.type === 'frames' && isInteger(timing.frames) && timing.frames > 0 ? timing.frames : null
  if (!Array.isArray(spec.hits)) add('missing', `${p}.hits`, '动作必须显式列出命中段，不能留空由内核猜')
  else {
    let last = -1
    spec.hits.forEach((hit, i) => {
      const hp = `${p}.hits.${i}`
      if (!hit || typeof hit !== 'object') { add('invalid', hp, '命中段必须是对象'); return }
      if (!isInteger(hit.atFrame) || hit.atFrame < 0) add('invalid', `${hp}.atFrame`, '命中帧必须是非负整数')
      if (hit.delayed !== undefined && typeof hit.delayed !== 'boolean') add('invalid', `${hp}.delayed`, '延迟命中标记必须是布尔值')
      if (bound !== null && isInteger(hit.atFrame) && hit.atFrame >= bound && hit.delayed !== true) add('invalid', `${hp}.atFrame`, '命中帧不能超出动作时长；若这是后续触发的延迟命中，请显式标 delayed: true')
      if (isInteger(hit.atFrame) && hit.atFrame < last) add('invalid', `${hp}.atFrame`, '命中帧必须按时间递增，同帧多段按数组顺序结算')
      if (isInteger(hit.atFrame)) last = Math.max(last, hit.atFrame)
      if (!isFiniteNumber(hit.motionValue) || hit.motionValue <= 0) add('invalid', `${hp}.motionValue`, '倍率必须是正有限数值')
      if (hit.scaling === undefined) add('missing', `${hp}.scaling`, '必须声明该段按 attack、hp 还是 def 结算')
      else if (!['atk', 'hp', 'def'].includes(hit.scaling)) add('unsupported', `${hp}.scaling`, `未知结算属性 ${String(hit.scaling)}`)
      if (!HIT_ELEMENTS.includes(hit.element as HitElement)) add('unsupported', `${hp}.element`, `未知命中元素 ${String(hit.element)}`)
      if (typeof hit.canCrit !== 'boolean') add('invalid', `${hp}.canCrit`, '必须显式声明该段是否可暴击')
      // 触发标记将来要按 id 统计命中次数；元素不是非空字符串的话，统计会静默丢项。
      if (hit.triggerIds !== undefined) {
        if (!Array.isArray(hit.triggerIds)) add('invalid', `${hp}.triggerIds`, '触发标记必须是数组')
        else hit.triggerIds.forEach((triggerId, j) => {
          if (typeof triggerId !== 'string' || !triggerId.trim()) add('invalid', `${hp}.triggerIds.${j}`, '触发标记必须是非空字符串')
        })
      }
      if (hit.hitlagFrames !== undefined && (!isInteger(hit.hitlagFrames) || hit.hitlagFrames < 0)) add('invalid', `${hp}.hitlagFrames`, '卡肉帧数必须是非负整数')
      if (hit.reaction !== undefined) {
        const reaction = hit.reaction
        if (!reaction || typeof reaction !== 'object' || Array.isArray(reaction)) add('invalid', `${hp}.reaction`, '反应必须写成 { kind, aura }')
        else {
          const auraOk = typeof reaction.aura === 'string' && ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'].includes(reaction.aura)
          if (!auraOk) add('invalid', `${hp}.reaction.aura`, '附着元素必须是七种元素之一')
          const elementOk = typeof hit.element === 'string' && hit.element !== 'physical'
          if (!elementOk) add('invalid', `${hp}.element`, '物理命中不触发元素反应')
          if (isStatefulKind(reaction.kind)) add('unsupported', `${hp}.reaction.kind`, `P1 不建模：${statefulReason(reaction.kind)}`)
          else if (isSpecialKind(reaction.kind)) {
            if (auraOk && elementOk) {
              const mismatch = describeSpecialMismatch(reaction.kind, hit.element as ReactionElement, reaction.aura as ReactionElement)
              if (mismatch) add('invalid', `${hp}.reaction`, mismatch)
            }
            if (reaction.talent !== undefined && typeof reaction.talent !== 'boolean') add('invalid', `${hp}.reaction.talent`, '天赋倍率开关必须是布尔值')
            if (reaction.count !== undefined && (!isInteger(reaction.count) || reaction.count < 1)) add('invalid', `${hp}.reaction.count`, '叠层计数必须是正整数')
            if (reaction.countFrom !== undefined && (typeof reaction.countFrom !== 'string' || !reaction.countFrom.trim())) add('invalid', `${hp}.reaction.countFrom`, '计数来源必须是效果 id')
            if (reaction.count !== undefined && reaction.countFrom !== undefined) add('invalid', `${hp}.reaction`, '计数只能二选一：写死数字用 count，读效果层数用 countFrom')
            for (const key of ['fypct', 'fyplus', 'elevated'] as const) {
              const value = reaction[key]
              if (value !== undefined && (!isFiniteNumber(value) || value < 0)) add('invalid', `${hp}.reaction.${key}`, '加成必须是非负有限数值')
            }
            if (reaction.kNum !== undefined && (!isFiniteNumber(reaction.kNum) || reaction.kNum <= 0)) add('invalid', `${hp}.reaction.kNum`, '反应系数乘区必须是正有限数值')
          }
          else if (!isReactiveKind(reaction.kind)) add('unsupported', `${hp}.reaction.kind`, '不支持的反应')
          else if (auraOk && elementOk) {
            const mismatch = describeMismatch(reaction.kind, hit.element as ReactionElement, reaction.aura as ReactionElement)
            if (mismatch) add('invalid', `${hp}.reaction`, mismatch)
          }
        }
      }
    })
  }
  if (spec.cancelWindows !== undefined) {
    if (!Array.isArray(spec.cancelWindows)) add('invalid', `${p}.cancelWindows`, '取消窗口必须是数组')
    else {
      spec.cancelWindows.forEach((w, i) => {
        const wp = `${p}.cancelWindows.${i}`
        if (!isInteger(w?.fromFrame) || !isInteger(w?.toFrame)) { add('invalid', wp, '取消窗口边界必须是整数帧'); return }
        if (w.fromFrame < 0 || w.toFrame < w.fromFrame) add('invalid', wp, '取消窗口必须先有起点且终点不早于起点')
        if (bound !== null && w.toFrame > bound) add('invalid', wp, '取消窗口不能超出动作时长')
      })
    }
  }
  if (spec.particles !== undefined) {
    if (!Array.isArray(spec.particles)) add('invalid', `${p}.particles`, '产球必须是数组')
    else {
      spec.particles.forEach((particle, i) => {
        const pp = `${p}.particles.${i}`
        if (!isInteger(particle?.atFrame) || particle.atFrame < 0 || (bound !== null && particle.atFrame >= bound)) add('invalid', `${pp}.atFrame`, '产球帧必须是非负整数且落在动作内')
        if (!isInteger(particle?.count) || particle.count <= 0) add('invalid', `${pp}.count`, '产球数量必须是正整数')
        if (![...HIT_ELEMENTS, 'clear'].includes(particle?.element)) add('unsupported', `${pp}.element`, `未知粒子元素 ${String(particle?.element)}`)
        if (!isInteger(particle?.travelFrames) || particle.travelFrames < 0) add('invalid', `${pp}.travelFrames`, '粒子飞行帧数必须是非负整数')
      })
    }
  }
  if (spec.delayedParticles !== undefined) {
    if (!Array.isArray(spec.delayedParticles)) add('invalid', `${p}.delayedParticles`, '延迟产球必须是数组')
    else {
      spec.delayedParticles.forEach((particle, i) => {
        const pp = `${p}.delayedParticles.${i}`
        // 延迟产球允许超出动作时长（召唤物在动作结束后仍会产球），但仍要与动作起手帧相对、非负。
        if (!isInteger(particle?.atFrame) || particle.atFrame < 0) add('invalid', `${pp}.atFrame`, '延迟产球帧必须是非负整数（可超出动作时长）')
        if (!isInteger(particle?.count) || particle.count <= 0) add('invalid', `${pp}.count`, '产球数量必须是正整数')
        if (![...HIT_ELEMENTS, 'clear'].includes(particle?.element)) add('unsupported', `${pp}.element`, `未知粒子元素 ${String(particle?.element)}`)
        if (!isInteger(particle?.travelFrames) || particle.travelFrames < 0) add('invalid', `${pp}.travelFrames`, '粒子飞行帧数必须是非负整数')
      })
    }
  }
  if (spec.energyRestore !== undefined) {
    if (!Array.isArray(spec.energyRestore)) add('invalid', `${p}.energyRestore`, '回能必须是数组')
    else {
      spec.energyRestore.forEach((restore, i) => {
        const pp = `${p}.energyRestore.${i}`
        if (!isInteger(restore?.atFrame) || restore.atFrame < 0) add('invalid', `${pp}.atFrame`, '回能帧必须是非负整数（可超出动作时长）')
        if (!isFiniteNumber(restore?.amount) || restore.amount < 0) add('invalid', `${pp}.amount`, '回能量必须是非负有限数值')
        if (restore?.target !== undefined && restore.target !== 'team' && restore.target !== 'self') add('invalid', `${pp}.target`, '回能目标只能是 team 或 self')
        if (restore?.rechargeScaling !== undefined && typeof restore.rechargeScaling !== 'boolean') add('invalid', `${pp}.rechargeScaling`, 'rechargeScaling 必须是布尔值')
      })
    }
  }
  if (spec.energyCost !== undefined && (!isFiniteNumber(spec.energyCost) || spec.energyCost < 0)) add('invalid', `${p}.energyCost`, '能量消耗必须是非负有限数值')
  if (spec.cooldownFrames !== undefined && (!isInteger(spec.cooldownFrames) || spec.cooldownFrames < 0)) add('invalid', `${p}.cooldownFrames`, '冷却帧数必须是非负整数')
  if (spec.requires !== undefined && !Array.isArray(spec.requires)) add('invalid', `${p}.requires`, '门槛标记必须是数组')
  if (spec.mechanism !== undefined && (typeof spec.mechanism !== 'string' || !spec.mechanism.trim())) add('invalid', `${p}.mechanism`, '机制标记必须是非空字符串')
  return issues
}

type QueueItem =
  | { kind: 'action-start'; frame: number; actorId: string; actionId: string }
  | { kind: 'hit'; frame: number; actorId: string; actionId: string; hitIndex: number; hit: HitSpec }
  | { kind: 'particle'; frame: number; actorId: string; actionId: string; particle: ParticleSpec }
  | { kind: 'energy-restore'; frame: number; actorId: string; actionId: string; restore: EnergyRestoreSpec }
  | { kind: 'action-end'; frame: number; actorId: string; actionId: string }

interface QueuedItem { frame: number; phase: EventPhase; sequence: number; item: QueueItem }

const phaseIndex = (phase: EventPhase) => EVENT_PHASES.indexOf(phase)

const phaseOf = (kind: QueueItem['kind']): EventPhase => {
  switch (kind) {
    case 'action-start': return 'action-start'
    case 'hit': return 'hit'
    case 'particle': return 'energy'
    case 'energy-restore': return 'energy'
    case 'action-end': return 'state'
  }
}

export function simulateTimeline(input: TimelineInput): TimelineResult {
  const issues: Issue[] = []
  const events: TimelineEvent[] = []
  const hits: TimelineHit[] = []
  const requests: TimelineRequest[] = []
  const approximateItems: string[] = []
  const triggers: TriggerRecord[] = []
  const add = (code: Issue['code'], path: string, message: string) => issues.push({ code, path, message })

  const actions = input?.actions ?? {}
  issues.push(...validateFrameTier(input?.frameTier))
  if (!Array.isArray(input?.steps)) return finish('invalid')
  if (!Array.isArray(input?.actors) || !input.actors.length) add('missing', 'actors', '至少需要一个角色的初始能量')
  if (!isInteger(input?.measurementEndFrame) || input.measurementEndFrame <= 0) add('invalid', 'measurementEndFrame', '测量终点必须是正整数帧')
  if (input?.switchFrames !== undefined && (!isInteger(input.switchFrames) || input.switchFrames < 0)) add('invalid', 'switchFrames', '切人帧必须是非负整数')

  const actors = new Map((input?.actors ?? []).map(a => [a.actorId, { actorId: a.actorId, energy: a.energy, energyMax: a.energyMax, cooldowns: {} as Record<string, number> }]))
  for (const a of actors.values()) {
    if (!isFiniteNumber(a.energy) || a.energy < 0) add('invalid', `actors.${a.actorId}.energy`, '初始能量必须是非负有限数值')
    if (!isFiniteNumber(a.energyMax) || a.energyMax <= 0) add('invalid', `actors.${a.actorId}.energyMax`, '能量上限必须是正有限数值')
  }
  const flags = new Set(input?.stateFlags ?? [])
  const recharge = input?.energyRecharge ?? {}
  let activeActorId = input?.activeActorId
  if (!actors.has(activeActorId)) add('missing', 'activeActorId', '前台角色必须在 actors 里')
  // 效果运行时按帧累积状态：命中结算时先取当帧修饰，再结算这一发携带的触发，所以触发不会反过来加强自己。
  const effectRuntime = createEffectRuntime(input?.effects ?? {}, [...actors.keys()], isInteger(input?.measurementEndFrame) ? input.measurementEndFrame : 0)
  /*
   * 动作起手触发（4 件套触发式）：声明必须能兑现——效果要在效果表里登记、角色要在 actors 里，
   * 否则直接报错，不静默跳过（跳过会让「说触发了其实没触发」变成隐形低估）。
   */
  const effectTriggers = Array.isArray(input?.effectTriggers) ? input.effectTriggers : []
  for (const [index, item] of effectTriggers.entries()) {
    const p = `effectTriggers.${index}`
    if (!item || typeof item !== 'object') { add('invalid', p, '触发项必须是对象'); continue }
    if (typeof item.effectId !== 'string' || !item.effectId) add('missing', `${p}.effectId`, '触发项必须指出效果 id')
    else if (!effectRuntime.has(item.effectId)) add('unsupported', `${p}.effectId`, `触发效果 ${item.effectId} 在效果表里没有登记`)
    if (!actors.has(item.actorId)) add('missing', `${p}.actorId`, `触发角色 ${String(item.actorId)} 不在本队`)
    if (item.on !== 'cast-skill' && item.on !== 'cast-burst' && item.on !== 'skill-hit') add('unsupported', `${p}.on`, `未知触发时机 ${String(item.on)}`)
  }

  const durationCache = new Map<ActionSpec, ResolvedTiming>()
  const durationOf = (spec: ActionSpec): ResolvedTiming => {
    const cached = durationCache.get(spec)
    if (cached) return cached
    const resolved = resolveActionTiming(spec.timing, input?.frameTier)
    durationCache.set(spec, resolved)
    return resolved
  }
  /** 响应型的帧上界要拿档位折算后才能判断：同一动作换档位可能放不下原来的命中帧。 */
  const boundIssues = (spec: ActionSpec, frames: number): Issue[] => {
    const problems: Issue[] = []
    const p = `actions.${spec.id}`
    const tierId = input?.frameTier?.id ?? '<missing>'
    const why = spec.timing?.type === 'response' ? '响应型按当前档位折算' : '计时器型'
    ;(spec.hits ?? []).forEach((hit, i) => {
      if (isInteger(hit?.atFrame) && hit.atFrame >= frames) problems.push({ code: 'invalid', path: `${p}.hits.${i}.atFrame`, message: `在 ${tierId} 档位下动作只有 ${frames} 帧（${why}），命中帧 ${hit.atFrame} 放不进动作` })
    })
    ;(spec.cancelWindows ?? []).forEach((w, i) => {
      if (isInteger(w?.toFrame) && w.toFrame > frames) problems.push({ code: 'invalid', path: `${p}.cancelWindows.${i}`, message: `取消窗口终点 ${w.toFrame} 超出 ${tierId} 档位下的 ${frames} 帧` })
    })
    ;(spec.particles ?? []).forEach((particle, i) => {
      if (isInteger(particle?.atFrame) && particle.atFrame >= frames) problems.push({ code: 'invalid', path: `${p}.particles.${i}.atFrame`, message: `产球帧 ${particle.atFrame} 超出 ${tierId} 档位下的 ${frames} 帧` })
    })
    return problems
  }

  let queue: QueuedItem[] = []
  let sequence = 0
  let currentFrame = 0
  /** 累计卡肉帧数与冻结期的结束帧（现实帧口径）。 */
  let hitlagWindows: { from: number; to: number }[] = []
  let hitlagUntil = -1
  const push = (item: QueueItem) => {
    const phase = phaseOf(item.kind)
    queue.push({ frame: item.frame, phase, sequence: sequence++, item })
    queue.sort((a, b) => a.frame - b.frame || phaseIndex(a.phase) - phaseIndex(b.phase) || a.sequence - b.sequence)
  }
  const record = (frame: number, phase: EventPhase, kind: TimelineEventKind, actorId?: string, actionId?: string, detail?: Record<string, unknown>) => {
    events.push({ frame, phase, sequence: sequence++, kind, ...(actorId ? { actorId } : {}), ...(actionId ? { actionId } : {}), ...(detail ? { detail } : {}) })
  }
  /**
   * 新动作开始时取消上一个动作尚未发生的命中与收尾。
   * 产球**不取消**：粒子已经发出（或召唤物会在之后产出），换人/接下一个动作不会让它消失，
   * 只按 `travelFrames` 延迟到账。2026-11-02 起由 `delayedParticles` 承载召唤物产球。
   */
  const cancelPending = (frame: number) => {
    queue = queue.filter(queued => queued.frame <= frame || queued.item.kind === 'action-start' ||
      queued.item.kind === 'particle' || queued.item.kind === 'energy-restore' || (queued.item.kind === 'hit' && queued.item.hit.delayed === true))
  }
  /**
   * 卡肉：`[atFrame, atFrame + frames)` 内游戏时钟冻结。做法是把排在这之后的一切整体顺延同样帧数——
   * 队列里未发生的事件、冷却期限、效果到期、当前最早可取消帧；现实帧照常消耗，所以动作变长而游戏内时间不变。
   */
  const applyHitlag = (atFrame: number, frames: number) => {
    if (frames <= 0) return
    const end = atFrame + frames
    // 同一帧的多段命中落在同一段冻结里时不叠加：只顺延超出已冻结区间的那部分。
    const delta = Math.max(0, end - Math.max(atFrame, hitlagUntil))
    hitlagWindows.push({ from: atFrame, to: end })
    hitlagUntil = Math.max(hitlagUntil, end)
    if (delta <= 0) return
    approximateItems.push(`hitlag:${atFrame}:${frames}`)
    for (const queued of queue) if (queued.frame > atFrame) queued.frame += delta
    queue.sort((a, b) => a.frame - b.frame || phaseIndex(a.phase) - phaseIndex(b.phase) || a.sequence - b.sequence)
    for (const actor of actors.values()) {
      for (const cooldownId of Object.keys(actor.cooldowns)) if (actor.cooldowns[cooldownId] > atFrame) actor.cooldowns[cooldownId] += delta
    }
    effectRuntime.shiftAfter(atFrame, delta)
    if (currentFrame > atFrame) currentFrame += delta
  }
  const readyFrame = (actorId: string, action: ActionSpec, from: number) => {
    const actor = actors.get(actorId)
    const cooldownId = action.cooldownId ?? action.id
    let frame = Math.max(from, actor?.cooldowns[cooldownId] ?? 0)
    if (actor && (action.energyCost ?? 0) > actor.energy) {
      const arrival = queue.find(queued => queued.item.kind === 'particle' && queued.item.actorId === actorId)
      // 粒子到达当帧先结算到达，动作最早在下一帧成立。
      frame = arrival ? Math.max(frame, arrival.frame + 1) : Number.POSITIVE_INFINITY
    }
    return frame
  }
  const handle = (queued: QueuedItem) => {
    const { item } = queued
    if (item.kind === 'hit') {
      const modifiers = effectRuntime.modifiersAt(item.actorId, queued.frame)
      // 叠层计数在命中当帧解析：效果先于本发结算，所以读到的是本发之前已经累好的层数。
      const declaredReaction = item.hit.reaction
      const reaction = declaredReaction && declaredReaction.countFrom
        ? { ...declaredReaction, count: effectRuntime.stacksAt(declaredReaction.countFrom, item.actorId, queued.frame) }
        : declaredReaction
      const activeEffects = effectRuntime.activeAt(item.actorId, queued.frame)
      hits.push({ frame: queued.frame, actorId: item.actorId, actionId: item.actionId, hitIndex: item.hitIndex, motionValue: item.hit.motionValue, scaling: item.hit.scaling, element: item.hit.element, canCrit: item.hit.canCrit, triggerIds: item.hit.triggerIds ?? [], reaction, modifiers, activeEffects })
      record(queued.frame, 'hit', 'hit', item.actorId, item.actionId, { hitIndex: item.hitIndex, motionValue: item.hit.motionValue, element: item.hit.element })
      for (const [index, effectId] of (item.hit.triggerIds ?? []).entries()) {
        if (!effectRuntime.has(effectId)) { add('unsupported', `actions.${item.actionId}.hits.${item.hitIndex}.triggerIds.${index}`, `触发标记 ${effectId} 在效果表里没有登记，无法兑现`); continue }
        const trigger = effectRuntime.trigger(effectId, queued.frame, item.actorId)
        if (!trigger) continue
        triggers.push(trigger)
        record(queued.frame, 'trigger', 'trigger', item.actorId, item.actionId, { effectId, stacks: trigger.stacks, expiresAt: trigger.expiresAt })
      }
      /*
       * 命中触发的 4 件套（千岩「战技命中敌人后」）：在命中当帧激活，
       * 沿用「本发先按触发前的状态结算」口径，与 `triggerIds` 一样不影响本次命中。
       */
      if (actions[item.actionId]?.kind === 'skill') {
        for (const entry of effectTriggers) {
          if (entry.actorId !== item.actorId || entry.on !== 'skill-hit') continue
          const fired = effectRuntime.trigger(entry.effectId, queued.frame, item.actorId)
          if (!fired) continue
          triggers.push(fired)
          record(queued.frame, 'trigger', 'trigger', item.actorId, item.actionId, { effectId: entry.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: 'skill-hit' })
        }
      }
      applyHitlag(queued.frame, item.hit.hitlagFrames ?? 0)
      return
    }
    if (item.kind === 'particle') {
      /*
       * 2026-11-02：产球按队伍共享结算（游戏里粒子是全队回能，不只是发出者）。
       * 每名角色按自己的充能效率结算 `count × ER`；暂不区分前台/后台折扣，也不做同元素加成，
       * 这两点都写进近似说明，不假装比实测更准。
       */
      const gains: Record<string, number> = {}
      for (const actor of actors.values()) {
        const gain = item.particle.count * (recharge[actor.actorId] ?? 1)
        gains[actor.actorId] = gain
        actor.energy = Math.min(actor.energyMax, actor.energy + gain)
      }
      record(queued.frame, 'energy', 'particle', item.actorId, item.actionId, { count: item.particle.count, element: item.particle.element, gain: gains })
      return
    }
    if (item.kind === 'energy-restore') {
      /*
       * 动作直接回能（爆发/领域）：与粒子不同，不走充能效率（雷神 A4 是显式倍率）。
       * `target: 'team'` 时全队每人各加一份；记录里写清实际加了多少。
       */
      const restore = item.restore
      const casterEr = recharge[item.actorId] ?? 1
      const scale = restore.rechargeScaling === true
        ? 1 + 0.006 * Math.floor(Math.max(casterEr - 1, 0) * 100)
        : 1
      const amount = restore.amount * scale
      const target = restore.target ?? 'team'
      const gains: Record<string, number> = {}
      for (const actor of actors.values()) {
        if (target === 'self' && actor.actorId !== item.actorId) continue
        gains[actor.actorId] = amount
        actor.energy = Math.min(actor.energyMax, actor.energy + amount)
      }
      record(queued.frame, 'energy', 'energy-restore', item.actorId, item.actionId, { amount, scale, target, gain: gains })
      return
    }
    if (item.kind === 'action-end') {
      record(queued.frame, 'state', 'action-end', item.actorId, item.actionId)
      return
    }
    record(queued.frame, 'action-start', 'action-start', item.actorId, item.actionId)
  }
  /**
   * 结算 `frame` 之前的事件。`includeHitsAtFrame` 额外结算落在 `frame` 当帧的命中——
   * 请求帧正好压在命中帧上时必须先知道这一发的卡肉，否则动作会在冻结期里起手；
   * 产球等后续相位仍留到下一帧，保持「能量到达后先结算、动作下一帧成立」的口径。
   */
  const processUntil = (frame: number, includeHitsAtFrame = false) => {
    while (queue.length) {
      const head = queue[0]
      if (head.frame < frame) { handle(queue.shift() as QueuedItem); continue }
      if (includeHitsAtFrame && head.frame === frame && phaseIndex(head.phase) <= phaseIndex('hit')) { handle(queue.shift() as QueuedItem); continue }
      break
    }
  }
  const reject = (step: Extract<TimelineStep, { kind: 'action' }>, frame: number): TimelineRequest => {
    record(frame, 'action-start', 'rejected', step.actorId, step.actionId, { reason: 'not-ready' })
    return { stepId: step.id, requestedFrame: frame, actualFrame: null, ok: false, reason: 'not-ready' }
  }
  /** 检查动作在指定帧是否成立：只收集问题，不改能量与冷却，便于 ASAP 反复试探。 */
  const checkAction = (step: Extract<TimelineStep, { kind: 'action' }>, spec: ActionSpec, frame: number): Issue[] => {
    const problems: Issue[] = []
    const p = `steps.${step.id}`
    processUntil(frame, true)
    if (spec.actorId !== step.actorId) problems.push({ code: 'invalid', path: `${p}.actorId`, message: `动作 ${spec.id} 属于 ${spec.actorId}，不能由 ${step.actorId} 发起` })
    if (step.actorId !== activeActorId) problems.push({ code: 'invalid', path: `${p}.actorId`, message: `动作必须由前台角色发起，当前前台是 ${activeActorId}` })
    const missing = (spec.requires ?? []).filter(flag => !flags.has(flag))
    if (missing.length) problems.push({ code: 'missing', path: `${p}.requires`, message: `动作前置状态未满足：${missing.join('、')}` })
    if (frame < currentFrame) problems.push({ code: 'invalid', path: `${p}.atFrame`, message: `动作请求帧 ${frame} 早于上一动作最早可取消帧 ${currentFrame}` })
    if (frame > input.measurementEndFrame) problems.push({ code: 'invalid', path: `${p}.atFrame`, message: `动作请求帧 ${frame} 超出测量窗口 ${input.measurementEndFrame}` })
    const actor = actors.get(step.actorId)
    if (actor && (spec.energyCost ?? 0) > actor.energy) problems.push({ code: 'invalid', path: `${p}.energy`, message: `动作需要 ${spec.energyCost} 能量，当前 ${actor.energy}` })
    const cooldownId = spec.cooldownId ?? spec.id
    if (actor && frame < (actor.cooldowns[cooldownId] ?? 0)) problems.push({ code: 'invalid', path: `${p}.cooldown`, message: `冷却到 ${actor.cooldowns[cooldownId]} 帧才结束，请求在 ${frame} 帧` })
    if (frame < hitlagUntil) problems.push({ code: 'invalid', path: `${p}.hitlag`, message: `第 ${frame} 帧仍在卡肉冻结期内（冻结到第 ${hitlagUntil - 1} 帧），游戏时钟不走，动作最早只能在 ${hitlagUntil} 帧开始` })
    return problems
  }
  /** 成立后执行：扣能量、进冷却、取消上一动作未发生的段并登记事件。 */
  const perform = (step: Extract<TimelineStep, { kind: 'action' }>, spec: ActionSpec, frame: number, requestedFrame: number): TimelineRequest => {
    processUntil(frame)
    const actor = actors.get(step.actorId)
    const cooldownId = spec.cooldownId ?? spec.id
    if (actor) {
      actor.energy -= spec.energyCost ?? 0
      if (spec.cooldownFrames) actor.cooldowns[cooldownId] = frame + spec.cooldownFrames
    }
    cancelPending(frame)
    const frames = durationOf(spec).frames
    record(frame, 'action-start', 'action-start', step.actorId, step.actionId)
    // 4 件套触发式：施放战技 / 爆发当帧激活；同帧先于本次动作的命中结算。
    const castTrigger = spec.kind === 'skill' ? 'cast-skill' : spec.kind === 'burst' ? 'cast-burst' : null
    if (castTrigger) {
      for (const item of effectTriggers) {
        if (item.actorId !== step.actorId || item.on !== castTrigger) continue
        const fired = effectRuntime.trigger(item.effectId, frame, step.actorId)
        if (!fired) continue
        triggers.push(fired)
        record(frame, 'trigger', 'trigger', step.actorId, spec.id, { effectId: item.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: 'cast' })
      }
    }
    push({ kind: 'action-end', frame: frame + frames, actorId: step.actorId, actionId: spec.id })
    spec.hits.forEach((hit, hitIndex) => push({ kind: 'hit', frame: frame + hit.atFrame, actorId: step.actorId, actionId: spec.id, hitIndex, hit }))
    for (const particle of spec.particles ?? []) push({ kind: 'particle', frame: frame + particle.atFrame + particle.travelFrames, actorId: step.actorId, actionId: spec.id, particle })
    for (const particle of spec.delayedParticles ?? []) push({ kind: 'particle', frame: frame + particle.atFrame + particle.travelFrames, actorId: step.actorId, actionId: spec.id, particle })
    for (const restore of spec.energyRestore ?? []) push({ kind: 'energy-restore', frame: frame + restore.atFrame, actorId: step.actorId, actionId: spec.id, restore })
    const earliestCancel = spec.cancelWindows?.length ? Math.min(...spec.cancelWindows.map(w => w.fromFrame)) : frames
    currentFrame = frame + earliestCancel
    return { stepId: step.id, requestedFrame, actualFrame: frame, ok: true }
  }

  for (const step of input.steps) {
    if (!step || typeof step !== 'object') { add('invalid', 'steps', '步骤必须是对象'); continue }
    const node = step as TimelineStep & { id?: string }
    const kind: string = (node as { kind?: string }).kind ?? ''
    if (kind !== 'wait' && kind !== 'switch' && kind !== 'action') { add('unsupported', `steps.${node.id ?? '<unknown>'}.kind`, `未知步骤类型 ${kind || '<missing>'}`); continue }
    if (node.kind === 'wait') {
      if (!isInteger(node.frames) || node.frames <= 0) { add('invalid', `steps.${node.id}.frames`, '等待帧数必须是正整数'); continue }
      currentFrame += node.frames
      record(currentFrame, 'state', 'wait', undefined, undefined, { frames: node.frames })
      continue
    }
    if (node.atFrame !== undefined && (!isInteger(node.atFrame) || node.atFrame < 0)) add('invalid', `steps.${node.id}.atFrame`, '请求帧必须是非负整数')
    /*
     * `asap-sequence` 下没有显式帧：动作按顺序尽早执行，换人也一样。
     * 换人最早只能发生在上一动作的最早可取消帧（`currentFrame`），所以缺省请求帧取这个位置；
     * 若落在卡肉冻结里，下面会再顺延到 `hitlagUntil`。
     */
    const frame = node.atFrame ?? (input.scheduler === 'asap-sequence' && node.kind === 'switch' ? Math.max(currentFrame, hitlagUntil) : 0)
    if (node.kind === 'switch') {
      processUntil(frame, true)
      const switchFrames = input.switchFrames ?? 0
      if (node.actorId === activeActorId) { add('invalid', `steps.${node.id}.actorId`, '目标已经是前台角色'); continue }
      if (!actors.has(node.actorId)) { add('missing', `steps.${node.id}.actorId`, `切换目标 ${node.actorId} 不在队伍中`); continue }
      if (frame > input.measurementEndFrame) { add('invalid', `steps.${node.id}.atFrame`, `换人请求帧 ${frame} 超出测量窗口 ${input.measurementEndFrame}`); continue }
      // 换人与动作同口径：压在上一动作最早可取消帧之前就换不出去，画面还在动作里。
      if (frame < currentFrame) { add('invalid', `steps.${node.id}.atFrame`, `换人请求帧 ${frame} 早于上一动作最早可取消帧 ${currentFrame}，这时还换不出去`); continue }
      // 卡肉冻结期内不能切人：请求帧落在冻结里就顺延到冻结结束，结果里两个帧都记下。
      const actual = Math.max(frame, hitlagUntil)
      const from = activeActorId
      // 换人取消上一动作尚未发生的命中与产球：后摇被换人打断，落空的那几段不能再结算。
      cancelPending(actual)
      activeActorId = node.actorId
      record(actual, 'state', 'switch', node.actorId, undefined, { switchFrames, requestedFrame: frame, from })
      currentFrame = Math.max(currentFrame, actual + switchFrames)
      continue
    }
    const spec = actions[node.actionId]
    if (!spec) {
      add('unsupported', `steps.${node.id}`, `动作 ${node.actionId} 未登记，拒绝轴`)
      record(Math.max(frame, currentFrame), 'action-start', 'rejected', node.actorId, node.actionId, { reason: 'action-not-registered' })
      requests.push({ stepId: node.id ?? '<unknown>', requestedFrame: frame, actualFrame: null, ok: false, reason: 'action-not-registered' })
      continue
    }
    const specIssues = validateActionSpec(spec)
    if (specIssues.length) { issues.push(...specIssues); requests.push(reject(node, frame)); continue }
    if (spec.timing?.type === 'response') {
      const resolved = durationOf(spec)
      if (!Number.isFinite(resolved.frames)) {
        add('invalid', `actions.${spec.id}.timing`, `无法在 ${input?.frameTier?.id ?? '当前档位'} 下折算响应型时长：帧率或 k、bMs 不自洽`)
        requests.push(reject(node, frame))
        continue
      }
      const bounds = boundIssues(spec, resolved.frames)
      if (bounds.length) { issues.push(...bounds); requests.push(reject(node, frame)); continue }
    }
    if (input.scheduler === 'asap-sequence') {
      let attempt = 0
      let request = Math.max(frame, currentFrame, hitlagUntil)
      /*
       * 可选步骤（`optional: true`）：攒不够能量/冷却没转好时**跳过这一步继续往下排**，
       * 而不是把整份轴判死。典型用途是 0 能量起手的循环轴里放爆发——前几轮放不出就跳过，
       * 后面攒够了自然会打出去；非 optional 的步骤仍按原口径报错。
       */
      const skipOptional = (reason: string): void => {
        requests.push({ stepId: node.id ?? '<unknown>', requestedFrame: request, actualFrame: null, ok: false, reason })
      }
      for (;;) {
        const problems = checkAction(node, spec, request)
        if (!problems.length) { requests.push(perform(node, spec, request, frame)); break }
        const deferrable = problems.every(problem => problem.path.endsWith('.energy') || problem.path.endsWith('.cooldown') || problem.path.endsWith('.hitlag'))
        if (!deferrable) {
          if (node.optional === true) { skipOptional('optional-skipped'); break }
          issues.push(...problems); requests.push(reject(node, request)); break
        }
        const next = Math.max(readyFrame(node.actorId, spec, request), hitlagUntil)
        if (!Number.isFinite(next) || next > input.measurementEndFrame || attempt++ > 64) {
          if (node.optional === true) { skipOptional('optional-skipped'); break }
          add('invalid', `steps.${node.id}.deadlock`, `ASAP 在测量窗口内等不到可用状态，最后请求帧 ${request}`)
          requests.push(reject(node, request))
          break
        }
        request = next
      }
      continue
    }
    const problems = checkAction(node, spec, frame)
    if (problems.length) { issues.push(...problems); requests.push(reject(node, frame)); continue }
    requests.push(perform(node, spec, frame, frame))
  }
  while (queue.length) handle(queue.shift() as QueuedItem)
  if (hitlagWindows.length) approximateItems.push('hitlag 时长来自数据、未经实测校准：受影响的收尾、冷却与效果到期都按数据顺延')

  return finish(issues.length ? 'invalid' : 'simulated')

  function finish(status: TimelineResult['status']): TimelineResult {
    const tier = input?.frameTier
    const validFps = tier && isFiniteNumber(tier.fps) && tier.fps > 0
    const realMsPerFrame = validFps ? 1000 / tier.fps : 0
    const tick = tier && isInteger(tier.timerTickMs) && tier.timerTickMs > 0 ? tier.timerTickMs : 0
    // 只统计落在结束帧之前的冻结段，重叠的冻结段先合并再累加（同帧多段命中不叠加）。
    const frozenFrames = (() => {
      const windows = hitlagWindows
        .map(w => ({ from: w.from, to: Math.min(currentFrame, w.to) }))
        .filter(w => w.to > w.from)
        .sort((a, b) => a.from - b.from)
      let total = 0
      let from = -1
      let to = -1
      for (const w of windows) {
        if (w.from > to) {
          if (to > from) total += to - from
          from = w.from
          to = w.to
        } else {
          to = Math.max(to, w.to)
        }
      }
      if (to > from) total += to - from
      return total
    })()
    return {
      status,
      simulationReady: false,
      accuracy: approximateItems.length ? 'approximate' : 'verified',
      timing: {
        tierId: tier?.id ?? '',
        fps: validFps ? tier.fps : 0,
        timerTickMs: tick,
        gameMsPerFrame: tick,
        realMsPerFrame,
        timerSecondsPerGameSecond: tick > 0 ? realMsPerFrame / tick : 0,
        hitlagFrames: frozenFrames,
        gameMs: (currentFrame - frozenFrames) * tick,
        realMs: currentFrame * realMsPerFrame,
        assumptions: ['constant-frame-rate']
      },
      approximateItems: [...new Set(approximateItems)],
      endFrame: currentFrame,
      events,
      hits,
      triggers,
      effects: effectRuntime.snapshot(),
      actors: [...actors.values()].map(a => ({ actorId: a.actorId, energy: a.energy, energyMax: a.energyMax, cooldowns: { ...a.cooldowns } })),
      requests,
      issues
    }
  }
}




