import { displayLabel } from '../model/markup.js';
/** 取出 v2 里某段的行数组（失败返回空数组） */
function rowsOf(guide, key) {
    const rows = guide?.v2?.[key];
    return Array.isArray(rows) ? rows : [];
}
/** 条目的名字（v2 里是对象 `{name}`，兼容纯字符串写法） */
function itemName(item) {
    if (item === null || item === undefined)
        return '';
    if (typeof item === 'object')
        return String(item.name ?? '').trim();
    return String(item).trim();
}
/**
 * 查「谁推荐了这把武器」
 *
 * @param store 数据仓库
 * @param weapon 武器名（精确匹配；调用方若要用别名请先解析）
 * @returns 命中的角色列表（保持 `_order.json` 顺序）
 */
export function findWeaponRecommenders(store, weapon) {
    const target = String(weapon ?? '').trim();
    if (!target)
        return [];
    const out = [];
    for (const character of store.listCharacters()) {
        const guide = store.getGuide(character);
        if (!guide)
            continue;
        const rows = rowsOf(guide, 'weapons');
        for (const [rowIndex, row] of rows.entries()) {
            const items = Array.isArray(row.items) ? row.items : [];
            const hit = items.some(item => itemName(item) === target);
            if (!hit)
                continue;
            out.push({
                character,
                tier: displayLabel(row.label ?? '', row.tier) || String(row.label ?? ''),
                rowIndex
            });
        }
    }
    return out;
}
/**
 * 查「哪些角色的配队同时包含这些成员」
 *
 * @param members 成员名（需已解析为标准名；空数组返回空结果）
 * @returns 命中的角色与队伍
 */
export function findTeamContainers(store, members) {
    const wanted = (members ?? []).map(m => String(m ?? '').trim()).filter(Boolean);
    if (!wanted.length)
        return [];
    const out = [];
    for (const character of store.listCharacters()) {
        const guide = store.getGuide(character);
        if (!guide)
            continue;
        for (const row of rowsOf(guide, 'teams')) {
            const list = Array.isArray(row.members) ? row.members : [];
            const names = list.map(itemName).filter(Boolean);
            if (!names.length)
                continue;
            if (!wanted.every(w => names.includes(w)))
                continue;
            out.push({
                character,
                tag: displayLabel(row.label ?? '') || String(row.label ?? '').trim(),
                members: names
            });
        }
    }
    return out;
}
//# sourceMappingURL=reverse.js.map