/** 内部规则版本（展示"计分口径"用；攻略目标版本另有来源，取不到就写"版本未提供"） */
export const SCORING_VERSION = 'meta-grade-v3';
export const STATE_LABEL = {
    met: '达标',
    below: '未达标',
    unscored: '不计分',
    unknown: '未知'
};
/** 颜色之外的第二通道（色觉障碍适配，规格 §2：颜色 + 固定图形 + 中文） */
export const STATE_SYMBOL = {
    met: '✓',
    below: '!',
    unscored: '−',
    unknown: '?'
};
export const REASON_TEXT = {
    'target-missing': '攻略缺该项',
    'data-missing': '未取到数据',
    'partial-data': '数据不完整',
    'fetch-failed': '取数失败'
};
/** 来源条的"数据新鲜度"文案（与颜色/时间分开，不靠一句话暗示） */
export const MODE_TEXT = {
    local: '本地数据',
    refreshed: '本次已刷新',
    cache: '缓存数据',
    fallback: '回退数据'
};
/** 从参考文本里取第一个数字（`C6` → 6、`2 / 6` → 2、`180%` → 180） */
function firstNumber(text) {
    const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
}
/** 参考行是否仍未满足（数字可比且当前值低于目标最小值）；无法比较时按"需展示"处理 */
export function referenceUnmet(row) {
    const actual = firstNumber(row.actual);
    const target = firstNumber(row.target);
    if (actual === null || target === null)
        return true;
    return actual + 1e-9 < target;
}
/** 只整理业务层已投影的参考项，不补入其他预设目标，也不按属性名吞掉不同目标。 */
export function buildReferenceGroups(references) {
    const groups = new Map();
    for (const row of references) {
        // 2026-10-30 用户定：命座不再单独占一个「命座」分类标题，行名「关键命座」已足够。
        const label = row.id.startsWith('panel:') ? '面板' : row.group === '命座' ? '' : row.group || '其他';
        let group = groups.get(label);
        if (!group) {
            group = { label, rows: [] };
            groups.set(label, group);
        }
        const tags = [];
        if (label === '面板' && row.group && row.group !== '参考')
            tags.push(row.group);
        // 条件原文只搬到短标签，不改写含义；同目标不同条件仍是不同项。
        const target = row.target.replace(/[（(〔]([^）)〕]*)[）)〕]/g, (_, text) => {
            tags.push(text.trim());
            return '';
        }).trim();
        const item = { id: row.id, name: row.name, actual: row.actual, target, tags: [...new Set(tags)], tone: referenceUnmet({ actual: row.actual, target }) ? 'warn' : 'info' };
        const duplicate = group.rows.some(r => r.name === item.name && r.actual === item.actual && r.target === item.target && r.tags.join('\0') === item.tags.join('\0'));
        if (!duplicate)
            group.rows.push(item);
    }
    return [...groups.values()];
}
/** 从字符串里抽数字（仅用于"还差多少"这类有限数字目标；拿不到就退回"未达标"） */
export function deltaTextOf(row) {
    if (row.verdict === 'off')
        return '无数据';
    if (row.verdict === 'info')
        return '参考';
    const actual = Number(String(row.actual).replace(/[^\d.-]/g, ''));
    const nums = String(row.target).match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (!Number.isFinite(actual) || !nums.length)
        return '未达标';
    const min = Math.min(...nums);
    const diff = Number((min - actual).toFixed(1));
    return diff > 0 ? `差 ${diff}` : '未达标';
}
/** 维度视图：四态 + 有效权重 + 不画 0 长度条 */
export function buildDims(dims) {
    return dims.map(d => {
        const state = d.state;
        const pct = d.ratio === null ? null : Math.round(d.ratio * 100);
        return {
            key: d.key,
            label: d.label,
            state,
            stateLabel: STATE_LABEL[state],
            symbol: STATE_SYMBOL[state],
            reason: d.reason,
            reasonText: d.reason ? REASON_TEXT[d.reason] : undefined,
            ratio: d.ratio,
            pct,
            // 不计分 / 未知都不显示百分数（旧实现显示 0%，等于把缺项说成"一点没做"）；
            // 数值列写"—"，状态由状态章表达（颜色 + 图形 + 中文三通道）
            pctText: pct === null ? '—' : `${pct}%`,
            weight: d.weight,
            weightText: d.weight > 0 ? `${Math.round(d.weight * 100)}%` : '—',
            detail: d.detail
        };
    });
}
/**
 * 证据行：按传入顺序编号 `E01…`，稳定键保持原样
 *
 * 参考行（`scored === false`）单独返回 —— 规格要求"参考项即使有差距也不计分"，
 * 而且**未知行不能被过滤掉**（旧实现把缺主词条的行丢掉了，页面还可能显示"全部达标"）。
 */
