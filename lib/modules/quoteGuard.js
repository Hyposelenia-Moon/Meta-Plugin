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
        /*
         * 2026-10-18 复审 R3：只有**长到像一条消息**（≥12 字）的引用原文才允许整段剔除。
         * 短文本（`胡桃12金` 这种 6 字参数）与用户重打/追加的筛选词无法区分，
         * 按包含关系删掉就会把角色与金数一起吃掉（`胡桃 12金 绿玩` → 只剩 `绿玩`）。
         *
         * 2026-10-27：**以 `#` 开头的引用**（`#DPS 胡桃 12金`）本身就是一条命令，属于可证明的边界 ——
         * 命令改名后这类引用只有 11 个字符，不够 12 字阈值，但绝不能当成"短参数"放过（否则整段进参数）。
         */
        const isCommandEcho = (v) => v.startsWith('#');
        const variants = [...new Set([quoted, squeeze(quoted)])]
            .filter(v => v.length >= 12 || isCommandEcho(v) || looksLikeOurEcho(v));
        let out = raw;
        let hit = false;
        for (const v of variants) {
            if (out.includes(v)) {
                out = out.split(v).join(' ');
                hit = true;
            }
        }
        /*
         * 2026-10-18 核对修复（#2 兜底）：整段命中但**剔完什么都不剩**时，说明用户重打的参数与引用原文
         * 完全相同（引用 `胡桃12金` → 再打 `胡桃12金`）→ 保留原文，否则参数变空、掉成总榜。
         */
        const stripped = hit ? squeeze(out) : '';
        return stripped ? stripped : raw;
    }
    catch {
        return raw;
    }
}
/**
 * 判定这段文本**是否我们自己出图/回帖的内容被回灌**（引用、转发、自环）。
 *
 * 背景（2026-10-16 实测）：用户引用上一条榜单回复再发命令时，旧回复正文会进到参数里；
 * `stripQuotedArgs` 只在"引用原文整段出现"时剔除，回灌文本自身成为整条消息时无法识别，
 * 于是被当参数解析 —— 出现"角色被解析成上一条回复里的名字 + 一堆碎片筛选词"的污染回复。
 *
 * 口径：命中我们自己的**输出指纹**即认定回灌（宁可漏判，不误伤用户正文——
 * 指纹取自我们生成的标题/脚注/诊断句式，用户不会这么输入）。
 */
const ECHO_MARKERS = [
    '各金档最高伤害队伍', // charDpsText 标题
    '每 4 金一档的最高伤害队伍', // 档位页标题
    '已忽略无法核实的词', // rankQuery 诊断句
    '数据来自 mhydps.cn', // 版权脚注
    '数据:原神DPS数据库', // 文本回退里的站点行
    '没有查询到该角色的配队记录' // charDpsText 空态
];
/** 半角/全角冒号归一（我们的文本输出用全角「数据：」，ASCII 指纹 `数据:` 会漏判 → 2026-10-18 修复） */
const canon = (s) => String(s || '').replace(/：/g, ':');
export function looksLikeOurEcho(text) {
    const s = canon(String(text || ''));
    if (!s)
        return false;
    return ECHO_MARKERS.some(m => s.includes(canon(m)));
}
/**
 * 解析命令参数：**优先用「用户自己打的文本」**，拿不到段信息时才退回旧路径。
 *
 * 2026-10-17 复审修复（#2 / #3）：
 *   - #3 `e.msg` 里**带着引用原文**，旧代码直接 `looksLikeOurEcho(e.msg)`：
 *     用户引用我们的回复、又打了新命令时，命中的是"引用里的指纹" → 直接 return false，
 *     合法的新命令一条回复都没有（实测：回复 0 条、getReply 调用 0 次）。
 *   - #2 旧路径把"用户重打的、与引用原文相同的参数"整段剔掉（`引用=胡桃12金` + 重打 `胡桃12金` → 空串），
 *     于是角色丢了、掉成总榜。
 * 现在：own 文本存在且能匹配规则时**只用 own**（既不判回灌、也不剔引用），
 * only 当适配器不提供 message 段时才走旧的 stripQuotedArgs 兜底。
 *
 * @returns `echo` = 这条命令本身就是我们自己的输出（自环/转发）→ 调用方应静默忽略；
 *          `text` = 规则第 1 组（参数原文，未做进一步解析）。
 */
export async function resolveCommandArgs(e, rule) {
    const own = ownTextOf(e).trim();
    if (own) {
        // 自环/转发：own 自身就是我们的输出（不见得带命令前缀，所以先判指纹再判规则）
        if (looksLikeOurEcho(own))
            return { echo: true, text: '' };
        if (rule.test(own))
            return { echo: false, text: (own.match(rule) || [])[1] || '' };
    }
    const msg = String(e?.msg || '');
    const raw = (msg.match(rule) || [])[1] || '';
    if (!raw)
        return { echo: false, text: '' };
    /*
     * 2026-10-18 核对修复（#3 兜底）：先剔引用**再**判回灌 ——
     * 旧写法直接 `looksLikeOurEcho(msg)`，而 msg 含着引用正文，用户引用我们回复后零回复。
     */
    const stripped = await stripQuotedArgs(e, raw);
    if (looksLikeOurEcho(stripped))
        return { echo: true, text: '' };
    return { echo: false, text: stripped };
}
//# sourceMappingURL=quoteGuard.js.map