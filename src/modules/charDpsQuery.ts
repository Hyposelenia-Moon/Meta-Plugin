/**
 * charDpsQuery — 角色「各金档最高伤害队伍」（v3 P1 新入口 `#xx dps`）
 *
 * 与 `#DPS榜` 的区别（这是 P1 的核心改动）：
 *   - `#DPS榜 胡桃` 给的是"含胡桃的记录"按全局伤害排序（第 1 名往往是别人打的冷门阵容）
 *   - 本模块给的是**同一角色在每个金档各取前几条** —— 实测同金最高分的阵容每档都不同
 *     （4 金 = 玛薇卡C2队、12 金 = 莱欧斯利C6队、48 金 = 玛薇卡C6队），所以"全局同金第一"对用户没意义
 *
 * 分档口径（2026-10-17 用户定，替换 2026-10-15 的「每档 4 条」）：
 *   低金**每 4 金一档**（`≤ 4 金` / `5-8 金` … `25-28 金`）+ **`29-31 金`** + **`32-48 金` 合并档**；
 *   条数 = 32 金以下每档 **5 条**、32-48 合并档 **固定 4 条**（该档记录不足就少列）。
 *   合并档的作用：原口径下 `33-36 / 37-40 / 41-44 / 45-48` 四档会被档数上限整段丢掉。
 *
 * 数据口径与 `rankQuery` 完全一致（同一份 `/api/teams` 缓存、同一套筛选与视图），
 * 本模块只多做一件事：**按金数区间分组，每组内部按 damage 降序取前 N 条**。
 */
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js'
import type { TeamRecord } from '../model/TeamStore.js'
import { findCharacter, searchCharacters } from '../model/CharacterIndex.js'
import { ensureAvatars } from '../model/AvatarStore.js'
import { getPluginConfig } from '../components/config.js'
import { avatarIdsOf } from './teamView.js'
import { buildRows, filterSummary, filterTeams, resolveTags, sortTeams } from './rankQuery.js'
import type { QueryFailure, QueryOptions, RankFilters, TagResolution } from './rankQuery.js'

/*
 * 分档口径（2026-10-17 用户定，实测后定稿）：
 *   ≤4 / 5-8 / 9-12 / 13-16 / 17-20 / 21-24 / 25-28（7 档，每档 4 金）
 *   + **29-48 金合并档**（29-31 与原来的 33-36/37-40/41-44/45-48 全并进来）
 * 为什么 29-31 不单列：实测全库 368 条里 29-31 只有 **4 条**（最少），10 个有该档的角色中
 * 6 个只有 1 条，且**没有任何角色"只有 29-31 而没有 ≥32"** —— 单列只会多加一张空卡。
 * 条数（群内更需要中低金，2026-10-17 用户定）：≤16 金每档 6 条、17-20 金 5 条、
 * 21 金以上与合并档 4 条；最坏 41 行（原口径 44 行），中低金反而更全、整图更矮。
 */

/** 中低金档（≤16 金）每档条数：群内主力数据，2026-10-17 用户定 5 → 6 */
export const PER_TIER_LOW = 6

/** 17-20 金档每条数：数据量中等（全库 28 条），保持 5 条 */
export const PER_TIER_MID = 5

/** 高金 / 稀疏档（21 金以上，含合并档）条数 */
export const PER_TIER_HIGH = 4

/** 金数分档步长（低金档**每 4 金一档** —— ≤4 / 5-8 / 9-12 …） */
export const COST_STEP = 4

/** 合并档边界（29-48 金合并为一个档位） */
export const MERGED_TIER_MIN = 29
export const MERGED_TIER_MAX = 48

/** 合并档的档序号（低金档 0…6，合并档 7） */
export const MERGED_TIER_BUCKET = 7

/** 金档总数：≤4 … 25-28（7 档）+ 29-48 = 8 档 */
export const DEFAULT_MAX_TIERS = 8

export interface CharDpsTier {
  /** 区间下界（第一档是 0，含无金队） */
  min: number
  /** 区间上界 */
  max: number
  /** 区间标题：`≤ 4 金` / `5-8 金` / … / `29-48 金` */
  label: string
  /** 该档的记录总数 */
  count: number
  /** 该档取到的前 N 条（视图行，与榜单页同一个 ViewRow 形状） */
  rows: ReturnType<typeof buildRows>
}

/**
 * 金数 → 档序号
 *
 * `≤4 → 0`、`5-8 → 1` … `25-28 → 6`、`29 及以上 → 7`（29-48 合并档）。
 */
export function costBucketOf (cost: number): number {
  const n = Math.max(0, Number(cost) || 0)
  if (n >= MERGED_TIER_MIN) return MERGED_TIER_BUCKET
  return Math.max(0, Math.ceil(n / COST_STEP) - 1)
}

/** 档序号 → 区间与标题（`0` → `≤ 4 金`、`6` → `25-28 金`、`≥7` → `29-48 金`） */
export function costRangeOf (bucket: number): { min: number, max: number, label: string } {
  const b = Math.max(0, Math.floor(Number(bucket) || 0))
  if (b >= MERGED_TIER_BUCKET) {
    return { min: MERGED_TIER_MIN, max: MERGED_TIER_MAX, label: `${MERGED_TIER_MIN}-${MERGED_TIER_MAX} 金` }
  }
  if (b === 0) return { min: 0, max: COST_STEP, label: `≤ ${COST_STEP} 金` }
  const min = b * COST_STEP + 1
  const max = (b + 1) * COST_STEP
  return { min, max, label: `${min}-${max} 金` }
}

/**
 * 该档默认取几条（2026-10-17 实测后定稿，群内更需要中低金）：
 *   档 0…3（≤16 金）→ 6 条；档 4（17-20 金）→ 5 条；档 5…6（21-28 金）与合并档 → 4 条。
 */