export function buildEvidence(rows) {
    const evidence = [];
    const references = [];
    for (const row of rows) {
        const scored = row.scored !== false && row.verdict !== 'info';
        const state = row.state || (row.verdict === 'ok' ? 'met' : row.verdict === 'warn' ? 'below' : row.verdict === 'info' ? 'unscored' : 'unknown');
        const item = {
            id: String(row.id || `${row.group}:${row.name}`),
            eid: '',
            group: row.group,
            name: row.name,
            target: row.target,
            actual: row.actual,
            state,
            stateLabel: STATE_LABEL[state],
            symbol: STATE_SYMBOL[state],
            reason: state === 'unknown' ? 'data-missing' : undefined,
            reasonText: state === 'unknown' ? REASON_TEXT['data-missing'] : undefined,
            scored,
            // 只有真算得出差值时才显示"差 N"；否则留空（状态章已经写了"未达标"，不必重复一遍）
            deltaText: /^差 /.test(deltaTextOf(row)) ? deltaTextOf(row) : ''
        };
        if (scored) {
            // E 号是**本页呈现号**：只发给需要关注的行（未达标 / 未知），达标行压成摘要行，
            // 这样编号连续（E01、E02…），建议引用不会出现"跳号"（2026-10-15 本地渲染发现）。
            if (state !== 'met') {
                item.eid = `E${String(evidence.filter(e => e.eid).length + 1).padStart(2, '0')}`;
            }
            evidence.push(item);
        }
        else {
            references.push(item);
        }
    }
    return { evidence, references };
}
/** 建议行：把稳定键映射成当页证据号；绑定不到就不编造号 */
export function buildSuggestionRows(rows, evidence) {
    const byId = new Map(evidence.map(e => [e.id, e.eid]));
    return rows.map(s => ({
        id: s.id,
        text: s.text,
        evidenceIds: [...s.evidenceIds],
        evidenceEids: s.evidenceIds.map(id => byId.get(id)).filter((x) => !!x),
        priority: s.priority,
        priorityBasis: s.priorityBasis
    }));
}
/** 计分覆盖与可比性（不同覆盖/版本的分数不横向比较） */
export function buildScoreContext(result, opts = {}) {
    const weights = {};
    for (const d of result.dims)
        if (d.weight > 0)
            weights[d.key] = Number(d.weight.toFixed(4));
    return {
        assessable: result.assessable,
        scoringVersion: opts.scoringVersion || SCORING_VERSION,
        targetVersion: String(opts.targetVersion || ''),
        evaluatedKeys: result.dims.filter(d => d.state === 'met' || d.state === 'below').map(d => d.key),
        unknownKeys: result.dims.filter(d => d.state === 'unknown').map(d => d.key),
        unscoredKeys: result.dims.filter(d => d.state === 'unscored').map(d => d.key),
        weights,
        isPartial: result.dims.some(d => d.state === 'unknown' || d.state === 'unscored')
    };
}
/** miao 面板来源 → 来源条 */
export function miaoSource(source, observedAt) {
    const mode = String(source?.mode || 'local');
    const safeMode = (['local', 'refreshed', 'cache', 'fallback'].includes(mode) ? mode : 'local');
    return {
        source: 'miao',
        name: String(source?.name || 'miao 面板'),
        mode: safeMode,
        modeText: MODE_TEXT[safeMode],
        updatedAt: String(source?.updatedAt || ''),
        observedAt,
        reason: source?.reason ? String(source.reason) : undefined
    };
}
/** 03 小字备注：只补正文没有的信息，正文已有的当前/目标不重复。 */
function improvementNote(id, evidence) {
    if (!evidence.length)
        return '';
    if (id === 'talent')
        return '';
    if (id === 'panel') {
        const deltas = [...new Set(evidence.map(e => e.deltaText).filter(Boolean))];
        return deltas.join('、');
    }
    if (id === 'mainstat')
        return `当前：${evidence.length === 1 ? evidence[0].actual : evidence.map(e => `${e.name} ${e.actual}`).join('、')}`;
    if (id === 'artifact:set' || id === 'artifact:mark' || id === 'weapon')
        return `当前：${evidence.map(e => e.actual).join('、')}`;
    return `依据：${evidence.map(e => `${e.group} ${e.name} ${e.actual}→${e.target}`).join('；')}`;
}
/** 汇总：一次生成页面需要的全部视图数据 */
export function buildPresentation(input) {
    const observedAt = Number(input.observedAt) || 0;
    const dims = buildDims(input.result.dims);
    const { evidence, references: allReferences } = buildEvidence(input.result.rows);
    /*
     * 05 只保留"还没做到、值得看"的参考（2026-10-29 用户定）：
     *   - 圣遗物/主词条这类「综合」参考不再展示（辅助预设本就不计分，达标时更是纯占版面）；
     *   - 关键命座在玩家已达到目标时隐藏；未达到才作为参考提示。
     * 面板参考仍保留（可能带命座条件），由 tone 标出是否还有差距。
     */
    const references = allReferences.filter(row => {
        if (row.id.startsWith('artifact:'))
            return false;
        // 已达标的参考不再占版面；数字不可比（如“走 miao 规则”）时保留
        return referenceUnmet(row);
    });
    const suggestions = buildSuggestionRows((input.result.suggestionRows || []).map(s => ({ id: s.id, text: s.text, evidenceIds: s.evidenceIds, priority: s.priority, priorityBasis: s.priorityBasis })), evidence);
    /*
     * 2026-10-30 页面精简：04 未达标项与 06 提升建议合并为「建议 + 当前→目标证据」。
     * 以建议为主序（优先级不变），证据只作小字，不再展示 E01 这类页内编号。
     */
    const rowById = new Map((input.result.rows || []).map(row => [String(row.id || ''), row]));
    const rawSuggestions = (input.result.suggestionRows || []).length
        ? input.result.suggestionRows
        : (input.result.suggestions || []).map((text, i) => ({ id: `suggestion-${i + 1}`, text, evidenceIds: [], priority: i + 1, priorityBasis: 'cost-step' }));
    const referenced = new Set();
    const improvements = rawSuggestions
        .filter(s => !(['all-met', 'unscored'].includes(String(s.id)) && !(s.evidenceIds || []).length))
        .map(s => {
        const evidenceItems = (s.evidenceIds || []).map(id => {
            referenced.add(String(id));
            const row = rowById.get(String(id));
            if (!row)
                return null;
            const delta = deltaTextOf(row);
            return {
                group: String(row.group || ''),
                name: String(row.name || ''),
                actual: String(row.actual ?? ''),
                target: String(row.target ?? ''),
                deltaText: /^差 /.test(delta) ? delta : ''
            };
        }).filter((x) => !!x);
        return { id: String(s.id || ''), priority: Number(s.priority) || 0, text: String(s.text || ''), evidence: evidenceItems, note: improvementNote(String(s.id || ''), evidenceItems) };
    });
    const pending = evidence
        .filter(e => e.state === 'unknown' && !referenced.has(e.id))
        .map(e => ({ group: String(e.group || ''), name: String(e.name || ''), reasonText: String(e.reasonText || '未取到数据') }));
    const consRow = references.find(r => r.id === 'cons:key');
    const consNote = consRow
        ? { name: consRow.name, actual: consRow.actual, target: consRow.target }
        : null;
    const metCount = evidence.filter(e => e.state === 'met').length;
    // 维度已判 below 但没有逐项证据时（合成/缺明细数据），收尾文案必须如实说明，不能写"均已满足"。
    const belowDims = input.result.dims.filter(d => d.state === 'below').map(d => d.label);
    /*
     * 参考项区的两条展示口径（2026-10-18 用户定）：
     *   refHasDir  —— 参考项里有没有**方向**（辅助/输出…）。没有就不为方向留列（省横向空间）；
     *   refOnlyCons —— 参考项只有「命座」一条 → 整块不显示（没有可参考的面板目标，纯占版面）。
     * 「参考」是面板无方向时的兜底 group，不算方向。
     */
    const refGroups = references.map(r => String(r.group || ''));
    const refHasDir = refGroups.some(g => g && g !== '参考' && g !== '命座');
    const refOnlyCons = references.length > 0 && refGroups.every(g => g === '命座');
    return {
        score: buildScoreContext(input.result, { targetVersion: input.targetVersion }),
        dimensionsTitle: dims.length === 4 ? '四维达成' : dims.length === 3 ? '三维达成' : `${dims.length}维达成`,
        sectionIndex: { suggestions: '03', refDps: '04' },
        referenceGroups: buildReferenceGroups(references),
        improvements,
        pending,
        consNote,
        dims,
        evidence,
        references,
        refHasDir,
        refOnlyCons,
        suggestions,
        metCount,
        belowDims,
        belowDimsText: belowDims.length ? `未达标维度：${belowDims.join('、')}（无逐项证据）` : '',
        /*
         * 未达标项的收尾文案（2026-10-18 用户定）：没有未达标项时写「已全部达标」，
         * 而不是在"未达标项"标题下只写「其余 N 项达标」。
         */
        /*
         * 2026-10-18 复审 R2：`已全部达标` 必须同时满足「证据全 met」且「没有维度 below」。
         * 之前只看 evidence（面板行是 info、套装行是 met），综合 92%/below 时仍打出「已全部达标」。
         */
        metText: evidence.length === 0
            ? ""
            : (evidence.every(e => e.state === "met") && !input.result.dims.some(d => d.state === "below")
                ? "已全部达标"
                : (metCount ? `其余 ${metCount} 项达标` : "")),
        sources: [miaoSource(input.source, observedAt), ...(input.extraSources || [])]
    };
}
/**
 * 整值占位符识别（2026-10-15 审核意见 4.4；2026-10-17 扩到「带单位 / 前缀」的写法）
 *
 * 数据里确实存在 `100级提升: ___%` 这类**未填写的占位值**，页面原样显示会像"有内容但坏掉"。
 * 认这几种形态：
 *   - 全下划线（可带 `%`）：`___%`、`__`
 *   - 全破折号：`——`、`--`、`—`
 *   - 空串 / 全空白
 *   - **带单位 / 前缀的空占位**：`___级`、`约 ___%`、`__~__级`（用户 2026-10-17 定：
 *     建议等级的数字是占位就整行不显示）—— 判据是「一个数字都没有、又含占位符字符」
 * **不碰**合法的 `0`、`0%`、`70-80%`、`约 7.2%~7.8%`、`60级突破`（都含数字）。
 *
 * 放在展示层（而不是各模板里）：图片与文本回退消费同一份归一结果。
 */
