/**
 * rankQuery — DPS 数据库榜单查询（合并自 `Mhydps-Plugin/modules/rankQuery.js`，行为逐字等价）
 *
 * 数据口径（来自站点 `/api/teams` 全量记录）：
 *   damage        期望 DPS（站点按此降序收录，前端「DPS数据库」页同口径）
 *   cost          总金数 = limitcost + normalcost（实测 1394/1394 成立）
 *   members       配队四人（含各自命座），第一位是主 C（前端「只搜主C」即按此判定）
 *   clean / lvl   绿玩（无宏/无连点）/ 全员满级
 * 本模块只做筛选、排序、分页与视图组装；取数与缓存新鲜度交给 `TeamStore`。
 */
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js'
import type { TeamRecord } from '../model/TeamStore.js'
import { findCharacter, memberIs, searchCharacters } from '../model/CharacterIndex.js'
import type { CharacterRecord } from '../model/CharacterIndex.js'
import { ensureAvatars } from '../model/AvatarStore.js'
import { getPageSize, getPluginConfig } from '../components/config.js'
import { MAX_PAGE_SIZE, damageText } from '../components/constants.js'
import { avatarIdsOf, memberViews, tagViews } from './teamView.js'
import type { ViewRow } from './formatText.js'

/** 排序口径：damage = 期望 DPS 降序（默认），costAsc/costDesc = 按总金数 */
export const RANK_SORTS: Record<string, (a: TeamRecord, b: TeamRecord) => number> = {
  damage: (a, b) => b.damage - a.damage || a.cost - b.cost,
  costAsc: (a, b) => a.cost - b.cost || b.damage - a.damage,
  costDesc: (a, b) => b.cost - a.cost || b.damage - a.damage
}

/** 筛选条件 */
export interface RankFilters {
  /** `CharacterIndex` 角色记录（内部会把成员名比对上别名） */
  character?: CharacterRecord | null
  costMin?: number | null
  costMax?: number | null
  /** 标签包含匹配（不区分大小写），空格分隔的多个标签需全部命中 */
  tag?: string
  /** 只看绿玩 */
  cleanOnly?: boolean
  /** 只匹配主 C（阵容第一位） */
  mainOnly?: boolean
}

/** 查询参数（`modules/queryArgs.js` 解析产物 + 排序） */
export interface RankQuery extends RankFilters {
  page?: number
  sort?: string
  char?: string
}

/** 查询选项 */
export interface QueryOptions {
  proxy?: string
  timeoutMs?: number
  sort?: string
  pageSize?: number
  /** 传 false 跳过补图（套件与离线环境用） */
  downloadAvatars?: boolean
}

/** 查询失败（角色没找到 / 名次越界） */
export interface QueryFailure {
  ok: false
  error: string
  suggestions?: string[]
}

/** 榜单页查询结果 */
export interface RankResult {
  ok: true
  total: number
  page: number
  totalPages: number
  pageSize: number
  rows: ViewRow[]
  avatarIds: string[]
  subtitle: string
  stale: boolean
  fetchedAt: number
  refreshed: boolean
  refreshError: string
  scope: { teams: number }
}

