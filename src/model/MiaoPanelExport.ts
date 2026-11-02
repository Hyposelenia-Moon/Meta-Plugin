/**
 * MiaoPanelExport — 从 bot 进程内导出当前账号的面板（轴编辑器的「从 miao 读取」）
 *
 * 为什么放在 bot 里：`#练度查询` 的账号来自 miao 的米游社绑定（消息事件里的人），
 * 独立进程读不到这份绑定账本。这里复用**同一条路径**：
 * `resolveUid(e)` → miao `Player` → `getAvatar(charId)` → `getArtisDetail()`，
 * 只是把结果落成 JSON 给编辑器读，不开端口、不另存账号。
 */
import fs from 'node:fs'
import path from 'node:path'
import { botRoot } from '../dir.js'
import { resolveUid } from './MiaoProfile.js'
import { loadMiaoModels } from './MiaoProfile.js'
import { findCharacter } from './CharacterIndex.js'

/** miao 的圣遗物部位顺序（1..5）→ 编辑器 slot 键 */
const SLOT_KEYS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const

/** miao 属性键 → 本仓库属性键（`hpPlus` 才是小生命） */
const KEY_MAP: Record<string, string> = {
  hpPlus: 'hp', atkPlus: 'atk', defPlus: 'def',
  hp: 'hpPct', atk: 'atkPct', def: 'defPct',
  mastery: 'mastery', recharge: 'recharge', cpct: 'cpct', cdmg: 'cdmg',
  heal: 'heal', phy: 'phy', pyro: 'pyro', hydro: 'hydro', electro: 'electro',
  cryo: 'cryo', anemo: 'anemo', geo: 'geo', dendro: 'dendro', dmg: 'dmg'
}

export interface ExportPiece {
  slot: string
  set: string
  setId: string
  name: string
  level: number
  mainKey: string
  mainValue: number | null
  subs: Array<{ key: string, value: number }>
}
export interface PanelExport {
  schemaVersion: 1
  uid: string
  charId: string
  charName: string
  level: number
  cons: number
  talent: { A: number, E: number, Q: number }
  weapon: { name: string, affix: number, level: number } | null
  artis: ExportPiece[]
  exportedAt: string
}

/** 套装名 → setId（miao `artifact/data.json`，与编辑器同一份来源） */
function setIds (): Map<string, string> {
  const map = new Map<string, string>()
  const dir = String(process.env.MIAO_ROOT ?? '').trim()
    || path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs', 'artifact', 'data.json')
  const file = dir.endsWith('.json') ? dir : path.join(dir, 'data.json')
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { name?: string }>
    for (const [id, item] of Object.entries(raw)) map.set(String(item?.name ?? ''), id)
  } catch { /* 读不到就留空，编辑器按套装名兜底 */ }
  return map
}

/** miao 的数值 → 我们的数值（百分比已是小数；字符串 `5.8%` 转小数） */
function toNumber (value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim()
  if (!text) return null
  const pct = text.endsWith('%')
  const num = Number(text.replace('%', ''))
  if (!Number.isFinite(num)) return null
  return pct ? num / 100 : num
}

/**
 * 导出（或刷新）一个角色的面板 JSON，写到 `data/team-sim/panel-exports/<charId>.json`
 *
 * @returns 成功时给出文件路径与角色名；失败给出中文原因
 */
