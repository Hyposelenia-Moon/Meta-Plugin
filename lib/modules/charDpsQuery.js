/**
 * charDpsQuery — 角色「各金档最高伤害队伍」（v3 P1 新入口 `#xx dps`）
 *
 * 与 `#DPS榜` 的区别（这是 P1 的核心改动）：
 *   - `#DPS榜 胡桃` 给的是"含胡桃的记录"按全局伤害排序（第 1 名往往是别人打的冷门阵容）
 *   - 本模块给的是**同一角色在每个金档各取前几条** —— 实测同金最高分的阵容每档都不同
 *     （4 金 = 玛薇卡C2队、12 金 = 莱欧斯利C6队、48 金 = 玛薇卡C6队），所以"全局同金第一"对用户没意义
 *
 * 分档口径（用户 2026-10-15 定）：**每 4 金一档** —— `≤ 4 金` / `5-8 金` / `9-12 金` …，
 * 每档最多 4 条（该档记录不足就少列）；不再是"每个整数金数各一档"。
 *
 * 数据口径与 `rankQuery` 完全一致（同一份 `/api/teams` 缓存、同一套筛选与视图），
 * 本模块只多做一件事：**按金数区间分组，每组内部按 damage 降序取前 N 条**。
 */
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js';
import { findCharacter, searchCharacters } from '../model/CharacterIndex.js';
import { ensureAvatars } from '../model/AvatarStore.js';
import { getPluginConfig } from '../components/config.js';
import { avatarIdsOf } from './teamView.js';
import { buildRows, filterSummary, filterTeams, resolveTags, sortTeams } from './rankQuery.js';
/** 每个金档默认取前几条（用户 2026-10-15 定：**每档最多 4 条**；该档记录不足就少列几条） */
export const DEFAULT_PER_TIER = 4;
/** 金数分档步长（用户 2026-10-15 定：**每 4 金一档** —— ≤4 / 5-8 / 9-12 …） */
export const COST_STEP = 4;
/** 金档过多时最多保留几档（超出时优先保留记录更多的档，并如实告知丢弃了几档） */
export const DEFAULT_MAX_TIERS = 8;
/** 金数 → 档序号（≤4 → 0、5-8 → 1、9-12 → 2 …；用户 2026-10-15 定的"每 4 金一档"） */
export function costBucketOf(cost) {
    const n = Math.max(0, Number(cost) || 0);
    return Math.max(0, Math.ceil(n / COST_STEP) - 1);
}
/** 档序号 → 区间与标题（`0` → `≤ 4 金`、`1` → `5-8 金` …） */
export function costRangeOf(bucket) {
    const b = Math.max(0, Math.floor(Number(bucket) || 0));
    if (b === 0)
        return { min: 0, max: COST_STEP, label: `≤ ${COST_STEP} 金` };
    const min = b * COST_STEP + 1;
    const max = (b + 1) * COST_STEP;
    return { min, max, label: `${min}-${max} 金` };
}
/**
 * 查询某角色在各金档的最高伤害队伍
 *
 * @param char 角色名（支持别名，如 火神 / 桃）
 * @param q    额外筛选（金数区间、标签、主C、绿玩等，与 `#DPS榜` 同一套语义）
 */
export async function queryCharDps(char, q = {}, opts = {}) {
    const character = char ? findCharacter(char) : null;
    if (!character) {
        return {
            ok: false,
            error: `没有找到角色「${char}」`,
            suggestions: searchCharacters(char, 6).map(c => c.name)
        };
    }
    const fresh = await ensureFresh(opts);
    const { teams } = getSnapshot();
    // 标签与榜单同一口径（显式原样、裸词核实），筛选与副标题摘要都用这一份
    const tags = resolveTags(teams, q);
    const filtered = filterTeams(teams, { ...q, character, tag: tags.effective });
    // 按金数**区间**分组（每 `COST_STEP` 金一档，档序号升序）
    const byBucket = new Map();
    for (const team of filtered) {
        const bucket = costBucketOf(Number(team.cost) || 0);
        const list = byBucket.get(bucket);
        if (list)
            list.push(team);
        else
            byBucket.set(bucket, [team]);
    }
    const maxTiers = Math.max(1, Number(opts.maxTiers) || DEFAULT_MAX_TIERS);
    let buckets = [...byBucket.keys()].sort((a, b) => a - b);
    let droppedTiers = 0;
    if (buckets.length > maxTiers) {
        // 记录更多的档优先；同数量时保留低金档（更贴近多数玩家），最后仍按金档升序展示
        buckets = buckets
            .slice()
            .sort((a, b) => (byBucket.get(b).length - byBucket.get(a).length) || (a - b))
            .slice(0, maxTiers)
            .sort((a, b) => a - b);
        droppedTiers = byBucket.size - buckets.length;
    }
    const perTier = Math.max(1, Number(opts.perTier) || DEFAULT_PER_TIER);
    // 每档先选出前 N 条（后面补立绘、组装视图都用这一批，避免重复排序）
    const tops = buckets.map(bucket => sortTeams(byBucket.get(bucket), 'damage').slice(0, perTier));
    // 先补立绘再组装视图（与 rankQuery 同一顺序：memberViews 依赖本地是否已有立绘）
    const avatarIds = avatarIdsOf(tops.flat());
    if (opts.downloadAvatars !== false && getPluginConfig()?.dpsAvatarEnabled !== false && avatarIds.length) {
        await ensureAvatars(avatarIds, opts).catch(() => { });
    }
    const tiers = buckets.map((bucket, idx) => ({
        ...costRangeOf(bucket),
        count: byBucket.get(bucket).length,
        rows: buildRows(tops[idx], 1)
    }));
    const info = cacheInfo();
    /*
     * 副标题里**写明筛选条件**：命中 0 时页面换成文本（见 `modules/respond.ts`），
     * 那时这段就是"为什么是 0"的唯一线索（例如 `视频1` 被当成标签筛掉了全部记录）。
     */
    const filters = filterSummary({ ...q, tag: tags.effective, sort: 'damage' });
    const subtitle = `#${character.name} · 每 ${COST_STEP} 金一档的最高伤害队伍（每档最多 ${perTier} 条）` +
        (filters ? `｜筛选：${filters}` : '') +
        `｜命中 ${filtered.length} 条 / ${byBucket.size} 个金档` +
        // 条件被忽略/无法核实时如实说明（审核 Q5：不能静默放宽，也不能只改过滤不改摘要）
        (tags.notice ? `｜${tags.notice}` : '') +
        (droppedTiers ? `｜金档过多，仅展示记录最多的 ${tiers.length} 档（另有 ${droppedTiers} 档未展示）` : '') +
        '｜数据来自 mhydps.cn 的匿名配队记录（期望 DPS），非官方数值';
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
    };
}
//# sourceMappingURL=charDpsQuery.js.map