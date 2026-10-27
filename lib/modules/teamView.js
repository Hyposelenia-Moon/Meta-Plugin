/**
 * teamView — 榜单记录 → 模板视图行（合并自 `Mhydps-Plugin/modules/teamView.js`，行为逐字等价）
 *
 * DPS与危战榜共用的展示口径：成员头像/命座、金数三元组（总/限定/常驻）。
 * 头像只在本地已缓存时才给路径（模板据此决定渲染图片还是文字占位，避免裂图）。
 */
import { findCharacter } from '../model/CharacterIndex.js';
import { hasAvatar } from '../model/AvatarStore.js';
/**
 * 成员列表 → 视图数组
 */
export function memberViews(members) {
    return (members || []).map(m => {
        const record = findCharacter(m.charId);
        const id = record?.character_id ? String(record.character_id) : '';
        const constellation = Number(m.constellation) || 0;
        return {
            name: m.charId,
            constellation,
            cText: constellation > 0 ? `C${constellation}` : '',
            avatar: id && hasAvatar(id) ? id : '',
            rarity: record?.rarity || 4
        };
    });
}
/**
 * 金数三元组视图（站点口径：`cost = limitcost + normalcost`，实测全量成立）
 */
export function costView(team) {
    return {
        cost: team.cost,
        limitcost: team.limitcost,
        normalcost: team.normalcost,
        costText: `${team.cost}金`
    };
}
/**
 * 收集一批记录里出现过的角色立绘 id（用于渲染前批量补图）
 */
export function avatarIdsOf(teams) {
    const ids = new Set();
    for (const team of teams || []) {
        for (const m of team.members || []) {
            const record = findCharacter(m.charId);
            if (record?.character_id)
                ids.add(String(record.character_id));
        }
    }
    return [...ids];
}
/**
 * 标签视图：站点原始标签 + 未审核标记
 *
 * 绿玩 / 满级不在这里拼：模板按 `clean` / `lvl` 字段渲染成带配色的徽章，
 * 拼进来会与模板那份重复（同一行出现两个「满级」）。
 */
export function tagViews(team) {
    const tags = [...(team.tags || [])];
    if (team.confirm === false)
        tags.unshift('未审核');
    return tags;
}
//# sourceMappingURL=teamView.js.map