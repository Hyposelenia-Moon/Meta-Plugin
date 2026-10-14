/**
 * rotation — 「简化轴」与队伍参考 DPS（v3 P4 / 队伍伤害 v2）
 *
 * 口径（用户 2026-10-13 定：**轴由用户手动设置，未设置走默认轴**）：
 *   - **默认轴**：每位队员取自己伤害行里**数值最高的一行 ×1 次**，窗口 **20 秒**。
 *     这是"保守的单轮口径"，只用于**横向比较**（同队不同配装 / 与榜单同阵容对照），
 *     不等于实战 DPS —— 页面与帮助里都会写明，避免被当成实战数值。
 *   - **手动轴**：`轴:关键词×次数@窗口s`，多段用 `+` 连接，例如
 *     `轴:重击×8@21s+元素战技×2`；关键词对 `row.title` 做包含匹配，命中多行时全部计入。
 *     整体窗口取各段 `@窗口` 的最大值；都没写时用 20s。
 *
 * 本模块**纯函数**：不读文件、不联网、不引 miao，可用合成伤害行完整单测。
 */
/** 默认窗口（秒） */
export const DEFAULT_WINDOW = 20;
/** 解析轴写法：`重击×8@21s+元素战技×2`（也接受 `x` / `*` / `*次数` 等写法） */
export function parseAxis(text) {
    const raw = String(text || '').trim();
    if (!raw)
        return defaultAxis();
    const segments = [];
    for (const part of raw.split(/[+＋,，、]/)) {
        const seg = part.trim();
        if (!seg)
            continue;
        // 关键词 × 次数（可选 @窗口）
        const m = seg.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*(?:@\s*(\d+(?:\.\d+)?)\s*s?)?$/);
        if (!m) {
            // 只给了关键词（可能带 @窗口）→ 记 1 次
            const w = seg.match(/@\s*(\d+(?:\.\d+)?)\s*s?/);
            segments.push({
                raw: seg,
                keyword: seg.replace(/@.*$/, '').trim(),
                count: 1,
                window: w ? Number(w[1]) : 0
            });
            continue;
        }
        segments.push({
            raw: seg,
            keyword: m[1].trim(),
            count: Math.max(1, Number(m[2]) || 1),
            window: m[3] ? Number(m[3]) : 0
        });
    }
    if (!segments.length)
        return defaultAxis();
    const windows = segments.map(s => s.window).filter(w => w > 0);
    const window = windows.length ? Math.max(...windows) : DEFAULT_WINDOW;
    return {
        manual: true,
        segments,
        window,
        label: `手动轴：${segments.map(s => `${s.keyword}×${s.count}`).join(' + ')}／${window}s`,
        notes: []
    };
}
/** 默认轴（每人最高单次伤害 ×1，20s） */
export function defaultAxis(window = DEFAULT_WINDOW) {
    return {
        manual: false,
        segments: [],
        window,
        label: `默认轴：每人最高单次伤害 ×1／${window}s（保守口径，仅供横向比较）`,
        notes: []
    };
}
/** 求和一位队员在轴下的贡献 */
function contribute(member, axis, notes) {
    if (!axis.manual) {
        const best = [...(member.rows || [])].sort((a, b) => b.value - a.value)[0];
        if (!best)
            return { charName: member.charName, damage: 0, hits: [], byDefault: true };
        return {
            charName: member.charName,
            damage: best.value,
            hits: [{ title: best.title, count: 1, value: best.value, subtotal: best.value }],
            byDefault: true
        };
    }
    const hits = [];
    for (const seg of axis.segments) {
        const matched = (member.rows || []).filter(r => r.title.includes(seg.keyword));
        if (!matched.length)
            continue;
        for (const row of matched) {
            hits.push({ title: row.title, count: seg.count, value: row.value, subtotal: row.value * seg.count });
        }
    }
    const damage = hits.reduce((s, h) => s + h.subtotal, 0);
    if (!hits.length)
        notes.push(`${member.charName}：手动轴的关键词一个都没匹配到，该队员按 0 计`);
    return { charName: member.charName, damage, hits, byDefault: false };
}
/**
 * 计算队伍参考 DPS
 *
 * @param members 队员与其伤害行（来自 miao 薄桥）
 * @param axis    轴（`parseAxis` 或 `defaultAxis` 的产物）
 */
export function teamDps(members, axis = defaultAxis()) {
    const notes = [...axis.notes];
    const window = axis.window > 0 ? axis.window : DEFAULT_WINDOW;
    const contributions = (members || []).map(m => contribute(m, axis, notes));
    const total = contributions.reduce((s, c) => s + c.damage, 0);
    if (!axis.manual)
        notes.push('当前是默认轴（每人最高单次 ×1），只适合横向比较；要更贴近实战请手动指定轴');
    if (contributions.some(c => !c.hits.length))
        notes.push('有队员没有可用伤害行，其贡献为 0');
    return {
        dps: window > 0 ? total / window : 0,
        total,
        window,
        axis: { ...axis, window },
        members: contributions,
        notes: [...new Set(notes)]
    };
}
//# sourceMappingURL=rotation.js.map