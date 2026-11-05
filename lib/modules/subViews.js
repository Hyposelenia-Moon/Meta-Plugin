import { listGuidePresets, selectGuidePreset } from './guidePresets.js';
import { attackIcon, characterSplash, iconForRef, talentIcon } from '../model/IconResolver.js';
import { buildCodexPresentation, normalizeMetaValue } from '../components/presentation.js';
import { EMPTY_TEXT, WEAPON_REFINE_HINT, buildV2Sections } from '../model/markup.js';
/** 六个模块的规范标题（= `guide-display.mjs` 的 `DISPLAY_SECTIONS` 标题，也就是分支命令用的词） */
export const SUB_VIEW_TITLES = ['武器', '圣遗物', '天赋', '面板', '命座', '配队'];
/**
 * 组装角色攻略视图
 *
 * @param guide `CodexStore.getGuide(name)` 的原始数据
 * @param opts 专武表与武器标签表（不传也能出图，只是没有专武标色与活动标签）
 * @returns 无数据或原始多预设未选择时返回 null；多预设必须先 selectGuidePreset 投影。
 */
export function buildCodexView(guide, opts = {}) {
    if (!guide)
        return null;
    if (Array.isArray(guide.presets)) {
        const presets = listGuidePresets(guide);
        // 只自动选择唯一预设；多预设返回 null，由命令层提示选择，不合并或猜第一份。
        if (presets.length !== 1)
            return null;
        guide = selectGuidePreset(guide, presets[0]);
    }
    const meta = (guide.meta && typeof guide.meta === 'object')
        ? guide.meta
        : {};
    /*
     * meta 行：占位值（`___%`）不进模板（2026-10-15 审核意见 4.4：图片与文本回退同一份来源），
     * 且"占位值"不算攻略内容 —— `hasContent` 沿用「meta 有非空值」这一条（与维护者流水线的
     * `isFilled` 同口径），否则空档角色会因为一个未填字段被当成"有攻略"。
     */
    const metaRows = Object.entries(meta)
        .map(([label, value]) => ({ label, value: normalizeMetaValue(value) }))
        .filter(row => row.value.length > 0);
    const sections = buildV2Sections(guide, {
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
        portraitSrc: opts.portraitSrc ?? '',
        portraitData: opts.portraitData ?? '',
        cropCfg: opts.cropCfg ?? { tol: 6, cover: 0.98, min: 0.03, colorCap: 0.12, whiteLevel: 240, whiteLineCover: 0.95 },
        genshinFont: opts.genshinFont ?? { family: '', url: '' },
        guideUpdatedAt: opts.guideUpdatedAt ?? '',
        portraitRatio: opts.portraitRatio ?? '',
        portraitBox: opts.portraitBox ?? { width: '', height: '', left: '', top: '' },
        subTitle: opts.subTitle ?? '角色攻略',
        element: opts.element ?? '',
        mx: buildCodexPresentation(view, {
            copyright: opts.copyright ?? '',
            sources: [{
                    source: 'codex',
                    name: '',
                    mode: 'local',
                    modeText: '',
                    updatedAt: opts.guideUpdatedAt ?? '',
                    observedAt: 0
                }]
        })
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
/**
 * 用图鉴正文补全攻略页
 *
 * 攻略数据只有概括时（新角色的空档尤其明显），用 Atlas 图鉴的官方文本补：
 * - 天赋：`A/E/Q` 项补 `atlasName` 与截断后的 `atlasDesc`；
 * - 命座：按 `index` 补 `atlasName` / `atlasDesc`；
 * - 面板：攻略面板不足两行时补一行「基础」（图鉴 1 级白值，页面标注来源）。
 *
 * **只补不覆盖**：已有 `text` 的条目保留原文，只附加图鉴字段；图鉴缺项时原样返回。
 */
export function fillFromAtlas(view, codex) {
    if (!codex)
        return view;
    const clip = (text, max) => text.length > max ? `${text.slice(0, max)}…` : text;
    const talents = new Map(codex.skills.map(skill => [skill.letter, skill]));
    const cons = new Map(codex.constellations.map(item => [item.index, item]));
    let changed = false;
    const sections = view.sections.map(section => {
        if (!Array.isArray(section.rows))
            return section;
        if (section.title === '天赋') {
            const rows = section.rows.map(row => ({
                ...row,
                items: (row.items ?? []).map(item => {
                    const letter = String(item.name ?? '').trim().toUpperCase();
                    const skill = talents.get(letter);
                    if (!skill || (!skill.name && !skill.desc))
                        return item;
                    changed = true;
                    return {
                        ...item,
                        atlasName: skill.name,
                        atlasDesc: clip(skill.desc, 60)
                    };
                })
            }));
            return { ...section, rows };
        }
        if (section.title === '命座') {
            const rows = section.rows.map(row => ({
                ...row,
                items: (row.items ?? []).map(item => {
                    const index = Number(item.index);
                    const hit = Number.isInteger(index) ? cons.get(index) : undefined;
                    if (!hit || (!hit.name && !hit.desc))
                        return item;
                    changed = true;
                    return {
                        ...item,
                        atlasName: hit.name,
                        atlasDesc: clip(hit.desc, 80)
                    };
                })
            }));
            return { ...section, rows };
        }
        if (section.title === '面板' && section.rows.length < 2) {
            const base = codex.base;
            const items = [
                base.hp !== undefined ? `生命 ${Math.round(base.hp)}` : '',
                base.atk !== undefined ? `攻击 ${Math.round(base.atk)}` : '',
                base.def !== undefined ? `防御 ${Math.round(base.def)}` : '',
                base.critRate !== undefined ? `暴击率 ${round1(base.critRate * 100)}%` : '',
                base.critDmg !== undefined ? `暴击伤害 ${round1(base.critDmg * 100)}%` : ''
            ].filter(Boolean);
            if (!items.length)
                return section;
            changed = true;
            return {
                ...section,
                rows: [...section.rows, { label: '基础', items: items.map(text => ({ text })) }]
            };
        }
        return section;
    });
    return changed ? { ...view, sections } : view;
}
/** 一位小数（`91.45` → `91.5`），去掉多余的 `.0` */
function round1(value) {
    return String(Math.round(value * 10) / 10);
}
/**
 * 给视图条目挂图标
 *
 * 图标是**相对 miao resources 的路径**（模板里配 `{{_miao_path}}`）：
 * miao 优先、Atlas 兜底、都没有就不挂（模板回落纯文字，不出现破图）。
 * 命座图标需要角色上下文（`constellation:N` 的 ref 只有序号）。
 */
export function withIcons(view, ctx) {
    const sections = view.sections.map(section => {
        const next = { ...section };
        if (Array.isArray(section.rows)) {
            /** 单个条目的图标解析（原逻辑原样保留） */
            const resolveItem = (item) => {
                const icon = iconForRef(String(item.ref ?? ''), { character: ctx.character });
                if (icon)
                    return { ...item, icon: icon.rel, iconSource: icon.source, iconAbsolute: icon.source === 'atlas' };
                // 天赋三格：攻略数据只给字母（A/E/Q），ref 取不到图标时按**练度页同源规则**再解析一次
                // （`IconResolver.talentIcon()` → `MiaoRes.talentIcon()`：命中 `talentCons` 用命座图标，否则 `icons/talent-{letter}.webp`）
                // 真实数据字段是 `name`（攻略 JSON 的 `v2.talents.order`），模板侧才叫 `text` —— 这里两个都认
                const letter = String(item.name ?? item.text ?? '').trim();
                if (/^[AEQ]$/.test(letter)) {
                    const talent = talentIcon(ctx.character, letter);
                    if (talent)
                        return { ...item, icon: talent.rel, iconSource: talent.source, iconAbsolute: talent.source === 'atlas' };
                    // A（普攻）槽：面板用角色武器类型的**通用武器图标**（`common/item/atk-*.webp`）
                    if (letter === 'A') {
                        const atk = attackIcon(ctx.character);
                        if (atk)
                            return { ...item, icon: atk.rel, iconSource: atk.source, iconAbsolute: atk.source === 'atlas' };
                    }
                }
                return item;
            };
            next.rows = section.rows.map(row => ({
                ...row,
                // 同级并列（数据里把同级的几件写成一个 item，名字用 `\` 连接，渲染显示为 `=`）：
                // 规则要求它们是**独立个体**，各自带图标 → 此处按 `\` 拆成多项，项间分隔符用 `=`。
                items: (row.items ?? []).flatMap(item => {
                    const raw = String(item.name ?? item.text ?? '');
                    const joiner = raw.includes('\\') ? '\\' : (raw.includes('=') ? '=' : '');
                    if (!joiner)
                        return [resolveItem(item)];
                    const parts = raw.split(joiner).map(s => s.trim()).filter(Boolean);
                    const refRaw = String(item.ref ?? '');
                    return parts.map((name, i) => resolveItem({
                        ...item,
                        name,
                        text: name,
                        ref: refRaw ? refRaw.split(':')[0] + ':' + name : '', // 用种类前缀 + 新名字重建（视图里的 ref 可能与文本分隔符不同）
                        sepAfter: i < parts.length - 1 ? '=' : String(item.sepAfter ?? '')
                    }));
                })
            }));
        }
        if (Array.isArray(section.teams)) {
            next.teams = section.teams.map(team => ({
                ...team,
                members: (team.members ?? []).map(member => {
                    const icon = iconForRef(String(member.ref ?? ''), { character: ctx.character });
                    /*
                     * 多选槽（`莫娜 / 沃雅妮莎`）：逐个候选解析图标（2026-10-18 核对修复 #9）。
                     * 首选之外的候选没有 `ref`，按 `character:<名字>` 现拼一个再解析；解析不到就留空，模板画名字。
                     */
                    /*
                     * 2026-10-18：候选槽（`莫娜 / 沃雅妮莎`）必须在**这一层**拆好，
                     * 因为图标解析（iconForRef）就发生在这里；presentation 之后才拆的话 alts 永远没有图标。
                     */
                    const nameRaw = String(member.name ?? '');
                    const splitNames = nameRaw.split(/[／/]/).map(s => s.trim()).filter(Boolean);
                    const altList = member.alts?.length
                        ? member.alts
                        : (splitNames.length ? splitNames : [nameRaw]).map(n => ({ name: n, icon: '' }));
                    const alts = altList.map(alt => {
                        if (!alt || typeof alt !== 'object')
                            return alt;
                        const altIcon = iconForRef(`character:${String(alt.name ?? '')}`, { character: ctx.character });
                        return altIcon ? { ...alt, icon: altIcon.rel, iconSource: altIcon.source, iconAbsolute: altIcon.source === 'atlas' } : alt;
                    });
                    const base = icon ? { ...member, icon: icon.rel, iconSource: icon.source, iconAbsolute: icon.source === 'atlas' } : member;
                    return { ...base, alts };
                })
            }));
        }
        return next;
    });
    return { ...view, sections };
}
/** 页头立绘（相对 miao resources 的路径；取不到返回 null，模板不画立绘） */
export function portraitOf(character) {
    try {
        return characterSplash(character)?.rel ?? null;
    }
    catch {
        return null;
    }
}
/**
 * 视图 → 纯文本（渲染失败时回落，内容与出图同源）
 *
 * 与帮助页同一策略：出图挂了就发文本版，而不是"图挂了就没内容"。
 */
export function viewToText(view) {
    const lines = [`${view.name} · ${view.hints.empty === EMPTY_TEXT ? '攻略' : '攻略'}`];
    for (const row of view.metaRows)
        lines.push(`${row.label}：${row.value}`);
    for (const section of view.sections) {
        lines.push('', `【${section.title}】`);
        if (section.empty) {
            lines.push(view.hints.empty);
            continue;
        }
        if (section.kind === 'teams') {
            for (const team of section.teams ?? []) {
                const members = (team.members ?? []).map(m => `${m.name ?? ''}${m.note ? `（${m.note}）` : ''}`).join(' + ');
                lines.push(`· ${team.tag ? `${team.tag}：` : ''}${members}${team.text ? `${team.text}` : ''}`);
            }
            continue;
        }
        for (const row of section.rows ?? []) {
            const items = (row.items ?? [])
                .map(item => `${item.text ?? ''}${item.note ? `（${item.note}）` : ''}`)
                .join(' ');
            lines.push(`· ${row.label ? `${row.label}：` : ''}${items}`);
        }
        if (section.title === '武器')
            lines.push(view.hints.refine);
    }
    return lines.join('\n');
}
//# sourceMappingURL=subViews.js.map