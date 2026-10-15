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
import { cacheInfo, ensureFresh, getSnapshot } from '../model/TeamStore.js';
import { findCharacter, memberIs, searchCharacters } from '../model/CharacterIndex.js';
import { ensureAvatars } from '../model/AvatarStore.js';
import { getPageSize, getPluginConfig } from '../components/config.js';
import { MAX_PAGE_SIZE, damageText } from '../components/constants.js';
import { avatarIdsOf, memberViews, tagViews } from './teamView.js';
/** 排序口径：damage = 期望 DPS 降序（默认），costAsc/costDesc = 按总金数 */
export const RANK_SORTS = {
    damage: (a, b) => b.damage - a.damage || a.cost - b.cost,
    costAsc: (a, b) => a.cost - b.cost || b.damage - a.damage,
    costDesc: (a, b) => b.cost - a.cost || b.damage - a.damage
};
/** 数据集里真实出现过的标签词（子串匹配）；**字典不可用时返回空数组**（不可核实 ≠ 全部可用） */
export function knownTagTokens(teams, tag) {
    const tokens = String(tag || '').split(/\s+/).filter(Boolean);
    if (!tokens.length)
        return [];
    const all = (teams || []).flatMap(t => (t.tags || []).map(x => String(x).toLowerCase()));
    if (!all.length)
        return [];
    return tokens.filter(t => all.some(o => o.includes(t.toLowerCase())));
}
/**
 * 解析标签条件（严进口径）
 *
 * 背景（2026-10-15 用户与审核双方面）：引用 / 粘贴机器人上一条回复时，那段文字会跟着进 `e.msg`，
 * 多出来的词被当成标签 → 命中 0、回复看着与命令无关。
 *
 * 口径：
 *  - **显式** `标签:X`：原样使用。**不放宽** —— 显式写了数据集没有的标签，就按原条件给 0 命中，
 *    并明确提示"数据里没有标签 X"（审核 2.4：旧实现会把 `总伤杯S3 不存在的标签` 悄悄缩成
 *    `总伤杯S3`，错误命中 1 条）；
 *  - **裸词**：字典可用时只留真实存在的词；字典**不可用**时一律不参与筛选（不可核实），
 *    两种情况都在 `notice` 里说明；
 *  - 显式与裸词来自不同字段（`queryArgs` 已把 `tag` / `tagBare` 分开）。
 */
export function resolveTags(teams, q = {}) {
    // 兼容旧调用：没写 `tagExplicit` 时，`tag` 里的词视为裸词（历史语义）
    const explicitRaw = q.tagExplicit === true ? String(q.tag || '').trim() : '';
    const bareRaw = [q.tagExplicit === true ? '' : String(q.tag || ''), String(q.tagBare || '')]
        .filter(Boolean).join(' ').trim();
    const all = (teams || []).flatMap(t => (t.tags || []).map(x => String(x).toLowerCase()));
    const dictionary = all.length > 0;
    const isKnown = (t) => all.some(o => o.includes(t.toLowerCase()));
    const explicitTokens = explicitRaw.split(/\s+/).filter(Boolean);
    const bareTokens = bareRaw.split(/\s+/).filter(Boolean);
    const knownBare = dictionary ? bareTokens.filter(isKnown) : [];
    const unknownExplicit = dictionary ? explicitTokens.filter(t => !isKnown(t)) : [];
    const ignoredBare = bareTokens.filter(t => !knownBare.includes(t));
    const effective = [explicitRaw, knownBare.join(' ')].filter(Boolean).join(' ');
    const notes = [];
    if (!dictionary)
        notes.push('该数据集没有标签信息，标签无法核实');
    if (unknownExplicit.length)
        notes.push(`数据里没有标签「${unknownExplicit.join('、')}」，已按原条件筛选`);
    if (ignoredBare.length)
        notes.push(`已忽略无法核实的词：${ignoredBare.join('、')}`);
    return {
        dictionary,
        explicit: explicitRaw,
        bare: knownBare.join(' '),
        unknownExplicit,
        ignoredBare,
        effective,
        notice: notes.join('；')
    };
}
/**
 * 按条件筛选配队
 */
export function filterTeams(teams, q = {}) {
    const tags = resolveTags(teams, q).effective.split(/\s+/).filter(Boolean).map(s => s.toLowerCase());
    return (teams || []).filter(team => {
        if (q.character) {
            const members = q.mainOnly ? (team.members || []).slice(0, 1) : (team.members || []);
            if (!members.some(m => memberIs(m.charId, q.character)))
                return false;
        }
        if (q.cleanOnly && !team.clean)
            return false;
        if (Number.isFinite(q.costMin) && team.cost < q.costMin)
            return false;
        if (Number.isFinite(q.costMax) && team.cost > q.costMax)
            return false;
        if (tags.length) {
            const own = (team.tags || []).map(t => t.toLowerCase());
            if (!tags.every(t => own.some(o => o.includes(t))))
                return false;
        }
        return true;
    });
}
/** 排序（不改原数组） */
export function sortTeams(teams, sort = 'damage') {
    const cmp = RANK_SORTS[sort] || RANK_SORTS.damage;
    return [...(teams || [])].sort(cmp);
}
/** 组装单行的视图数据（名次从 `startRank` 连续编号） */
export function buildRows(teams, startRank = 1) {
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
    }));
}
/**
 * 筛选条件摘要（不含角色与排序）
 *
 * 用在「0 命中」的文本提示与角色档位页副标题上：让用户一眼看出是**哪个筛选**把结果筛没了
 * （2026-10-15 用户反馈：`#dps 七七 48金 视频1` 在新写法生效前，`视频1` 被当成"标签"筛选 →
 * 命中 0 → 页面就是一张"没有查询到…"的空图，看不出原因）。
 */
