/**
 * 命令参数解析与视图收窄
 *
 * 覆盖三种入口形态（设计文档 §5.4）：
 *   1. 后缀式：`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`
 *   2. 前缀式：`#攻略 <角色> [模块|档位]`
 *   3. 反查式：`#攻略 武器 <武器名>` / `#攻略 配队 <角色…>`（v1 只做这两个，§13.1 B11）
 *
 * 歧义怎么定：`武器`/`圣遗物`/`配队` 既是**模块名**又是**反查头部**，所以先拿头词去解析角色——
 * 能解析成角色（`#攻略 胡桃 武器`）就是"角色 + 模块"；解析不了（`#攻略 武器 护摩之杖`）才当反查。
 */
import { CODEX_ARG_RULE, CODEX_SUFFIX_RULE, TIER_WORDS } from '../components/constants.js';
import { SUB_VIEW_TITLES } from './subViews.js';
/** 反查头部关键词（v1 只实现这两个） */
export const REVERSE_HEADS = ['武器', '配队'];
/**
 * 解析后缀式
 *
 * `#胡桃攻略` / `#胡桃攻略2` / `#更新胡桃攻略` / `#胡桃指南` / `#更新胡桃指南`
 * @returns 解析不出（或只有「攻略」二字）时返回 null
 */
export function parseSuffixQuery(msg) {
    const text = String(msg ?? '').trim();
    if (!text.startsWith('#'))
        return null;
    const hit = text.match(CODEX_SUFFIX_RULE);
    if (!hit)
        return null;
    const name = hit[2].trim();
    if (!name)
        return null;
    const setIndex = hit[3] ? Number(hit[3]) : null;
    const panelIndex = hit[5] ? Number(hit[5]) : null;
    const preset = hit[4] ? hit[4].trim() : '';
    return { character: name, setIndex, panelIndex, ...(preset ? { preset } : {}) };
}
/**
 * 解析前缀式 `#攻略 …`
 *
 * @param msg 原始消息
 * @param resolve 角色名解析器（通常传 `resolveCharacter(store, …)`）
 */
export function parseArgQuery(msg, resolve) {
    const hit = String(msg ?? '').trim().match(CODEX_ARG_RULE);
    const tokens = (hit?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
    const head = tokens[0] ?? '';
    const rest = tokens.slice(1);
    if (head === '列表')
        return { kind: 'list', head, rest };
    if (head === '状态')
        return { kind: 'status', head, rest };
    const asCharacter = resolve(head);
    if (asCharacter) {
        const query = { kind: 'character', head, rest, character: asCharacter };
        for (const token of rest) {
            if (!query.module && SUB_VIEW_TITLES.includes(token)) {
                query.module = token;
            }
            else if (!query.tier && TIER_WORDS.includes(token)) {
                query.tier = token;
            }
        }
        return query;
    }
    if (head === '武器') {
        return { kind: 'reverseWeapon', head, rest, weapon: rest.join('').trim() };
    }
    if (head === '配队') {
        const members = [];
        const unresolved = [];
        for (const token of rest) {
            const name = resolve(token);
            if (name)
                members.push(name);
            else {
                members.push(token);
                unresolved.push(token);
            }
        }
        return { kind: 'reverseTeam', head, rest, members, unresolved };
    }
    return { kind: 'unknown', head, rest };
}
/** 视图收窄：按模块与档位过滤（`#攻略 胡桃 武器` / `#攻略 胡桃 过渡`） */
export function filterView(view, opts) {
    let sections = view.sections;
    if (opts.module)
        sections = sections.filter(section => section.title === opts.module);
    if (opts.tier) {
        const tier = opts.tier;
        sections = sections
            .map(section => {
            // 配队的档位挂在队伍标签（tag）上，与行的 label 对称处理
            if (section.kind === 'teams') {
                const teams = (section.teams ?? []).filter(team => String(team.tag ?? '').trim() === tier);
                return { ...section, teams, empty: teams.length === 0 };
            }
            const rows = (section.rows ?? []).filter(row => String(row.label ?? '').trim() === tier);
            return { ...section, rows, empty: rows.length === 0 };
        })
            .filter(section => (section.kind === 'teams')
            ? (section.teams?.length ?? 0) > 0
            : (section.rows?.length ?? 0) > 0);
    }
    return { ...view, sections };
}
/** 收窄后是否已无内容（调用方据此回「该档位暂无」而不是出空图） */
export function isViewEmpty(view) {
    return view.sections.length === 0 ||
        view.sections.every(section => (section.kind === 'teams')
            ? !(section.teams ?? []).some(team => (team.members ?? []).length || team.text)
            : (section.rows ?? []).every(row => !(row.items ?? []).some(item => String(item.text ?? '').trim())));
}
//# sourceMappingURL=branches.js.map