import type { Issue } from './types.js'
import { FRAME_TIERS, validateActionSpec, type ActionSpec, type CancelWindow, type ParticleSpec } from './timeline.js'
import { validateEffects, type EffectSpec } from './effects.js'

/**
 * 版本化动作数据包：动作帧表、倍率、产球与冷却都放这里，由调用方读进内存后交给校验器。
 * 组件层不读文件、不猜缺省值：包不完整就拒绝，不拿默认数据补。
 */
export interface DataPack {
  schemaVersion: 1
  gameVersion: string
  source: string
  actions: Record<string, ActionSpec>
  /** 效果表：动作命中里的 `triggerIds` 必须指向这里的条目，写错 id 等于承诺了兑现不了的效果。 */
  effects?: Record<string, EffectSpec>
}

export type DataPackResult =
  | { status: 'ok'; pack: DataPack; issues: [] }
  | { status: 'invalid' | 'unsupported' | 'version-mismatch' | 'incomplete'; issues: Issue[] }

const resultStatus = (issues: Issue[]): 'invalid' | 'unsupported' | 'version-mismatch' | 'incomplete' =>
  issues.some(i => i.code === 'version-mismatch') ? 'version-mismatch'
    : issues.some(i => i.code === 'unsupported') ? 'unsupported'
      : issues.some(i => i.code === 'invalid') ? 'invalid'
        : 'incomplete'

/** 校验数据包：结构、版本、动作 id 与键一致、每个动作各自合法。 */
export function validateDataPack(input: unknown): DataPackResult {
  const issues: Issue[] = []
  const add = (code: Issue['code'], path: string, message: string) => issues.push({ code, path, message })
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 'invalid', issues: [{ code: 'invalid', path: 'pack', message: '数据包必须是对象' }] }
  }
  const pack = input as Partial<DataPack>
  if (pack.schemaVersion !== 1) add('version-mismatch', 'pack.schemaVersion', `不支持的包版本 ${String(pack.schemaVersion)}，当前只认 1`)
  for (const key of ['gameVersion', 'source'] as const) {
    const value = pack[key]
    if (value === undefined) add('missing', `pack.${key}`, '必须显式标注版本与出处')
    else if (typeof value !== 'string' || !value.trim()) add('invalid', `pack.${key}`, '必须是非空字符串')
  }
  const actions = pack.actions
  const effects = pack.effects
  issues.push(...validateEffects(effects))
  const effectIds = new Set(effects && typeof effects === 'object' && !Array.isArray(effects) ? Object.keys(effects) : [])
  if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
    add(actions === undefined ? 'missing' : 'invalid', 'pack.actions', '必须提供动作表')
  } else if (!Object.keys(actions).length) {
    add('invalid', 'pack.actions', '空动作表不能冒充可用数据包')
  } else {
    for (const [key, action] of Object.entries(actions)) {
      if (!key.trim()) { add('invalid', 'actions.', '动作键不能是空字符串，否则报错路径与引用都指向同一处'); continue }
      if (!action || typeof action !== 'object') { add('invalid', `actions.${key}`, '动作必须是对象'); continue }
      if (action.id !== key) add('invalid', `actions.${key}.id`, `动作 id 必须与键一致，收到 ${String(action.id)}`)
      issues.push(...validateActionSpec(action as ActionSpec))
      // 触发标记必须在效果表里有对应条目：否则要么数据写错，要么机制没实现，两种都不该静默放过。
      const hits = Array.isArray(action.hits) ? action.hits : []
      hits.forEach((hit, i) => {
        const triggerIds = Array.isArray(hit?.triggerIds) ? hit.triggerIds : []
        triggerIds.forEach((triggerId, j) => {
          // 空串与非字符串已经由结构校验判 invalid，这里只判「写了 id 但表里没有」。
          if (typeof triggerId === 'string' && triggerId.trim() && !effectIds.has(triggerId)) add('unsupported', `actions.${key}.hits.${i}.triggerIds.${j}`, `触发标记 ${triggerId} 在 effects 表里没有登记，无法兑现`)
        })
        // 计数来源同样必须是已登记的效果：读一个不存在的效果只会得到 0 层，等于静默降级。
        const countFrom = hit?.reaction && typeof hit.reaction === 'object' ? hit.reaction.countFrom : undefined
        if (typeof countFrom === 'string' && countFrom.trim() && !effectIds.has(countFrom)) add('unsupported', `actions.${key}.hits.${i}.reaction.countFrom`, `计数来源 ${countFrom} 在 effects 表里没有登记，读不到层数`)
      })
    }
  }
  if (issues.length) return { status: resultStatus(issues), issues }
  return { status: 'ok', pack: pack as DataPack, issues: [] }
}

/**
 * 合并多个数据包（当前按人落盘，运行期要把同队几个人的包合成一张动作表）。
 * 每个包先各自校验；动作键或效果键跨包重复直接拒绝——对象合并会静默覆盖，覆盖掉的是一份已经过校验的数据。
 */