export function isPlaceholderValue(raw) {
    const text = String(raw ?? '').trim();
    if (!text)
        return true;
    if (/\d/.test(text))
        return false;
    if (/^[_＿]+%?$/.test(text) || /^[-－—–~～]+%?$/.test(text))
        return true;
    // 走到这里已经确定"没有数字"：只要出现占位符字符，就当占位（`___级` / `约 ___%` / `__ ~ __`）
    return /[_＿\-－—–~～]/.test(text);
}
/** 占位值归一：占位 → 空串（由调用方决定显示"未提供"还是整行省略） */
export function normalizeMetaValue(raw) {
    return isPlaceholderValue(raw) ? '' : String(raw ?? '').trim();
}
/** 行内 `名称：值` 里的值若是占位符 → 换成"未提供"（视图层改一次，两条渲染路径同源） */
/**
 * 备注斜体：把文本里的括号备注（全角 `（）` / 半角 `()`）切成
 * `<span class="codex-note">…</span>`，供模板用 `{{@…}}` 原样输出。
 *
 * 只处理**括号内容**（本仓库攻略数据的备注约定就是括号，见现场核对）；
 * 其他 HTML 字符一律转义，避免数据里出现尖括号时破坏结构。
 */
export function noteSpansOf(raw) {
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return String(raw ?? '').replace(/[（(]([^）)]*)[）)]/g, (m, inner) => `<span class="codex-note">${esc(m)}</span>`);
}
export function normalizeItemText(raw) {
    const text = String(raw ?? '').trim();
    const m = text.match(/^(.+?)[：:]\s*(.+)$/);
    if (!m)
        return text;
    return isPlaceholderValue(m[2]) ? `${m[1]}：未提供` : text;
}
const asRecord = (v) => (v && typeof v === 'object' ? v : {});
const asArray = (v) => (Array.isArray(v) ? v : []);
/** 长标签判定（> 6 字符）：攻略里有 `月结晶/月感电` 这类双方案标签，窄列会被拆成半截 */
export function isLongLabel(label) {
    return String(label || '').trim().length > 6;
}
const TONE_WORDS = [
    ['core', /推荐|主词条|命之座|首选|毕业|专武|核心|月结晶|月感电|月绽放/],
    ['alt', /可选|副词条|次选|备选|替代/],
    ['muted', /过渡|其他|通用|输出向|辅助向/]
];
export function labelToneOf(label) {
    const text = String(label || '').trim();
    if (!text)
        return 'plain';
    for (const [tone, re] of TONE_WORDS)
        if (re.test(text))
            return tone;
    return 'plain';
}
/** 面板格文本 `暴击率：80-90%` → `{ k: '暴击率', v: '80-90%' }`；没有冒号时 k 留空、v 原样 */
/**
 * `属性：数值` → 三瓣（2026-10-17 复审修复 #10）
 *
 * 攻略里的面板行有**方向前缀**：`辅助：暴击率：70%` / `输出：暴击率：90%`。
 * 旧实现只按**第一个**冒号切 → `k = 辅助`、`v = 暴击率：70%`：方向是出现了，但属性名和数值被挤在
 * 同一格里、两种方向的两行看起来只是"标签不同"，读不出"这是辅助档 / 输出档"。
 * 两个及以上冒号时按 **方向 : 属性 : 数值** 切；只有一个冒号时维持 `属性 : 数值`。
 */
