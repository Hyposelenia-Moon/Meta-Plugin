/**
 * charDpsQuery — 角色「各金档最高伤害队伍」（v3 P1 新入口 `#xx dps`）
 *
 * 与 `#DPS榜` 的区别（这是 P1 的核心改动）：
 *   - `#DPS榜 胡桃` 给的是"含胡桃的记录"按全局伤害排序（第 1 名往往是别人打的冷门阵容）
 *   - 本模块给的是**同一角色在每个金档各取前几条** —— 实测同金最高分的阵容每档都不同
 *     （4 金 = 玛薇卡C2队、12 金 = 莱欧斯利C6队、48 金 = 玛薇卡C6队），所以"全局同金第一"对用户没意义
 *
 * 数据口径与 `rankQuery` 完全一致（同一份 `/api/teams` 缓存、同一套筛选与视图），
 * 本模块只多做一件事：**按 `cost`（总金数）分组，每组内部按 damage 降序取前 N 条**。
 */
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js';
import { findCharacter, searchCharacters } from '../model/CharacterIndex.js';
import { ensureAvatars } from '../model/AvatarStore.js';
import { getPluginConfig } from '../components/config.js';
import { avatarIdsOf } from './teamView.js';
import { buildRows, filterTeams, sortTeams } from './rankQuery.js';
/** 每个金档默认取前几条（页面高度与可读性的折中） */
export const DEFAULT_PER_TIER = 2;
/** 金档过多时最多保留几档（超出时优先保留记录更多的档，并如实告知丢弃了几档） */
export const DEFAULT_MAX_TIERS = 8;
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
    const filtered = filterTeams(teams, { ...q, character });
    // 按总金数分组（金档升序）
    const byCost = new Map();
    for (const team of filtered) {
        const cost = Number(team.cost) || 0;
        const list = byCost.get(cost);
        if (list)
            list.push(team);
        else
            byCost.set(cost, [team]);
    }
    const maxTiers = Math.max(1, Number(opts.maxTiers) || DEFAULT_MAX_TIERS);
    let costs = [...byCost.keys()].sort((a, b) => a - b);
    let droppedTiers = 0;
    if (costs.length > maxTiers) {
        // 记录更多的档优先；同数量时保留低金档（更贴近多数玩家），最后仍按金档升序展示
        costs = costs
            .slice()
            .sort((a, b) => (byCost.get(b).length - byCost.get(a).length) || (a - b))
            .slice(0, maxTiers)
            .sort((a, b) => a - b);
        droppedTiers = byCost.size - costs.length;
    }
    const perTier = Math.max(1, Number(opts.perTier) || DEFAULT_PER_TIER);
    // 每档先选出前 N 条（后面补立绘、组装视图都用这一批，避免重复排序）
    const tops = costs.map(cost => sortTeams(byCost.get(cost), 'damage').slice(0, perTier));
    // 先补立绘再组装视图（与 rankQuery 同一顺序：memberViews 依赖本地是否已有立绘）
    const avatarIds = avatarIdsOf(tops.flat());
    if (opts.downloadAvatars !== false && getPluginConfig()?.dpsAvatarEnabled !== false && avatarIds.length) {
        await ensureAvatars(avatarIds, opts).catch(() => { });
    }
    const tiers = costs.map((cost, idx) => ({
        cost,
        count: byCost.get(cost).length,
        rows: buildRows(tops[idx], 1)
    }));
    const info = cacheInfo();
    const subtitle = `#${character.name} · 各金档最高伤害队伍（每档最多 ${perTier} 条）｜命中 ${filtered.length} 条 / ${byCost.size} 个金档` +
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
        subtitle
    };
}
//# sourceMappingURL=charDpsQuery.js.map