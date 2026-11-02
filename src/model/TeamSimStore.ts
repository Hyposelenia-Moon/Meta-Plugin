/**
 * 队伍模拟的运行期取数 —— 只读 `data/team-sim/**`，不写文件、不联网。
 *
 * 四步各自可独立失败，调用方拿结构化 issues 翻成人话即可：
 *   1. 名录 `roster.json`：miao charId → gcsim 键
 *   2. 数据包 `packs/<键>.json`：动作与命中
 *   3. 轴 `rotations/<任意名>.json`：录制 + 键位表，按队伍成员匹配
 *   4. 永久数据 `permanent/<charId>.json`：基础白值与效果
 *
 * 面板不在这里读：原始配装来自 `TeamBuildAdapter`，两边各自只认公开字段。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../dir.js'
import { buildRuntimePermanent } from './PermanentSource.js'
import {
  combineDataPacks,
  recordingToRotation,
  validateRecording,
  validateRotation,
  simulateTimeline,
  FRAME_TIERS,
  type ActorInit,
  type CharacterBuild,
  type DataPack,
  type FrameTier,
  type Issue,
  type PermanentData,
  type RecordingKeymap,
  type RotationSpec,
  type TimelineStep
} from '../modules/teamSimulation/index.js'

const teamSimDir = path.join(dataDir, 'team-sim')
/** 轴文件目录：一份录制 + 一张键位表 */
export const rotationsDir = path.join(teamSimDir, 'rotations')
/** 永久数据目录：每个角色一份 */
export const permanentDir = path.join(teamSimDir, 'permanent')
const rosterFile = path.join(teamSimDir, 'roster.json')

export type RosterStatus = 'mapped' | 'traveler' | 'alias' | 'no-gcsim'

export interface RosterEntry {
  charId: string
  cn: string
  element: string
  weapon: string
  star: number
  keys: string[]
  dir: string | null
  status: RosterStatus
  note?: string
}

