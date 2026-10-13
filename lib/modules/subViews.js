import { EMPTY_TEXT, WEAPON_REFINE_HINT, normalizeGuideSections, v2ToSections } from '../model/markup.js';
/** 六个模块的规范标题（= `guide-display.mjs` 的 `DISPLAY_SECTIONS` 标题，也就是分支命令用的词） */
export const SUB_VIEW_TITLES = ['武器', '圣遗物', '天赋', '面板', '命座', '配队'];
/**
 * 组装角色攻略视图
 *
 * @param guide `CodexStore.getGuide(name)` 的原始数据
 * @param opts 专武表与武器标签表（不传也能出图，只是没有专武标色与活动标签）
 * @returns 无该角色数据时返回 null
 */
export function buildCodexView(guide, opts = {}) {
    if (!guide)
        return null;
    const meta = (guide.meta && typeof guide.meta === 'object')
        ? guide.meta
        : {};
    const metaRows = Object.entries(meta)
        .map(([label, value]) => ({ label, value: String(value ?? '').trim() }))
        .filter(row => row.value.length > 0);
    const sections = normalizeGuideSections(v2ToSections(guide.v2 ?? {}), {
        signature: opts.signature ?? null,
        weaponTags: opts.weaponTags ?? {}
    });
    return {
        name: String(guide.name ?? ''),
        meta,
        metaRows,
        sections,
        hasContent: metaRows.length > 0,
        hints: { empty: EMPTY_TEXT, refine: WEAPON_REFINE_HINT }
    };
}
/** 视图 → 模板数据（模板只读这里给出的字段） */
export function toPageData(view, opts = {}) {
    return {
        ...view,
        copyright: opts.copyright ?? '',
        renderScale: opts.renderScale ?? 1,
        portrait: opts.portrait ?? '',
        subTitle: opts.subTitle ?? '角色攻略'
    };
}
/** 是否为合法的分支词（武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队） */
export function isSubViewTitle(key) {
    return SUB_VIEW_TITLES.includes(String(key ?? '').trim());
}
/** 取某个模块；词非法或不存在返回 null */
export function pickSection(view, key) {
    const title = String(key ?? '').trim();
    if (!isSubViewTitle(title))
        return null;
    return view.sections.find(section => section.title === title) ?? null;
}
/** 收窄成单模块视图（`#攻略 <角色> 武器` 用）；词非法返回 null */
export function narrowToSubView(view, key) {
    const section = pickSection(view, key);
    if (!section)
        return null;
    return { ...view, sections: [section] };
}
//# sourceMappingURL=subViews.js.map