/** 单条记录查询结果 */
export interface RankEntry {
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
 * 按条件筛选配队
 */
export function filterTeams (teams: TeamRecord[] | undefined, q: RankFilters = {}): TeamRecord[] {
  const tags = String(q.tag || '').split(/\s+/).filter(Boolean).map(s => s.toLowerCase())

  return (teams || []).filter(team => {
    if (q.character) {
      const members = q.mainOnly ? (team.members || []).slice(0, 1) : (team.members || [])
      if (!members.some(m => memberIs(m.charId, q.character))) return false
    }
    if (q.cleanOnly && !team.clean) return false
    if (Number.isFinite(q.costMin) && team.cost < (q.costMin as number)) return false
    if (Number.isFinite(q.costMax) && team.cost > (q.costMax as number)) return false
    if (tags.length) {
      const own = (team.tags || []).map(t => t.toLowerCase())
      if (!tags.every(t => own.some(o => o.includes(t)))) return false
    }
    return true
  })
}

/** 排序（不改原数组） */
export function sortTeams (teams: TeamRecord[] | undefined, sort = 'damage'): TeamRecord[] {
  const cmp = RANK_SORTS[sort] || RANK_SORTS.damage
  return [...(teams || [])].sort(cmp)
}

/** 组装单行的视图数据（名次从 `startRank` 连续编号） */
export function buildRows (teams: TeamRecord[] | undefined, startRank = 1): ViewRow[] {
  return (teams || []).map((team, i) => ({
    rank: startRank + i,
    damage: team.damage,
    damageText: damageText(team.damage),
    cost: team.cost,
    limitcost: team.limitcost,
    normalcost: team.normalcost,
    tags: tagViews(team),
    clean: team.clean,
    lvl: team.lvl,
    video: team.video,
    chars: memberViews(team.members)
  }))
}

/** 查询摘要（页脚与副标题用） */
function describe (q: RankQuery, character: CharacterRecord | null): string {
  const parts: string[] = []
  if (character) parts.push(`${character.name}${q.mainOnly ? '（主C）' : ''}`)
  if (Number.isFinite(q.costMin) && Number.isFinite(q.costMax)) parts.push(`${q.costMin}~${q.costMax}金`)
  else if (Number.isFinite(q.costMax)) parts.push(`≤${q.costMax}金`)
  else if (Number.isFinite(q.costMin)) parts.push(`≥${q.costMin}金`)
  if (q.tag) parts.push(`标签「${q.tag}」`)
  if (q.cleanOnly) parts.push('仅绿玩')
  if (q.sort === 'costAsc') parts.push('按金数升序')
  else if (q.sort === 'costDesc') parts.push('按金数降序')
  else parts.push('按期望DPS降序')
  return parts.join(' · ')
}

/**
 * 查询 DPS 榜
 *
 * @returns 成功 `{ ok: true, total, page, totalPages, rows, … }`；
 *          角色没找到 `{ ok: false, error, suggestions }`
 */
export async function queryRank (q: RankQuery = {}, opts: QueryOptions = {}): Promise<RankResult | QueryFailure> {
  const character = q.char ? findCharacter(q.char) : null
  if (q.char && !character) {
    return {
      ok: false,
      error: `没有找到角色「${q.char}」`,
      suggestions: searchCharacters(q.char, 6).map(c => c.name)
    }
  }

  const fresh = await ensureFresh(opts)
  const { teams } = getSnapshot()

  const filtered = filterTeams(teams, { ...q, character })
  const sorted = sortTeams(filtered, opts.sort || q.sort || 'damage')

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(opts.pageSize || getPageSize())))
  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Number(q.page) || 1), totalPages)
  const start = (page - 1) * pageSize
  const slice = sorted.slice(start, start + pageSize)

  // 先补立绘再组装视图：memberViews 依赖本地是否已有立绘决定 avatar 字段；补图失败不阻断查询
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
    subtitle: describe({ ...q, sort: opts.sort || q.sort || 'damage' }, character),
    stale: info.stale,
    fetchedAt: info.fetchedAt,
    refreshed: fresh.refreshed,
    refreshError: fresh.ok ? '' : String(fresh.error || ''),
    scope: { teams: teams.length }
  }
}

/**
 * 按名次取单条记录（视频查询用）
 *
 * 名次与榜单图里的编号同口径：在当前筛选与排序下从 1 开始的全局序号（跨页连续）。
 */
export async function findRankEntry (
  q: RankQuery = {},
  rankNo: number | string,
  opts: QueryOptions = {}
): Promise<RankEntry | QueryFailure> {
  const rank = Number(rankNo)
  if (!Number.isFinite(rank) || rank < 1 || !Number.isInteger(rank)) {
    return { ok: false, error: '名次需要是正整数，例如 #视频 3' }
  }

  const character = q.char ? findCharacter(q.char) : null
  if (q.char && !character) {
    return {
      ok: false,
      error: `没有找到角色「${q.char}」`,
      suggestions: searchCharacters(q.char, 6).map(c => c.name)
    }
  }

  const fresh = await ensureFresh(opts)
  const { teams } = getSnapshot()
  const sorted = sortTeams(
    filterTeams(teams, { ...q, character }),
    opts.sort || q.sort || 'damage'
  )

  const total = sorted.length
  if (!total) return { ok: false, error: '当前筛选条件下没有任何记录' }
  if (rank > total) return { ok: false, error: `名次超出范围：当前条件下共 ${total} 条` }

  const info = cacheInfo()
  return {
    ok: true,
    row: buildRows([sorted[rank - 1]], rank)[0],
    total,
    rank,
    subtitle: describe({ ...q, sort: opts.sort || q.sort || 'damage' }, character),
    stale: info.stale,
    fetchedAt: info.fetchedAt,
    refreshed: fresh.refreshed
  }
}
