/**
 * raidQuery — 危战榜单查询（合并自 `Mhydps-Plugin/modules/raidQuery.js`，行为逐字等价）
 *
 * 数据口径（来自站点 `/api/teams2` 全量记录）：
 *   speed   通关耗时（秒）
 *   ver     版本（5.7 ~ 当前，站点每期三个首领）
 *   boss    首领 id，名称来自随插件分发的 `resources/data/bosses.json`
 *   cost    总金数 = limitcost + normalcost
 * 站点前端的排序是「金数升序 → 耗时升序」，本模块默认同口径（`opts.sort = 'costAsc'`）。
 */
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js'
import type { RaidRecord } from '../model/TeamStore.js'
import { bossById, bossesOfVer, findBoss, findCharacter, memberIs, searchCharacters, versions } from '../model/CharacterIndex.js'
import type { CharacterRecord } from '../model/CharacterIndex.js'
import { ensureAvatars } from '../model/AvatarStore.js'
import { getPageSize, getPluginConfig } from '../components/config.js'
import { MAX_PAGE_SIZE, speedText } from '../components/constants.js'
import { avatarIdsOf, memberViews, tagViews } from './teamView.js'
import type { QueryFailure, QueryOptions } from './rankQuery.js'
import type { ViewRow } from './formatText.js'

/** 排序口径 */
export const RAID_SORTS: Record<string, (a: RaidRecord, b: RaidRecord) => number> = {
  // 站点默认：低金优先，同金数比耗时
  costAsc: (a, b) => a.cost - b.cost || a.speed - b.speed,
  speed: (a, b) => a.speed - b.speed || a.cost - b.cost,
  costDesc: (a, b) => b.cost - a.cost || a.speed - b.speed
}

/** 筛选条件 */
export interface RaidFilters {
  /** `CharacterIndex` 首领记录 */
  bossRecord?: { id?: string | number, name?: string } | null
  ver?: string
  /** 角色记录 */
  character?: CharacterRecord | null
  costMin?: number | null
  costMax?: number | null
}

/** 查询参数 */
export interface RaidQuery extends RaidFilters {
  page?: number
  sort?: string
  char?: string
  boss?: string
}

/** 危战榜页查询结果 */
export interface RaidResult {
  ok: true
  total: number
  page: number
  totalPages: number
  pageSize: number
  rows: ViewRow[]
  avatarIds: string[]
  versions: string[]
  subtitle: string
  stale: boolean
  fetchedAt: number
  refreshed: boolean
  refreshError: string
  scope: { teams2: number }
}

/** 单条危战记录查询结果 */
export interface RaidEntry {
  ok: true
  row: ViewRow
  total: number
  rank: number
  subtitle: string
  stale: boolean
  fetchedAt: number
  refreshed: boolean
}

/**
 * 按条件筛选危战记录
 */
export function filterRaids (teams: RaidRecord[] | undefined, q: RaidFilters = {}): RaidRecord[] {
  return (teams || []).filter(t => {
    if (q.ver && t.ver !== q.ver) return false
    if (q.bossRecord && t.boss !== Number(q.bossRecord.id)) return false
    if (q.character && !(t.members || []).some(m => memberIs(m.charId, q.character))) return false
    if (Number.isFinite(q.costMin) && t.cost < (q.costMin as number)) return false
    if (Number.isFinite(q.costMax) && t.cost > (q.costMax as number)) return false
    return true
  })
}

/** 排序（不改原数组） */
export function sortRaids (teams: RaidRecord[] | undefined, sort = 'costAsc'): RaidRecord[] {
  const cmp = RAID_SORTS[sort] || RAID_SORTS.costAsc
  return [...(teams || [])].sort(cmp)
}

/** 组装单行视图 */
export function buildRows (teams: RaidRecord[] | undefined, startRank = 1): ViewRow[] {
  return (teams || []).map((team, i) => ({
    rank: startRank + i,
    speed: team.speed,
    speedText: speedText(team.speed),
    cost: team.cost,
    limitcost: team.limitcost,
    normalcost: team.normalcost,
    ver: team.ver,
    bossName: bossById(team.boss)?.name || (team.boss ? `首领#${team.boss}` : '-'),
    tags: tagViews(team),
    clean: team.clean,
    lvl: team.lvl,
    video: team.video,
    chars: memberViews(team.members)
  }))
}

