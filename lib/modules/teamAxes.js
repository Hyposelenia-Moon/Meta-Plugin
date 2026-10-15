/**
 * teamAxes — 队伍伤害的**序号轴**（2026-10-15 用户定）
 *
 * 背景：`#队伍伤害 … 轴:重击×8@21s 词条:暴击率+20` 这种写法对使用者太晦涩。
 * 现在改成**内置序号轴**：轴表写在配置项 `teamDamageAxes` 里，使用者只发 `#队伍伤害2 胡桃 行秋 夜兰 钟离`。
 *
 * 配置写法（`config/config.yaml`，也可在锅巴里填）：
 *   `序号:名称=轴定义`，多个轴用 `,` 或 `；` 分隔
 *   轴定义 = `关键词×次数@窗口s`（多段用 `+`），关键词对 miao 的伤害行标题做**包含匹配**
 *   `默认` / `空` = 保守轴（每位队员取自己伤害最高的 1 行 ×1，窗口 20s）
 *
 * 例：`1:保守轴=默认,2:重击轴=重击×8@20s+元素战技×1,3:爆发轴=元素爆发×1+重击×4@15s`
 *
 * ⚠ 轴 1 永远存在（配置空着时也退化成内置的保守轴），因此 `#队伍伤害 …`（不带序号）= 轴 1。
 * 本模块**纯函数**：不读文件、不联网。
 */
import { defaultAxis, parseAxis } from './rotation.js';
/** 轴 1 的内置名称（配置没写名称时用它） */
export const DEFAULT_AXIS_NO = '1';
export const DEFAULT_AXIS_NAME = '保守轴';
/** 是否"默认/保守轴"的写法 */
function isDefaultText(text) {
    const t = text.trim();
    return !t || t === '默认' || t === '保守' || t === DEFAULT_AXIS_NAME;
}
/** 没有名称时，用轴定义推一个可读名称（如 `重击×8 + 元素战技×1`） */
function nameFromSpec(spec) {
    if (!spec.manual)
        return DEFAULT_AXIS_NAME;
    return spec.segments.map(s => `${s.keyword}×${s.count}`).join(' + ');
}
/**
 * 解析配置里的轴表
 *
 * 永远至少返回轴 1（配置没写就用内置保守轴）。
 */
export function parseAxesConfig(text) {
    const axes = [];
    const seen = new Set();
    for (const chunk of String(text || '').split(/[,，;；\n]+/)) {
        const part = chunk.trim();
        if (!part)
            continue;
        // `序号:名称=轴定义` / `序号=轴定义` / `序号:名称`
        const m = /^(\d{1,2})\s*(?:[:：]\s*([^=]*))?\s*(?:=\s*(.*))?$/.exec(part);
        if (!m)
            continue;
        const no = String(Number(m[1]));
        if (seen.has(no))
            continue;
        seen.add(no);
        const nameRaw = (m[2] || '').trim();
        const defRaw = (m[3] || '').trim();
        const axis = isDefaultText(defRaw) ? defaultAxis() : parseAxis(defRaw);
        axes.push({ no, name: nameRaw || nameFromSpec(axis), axis });
    }
    if (!seen.has(DEFAULT_AXIS_NO)) {
        axes.unshift({ no: DEFAULT_AXIS_NO, name: DEFAULT_AXIS_NAME, axis: defaultAxis() });
    }
    return axes.sort((a, b) => Number(a.no) - Number(b.no));
}
/** 按序号取轴；`序号为空` = 轴 1；序号不存在返回 null（由 app 提示可用序号） */
export function axisByNo(no, text) {
    const want = String(no ?? '').trim() || DEFAULT_AXIS_NO;
    return parseAxesConfig(text).find(a => a.no === want) || null;
}
/** 帮助页/用法提示用的轴清单（只展示序号与名称，不暴露关键词写法） */
export function axesHelpLines(text) {
    return parseAxesConfig(text).map(a => `${a.no} = ${a.name}（${a.axis.window}s）`);
}
//# sourceMappingURL=teamAxes.js.map