export function combineDataPacks(inputs: unknown[]): DataPackResult {
  if (!Array.isArray(inputs) || !inputs.length) {
    return { status: 'invalid', issues: [{ code: 'missing', path: 'packs', message: '至少要提供一个数据包' }] }
  }
  const issues: Issue[] = []
  const actions: Record<string, ActionSpec> = {}
  const effects: Record<string, EffectSpec> = {}
  const versions = new Set<string>()
  inputs.forEach((input, i) => {
    const result = validateDataPack(input)
    if (result.status !== 'ok') {
      for (const issue of result.issues) issues.push({ ...issue, path: `packs.${i}.${issue.path}` })
      return
    }
    versions.add(result.pack.gameVersion)
    for (const [key, action] of Object.entries(result.pack.actions)) {
      if (actions[key]) issues.push({ code: 'invalid', path: `packs.${i}.actions.${key}`, message: `动作键 ${key} 与前面的包重复，合并会静默覆盖` })
      else actions[key] = action
    }
    for (const [key, effect] of Object.entries(result.pack.effects ?? {})) {
      if (effects[key]) issues.push({ code: 'invalid', path: `packs.${i}.effects.${key}`, message: `效果键 ${key} 与前面的包重复，合并会静默覆盖` })
      else effects[key] = effect
    }
  })
  if (versions.size > 1) issues.push({ code: 'version-mismatch', path: 'packs', message: `数据包版本不一致：${[...versions].join(' / ')}` })
  if (issues.length) return { status: resultStatus(issues), issues }
  const merged: DataPack = {
    schemaVersion: 1,
    gameVersion: [...versions][0] ?? '',
    source: `合并 ${inputs.length} 个数据包`,
    actions,
    ...(Object.keys(effects).length ? { effects } : {}),
  }
  return { status: 'ok', pack: merged, issues: [] }
}

/** 动作包帧表的记录口径：全部按 60fps（`fps-60` 档）记录，换档时按比例折算。 */
const DATA_PACK_FPS_TIER = 'fps-60'

/**
 * 把动作包从 60fps 口径折算到目标帧率档。
 *
 * 动作包里的帧全部来自 gcsim 的 60fps 口径（`frames.InitNormalCancelSlice` 等），
 * 轴的 `frameTierId` 换成别的档位时，如果直接把 60fps 的帧数塞进 217 档的窗口，
 * 动作会被人为拉长/压缩。这里只做帧数换算，不改变任何语义字段。
 *
 * 目标档位等于记录口径或未登记时原样返回——档位写错由 `validateRotation` 报错，不在这里吞。
 */
export function convertPackToFrameTier (pack: DataPack, tierId: string | undefined): DataPack {
  const targetId = tierId ?? DATA_PACK_FPS_TIER
  if (targetId === DATA_PACK_FPS_TIER) return pack
  const from = FRAME_TIERS[DATA_PACK_FPS_TIER]
  const to = FRAME_TIERS[targetId]
  if (from === undefined || to === undefined) return pack
  const factor = to.fps / from.fps
  const frame = (value: number): number => Math.max(0, Math.round(value * factor))
  const duration = (value: number): number => Math.max(1, Math.round(value * factor))
  const particle = (spec: ParticleSpec): ParticleSpec => ({
    ...spec,
    atFrame: frame(spec.atFrame),
    ...(spec.travelFrames !== undefined ? { travelFrames: frame(spec.travelFrames) } : {})
  })
  const window = (spec: CancelWindow): CancelWindow => ({ fromFrame: frame(spec.fromFrame), toFrame: frame(spec.toFrame) })
  const action = (spec: ActionSpec): ActionSpec => ({
    ...spec,
    timing: spec.timing.type === 'frames'
      ? { type: 'frames', frames: duration(spec.timing.frames) }
      : { type: 'response', k: duration(spec.timing.k), bMs: spec.timing.bMs },
    hits: spec.hits.map(hit => ({ ...hit, atFrame: frame(hit.atFrame) })),
    ...(spec.cancelWindows ? { cancelWindows: spec.cancelWindows.map(window) } : {}),
    ...(spec.particles ? { particles: spec.particles.map(particle) } : {}),
    ...(spec.delayedParticles ? { delayedParticles: spec.delayedParticles.map(particle) } : {}),
    ...(spec.energyRestore
      ? {
          energyRestore: spec.energyRestore.map(restore => ({ ...restore, atFrame: frame(restore.atFrame) }))
        }
      : {}),
    ...(spec.heal ? { heal: { ...spec.heal, atFrame: frame(spec.heal.atFrame) } } : {}),
    ...(spec.bond ? { bond: { ...spec.bond, atFrame: frame(spec.bond.atFrame) } } : {}),
    ...(spec.nightsoulConsume ? { nightsoulConsume: { ...spec.nightsoulConsume, atFrame: frame(spec.nightsoulConsume.atFrame) } } : {}),
    ...(spec.shardPickup ? { shardPickup: { ...spec.shardPickup, atFrame: frame(spec.shardPickup.atFrame) } } : {}),
    ...(spec.cooldownFrames !== undefined ? { cooldownFrames: duration(spec.cooldownFrames) } : {})
  })
  return {
    ...pack,
    actions: Object.fromEntries(Object.entries(pack.actions).map(([id, spec]) => [id, action(spec)]))
  }
}
