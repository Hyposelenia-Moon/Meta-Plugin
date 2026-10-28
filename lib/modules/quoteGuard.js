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
 * 剥离**完整引用块**（2026-10-28 复审重写）
 *
 * 旧实现按"最后出现 / 重复字符"推断引用副本，实测两个反例：
 *   - 引用「矮灵」时，`#危战 矮灵 n7` 被删成 `#危战 n7`（引用原文恰好也出现在自身命令里）；
 *   - 引用「2」时，`#DPS 22金 页2` 被删成第 1 页。
 * 短词、数字、命令前缀、重复本身都不能证明某段文字来自引用。
 *
 * 现在只剥离**边界可证明**的完整引用块：
 *   ① 引用在开头：后面必须是换行 + 新的 `#` 命令（`引用\n#命令 …`）；
 *   ② 引用在结尾：前面必须是换行边界；或前面是空白且引用本身命中我们的输出指纹（整块回帖）。
 * 其余情况一律原样返回 —— 宁可留下不会解析成参数的噪声，也不删用户正文。
 */
export async function stripQuotedBlock(e, text) {
    const raw = String(text || '');
    const ev = e;
    if (!raw || !ev?.reply_id || typeof ev.getReply !== 'function')
        return raw;
    try {
        const quoted = quotedText(await ev.getReply());
        if (!quoted)
            return raw;
        const variants = [...new Set([quoted, squeeze(quoted)])].filter(Boolean);
        for (const variant of variants) {
            // ① 引用块在开头：`引用\n#命令 …`
            if (raw.startsWith(variant)) {
                const rest = raw.slice(variant.length);
                if (/^[\t ]*\r?\n/.test(rest) && /^#\S/.test(rest.trimStart()))
                    return rest.trimStart();
            }
            // ② 引用块在结尾：行边界，或"空白 + 我们的整块输出"
            if (raw.endsWith(variant) && raw.length > variant.length) {
                const prefix = raw.slice(0, raw.length - variant.length);
                const lineBoundary = /[\r\n][\t ]*$/.test(prefix);
                const outputBoundary = /\s$/.test(prefix) && looksLikeOurEcho(variant);
                if (lineBoundary || outputBoundary)
                    return prefix.trimEnd();
            }
        }
        return raw;
    }
    catch {
        return raw;
    }
}
/** 兼容入口：`stripQuotedArgs` 与全文隔离使用同一套"完整引用块"算法 */
export const stripQuotedArgs = stripQuotedBlock;
/**
 * 隔离引用后的**命令全文**（给路由 / 档位这类"必须看用户原话"的解析用）
 *
 * 优先用自身 `message` 文本段；拿不到时才走 `stripQuotedBlock()` 的边界逻辑。
 * 不再按"最后出现"删一段 —— 那会在 e.msg 不含引用正文、只有 getReply 有原文时，
 * 把用户自己命令里的同名词删掉（2026-10-28 复审）。
 */
export async function isolatedText(e) {
    const own = ownTextOf(e).trim();
    if (own)
        return own;
    const msg = String(e?.msg || '');
    return stripQuotedBlock(e, msg);
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
 * 解析命令参数：**优先用「用户自己打的文本」**，拿不到段信息时才退回 e.msg。
 *
 * 2026-10-17 复审修复（#2 / #3）：
 *   - #3 `e.msg` 里**带着引用原文**，旧代码直接 `looksLikeOurEcho(e.msg)`：
 *     用户引用我们的回复、又打了新命令时，命中的是"引用里的指纹" → 直接 return false，
 *     合法的新命令一条回复都没有（实测：回复 0 条、getReply 调用 0 次）。
 *   - #2 旧路径把"用户重打的、与引用原文相同的参数"整段剔掉（`引用=胡桃12金` + 重打 `胡桃12金` → 空串），
 *     于是角色丢了、掉成总榜。
 *
 * 2026-10-28 复审：无 own 段时**先隔离全文再匹配规则**（`stripQuotedBlock`），
 * 不再"先匹配参数、再按包含关系删词"——那样会对全文和参数各删一次，且短词/数字会被误删。
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
    const isolated = await stripQuotedBlock(e, msg);
    const hit = isolated.match(rule);
    if (!hit)
        return { echo: false, text: '' };
    // 先隔离**再**判回灌：旧写法直接判 msg，引用正文里的指纹会让合法新命令零回复
    if (looksLikeOurEcho(isolated))
        return { echo: true, text: '' };
    return { echo: false, text: hit[1] || '' };
}
//# sourceMappingURL=quoteGuard.js.map