export interface Roster {
  schemaVersion: number
  gameVersion: string
  gcsimCommit: string
  source: string
  characters: RosterEntry[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function readJson (file: string): { value?: unknown, issue?: Issue } {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (error) {
    return { issue: { code: 'missing', path: file, message: `读不到或解析失败：${reason(error)}` } }
  }
}

let rosterCache: Roster | null = null
/** 名录；文件缺失直接抛错（构建期产物没生成就是部署问题，不该静默） */
export function loadRoster (): Roster {
  if (rosterCache) return rosterCache
  const raw = fs.readFileSync(rosterFile, 'utf8')
  const parsed = JSON.parse(raw) as Roster
  if (!Array.isArray(parsed.characters)) throw new Error('roster.json 缺少 characters')
  rosterCache = parsed
  return parsed
}

/** 旅行者按元素展开：10000005 → aether*，10000007 → lumine* */
function travelerKey (charId: string, element: string): string | null {
  const prefix = charId === '10000005' ? 'aether' : charId === '10000007' ? 'lumine' : ''
  if (!prefix || !element.trim()) return null
  return `${prefix}${element.trim().toLowerCase()}`
}

/**
 * 角色 → gcsim 键。名录里没有、没有 gcsim 数据、旅行者缺元素，都算「用不了」，各自给出原因。
 */
export function resolveKey (entry: RosterEntry | undefined, build: CharacterBuild): { key?: string, issue?: Issue } {
  const path_ = `member.${build.name || build.characterId}`
  if (!entry) return { issue: { code: 'missing', path: path_, message: `${build.name || build.characterId}（${build.characterId}）不在名录里` } }
  if (entry.status === 'no-gcsim') return { issue: { code: 'unsupported', path: path_, message: `${entry.cn} 还没有 gcsim 动作数据` } }
  if (entry.status === 'alias') return { issue: { code: 'unsupported', path: path_, message: `${entry.cn} 是别名条目，请直接换用空或荧` } }
  if (entry.status === 'traveler') {
    const key = travelerKey(entry.charId, build.element)
    if (!key) return { issue: { code: 'missing', path: path_, message: `${entry.cn} 需要知道元素才能选键` } }
    return { key }
  }
  const key = entry.keys[0]
  if (!key) return { issue: { code: 'missing', path: path_, message: `${entry.cn} 的名录条目没有键` } }
  return { key }
}

export interface TeamPackResult {
  status: 'ok' | 'incomplete' | 'unsupported'
  keys: string[]
  pack?: DataPack
  issues: Issue[]
}

/** 四份原始配装 → 合成一份数据包；任何一个角色缺包就整体不可用 */
export function loadTeamPack (builds: CharacterBuild[]): TeamPackResult {
  const issues: Issue[] = []
  const keys: string[] = []
  let roster: Roster
  try {
    roster = loadRoster()
  } catch (error) {
    return { status: 'incomplete', keys, issues: [{ code: 'missing', path: 'data/team-sim/roster.json', message: reason(error) }] }
  }
  const packs: unknown[] = []
  for (const build of builds) {
    const entry = roster.characters.find(c => c.charId === build.characterId)
    const { key, issue } = resolveKey(entry, build)
    if (issue || !key) { if (issue) issues.push(issue); continue }
    keys.push(key)
    const file = path.join(teamSimDir, 'packs', `${key}.json`)
    const read = readJson(file)
    if (read.issue) issues.push({ ...read.issue, path: `data/team-sim/packs/${key}.json`, message: `缺少 ${key} 的动作数据` })
    else packs.push(read.value)
  }
  if (issues.length) {
    const status = issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'incomplete'
    return { status, keys, issues }
  }
  const merged = combineDataPacks(packs as DataPack[])
  if (merged.status !== 'ok' || !merged.pack) return { status: merged.status === 'unsupported' ? 'unsupported' : 'incomplete', keys, issues: merged.issues }
  return { status: 'ok', keys, pack: merged.pack, issues: [] }
}

/**
 * 轴文件：两种写法。
 *
 * 1. 录制轴（精确帧）：`recording` + `keymap`，由录制器/编辑器产出；
 * 2. **顺序轴（手写友好）**：`sequence: ["bennett.skill", ...]`，只写动作顺序，
 *    帧由 `asap-sequence` 调度器排，角色变化时自动插切人步骤。
 *    两种写法二选一；`actorId` 默认取动作 id 的点号前缀（动作包键）。
 */
export interface RotationFile {
  schemaVersion: 1
  id: string
  /** 该轴适用的四人 charId，顺序无关 */
  team: string[]
  measurementEndFrame: number
  scheduler?: 'fixed' | 'asap-sequence'
  /** 顺序轴：动作 id 列表（或 { actionId, actorId }），与 recording 互斥 */
  sequence?: Array<string | { actionId: string, actorId?: string }>
  /** 顺序轴可选：显式给初始能量（缺省 0 / 上限取爆发能耗） */
  actors?: Array<{ actorId: string, energy?: number, energyMax?: number }>
  /** 顺序轴可选：帧率档位 id，缺省 fps-60 */
  frameTierId?: string
  /** 录制轴必需 */
  keymap?: RecordingKeymap
  /** 录制轴必需 */
  recording?: unknown
}

/** 列出目录下所有轴文件（缺失目录按「没有轴」处理） */
export function listRotationFiles (): string[] {
  try {
    return fs.readdirSync(rotationsDir).filter(name => name.endsWith('.json')).map(name => path.join(rotationsDir, name)).sort()
  } catch {
    return []
  }
}

/** 轴文件与当前队伍的重合度：用于「没有轴」时给出最接近的现成轴，而不是一句空的「需要轴」 */
export interface NearbyRotation {
  file: string
  name: string
  team: string[]
  shared: string[]
}

/**
 * 按队伍成员找轴：team 集合完全相等才算命中；同名多份时取文件名排序第一份并在 issues 里提示。
 * 没命中时返回 `nearby`（重合 ≥2 人的轴，按重合人数降序），调用方可以据此提示「差哪个人」。
 */
export function findRotation (charIds: string[]): { file?: string, rotationFile?: RotationFile, nearby: NearbyRotation[], issues: Issue[] } {
  const wanted = [...charIds].sort().join(',')
  const hits: Array<{ file: string, rotationFile: RotationFile }> = []
  const nearby: NearbyRotation[] = []
  const issues: Issue[] = []
  for (const file of listRotationFiles()) {
    const read = readJson(file)
    if (read.issue) { issues.push(read.issue); continue }
    const raw = read.value
    if (!isObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.team)) {
      issues.push({ code: 'invalid', path: path.basename(file), message: '轴文件必须是 { schemaVersion: 1, team: [...] }' })
      continue
    }
    const team = raw.team as string[]
    if ([...team].sort().join(',') === wanted) {
      hits.push({ file, rotationFile: raw as unknown as RotationFile })
      continue
    }
    const shared = team.filter(id => charIds.includes(id))
    if (shared.length >= 2) {
      nearby.push({ file, name: String((raw as { id?: string }).id ?? path.basename(file, '.json')), team, shared })
    }
  }
  if (!hits.length) {
    nearby.sort((a, b) => b.shared.length - a.shared.length)
    return { nearby: nearby.slice(0, 3), issues }
  }
  if (hits.length > 1) issues.push({ code: 'invalid', path: 'rotations', message: `有 ${hits.length} 份轴都声明了这支队伍，取 ${path.basename(hits[0].file)}` })
  return { file: hits[0].file, rotationFile: hits[0].rotationFile, nearby: [], issues }
}

/** 录制 + 键位表 → 轴；键位版本不一致、窗口不合法、步骤引用不存在的动作都会被拒绝 */
export function toRotation (file: RotationFile, pack: DataPack): { status: 'ok' | 'invalid' | 'unsupported', rotation?: RotationSpec, issues: Issue[] } {
  if (Array.isArray(file.sequence) && file.sequence.length) return sequenceToRotation(file, pack)
  if (file.recording === undefined || file.keymap === undefined) {
    return { status: 'invalid', issues: [{ code: 'missing', path: 'rotation', message: '轴文件要么给 sequence（顺序轴），要么给 recording + keymap（录制轴）' }] }
  }
  const checked = validateRecording(file.recording)
  if (checked.status !== 'ok' || !checked.recording) return { status: checked.status === 'unsupported' ? 'unsupported' : 'invalid', issues: checked.issues }
  const converted = recordingToRotation(checked.recording, file.keymap, {
    id: file.id,
    measurementEndFrame: file.measurementEndFrame,
    ...(file.scheduler ? { scheduler: file.scheduler } : {})
  })
  if (converted.status !== 'ok' || !converted.rotation) return { status: converted.status === 'unsupported' ? 'unsupported' : 'invalid', issues: converted.issues }
  const issues = validateRotation(converted.rotation, pack)
  if (issues.length) return { status: issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', rotation: converted.rotation, issues }
  return { status: 'ok', rotation: converted.rotation, issues }
}

/**
 * 顺序轴 → 轴：只写动作顺序，帧交给 `asap-sequence` 调度器。
 *
 * 角色变化时自动插一个切人步骤（`kind: 'switch'`），与录制轴里 `to_xxx` 键等价；
 * 初始能量缺省 0、上限取该角色爆发动作的 energyCost（没有爆发就按 100）。
 * 引用了包里没有的动作仍由 `validateRotation` 拒绝——不跑空。
 */
function sequenceToRotation (file: RotationFile, pack: DataPack): { status: 'ok' | 'invalid' | 'unsupported', rotation?: RotationSpec, issues: Issue[] } {
  const issues: Issue[] = []
  const tierId = file.frameTierId ?? 'fps-60'
  const tier: FrameTier | undefined = FRAME_TIERS[tierId]
  if (!tier) return { status: 'unsupported', issues: [{ code: 'unsupported', path: 'frameTierId', message: `未知帧率档位 ${tierId}` }] }

  const actions = pack.actions ?? {}
  const steps: TimelineStep[] = []
  let index = 0
  let currentActor = ''
  for (const raw of file.sequence ?? []) {
    const actionId = typeof raw === 'string' ? raw.trim() : String(raw.actionId ?? '').trim()
    if (!actionId) { issues.push({ code: 'invalid', path: `sequence.${index}`, message: '顺序轴的动作 id 不能为空' }); index += 1; continue }
    const actorId = typeof raw === 'string' ? actionId.split('.')[0] : String(raw.actorId ?? actionId.split('.')[0])
    if (!actions[actionId]) {
      issues.push({ code: 'unsupported', path: `sequence.${index}`, message: `动作包里没有 ${actionId}` })
      index += 1
      continue
    }
    const packActor = actions[actionId].actorId
    if (packActor && packActor !== actorId) {
      issues.push({ code: 'invalid', path: `sequence.${index}`, message: `${actionId} 属于 ${packActor}，但 actorId 写成了 ${actorId}` })
      index += 1
      continue
    }
    if (currentActor && currentActor !== actorId) steps.push({ id: `switch-${index}`, kind: 'switch', actorId })
    steps.push({ id: `step-${index}`, kind: 'action', actorId, actionId })
    currentActor = actorId
    index += 1
  }
  if (!steps.length) {
    const all = [...issues, { code: 'invalid' as const, path: 'sequence', message: '顺序轴里没有一个可解析的动作' }]
    return { status: all.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', issues: all }
  }

  const actors = actorInitOf(file, pack, steps)
  const firstActor = steps.find(step => step.kind === 'action' || step.kind === 'switch')?.actorId
  const rotation: RotationSpec = {
    id: file.id,
    scheduler: 'asap-sequence',
    frameTier: tier,
    measurementEndFrame: file.measurementEndFrame,
    steps,
    actors,
    activeActorId: file.actors?.[0]?.actorId ?? firstActor ?? actors[0].actorId
  }
  const checked = validateRotation(rotation, pack)
  const all = [...issues, ...checked]
  // 顺序轴里写错一个动作不能让整份轴「看起来成功」——有问题就按问题类型失败，错在哪一条都在 issues 里。
  if (all.length) return { status: all.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', rotation, issues: all }
  // 机制规划（buff 窗口/活跃段）目前只认 fixed 调度，所以顺序轴在这里先跑一遍空时间线，
  // 把 asap 排出来的实际帧固化成固定轴——作者只写顺序，内核看到的仍是可规划的固定帧。
  return freezeSequenceFrames(rotation, pack)
}

/**
 * 顺序轴 → 固定轴：用一次空时间线（不结算伤害归属）取每个步骤的实际帧。
 * 这一步只决定「第几帧按下去」，数值仍由后续正式模拟算。
 */
function freezeSequenceFrames (rotation: RotationSpec, pack: DataPack): { status: 'ok' | 'invalid' | 'unsupported', rotation?: RotationSpec, issues: Issue[] } {
  const dry = simulateTimeline({
    scheduler: rotation.scheduler,
    steps: rotation.steps,
    actions: pack.actions ?? {},
    actors: rotation.actors,
    activeActorId: rotation.activeActorId,
    frameTier: rotation.frameTier,
    measurementEndFrame: rotation.measurementEndFrame
  })
  if (dry.issues.length) return { status: 'invalid', issues: dry.issues }
  const frameOf = new Map<string, number>()
  for (const request of dry.requests) {
    if (request.actualFrame !== null) frameOf.set(request.stepId, request.actualFrame)
  }
  /*
   * 换人步骤不进 `requests`（它不产生动作请求），但固定轴要求每步都有帧。
   * 换人一定紧挨着下一个动作发生，所以取「下一个动作的实际帧」；没有下一个动作时退回上一个动作帧。
   */
  const actionFrames = rotation.steps
    .map((step, index) => ({ step, index }))
    .filter(item => item.step.kind === 'action' && frameOf.has(item.step.id))
    .map(item => ({ index: item.index, frame: frameOf.get(item.step.id) as number }))
  const frameForSwitch = (index: number): number | null => {
    const next = actionFrames.find(item => item.index > index)
    if (next) return next.frame
    const prev = [...actionFrames].reverse().find(item => item.index < index)
    return prev ? prev.frame : null
  }
  const frozen: TimelineStep[] = []
  rotation.steps.forEach((step, index) => {
    if (step.kind === 'wait') { frozen.push(step); return }
    const atFrame = step.kind === 'switch' ? frameForSwitch(index) : frameOf.get(step.id)
    if (atFrame === undefined || atFrame === null) {
      return
    }
    frozen.push({ ...step, atFrame })
  })
  const missing = rotation.steps.filter(step => step.kind !== 'wait').length - frozen.filter(step => step.kind !== 'wait').length
  if (missing > 0) return { status: 'invalid', issues: [{ code: 'invalid', path: 'steps', message: `有 ${missing} 个步骤没有排到执行帧，无法固化成固定轴` }] }
  const fixed: RotationSpec = { ...rotation, scheduler: 'fixed', steps: frozen }
  const issues = validateRotation(fixed, pack)
  if (issues.length) return { status: issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', rotation: fixed, issues }
  return { status: 'ok', rotation: fixed, issues: [] }
}

/** 顺序轴的初始资源：文件里给了就用，没给就 0 能量 + 按爆发能耗推上限。 */
function actorInitOf (file: RotationFile, pack: DataPack, steps: TimelineStep[]): ActorInit[] {
  const ids: string[] = []
  for (const step of steps) if (step.kind === 'action' && step.actorId && !ids.includes(step.actorId)) ids.push(step.actorId)
  return ids.map(actorId => {
    const given = file.actors?.find(item => item.actorId === actorId)
    const burst = Object.values(pack.actions ?? {}).find(action => action.actorId === actorId && action.kind === 'burst' && Number.isFinite(Number(action.energyCost)))
    const energyMax = given?.energyMax ?? (burst ? Number(burst.energyCost) : 100)
    return { actorId, energy: given?.energy ?? 0, energyMax: energyMax > 0 ? energyMax : 100 }
  })
}

/**
 * 永久数据：基础白值 + 已审计效果。
 *
 * 先读入库的 `permanent/<charId>-<武器id>-r<精炼>.json`（人工审计过、可复现）；
 * 没有这份文件时**按玩家实际配装现算**（2026-11-02 用户定）。现算的副作用只在内存里，
 * 不往 `data/` 写缓存——那个目录是入库数据，运行期不能碰。
 */
export function loadPermanentData (build: CharacterBuild): { data?: PermanentData, issue?: Issue } {
  const file = `${build.characterId}-${build.weapon.id}-r${build.weapon.refinement}.json`
  const where = `data/team-sim/permanent/${file}`
  const read = readJson(path.join(permanentDir, file))
  if (read.issue) {
    const runtime = buildRuntimePermanent({
      characterId: String(build.characterId),
      name: String(build.name ?? ''),
      weaponId: String(build.weapon.id),
      refinement: Number(build.weapon.refinement)
    })
    if (runtime.ok) return { data: runtime.data }
    // 连现算也拿不到（miao 缺角色/武器），再报缺文件，并把原因一起写出来。
    let siblings: string[] = []
    try {
      siblings = fs.readdirSync(permanentDir).filter(name => name.startsWith(`${build.characterId}-`) && name.endsWith('.json'))
    } catch {
      siblings = []
    }
    const hint = siblings.length
      ? `；同角色已有 ${siblings.join('、')}，武器或精炼对不上`
      : '；这个角色还没有永久数据'
    return { issue: { code: 'missing', path: where, message: `${build.name || build.characterId} 缺永久数据（${file}）${hint}；现算失败：${runtime.error}` } }
  }
  const raw = read.value
  if (!isObject(raw) || !isObject(raw.character) || !isObject(raw.weapon)) {
    return { issue: { code: 'invalid', path: where, message: '永久数据必须含 character 与 weapon' } }
  }
  return { data: raw as unknown as PermanentData }
}