const DIRECTION_WORDS = /^(?:辅助|输出|治疗|生存|主c|副c|主C|副C|输出向|辅助向|双修|盾)(?:向)?$/i;
export function splitStatCell(text) {
    const raw = String(text || '').trim();
    const all = [...raw.matchAll(/[：:]/g)].map(m => m.index ?? -1).filter(i => i > 0);
    if (!all.length)
        return { group: '', k: '', v: raw };
    if (all.length >= 2) {
        const g = raw.slice(0, all[0]).trim();
        const k = raw.slice(all[0] + 1, all[1]).trim();
        const v = raw.slice(all[1] + 1).trim();
        /*
         * 只有首段确实是"方向词"才当 group（数据里实测只有：辅助 / 输出 / 输出向 / 辅助向 / 主c …）。
         * 否则像 `备注：时间 12:30` 这种「值里带冒号」的行会被误拆成三瓣 —— 旧口径只切第一个冒号，必须保留。
         */
        if (DIRECTION_WORDS.test(g) && k && v)
            return { group: g, k, v };
    }
    const at = all[0];
    return { group: '', k: raw.slice(0, at).trim(), v: raw.slice(at + 1).trim() };
}
export function labelLinesOf(label) {
    const text = String(label || '').trim();
    if (!text)
        return [];
    if (!isLongLabel(text))
        return [text];
    const parts = text.split(/[／/｜|、]/).map(s => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [text];
}
/**
 * 圣遗物套装表述（纯函数，2026-10-15 用户定；2026-10-17 从 `apps/grade.ts` 提成共享）
 *
 * 规则：**只写 4 件套 / 2+2 / 2 件套；凑不出套装加成就写「散件」，不列单件散件**。
 * （曾经写成 `魔女×4 + 乐团×1` 会把单件散件也列出来。）
 *
 * @param sets 每套的**展示名**与件数（名一律由调用方给中文；按入参顺序做稳定排序，排名相同的保序）
 */
export function setSummary(sets) {
    const counts = (sets || [])
        .filter(s => s && String(s.name ?? '') && Number(s.count) > 0)
        .map(s => [String(s.name), Math.floor(Number(s.count))])
        .sort((a, b) => b[1] - a[1]);
    const four = counts.find(([, n]) => n >= 4);
    if (four)
        return `${four[0]}×4`;
    const pairs = counts.filter(([, n]) => n >= 2).slice(0, 2);
    if (pairs.length >= 2)
        return `${pairs[0][0]}×2 + ${pairs[1][0]}×2`;
    if (pairs.length === 1)
        return `${pairs[0][0]}×2`;
    return '散件';
}
/**
 * 攻略页投影：给每个模块补章节序号，给条目补"颜色之外"的图形通道，并收集来源/脚注。
 *
 * **不重做归一**：`kind/items/sepAfter/talentLevel/crown` 一律照 `buildV2Sections()` 的输出消费
 * （现场核对 §一：模板里不重新展开攻略，也不解析自然语言猜语义）。
 */
export function buildCodexPresentation(view, opts = {}) {
    const sections = asArray(view?.sections).map((raw, i) => {
        const s = asRecord(raw);
        const rows = asArray(s.rows).map(r => {
            const row = asRecord(r);
            const items = asArray(row.items).map(it => {
                const item = asRecord(it);
                const sig = item.sig === true;
                const alt = item.sigAlt === true;
                const cell = splitStatCell(normalizeItemText(item.text));
                return {
                    text: normalizeItemText(item.text),
                    group: cell.group,
                    k: cell.k,
                    v: cell.v,
                    textHtml: noteSpansOf(normalizeItemText(item.text)),
                    note: String(item.note ?? ''),
                    icon: String(item.icon ?? ''),
                    tone: sig ? 'sig' : alt ? 'alt' : '',
                    marker: sig ? '★' : alt ? '◇' : '',
                    sepAfter: String(item.sepAfter ?? ''),
                    talentLevel: Number(item.talentLevel ?? item.level) || 0, // 真实数据字段是 `level`（v2.talents.order），模板用 `talentLevel`
                    crown: item.crown === true || Number(item.talentLevel ?? item.level) >= 10 // 与 miao 同规则：原始等级 ≥ 10 即出冠
                };
            });
            const label = String(row.label ?? '');
            return { label, labelLines: labelLinesOf(label), longLabel: isLongLabel(label), labelTone: labelToneOf(label), kind: String(row.kind ?? ''), items };
        });
        const teams = asArray(s.teams).map(t => {
            const team = asRecord(t);
            return {
                tag: String(team.tag ?? ''),
                text: String(team.text ?? ''),
                members: asArray(team.members).map(m => {
                    const member = asRecord(m);
                    const name = String(member.name ?? '');
                    /*
                     * 2026-10-18 核对修复（#9 残留）：多选槽的候选写在名字里（`莫娜 / 沃雅妮莎`），
                     * 旧实现只当一整个名字 → 模板只画得到首选头像、其余候选直接消失。
                     * 这里拆成 `alts`，模板逐个渲染（有图标画头像、没图标画名字）。
                     */
                    const existing = member.alts;
                    const split = name.split(/[／/]/).map(s => s.trim()).filter(Boolean);
                    return {
                        name,
                        icon: String(member.icon ?? ''),
                        note: String(member.note ?? ''),
                        // 上游（subViews.withIcons）已经拆好并解析过图标时直接用，避免这里把图标丢掉
                        alts: Array.isArray(existing) && existing.length
                            ? existing.map(a => ({ name: String(a?.name ?? ''), icon: String(a?.icon ?? '') }))
                            : (split.length ? split : [name]).map(n => ({ name: n, icon: '' }))
                    };
                })
            };
        });
        return {
            index: String(i + 1).padStart(2, '0'),
            title: String(s.title ?? ''),
            kind: String(s.kind ?? ''),
            empty: s.empty === true || (rows.length === 0 && teams.length === 0),
            emptyText: String(view?.hints?.empty ?? '暂无'),
            // 武器模块的精炼提示挂在**标题行**上（原来贴在卡片底部，容易被当成脚注忽略）
            hint: String(s.title ?? '') === '武器' ? String(view?.hints?.refine ?? '') : '',
            rows,
            teams
        };
    });
    return {
        sections,
        legend: '★ 专武　◇ 可选档',
        hint: String(view?.hints?.refine ?? ''),
        copyright: String(opts.copyright ?? ''),
        sources: opts.sources && opts.sources.length
            ? opts.sources
            : [{ source: 'codex', name: '本仓库攻略数据', mode: 'local', modeText: MODE_TEXT.local, updatedAt: '', observedAt: 0 }]
    };
}
//# sourceMappingURL=presentation.js.map