export function filterSummary(q) {
    const parts = [];
    if (Number.isFinite(q.costMin) && Number.isFinite(q.costMax))
        parts.push(`${q.costMin}~${q.costMax}金`);
    else if (Number.isFinite(q.costMax))
        parts.push(`≤${q.costMax}金`);
    else if (Number.isFinite(q.costMin))
        parts.push(`≥${q.costMin}金`);
    if (q.tag)
        parts.push(`标签「${q.tag}」`);
    if (q.cleanOnly)
        parts.push('仅绿玩');
    return parts.join(' · ');
}
/** 查询摘要（页脚与副标题用） */
function describe(q, character) {
    const parts = [];
    if (character)
        parts.push(`${character.name}${q.mainOnly ? '（主C）' : ''}`);
    // 逐段顺序与拆分前一致，输出字符串不变（`test/mhydps-parity` 的快照会逐字比对）
    const filters = filterSummary(q);
    if (filters)
        parts.push(filters);
    if (q.sort === 'costAsc')
        parts.push('按金数升序');
    else if (q.sort === 'costDesc')
        parts.push('按金数降序');
    else
        parts.push('按期望DPS降序');
    return parts.join(' · ');
}
/**
 * 查询 DPS 榜
 *
 * @returns 成功 `{ ok: true, total, page, totalPages, rows, … }`；
 *          角色没找到 `{ ok: false, error, suggestions }`
 */
export async function queryRank(q = {}, opts = {}) {
    const character = q.char ? findCharacter(q.char) : null;
    if (q.char && !character) {
        return {
            ok: false,
            error: `没有找到角色「${q.char}」`,
            suggestions: searchCharacters(q.char, 6).map(c => c.name)
        };
    }
    const fresh = await ensureFresh(opts);
    const { teams } = getSnapshot();
    // 标签先解析（显式原样、裸词核实；筛选与摘要都用同一份 effective）
    const tags = resolveTags(teams, q);
    const query = { ...q, tag: tags.effective };
    const filtered = filterTeams(teams, { ...query, character });
    const sorted = sortTeams(filtered, opts.sort || q.sort || 'damage');
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(opts.pageSize || getPageSize())));
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Number(q.page) || 1), totalPages);
    const start = (page - 1) * pageSize;
    const slice = sorted.slice(start, start + pageSize);
    // 先补立绘再组装视图：memberViews 依赖本地是否已有立绘决定 avatar 字段；补图失败不阻断查询
    const avatarIds = avatarIdsOf(slice);
    if (opts.downloadAvatars !== false && getPluginConfig()?.dpsAvatarEnabled !== false && avatarIds.length) {
        await ensureAvatars(avatarIds, opts).catch(() => { });
    }
    const info = cacheInfo();
    return {
        ok: true,
        total,
        page,
        totalPages,
        pageSize,
        rows: buildRows(slice, start + 1),
        avatarIds,
        subtitle: describe({ ...q, sort: opts.sort || q.sort || 'damage' }, character),
        tags,
        stale: info.stale,
        fetchedAt: info.fetchedAt,
        refreshed: fresh.refreshed,
        refreshError: fresh.ok ? '' : String(fresh.error || ''),
        scope: { teams: teams.length }
    };
}
/**
 * 按名次取单条记录（视频查询用）
 *
 * 名次与榜单图里的编号同口径：在当前筛选与排序下从 1 开始的全局序号（跨页连续）。
 */
export async function findRankEntry(q = {}, rankNo, opts = {}) {
    const rank = Number(rankNo);
    if (!Number.isFinite(rank) || rank < 1 || !Number.isInteger(rank)) {
        return { ok: false, error: '名次需要是正整数，例如 #DPS榜 胡桃 48金视频1' };
    }
    const character = q.char ? findCharacter(q.char) : null;
    if (q.char && !character) {
        return {
            ok: false,
            error: `没有找到角色「${q.char}」`,
            suggestions: searchCharacters(q.char, 6).map(c => c.name)
        };
    }
    const fresh = await ensureFresh(opts);
    const { teams } = getSnapshot();
    const tags = resolveTags(teams, q);
    const query = { ...q, tag: tags.effective };
    const sorted = sortTeams(filterTeams(teams, { ...query, character }), opts.sort || q.sort || 'damage');
    const total = sorted.length;
    if (!total)
        return { ok: false, error: '当前筛选条件下没有任何记录' };
    if (rank > total)
        return { ok: false, error: `名次超出范围：当前条件下共 ${total} 条` };
    const info = cacheInfo();
    return {
        ok: true,
        row: buildRows([sorted[rank - 1]], rank)[0],
        total,
        rank,
        subtitle: describe({ ...query, sort: opts.sort || q.sort || 'damage' }, character),
        tags,
        stale: info.stale,
        fetchedAt: info.fetchedAt,
        refreshed: fresh.refreshed
    };
}
//# sourceMappingURL=rankQuery.js.map