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
import {
  combineDataPacks,
  recordingToRotation,
  validateRecording,
  validateRotation,
  type CharacterBuild,
  type DataPack,
  type Issue,
  type PermanentData,
  type RecordingKeymap,
  type RotationSpec
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

/** 轴文件：一份录制 + 一张键位表 + 队伍声明 */
export interface RotationFile {
  schemaVersion: 1
  id: string
  /** 该轴适用的四人 charId，顺序无关 */
  team: string[]
  measurementEndFrame: number
  scheduler?: 'fixed' | 'asap-sequence'
  keymap: RecordingKeymap
  recording: unknown
}

/** 列出目录下所有轴文件（缺失目录按「没有轴」处理） */
export function listRotationFiles (): string[] {
  try {
    return fs.readdirSync(rotationsDir).filter(name => name.endsWith('.json')).map(name => path.join(rotationsDir, name)).sort()
  } catch {
    return []
  }
}

/** 按队伍成员找轴：team 集合完全相等才算命中；同名多份时取文件名排序第一份并在 issues 里提示 */
export function findRotation (charIds: string[]): { file?: string, rotationFile?: RotationFile, issues: Issue[] } {
  const wanted = [...charIds].sort().join(',')
  const hits: Array<{ file: string, rotationFile: RotationFile }> = []
  const issues: Issue[] = []
  for (const file of listRotationFiles()) {
    const read = readJson(file)
    if (read.issue) { issues.push(read.issue); continue }
    const raw = read.value
    if (!isObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.team)) {
      issues.push({ code: 'invalid', path: path.basename(file), message: '轴文件必须是 { schemaVersion: 1, team: [...] }' })
      continue
    }
    if ([...raw.team as string[]].sort().join(',') !== wanted) continue
    hits.push({ file, rotationFile: raw as unknown as RotationFile })
  }
  if (!hits.length) return { issues }
  if (hits.length > 1) issues.push({ code: 'invalid', path: 'rotations', message: `有 ${hits.length} 份轴都声明了这支队伍，取 ${path.basename(hits[0].file)}` })
  return { file: hits[0].file, rotationFile: hits[0].rotationFile, issues }
}

/** 录制 + 键位表 → 轴；键位版本不一致、窗口不合法、步骤引用不存在的动作都会被拒绝 */
export function toRotation (file: RotationFile, pack: DataPack): { status: 'ok' | 'invalid' | 'unsupported', rotation?: RotationSpec, issues: Issue[] } {
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

/** 永久数据：基础白值 + 已审计效果，每个角色一份 */
export function loadPermanentData (build: CharacterBuild): { data?: PermanentData, issue?: Issue } {
  const file = path.join(permanentDir, `${build.characterId}.json`)
  const read = readJson(file)
  if (read.issue) return { issue: { code: 'missing', path: `data/team-sim/permanent/${build.characterId}.json`, message: `${build.name || build.characterId} 还没有永久数据` } }
  const raw = read.value
  if (!isObject(raw) || !isObject(raw.character) || !isObject(raw.weapon)) {
    return { issue: { code: 'invalid', path: `data/team-sim/permanent/${build.characterId}.json`, message: '永久数据必须含 character 与 weapon' } }
  }
  return { data: raw as unknown as PermanentData }
}