/** 查询摘要 */
function describe (q: RaidQuery, ctx: { character: CharacterRecord | null, bossRecord: RaidFilters['bossRecord'] }): string {
  const parts: string[] = []
  if (q.ver) parts.push(`版本 ${q.ver}`)
  if (ctx.bossRecord) parts.push(String(ctx.bossRecord.name || ''))
  if (ctx.character) parts.push(ctx.character.name)
  if (Number.isFinite(q.costMax)) parts.push(`≤${q.costMax}金`)
  parts.push(q.sort === 'speed' ? '按耗时升序' : q.sort === 'costDesc' ? '按金数降序' : '按金数升序')
  return parts.join(' · ')
}

/**
 * 查询危战榜
 */
export async function queryRaid (q: RaidQuery = {}, opts: QueryOptions = {}): Promise<RaidResult | QueryFailure> {
  const character = q.char ? findCharacter(q.char) : null
  if (q.char && !character) {
    return {
      ok: false,
      error: `没有找到角色「${q.char}」`,
      suggestions: searchCharacters(q.char, 6).map(c => c.name)
    }
  }

  const bossRecord = q.boss ? findBoss(q.boss) : null
  if (q.boss && !bossRecord) {
    return {
      ok: false,
      error: `没有找到首领「${q.boss}」`,
      suggestions: versions().slice(0, 3).flatMap(v => bossesOfVer(v).map(b => b.name)).slice(0, 6)
    }
  }

  if (q.ver && !versions().includes(q.ver)) {
    return {
      ok: false,
      error: `没有版本「${q.ver}」的危战记录`,
      suggestions: versions().slice(0, 6)
    }
  }

  const fresh = await ensureFresh(opts)
  const { teams2 } = getSnapshot()

  const filtered = filterRaids(teams2, { ...q, character, bossRecord })
  const sort = opts.sort || q.sort || 'costAsc'
  const sorted = sortRaids(filtered, sort)

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(opts.pageSize || getPageSize())))
  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Number(q.page) || 1), totalPages)
  const start = (page - 1) * pageSize
  const slice = sorted.slice(start, start + pageSize)

  // 先补立绘再组装视图（同 rankQuery）
  const avatarIds = avatarIdsOf(slice)
  if (opts.downloadAvatars !== false && getPluginConfig()?.dpsAvatarEnabled !== false && avatarIds.length) {
    await ensureAvatars(avatarIds, opts).catch(() => {})
  }

  const info = cacheInfo()
  return {
    ok: true,
    total,
    page,
    totalPages,
    pageSize,
    rows: buildRows(slice, start + 1),
    avatarIds,
    versions: versions(),
    subtitle: describe({ ...q, sort }, { character, bossRecord }),
    stale: info.stale,
    fetchedAt: info.fetchedAt,
    refreshed: fresh.refreshed,
    refreshError: fresh.ok ? '' : String(fresh.error || ''),
    scope: { teams2: teams2.length }
  }
}

/**
 * 按名次取单条危战记录（视频查询用）
 *
 * 名次与榜单图编号同口径：当前筛选与排序下从 1 起的全局序号（跨页连续）。
 */
export async function findRaidEntry (
  q: RaidQuery = {},
  rankNo: number | string,
  opts: QueryOptions = {}
): Promise<RaidEntry | QueryFailure> {
  const rank = Number(rankNo)
  if (!Number.isFinite(rank) || rank < 1 || !Number.isInteger(rank)) {
    return { ok: false, error: '名次需要是正整数，例如 #DPS危战视频 3' }
  }

  const character = q.char ? findCharacter(q.char) : null
  if (q.char && !character) {
    return {
      ok: false,
      error: `没有找到角色「${q.char}」`,
      suggestions: searchCharacters(q.char, 6).map(c => c.name)
    }
  }

  const bossRecord = q.boss ? findBoss(q.boss) : null
  if (q.boss && !bossRecord) {
    return { ok: false, error: `没有找到首领「${q.boss}」`, suggestions: [] }
  }
  if (q.ver && !versions().includes(q.ver)) {
    return { ok: false, error: `没有版本「${q.ver}」的危战记录`, suggestions: versions().slice(0, 6) }
  }

  const fresh = await ensureFresh(opts)
  const { teams2 } = getSnapshot()
  const sort = opts.sort || q.sort || 'costAsc'
  const sorted = sortRaids(filterRaids(teams2, { ...q, character, bossRecord }), sort)

  const total = sorted.length
  if (!total) return { ok: false, error: '当前筛选条件下没有任何记录' }
  if (rank > total) return { ok: false, error: `名次超出范围：当前条件下共 ${total} 条` }

  const info = cacheInfo()
  return {
    ok: true,
    row: buildRows([sorted[rank - 1]], rank)[0],
    total,
    rank,
    subtitle: describe({ ...q, sort }, { character, bossRecord }),
    stale: info.stale,
    fetchedAt: info.fetchedAt,
    refreshed: fresh.refreshed
  }
}
