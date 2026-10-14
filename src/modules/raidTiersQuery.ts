/**
 * raidTiersQuery — 危战榜的 n6 / n7 两档（v3 P1 新入口 `#危战`）
 *
 * 口径（用户 2026-10-13 定，写进页面脚注，避免用户误解）：
 *   - **n7 档**：65s 内通关（允许 1~5s 浮动 → 取 **≤70s**）
 *   - **n6 档**：其余记录（>70s），按耗时**降序**展示 —— 越接近站点上限 **120s** 越靠前，
 *     正好对应"险胜通过 n6"的水平
 *
 * 为什么这样切而不是写死"110~120s"：站点记录里**没有难度字段**，只能由耗时推断；
 * 用 70s 一刀切能覆盖全部记录（不丢数据），并把"刚过 n6"的一端排在最前。
 *
 * 数据口径与 `raidQuery` 完全一致（同一份 `/api/teams2` 缓存、同一套筛选与视图）。
 */
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js'
import type { RaidRecord } from '../model/TeamStore.js'
import { bossById, bossesOfVer, findBoss, findCharacter, searchCharacters, versions } from '../model/CharacterIndex.js'
import { ensureAvatars } from '../model/AvatarStore.js'
import { getPluginConfig } from '../components/config.js'
import { avatarIdsOf } from './teamView.js'
import { buildRows as buildRaidRows, filterRaids } from './raidQuery.js'
import type { QueryFailure, QueryOptions } from './rankQuery.js'
import type { RaidQuery } from './raidQuery.js'

/** n7 判定的耗时上限（秒）：65s + 最多 5s 浮动 */
export const N7_SECONDS_LIMIT = 70

/** 站点收录的耗时上限（秒），仅用于页面文案与排序说明 */
export const RAID_SPEED_CAP = 120

/** 每档默认取前几条 */
export const DEFAULT_TIER_ROWS = 5

export interface RaidTierBlock {
  key: 'n7' | 'n6'
  label: string
  /** 该档的口径说明（页面小字） */
  note: string
  /** 该档命中条数（不限于展示的前 N 条） */
  count: number
  rows: ReturnType<typeof buildRaidRows>
}

export interface RaidTiersResult {
  ok: true
  tiers: RaidTierBlock[]
  /** 命中筛选条件的总条数 */
  total: number
  fetchedAt: number
  stale: boolean
  refreshed: boolean
  subtitle: string
}

/**
 * 查询危战记录并按 n6 / n7 分档
 *
 * 筛选语义与 `#DPS危战榜` 完全一致（版本 / 首领 / 角色 / 金数），只是展示方式改为两档。
 */
export async function queryRaidTiers (
  q: RaidQuery = {},
  opts: QueryOptions & { perTier?: number } = {}
): Promise<RaidTiersResult | QueryFailure> {
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
  const n7 = filtered.filter(t => Number(t.speed) <= N7_SECONDS_LIMIT)
  const n6 = filtered.filter(t => Number(t.speed) > N7_SECONDS_LIMIT)

  // n7：越快越靠前；n6：越接近 120s 上限越靠前（"险胜"）
  n7.sort((a, b) => a.speed - b.speed || a.cost - b.cost)
  n6.sort((a, b) => b.speed - a.speed || a.cost - b.cost)

  const perTier = Math.max(1, Number(opts.perTier) || DEFAULT_TIER_ROWS)
  const pick = (list: RaidRecord[]) => list.slice(0, perTier)
  const tops = [pick(n7), pick(n6)]

  // 先补立绘再组装视图（与 raidQuery 同一顺序）
  const avatarIds = avatarIdsOf(tops.flat())
  if (opts.downloadAvatars !== false && getPluginConfig()?.dpsAvatarEnabled !== false && avatarIds.length) {
    await ensureAvatars(avatarIds, opts).catch(() => {})
  }

  const tiers: RaidTierBlock[] = [
    {
      key: 'n7',
      label: `n7 档（≤ ${N7_SECONDS_LIMIT}s）`,
      note: '65s 内通关，允许 1~5s 浮动；越快越靠前',
      count: n7.length,
      rows: buildRaidRows(tops[0], 1)
    },
    {
      key: 'n6',
      label: `n6 档（> ${N7_SECONDS_LIMIT}s）`,
      note: `其余记录；按耗时降序，越接近站点上限 ${RAID_SPEED_CAP}s 越靠前（险胜通过 n6 的水平）`,
      count: n6.length,
      rows: buildRaidRows(tops[1], 1)
    }
  ]

  const info = cacheInfo()
  const scope = [q.ver ? `版本 ${q.ver}` : '', bossRecord ? `首领 ${bossRecord.name}` : '', character ? `含 ${character.name}` : '']
    .filter(Boolean)
    .join(' · ')
  const subtitle = `幽境危战 · n6 / n7 两档${scope ? `｜${scope}` : ''}｜命中 ${filtered.length} 条` +
    `（n7 ${n7.length} / n6 ${n6.length}）｜每档最多 ${perTier} 条`

  return {
    ok: true,
    tiers,
    total: filtered.length,
    fetchedAt: info.fetchedAt,
    stale: info.stale,
    refreshed: fresh.refreshed,
    subtitle
  }
}

/** 首领名（模板兜底用） */
export function bossNameOf (id: number | undefined): string {
  return bossById(id)?.name || (id ? `首领#${id}` : '-')
}
