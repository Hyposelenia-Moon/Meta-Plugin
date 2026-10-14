/**
 * statPatch — 「可调节词条」（v3 P4 / 队伍伤害 v2）
 *
 * 用途：临时改几个面板属性（不动用户的 miao 面板），看伤害会变成多少。
 * 写法：`词条:暴击率+20,暴击伤害+40,生命值-2000`（也接受 `=` 与中文逗号；键名与攻略面板同口径）。
 *
 * 单位口径（与 miao 的 `attr` 一致）：暴击率/暴击伤害/充能效率等是**百分点**（`+20` = +20 个百分点）；
 * 生命值/攻击力/防御力/元素精通是**数值**（`+2000` = +2000）。`-` 表示下调。
 *
 * 本模块**纯函数**，可用合成属性表完整单测。
 */
/** 面板属性名 → 玩家侧属性键（与 `modules/grade.ts` 同一张表；元素伤害统一取 `dmg`） */
export const PANEL_ATTR_KEY = {
    生命值: 'hp',
    攻击力: 'atk',
    防御力: 'def',
    元素精通: 'mastery',
    元素充能效率: 'recharge',
    暴击率: 'cpct',
    暴击伤害: 'cdmg',
    治疗加成: 'heal',
    物理伤害加成: 'phy',
    元素伤害加成: 'dmg'
};
const ELEM_DMG_RE = /^(火|水|雷|草|风|岩|冰)元素伤害加成$/;
/**
 * 解析词条写法
 *
 * 支持：`暴击率+20` / `暴击伤害-15.5` / `攻击力=100`；分隔符 `,` `，` `、` `;` 空格
 */
export function parseStatPatch(text) {
    const items = [];
    const invalid = [];
    for (const part of String(text || '').split(/[,，、;；\s]+/)) {
        const seg = part.trim();
        if (!seg)
            continue;
        const m = seg.match(/^(.+?)\s*([+\-=])\s*(\d+(?:\.\d+)?)$/);
        if (!m) {
            invalid.push(seg);
            continue;
        }
        const name = m[1].trim();
        const attrKey = PANEL_ATTR_KEY[name] || (ELEM_DMG_RE.test(name) ? 'dmg' : '');
        if (!attrKey) {
            invalid.push(seg);
            continue;
        }
        const value = Number(m[3]);
        items.push({ raw: seg, name, attrKey, delta: m[2] === '-' ? -value : value });
    }
    return { items, invalid };
}
/** 把词条应用到属性表（不改原对象） */
export function applyStatPatch(attrs, patch) {
    const out = { ...(attrs || {}) };
    for (const item of patch.items) {
        const base = Number(out[item.attrKey]) || 0;
        const next = base + item.delta;
        // 属性不会为负：下限截到 0（例如"生命值-99999"）
        out[item.attrKey] = next < 0 ? 0 : next;
    }
    return out;
}
/** 展示用说明 */
export function patchLabel(patch) {
    if (!patch.items.length)
        return '';
    return patch.items.map(i => `${i.name}${i.delta >= 0 ? '+' : ''}${i.delta}`).join('，');
}
//# sourceMappingURL=statPatch.js.map