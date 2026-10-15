/**
 * quoteGuard — 引用内容隔离（2026-10-15 审核意见后重写）
 *
 * ## 为什么重写
 *
 * 旧实现把"与引用原文有包含关系的 token"一律丢掉 —— 这是**用词重合推断来源**，不成立：
 * 文字相同不能证明它来自引用。审核实测（真实编译产物）：
 *
 * | 新正文 | 引用里含有 | 旧实现结果 | 后果 |
 * |---|---|---|---|
 * | `刻晴 48金` | `刻晴(C6)`、`48金` | 空串 | 角色与金数全丢，变成总榜查询 |
 * | `七七 视频1` | 正常回复里的独立数字 `1` | `七七` | 视频请求被降级成角色档位请求 |
 *
 * ## 现在的口径（严格、可证明）
 *
 * 只做**整段精确剔除**：引用消息的原文（或其空白归一形式）**整段出现**在参数里，才把这一段切掉；
 * 不做任何 token 级推断。拿不到引用原文、或原文没有整段出现 → **原样返回**（宁可多留，绝不误删）。
 *
 * 粘贴进来的内容（没有 `reply_id` 等来源元数据）这里**不做任何处理**：
 * 它由参数解析层照常解析，并在命中 0 时由回复里的诊断说明解释 —— 不假装识别成了引用。
 */
/** 引用消息对象的纯文本（兼容 `message` 段数组与 `raw_message` 字符串两种形态） */
export function quotedText(quoted) {
    const msg = quoted;
    if (!msg)
        return '';
    const segs = msg.message;
    if (Array.isArray(segs)) {
        return segs
            .filter(s => s?.type === 'text')
            .map(s => String(s?.text ?? ''))
            .join('');
    }
    return typeof msg.raw_message === 'string' ? msg.raw_message : '';
}
/** 当前消息**自身**的文本段（拿不到段信息时返回空串；用于核对参数来源） */
export function ownTextOf(e) {
    const segs = e?.message;
    if (!Array.isArray(segs))
        return '';
    return segs
        .filter(s => s?.type === 'text')
        .map(s => String(s?.text ?? ''))
        .join('');
}
const squeeze = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/**
 * 把引用原文**整段**从参数文本里剔除
 *
 * 只读 `e.reply_id` / `e.getReply()`；任何异常（取不到引用等）都原样返回。
 * @returns 处理后的参数文本（未发生整段匹配时与入参相同）
 */
export async function stripQuotedArgs(e, text) {
    const raw = String(text || '');
    const ev = e;
    if (!raw || !ev?.reply_id || typeof ev.getReply !== 'function')
        return raw;
    try {
        const quoted = quotedText(await ev.getReply());
        if (!quoted)
            return raw;
        // 候选形态：原文、空白归一后的原文（适配器可能改写换行）
        const variants = [...new Set([quoted, squeeze(quoted)])].filter(v => v.length >= 4);
        let out = raw;
        let hit = false;
        for (const v of variants) {
            if (out.includes(v)) {
                out = out.split(v).join(' ');
                hit = true;
            }
        }
        // 没整段命中 → 不做任何改动（旧的 token 级剔除会在这里误删用户正文）
        return hit ? squeeze(out) : raw;
    }
    catch {
        return raw;
    }
}
//# sourceMappingURL=quoteGuard.js.map