export function perTierOf (bucket: number): number {
  const b = Math.max(0, Math.floor(Number(bucket) || 0))
  if (b >= MERGED_TIER_BUCKET) return PER_TIER_HIGH
  if (b <= 3) return PER_TIER_LOW
  if (b === 4) return PER_TIER_MID
  return PER_TIER_HIGH
}

export interface CharDpsResult {
  ok: true
  /** 归一后的角色名（标题用） */
  charName: string
  tiers: CharDpsTier[]
  /** 命中该角色的记录总数 */
  total: number
  /** 实际展示的金档数 */
  tierCount: number
  /** 因超过上限而未展示的金档数（0 = 全部展示） */
  droppedTiers: number
  fetchedAt: number
  stale: boolean
  refreshed: boolean
  subtitle: string
  /** 标签解析结果（显式/裸词/生效条件/诊断） */
  tags: TagResolution
}

/**
 * 查询某角色在各金档的最高伤害队伍
 *
 * @param char 角色名（支持别名，如 火神 / 桃）
 * @param q    额外筛选（金数区间、标签、主C、绿玩等，与 `#DPS榜` 同一套语义）
 */
export async function queryCharDps (
  char: string,
  q: RankFilters = {},
  opts: QueryOptions & { perTier?: number, maxTiers?: number } = {}
): Promise<CharDpsResult | QueryFailure> {
  const character = char ? findCharacter(char) : null
  if (!character) {
    return {
      ok: false,
      error: `没有找到角色「${char}」`,
      suggestions: searchCharacters(char, 6).map(c => c.name)
    }
  }

  const fresh = await ensureFresh(opts)
  const { teams } = getSnapshot()

  // 标签与榜单同一口径（显式原样、裸词核实），筛选与副标题摘要都用这一份
  const tags = resolveTags(teams, q)
  const filtered = filterTeams(teams, { ...q, character, tag: tags.effective })

  // 按金数**区间**分组（每 `COST_STEP` 金一档，档序号升序）
  const byBucket = new Map<number, TeamRecord[]>()
  for (const team of filtered) {
    const bucket = costBucketOf(Number(team.cost) || 0)
    const list = byBucket.get(bucket)
    if (list) list.push(team)
    else byBucket.set(bucket, [team])
  }

  const maxTiers = Math.max(1, Number(opts.maxTiers) || DEFAULT_MAX_TIERS)
  let buckets = [...byBucket.keys()].sort((a, b) => a - b)
  let droppedTiers = 0
  if (buckets.length > maxTiers) {
    // 记录更多的档优先；同数量时保留低金档（更贴近多数玩家），最后仍按金档升序展示
    buckets = buckets
      .slice()
      .sort((a, b) => (byBucket.get(b)!.length - byBucket.get(a)!.length) || (a - b))
      .slice(0, maxTiers)
      .sort((a, b) => a - b)
    droppedTiers = byBucket.size - buckets.length
  }

  // 每档先选出前 N 条（后面补立绘、组装视图都用这一批，避免重复排序）
  // `opts.perTier` 是**显式覆盖**（套件/调试用）；不传时按档位取：32 金以下 5 条、32-48 合并档 4 条
  const perTierOverride = Math.max(0, Number(opts.perTier) || 0)
  const tops = buckets.map(bucket => sortTeams(byBucket.get(bucket)!, 'damage').slice(0, perTierOverride || perTierOf(bucket)))

  // 先补立绘再组装视图（与 rankQuery 同一顺序：memberViews 依赖本地是否已有立绘）
  const avatarIds = avatarIdsOf(tops.flat())
  if (opts.downloadAvatars !== false && getPluginConfig()?.dpsAvatarEnabled !== false && avatarIds.length) {
    await ensureAvatars(avatarIds, opts).catch(() => {})
  }

  const tiers: CharDpsTier[] = buckets.map((bucket, idx) => ({
    ...costRangeOf(bucket),
    count: byBucket.get(bucket)!.length,
    rows: buildRows(tops[idx], 1)
  }))

  const info = cacheInfo()
  /*
   * 副标题里**写明筛选条件**：命中 0 时页面换成文本（见 `modules/respond.ts`），
   * 那时这段就是"为什么是 0"的唯一线索（例如 `视频1` 被当成标签筛掉了全部记录）。
   */
  const filters = filterSummary({ ...q, tag: tags.effective, sort: 'damage' })
  const subtitle = `#${character.name} · 每 ${COST_STEP} 金一档的最高伤害队伍` +
    `（${MERGED_TIER_MIN} 金以上合并为 ${MERGED_TIER_MIN}-${MERGED_TIER_MAX} 金一档；≤16 金每档 ${PER_TIER_LOW} 条、17-20 金 ${PER_TIER_MID} 条、21 金以上 ${PER_TIER_HIGH} 条）` +
    (filters ? `｜筛选：${filters}` : '') +
    `｜命中 ${filtered.length} 条 / ${byBucket.size} 个金档` +
    // 条件被忽略/无法核实时如实说明（审核 Q5：不能静默放宽，也不能只改过滤不改摘要）
    (tags.notice ? `｜${tags.notice}` : '') +
    (droppedTiers ? `｜金档过多，仅展示记录最多的 ${tiers.length} 档（另有 ${droppedTiers} 档未展示）` : '') +
    '｜数据来自 mhydps.cn 的匿名配队记录（期望 DPS），非官方数值'

  return {
    ok: true,
    charName: character.name,
    tiers,
    total: filtered.length,
    tierCount: tiers.length,
    droppedTiers,
    fetchedAt: info.fetchedAt,
    stale: info.stale,
    refreshed: fresh.refreshed,
    subtitle,
    tags
  }
}
