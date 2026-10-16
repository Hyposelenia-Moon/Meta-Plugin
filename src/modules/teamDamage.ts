/**
 * teamDamage — `#队伍伤害` 的纯计算部分（v3 P3 v1）
 *
 * 两件事：
 *   1. **估算队伍金数**：5★ 角色 1 金 + 命座每级 1 金 + 5★ 武器 1 金（精炼不计）——
 *      与站点的口径接近但不完全相同，所以页面上一律写「约 N 金」。
 *   2. **找同阵容的 mhydps 记录**：完全相同的四人（不看顺序）→ 按"金数最接近"再按伤害降序排，
 *      作为"别人这套打到多少"的锚点。
 *
 * 本模块**纯函数**（不读文件、不联网、不引 miao），因此可用合成数据完整单测。
 */
import { avatarIdOf } from '../model/CharacterIndex.js'
import type { TeamRecord } from '../model/TeamStore.js'
import { statPatchToken } from './statPatch.js'

/** 参与的队员（取自 miao 薄桥，或测试里手工构造） */
export interface TeamMemberInput {
  charName: string
  rarity: number
  level: number
  cons: number
  weapon: { name: string, affix: number, rarity: number } | null
  talent?: { A: number, E: number, Q: number }
  rows?: Array<{ title: string, value: number }>
  ruleBy?: string
  artiMark?: { total: number, markClass: string } | null
  artiSets?: string[]
}

export interface LineupRef {
  /** 榜单里的名次无关，这里给"金数差"与伤害 */
  cost: number
  limitcost: number
  normalcost: number
  damage: number
  video: string
  tags: string[]
  members: Array<{ name: string, cons: number, avatar: string }>
  /** 与估算金数之差（0 = 同金） */
  costDiff: number
}

export interface TeamDamageView {
  /** 估算金数 */
  approxCost: number
  /** 金数构成说明 */
  costNote: string
  /** 同阵容参考（最多 N 条） */
  refs: LineupRef[]
  /** 命中的同阵容记录总数 */
  refTotal: number
  /** 是否按"同金优先"排过序 */
  sameCostFirst: boolean
  notes: string[]
}

/** 估算队伍金数（5★ 角色 + 命座 + 5★ 武器；精炼不计） */
export function estimateCost (members: TeamMemberInput[]): number {
  let cost = 0
  for (const m of members) {
    if (Number(m.rarity) >= 5) cost += 1
    cost += Math.max(0, Number(m.cons) || 0)
    if (Number(m.weapon?.rarity) >= 5) cost += 1
  }
  return cost
}

/** 金数构成（页面脚注用） */
export function costBreakdown (members: TeamMemberInput[]): string {
  const chars = members.filter(m => Number(m.rarity) >= 5).length
  const cons = members.reduce((s, m) => s + Math.max(0, Number(m.cons) || 0), 0)
  const weapons = members.filter(m => Number(m.weapon?.rarity) >= 5).length
  return `5★角色 ${chars} + 命座 ${cons} + 5★武器 ${weapons}（精炼不计）`
}

/** 榜单记录是否与给定四人**完全同阵容**（顺序无关） */
export function isSameLineup (team: TeamRecord, names: string[]): boolean {
  const want = [...names].sort()
  const got = [...new Set((team.members || []).map(m => String(m.charId || '')))].sort()
  if (got.length !== want.length) return false
  return want.every((n, i) => n === got[i])
}

/**
 * 找同阵容参考
 *
 * @param teams      榜单记录（`TeamStore` 的快照）
 * @param names      我方四人
 * @param approxCost 估算金数（用于"同金优先"）
 * @param limit      最多返回几条
 */
export function findLineupRefs (
  teams: TeamRecord[] | undefined,
  names: string[],
  approxCost = 0,
  limit = 5
): { refs: LineupRef[], total: number } {
  const hit = (teams || []).filter(t => isSameLineup(t, names))
  const mapped: LineupRef[] = hit.map(t => ({
    cost: Number(t.cost) || 0,
    limitcost: Number(t.limitcost) || 0,
    normalcost: Number(t.normalcost) || 0,
    damage: Number(t.damage) || 0,
    video: String(t.video || ''),
    tags: Array.isArray(t.tags) ? t.tags : [],
    members: (t.members || []).map(m => ({ name: String(m.charId || ''), cons: Number(m.constellation) || 0, avatar: avatarIdOf(String(m.charId || '')) })),
    costDiff: Math.abs((Number(t.cost) || 0) - approxCost),
      damageWanText: ((Number(t.damage) || 0) / 10000).toFixed(2)
  }))
  // 同金优先（金数差小的在前），其次伤害高的在前
  mapped.sort((a, b) => a.costDiff - b.costDiff || b.damage - a.damage)
  return { refs: mapped.slice(0, Math.max(1, limit)), total: mapped.length }
}

/** 组装页面视图 */
export function buildTeamDamageView (
  members: TeamMemberInput[],
  teams: TeamRecord[] | undefined,
  limit = 5
): TeamDamageView {
  const approxCost = estimateCost(members)
  const names = members.map(m => m.charName)
  const { refs, total } = findLineupRefs(teams, names, approxCost, limit)
  const notes: string[] = []
  if (!total) {
    notes.push('这份榜单里暂时没有这套四人阵容的记录（榜单是匿名投稿，冷门阵容可能没人打）')
  } else if (!refs.some(r => r.costDiff === 0)) {
    notes.push(`同阵容共 ${total} 条，但没有正好「约 ${approxCost} 金」的记录 —— 下面按金数最接近排序，注意金数差异`)
  }
  if (members.some(m => !m.rows?.length)) {
    notes.push('有队员没有取到伤害行（该角色可能没有 miao 伤害规则）')
  }
  return {
    approxCost,
    costNote: costBreakdown(members),
    refs,
    refTotal: total,
    sameCostFirst: true,
    notes
  }
}

/* ------------------------------------------------------------------ *
 * 参数解析（从 app 里挪出来：纯函数才能离线单测）
 * ------------------------------------------------------------------ */

/**
 * 旧写法（2026-10-15 废除）：`轴:…` / `词条:…`
 *
 * 现在轴走序号（`#队伍伤害2`）、词条免前缀（`暴击+20`）；命中旧写法时给一句改用提示，
 * 而不是静默当作角色名（否则只会得到"要四个角色名"这种看不懂的报错）。
 */
export const LEGACY_TOKEN_RE = /^(?:轴|词条)[:：]/

/** 把参数拆成「四人名 + 可选 UID + 词条」（支持空格 / 顿号 / 逗号分隔） */
export function parseTeamArgs (raw: string): {
  names: string[]
  uid: string
  /** 词条 token（免前缀；`statPatchToken` 判定） */
  patchTokens: string[]
  /** 旧写法 token（已废除，app 提示用） */
  legacyTokens: string[]
} {
  const parts = String(raw || '')
    .split(/[\s、,，/|]+/)
    .map(t => t.trim())
    .filter(Boolean)

  let uid = ''
  const names: string[] = []
  const patchTokens: string[] = []
  const legacyTokens: string[] = []

  for (const p of parts) {
    if (LEGACY_TOKEN_RE.test(p)) {
      legacyTokens.push(p)
      continue
    }
    if (/^[1-9]\d{8}$/.test(p) && !uid) {
      uid = p
      continue
    }
    if (statPatchToken(p)) {
      patchTokens.push(p)
      continue
    }
    names.push(p)
  }

  return { names, uid, patchTokens, legacyTokens }
}