export async function exportPanelSnapshot (
  e: Record<string, any>,
  charName: string
): Promise<{ ok: true, file: string, charName: string, pieces: number } | { ok: false, error: string }> {
  const resolved = await resolveUid(e as never)
  if (!resolved.uid) return { ok: false, error: resolved.error || '没有可用的账号' }
  const local = findCharacter(charName)
  if (!local) return { ok: false, error: `没有找到角色「${charName}」` }
  let models: Record<string, any>
  try { models = await loadMiaoModels() } catch (err) {
    return { ok: false, error: `加载 miao 模型失败：${(err as Error)?.message ?? err}` }
  }
  const Player = models.Player
  const Character = models.Character
  if (!Player || !Character) return { ok: false, error: 'miao 模型缺少 Player / Character' }
  const char = Character.get?.(local.name) || Character.get?.(charName)
  if (!char?.id) return { ok: false, error: `miao 里没有角色「${local.name}」` }
  let player: any
  try {
    player = typeof Player.get === 'function' ? Player.get(resolved.uid) : Player.create({ uid: resolved.uid })
  } catch (err) {
    return { ok: false, error: `读取玩家 ${resolved.uid} 失败：${(err as Error)?.message ?? err}` }
  }
  if (!player) return { ok: false, error: `无法载入玩家 ${resolved.uid}` }
  if (player.e == null) player.e = e
  const avatar = player.getAvatar?.(char.id) || player.getAvatar?.(char.id, true)
  if (!avatar) return { ok: false, error: `没有取到「${local.name}」的面板：先在 miao 侧发一次 #面板 或 #米游社更新面板` }
  let detail: Record<string, any> = {}
  try {
    detail = avatar.getArtisDetail?.(false) ?? avatar.artis?.getDetail?.() ?? {}
  } catch { detail = {} }
  const ids = setIds()
  const artis: ExportPiece[] = []
  for (let idx = 1; idx <= 5; idx++) {
    const ds = (detail[idx] ?? detail[String(idx)]) as Record<string, any> | undefined
    if (!ds) continue
    const mainKey = KEY_MAP[String(ds.main?.key ?? '')] ?? ''
    const subs: Array<{ key: string, value: number }> = []
    for (const attr of (Array.isArray(ds.attrs) ? ds.attrs : [])) {
      const key = KEY_MAP[String(attr?.key ?? '')] ?? ''
      const value = toNumber(attr?.value)
      if (!key || value === null) continue
      subs.push({ key, value })
    }
    artis.push({
      slot: SLOT_KEYS[idx - 1],
      set: String(ds.set ?? ''),
      setId: ids.get(String(ds.set ?? '')) ?? '',
      name: String(ds.name ?? ''),
      level: Number(ds.level) || 0,
      mainKey,
      mainValue: toNumber(ds.main?.value),
      subs
    })
  }
  if (!artis.length) return { ok: false, error: `「${local.name}」的面板里没有圣遗物明细（先让 miao 拉一次米游社明细）` }
  const talent = avatar.talent && typeof avatar.talent === 'object' ? avatar.talent : {}
  const weapon = avatar.weapon?.name
    ? { name: String(avatar.weapon.name), affix: Number(avatar.weapon.affix) || 1, level: Number(avatar.weapon.level) || 0 }
    : null
  const payload: PanelExport = {
    schemaVersion: 1,
    uid: String(resolved.uid),
    charId: String(char.id),
    charName: String(local.name),
    level: Number(avatar.level) || 0,
    cons: Number(avatar.cons) || 0,
    talent: {
      A: Number(talent.a?.level ?? talent.a) || 0,
      E: Number(talent.e?.level ?? talent.e) || 0,
      Q: Number(talent.q?.level ?? talent.q) || 0
    },
    weapon,
    artis,
    exportedAt: new Date().toISOString()
  }
  const dir = path.join(botRoot, 'plugins', 'Meta-Plugin', 'data', 'team-sim', 'panel-exports')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${char.id}.json`), JSON.stringify(payload, null, 2) + '\n', 'utf8')
  } catch (err) {
    return { ok: false, error: `写入导出文件失败：${(err as Error)?.message ?? err}` }
  }
  return { ok: true, file: path.join(dir, `${char.id}.json`), charName: local.name, pieces: artis.length }
}

/** 导出目录（编辑器与命令共用） */
export function panelExportDir (): string {
  return path.join(botRoot, 'plugins', 'Meta-Plugin', 'data', 'team-sim', 'panel-exports')
}
