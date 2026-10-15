/**
 * raidTiersQuery — 危战榜的 n6 / n7 两档（v3 P1 新入口 `#危战`）
 *
 * 口径（用户 2026-10-13 定 / 2026-10-15 改排序，写进页面脚注，避免用户误解）：
 *   - **n7 档**：65s 内通关（允许 1~5s 浮动 → 取 **≤70s**）
 *   - **n6 档**：其余记录（>70s）
 *   - **两档都按耗时降序**（用户 2026-10-15 定）：n7 内越接近 70s 越靠前，n6 内越接近站点上限
 *     **120s** 越靠前 —— 两端都是"越贴着档位边界越靠前"，口径一致。
 *
 * 为什么这样切而不是写死"110~120s"：站点记录里**没有难度字段**，只能由耗时推断；
 * 用 70s 一刀切能覆盖全部记录（不丢数据），并把"刚过 n6"的一端排在最前。
 *
 * 数据口径与 `raidQuery` 完全一致（同一份 `/api/teams2` 缓存、同一套筛选与视图）。
 */
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js';
import { bossById, bossesOfVer, findBoss, findCharacter, searchCharacters, versions } from '../model/CharacterIndex.js';
import { resolveBossName } from './bossAlias.js';
import { ensureAvatars } from '../model/AvatarStore.js';
import { getPluginConfig } from '../components/config.js';
import { avatarIdsOf } from './teamView.js';
import { buildRows as buildRaidRows, filterRaids, sortRaids } from './raidQuery.js';
/** n7 判定的耗时上限（秒）：65s + 最多 5s 浮动 */
export const N7_SECONDS_LIMIT = 70;
/** 站点收录的耗时上限（秒），仅用于页面文案与排序说明 */
export const RAID_SPEED_CAP = 120;
/** 每档默认取前几条（用户 2026-10-15 定：单档最多列 **10** 条） */
export const DEFAULT_TIER_ROWS = 10;
/**
 * 查询危战记录并按 n6 / n7 分档
 *
 * 筛选语义与 `#危战` 完全一致（版本 / 首领 / 角色 / 金数），只是展示方式改为两档。
 */
export async function queryRaidTiers(q = {}, opts = {}) {
    const character = q.char ? findCharacter(q.char) : null;
    if (q.char && !character) {
        return {
            ok: false,
            error: `没有找到角色「${q.char}」`,
            suggestions: searchCharacters(q.char, 6).map(c => c.name)
        };
    }
    const bossRecord = q.boss ? findBoss(resolveBossName(q.boss)) : null;
    if (q.boss && !bossRecord) {
        return {
            ok: false,
            error: `没有找到首领「${q.boss}」`,
            suggestions: versions().slice(0, 3).flatMap(v => bossesOfVer(v).map(b => b.name)).slice(0, 6)
        };
    }
    if (q.ver && !versions().includes(q.ver)) {
        return {
            ok: false,
            error: `没有版本「${q.ver}」的危战记录`,
            suggestions: versions().slice(0, 6)
        };
    }
    const fresh = await ensureFresh(opts);
    const { teams2 } = getSnapshot();
    // 档位不是筛选条件（它是展示口径），所以传筛选前先摘掉，避免漏进 filterRaids
    const { tier: _tier, ...filters } = q;
    const filtered = filterRaids(teams2, { ...filters, character, bossRecord });
    const n7 = filtered.filter(t => Number(t.speed) <= N7_SECONDS_LIMIT);
    const n6 = filtered.filter(t => Number(t.speed) > N7_SECONDS_LIMIT);
    // 两档都按耗时**降序**（2026-10-15 用户定：n7 也改为时间越长越靠前）；同耗时按金数升序
    n7.sort((a, b) => b.speed - a.speed || a.cost - b.cost);
    n6.sort((a, b) => b.speed - a.speed || a.cost - b.cost);
    /*
     * 全榜名次（同一批筛选下、按站点口径「金数升序 → 同金比耗时」的名次）
     *
     * 用户 2026-10-15 定：`#危战视频 N` 仍按这个全榜口径取名次；档页按耗时降序，所以每行额外标
     * 「全榜 #N」，让用户看到就能直接发 `#危战视频 N`（否则两个序号对不上，等于没有入口）。
     */
    const rankOf = new Map();
    sortRaids(filtered, 'costAsc').forEach((t, i) => rankOf.set(t, i + 1));
    const rowsWithRank = (list) => buildRaidRows(list, 1).map((row, i) => ({ ...row, overallRank: rankOf.get(list[i]) || 0 }));
    const perTier = Math.max(1, Number(opts.perTier) || DEFAULT_TIER_ROWS);
    const pick = (list) => list.slice(0, perTier);
    const tops = [pick(n7), pick(n6)];
    // 先补立绘再组装视图（与 raidQuery 同一顺序）
    const avatarIds = avatarIdsOf(tops.flat());
    if (opts.downloadAvatars !== false && getPluginConfig()?.dpsAvatarEnabled !== false && avatarIds.length) {
        await ensureAvatars(avatarIds, opts).catch(() => { });
    }
    const tiers = [
        {
            key: 'n7',
            label: `n7 档（≤ ${N7_SECONDS_LIMIT}s）`,
            note: '65s 内通关，允许 1~5s 浮动；按耗时降序（越接近 70s 越靠前）',
            count: n7.length,
            rows: rowsWithRank(tops[0])
        },
        {
            key: 'n6',
            label: `n6 档（> ${N7_SECONDS_LIMIT}s）`,
            note: `其余记录；按耗时降序，越接近站点上限 ${RAID_SPEED_CAP}s 越靠前（险胜通过 n6 的水平）`,
            count: n6.length,
            rows: rowsWithRank(tops[1])
        }
    ];
    const info = cacheInfo();
    const scope = [q.ver ? `版本 ${q.ver}` : '', bossRecord ? `首领 ${bossRecord.name}` : '', character ? `含 ${character.name}` : '']
        .filter(Boolean)
        .join(' · ');
    /*
     * 档位剥离（用户 2026-10-15 定）：`#危战 … n6` / `n7` 每次只出一档 ——
     * 两档并列时排序口径相反（n7 越快越前、n6 越接近上限越前），同页并列容易看错。
     */
    const wantTier = opts.tier === 'n6' || opts.tier === 'n7' ? opts.tier : null;
    const shown = wantTier ? tiers.filter(t => t.key === wantTier) : tiers;
    const tierText = wantTier
        ? `${wantTier} 档（${wantTier === 'n7' ? `≤ ${N7_SECONDS_LIMIT}s 速通档` : `> ${N7_SECONDS_LIMIT}s 险胜档`}）`
        : 'n6 / n7 两档';
    const subtitle = `幽境危战 · ${tierText}${scope ? `｜${scope}` : ''}｜命中 ${filtered.length} 条` +
        `（n7 ${n7.length} / n6 ${n6.length}）｜每档最多 ${perTier} 条`;
    return {
        ok: true,
        tier: wantTier,
        tiers: shown,
        counts: { n7: n7.length, n6: n6.length },
        total: filtered.length,
        fetchedAt: info.fetchedAt,
        stale: info.stale,
        refreshed: fresh.refreshed,
        subtitle
    };
}
/** 首领名（模板兜底用） */
export function bossNameOf(id) {
    return bossById(id)?.name || (id ? `首领#${id}` : '-');
}
//# sourceMappingURL=raidTiersQuery.js.map