/**
 * grade — 练度评分器（v3 P2「提升指南」的核心）
 *
 * 设计口径：
 *   - **综合（2026-10-15 用户定）**：面板与圣遗物**合并成一维**，以**圣遗物有效词条**为主 ——
 *     `miao 评分档位 × 0.8 + 套装符合度 × 0.2`。理由：面板本来就是武器与圣遗物词条的产物，
 *     分两维等于把同一件事算两次；用户口径是"以圣遗物词条数为主，毕业面板不设严格限制"。
 *   - **面板目标不计分**：攻略里的面板区间只在对比表里作**参考**展示（`verdict: 'info'`），
 *     不参与总分、不设门槛。
 *   - **总体练度**：三维加权（综合 / 武器 / 天赋）→ 0~100 → `MAX…D` 九档
 *   - **毕业档**（大毕业 / 毕业 / 小毕业）：按**综合（词条）分**判定；等级不足时最高「小毕业」
 *   - **命座不计分**（抽卡结果，不是"练"出来的），只作提示
 *   - **攻略缺该项不扣分**：该维度不计入分母（权重重归一）
 *   - **圣遗物评分走 miao 的规则**（`ArtisMark.getMarkDetail()`：有效词条加权分 + MAX…D 档位），
 *     页脚口径行写明这一点。
 *
 * 本模块**纯函数**：不读文件、不联网、不引 miao —— 攻略目标与玩家配装都由调用方准备好，
 * 因此可以用合成数据完整单测（`test/grade.test.mjs`）。
 */
/**
 * 默认权重（配置项 `gradeWeights` 可覆盖；权重会按"可评维度"归一）
 *
 * `comprehensive` = 旧「面板 30 + 圣遗物 35」合并而来（读旧配置时自动相加，见 `components/config.ts`）。
 */
export const DEFAULT_WEIGHTS = {
    comprehensive: 65,
    weapon: 20,
    talent: 15
};
/** 旧配置里的两个维度键（读入时合并进 `comprehensive`，只为向后兼容） */
export const LEGACY_WEIGHT_KEYS = ['panel', 'artifact'];
/** 面板三档阈值（配置项 `gradePanelTiers` 可覆盖） */
/**
 * 综合（圣遗物）维度的**达标线**（2026-10-18 用户反馈：40 多词条、miao 评分 ACE 仍被要求"继续提升"）。
 *
 * 原有 `ratio >= 1` 等于"必须 miao 满分（MAX）才算达标"，而综合分 = 0.8×词条档 + 0.2×套装，
 * ACE(0.95) + 推荐套装(1) 只有 0.96 → 永远判未达标，跟进阶建议互相打脸。
 * 现在按 miao 的 **ACE 档**作为达标线；武器 / 天赋仍按 100% 判（它们本来就是离散档位）。
 */
export const COMPREHENSIVE_MET_RATIO = 0.95;
export const DEFAULT_PANEL_TIERS = { big: 0.9, normal: 0.6, small: 0.3 };
/** 九档阈值：分数 ≥ 阈值即该档（配置项 `gradeRankThresholds` 可覆盖） */
export const DEFAULT_RANK_THRESHOLDS = [
    ['MAX', 95], ['ACE', 88], ['SSS', 80], ['SS', 72], ['S', 64], ['A', 55], ['B', 45], ['C', 30]
];
/** miao 圣遗物评分档位 → 0~1（与 miao `ArtisMark.getMarkClass` 的档位一一对应） */
export const MIAO_MARK_SCORE = {
    MAX: 1, ACE: 0.95, SSS: 0.9, SS: 0.8, S: 0.7, A: 0.55, B: 0.4, C: 0.25, D: 0.1
};
const PART_KEYS = ['mark', 'set', 'main', 'panel'];
/** 内置预设（主C / 副C / 辅助三档；由 miao 规则的输出向权重占比自动选中） */
export const GRADE_RULE_PRESETS = {
    dps: { weights: { mark: 80, set: 20 }, floors: { mark: 0.95, set: 0.8 }, requireMark: true, minParts: 2 },
    subdps: { weights: { mark: 45, set: 25, panel: 30 }, floors: { mark: 0.8, set: 0.8, panel: 0.9 }, requireMark: true, minParts: 2 },
    support: { weights: { set: 40, main: 30, panel: 30 }, floors: { set: 0.8, main: 1, panel: 0.9 }, requireMark: false, minParts: 2 }
};
/** 是否内置预设名 */
export function isRuleName(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GRADE_RULE_PRESETS, value);
}
/**
 * 归一配置里的规则写法（2026-10-27：只接受预设名）
 *
 * 内联规则对象随 `data/gi/_grade-rules.json` 一起移除 —— 口径唯一来源改为 miao 面板的激活规则，
 * 本插件只保留「全局强制」与「逐角色覆盖」两个逃生阀。
 */
export function normalizeGradeRule(raw) {
    if (!isRuleName(raw))
        return null;
    const preset = GRADE_RULE_PRESETS[raw];
    return { ...preset, weights: { ...preset.weights }, floors: { ...preset.floors } };
}
const ROLE_DPS_RE = /主C|主c|主\/|主／|站场|前台输出|输出/;
const ROLE_SUP_RE = /辅|奶|盾|拐|治疗|副C|副c|位|挂|专|减抗|增伤|加攻/;
/**
 * 按攻略「定位」判断口径（**只作 miao 规则读不到时的兜底**）
 *
 * 定位是自由文本，靠关键词只能近似；真正生效的是 miao 面板当前激活的评分规则。
 * 兜底信号：面板目标含暴击率 / 暴击伤害（输出向）优先按 dps。
 */
export function classifyGradeRole(input) {
    const text = String(input.roleText ?? '').trim();
    const panel = input.panel || [];
    const mainStats = input.mainStats || [];
    const critPanel = panel.some(t => t.attrKey === 'cpct' || t.attrKey === 'cdmg');
    const critMain = mainStats.some(t => {
        const views = t.optionViews?.length ? t.optionViews : t.options.map(o => parseCondMark(o));
        return views.some(v => /暴击/.test(String(v.name || '')));
    });
    const crit = critPanel || critMain;
    if (!text || text === '___')
        return crit ? 'dps' : 'support';
    const dpsTok = ROLE_DPS_RE.test(text);
    const supTok = ROLE_SUP_RE.test(text);
    if (dpsTok && supTok)
        return crit ? 'dps' : 'support';
    if (dpsTok)
        return 'dps';
    if (supTok)
        return 'support';
    if (/C$/i.test(text))
        return 'dps';
    return crit ? 'dps' : 'support';
}
/**
 * miao 评分规则里的「输出向」与「功能向」属性键
 *
 * 与 `ArtisMarkCfg` 的 `attrs` 一致（hp / atk / def / mastery / cpct / cdmg / dmg / phy / recharge / heal）。
 */
const OUTPUT_WEIGHT_KEYS = ['atk', 'cpct', 'cdmg', 'dmg', 'phy'];
const UTILITY_WEIGHT_KEYS = ['hp', 'def', 'mastery', 'recharge', 'heal'];
/** 分档阈值（输出向权重占比；经验值，可用 `gradeRuleOverrides` 逐角色纠正） */
export const MIAO_RULE_DPS_SHARE = 0.65;
export const MIAO_RULE_SUBDPS_SHARE = 0.5;
/**
 * 用 miao 面板当前激活的评分规则（`charWeight`）自动定档
 *
 * 输出向 = 攻击 / 暴击率 / 暴击伤害 / 伤害加成 / 物理伤害；功能向 = 生命 / 防御 / 精通 / 充能 / 治疗。
 * 返回 null 表示拿不到规则（miao 缺失 / 面板没有属性权重），调用方回落到「定位」兜底。
 */
export function deriveRuleFromCharWeight(weights) {
    if (!weights || typeof weights !== 'object')
        return null;
    const sum = (keys) => keys.reduce((s, k) => s + (Number(weights[k]) || 0), 0);
    const out = sum(OUTPUT_WEIGHT_KEYS);
    const util = sum(UTILITY_WEIGHT_KEYS);
    if (out + util <= 0)
        return null;
    const share = out / (out + util);
    const name = share >= MIAO_RULE_DPS_SHARE
        ? 'dps'
        : share >= MIAO_RULE_SUBDPS_SHARE ? 'subdps' : 'support';
    return { name, share: Number(share.toFixed(4)) };
}
/**
 * 取某个角色要跑的规则
 *
 * 优先级（高 → 低）：
 *   ① 配置 `gradeRuleOverrides`（逐角色临时纠偏）
 *   ② 配置 `gradeRule`（全局强制，整站回退用）
 *   ③ **miao 面板当前激活的评分规则**（`charWeight` → 输出向权重占比）
 *   ④ 读不到 miao 规则时，按攻略「定位」兜底
 */
export function resolveGradeRule(input) {
    const name = String(input.charName || '').trim();
    const overrides = input.overrides || {};
    if (name && overrides[name]) {
        const rule = normalizeGradeRule(overrides[name]);
        if (rule)
            return { rule, name: String(overrides[name]), source: 'override' };
    }
    const global = String(input.globalRule || 'auto').trim();
    if (global && global !== 'auto') {
        const rule = normalizeGradeRule(global);
        if (rule)
            return { rule, name: global, source: 'global' };
    }
    const derived = deriveRuleFromCharWeight(input.charWeight);
    if (derived) {
        return { rule: normalizeGradeRule(derived.name), name: derived.name, source: 'miao', share: derived.share };
    }
    const preset = input.role === 'support' ? 'support' : 'dps';
    return { rule: normalizeGradeRule(preset), name: 'auto', source: 'auto' };
}
/** 面板属性名 → 玩家侧属性键（miao 面板 `attr` 的键；元素伤害统一取 `dmg`） */
const PANEL_ATTR_KEY = {
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
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 解析目标项上的条件标注（`生命值（二命）` → name=生命值, consMin=2） */
export function parseCondMark(raw) {
    const text = String(raw ?? '').trim();
    // 攻略源用中文括号 `（二命）`，展示层（`buildV2Sections` 归一）会把它转成六角括号 `〔二命〕`——
    // 两条路都要认，否则"按显示标签"的那条回退路径又会漏掉条件。
    const m = text.match(/[（(〔]([^）)〕]*)[）)〕]\s*$/);
    if (!m)
        return { name: text, mark: '' };
    const inner = m[1].trim();
    const name = text.slice(0, m.index).trim();
    const mark = text.slice(m.index).trim();
    // 满命 / 六命 / 6命 → 6；四命 / 4 命 → 4；二命 / 2命 → 2
    const num = inner.match(/(\d+)\s*命/);
    const cn = inner.match(/([一二两三四五六七八九十]+)\s*命/);
    if (inner.includes('满命'))
        return { name, mark, consMin: 6 };
    if (num)
        return { name, mark, consMin: Number(num[1]) };
    if (cn)
        return { name, mark, consMin: CN_NUM[cn[1]] || undefined, vague: CN_NUM[cn[1]] ? undefined : inner };
    if (/高命|随命座|命座/.test(inner))
        return { name, mark, vague: inner };
    return { name, mark, note: inner };
}
/** 条件是否满足（没有命座门槛即视为满足；无法判定的条件不做惩罚） */
export function condSatisfied(view, cons) {
    const need = Number(view?.consMin);
    if (!Number.isFinite(need) || need <= 0)
        return true;
    return Number(cons) >= need;
}
/** 主词条是否可接受：命中某个候选名 **且** 该候选的命座条件满足 */
export function mainStatAcceptable(target, actual, cons) {
    const wanted = String(actual || '').trim();
    if (!wanted)
        return false;
    const views = target.optionViews?.length
        ? target.optionViews
        : target.options.map(o => parseCondMark(o));
    const hit = views.find(v => v.name === wanted || v.name.includes(wanted) || wanted.includes(v.name));
    if (!hit)
        return false;
    return condSatisfied(hit, cons);
}
/** 解析 `70-80%` / `150` / `32000` / `81-90级` 这类目标值 */
export function parseTargetRange(raw) {
    // ⚠ 目标值不会是负数：这里**不能**把区间里的连字符当负号（`70-80%` 曾解析成 min=-80）
    const text = String(raw || '').replace(/[，,、~～—–－至到]/g, '-');
    const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])).filter(Number.isFinite);
    if (!nums.length)
        return null;
    const min = Math.min(...nums.slice(0, 2));
    const max = nums.length > 1 ? Math.max(nums[0], nums[1]) : min;
    return { min, max };
}
/**
 * 把攻略条目拆成候选名
 *
 * 攻略里的组合项写成 `冲浪时光\真语秘匣\万世流涌大典`（`v2` 的 `ref`/`name` 就是这种整串），
 * 逐项与实装名比对才能命中（2026-10-15 外部复核第 6 项发现：评分与比较表口径不一致）。
 */
export function guideCandidates(entry) {
    return String(entry || '').split(/[\\|]/).map(s => s.trim()).filter(Boolean);
}
/** 实装名是否命中攻略列表（逐候选：完全相同 / 互相包含） */
export function matchesGuideName(name, list) {
    const target = String(name || '').trim();
    if (!target)
        return false;
    return list.some(entry => guideCandidates(entry).some(c => c === target || c.includes(target) || target.includes(c)));
}
/**
 * 从攻略视图抽取评分目标（结构不匹配的行直接跳过，绝不抛错）
 *
 * @param guide 原始攻略数据（可选）：带 `v2.artifacts` 时**按结构化 `kind` 分桶**，
 *              没有才退回按显示标签（推荐/可选）判定 —— 自定义标签（如「月结晶/月感电」「月绽放」）
 *              只有结构化路径认得（2026-10-15 外部复核第 3 项发现）。
 */
export function extractTargets(view, charName = '', guide) {
    const targets = {
        charName,
        roleText: '',
        gradeRole: 'dps',
        levelMin: null,
        levelText: '',
        panel: [],
        weapon: { recommend: [], optional: [], transition: [] },
        artifact: { recommend: [], optional: [] },
        mainStats: [],
        talent: [],
        consKeys: []
    };
    // 建议等级（门槛）
    for (const row of view.metaRows || []) {
        if (String(row.label || '').includes('等级')) {
            const r = parseTargetRange(String(row.value || ''));
            targets.levelText = String(row.value || '');
            targets.levelMin = r ? r.min : null;
            break;
        }
    }
    const section = (title) => (view.sections || []).find(s => String(s.title || '') === title);
    // 面板
    for (const row of section('面板')?.rows || []) {
        // 方向取自**行标签**（`输出向` / `辅助向`）；同一属性在不同方向下目标可能不同，不能丢
        const groupName = String(row.label || '').trim();
        for (const item of row.items || []) {
            const text = String(item.text || '').trim();
            const idx = text.search(/[:：]/);
            if (idx < 0)
                continue;
            const name = text.slice(0, idx).trim();
            const attrKey = PANEL_ATTR_KEY[name] || (ELEM_DMG_RE.test(name) ? 'dmg' : '');
            if (!attrKey)
                continue;
            const valuePart = text.slice(idx + 1);
            const range = parseTargetRange(valuePart);
            if (!range)
                continue;
            /*
             * 目标值上的条件标注（`元素充能效率：185%（满命）`）：解析出来随行走，
             * 因为同一属性在不同命座下目标不同 —— 页面上必须能看到条件，不能当成普适目标。
             */
            const cond = parseCondMark(valuePart);
            /*
             * 去重规则（2026-10-15 审核意见 4.3）：
             *   - **同方向**里完全相同的目标只留一条；
             *   - **跨方向**同名同值（哥伦比娅「输出向/辅助向」都写 生命值 35000）合并成一条，
             *     方向记进 `groups`，页面显示"输出/辅助"联合标签 —— 而不是按属性名一刀切去重。
             */
            const same = targets.panel.find(t => t.name === name && t.min === range.min && t.max === range.max);
            if (same) {
                if (groupName && !same.groups.includes(groupName))
                    same.groups.push(groupName);
                continue;
            }
            targets.panel.push({
                raw: text,
                name,
                attrKey,
                min: range.min,
                max: range.max,
                groups: groupName ? [groupName] : [],
                // 百分比看目标原文（`70%` / `130%以上`），不靠属性名猜
                percent: /%|％/.test(valuePart),
                ...(cond.consMin || cond.vague || cond.note ? { cond } : {})
            });
        }
    }
    // 武器（按档位行；`sig` 专武标记只作展示，不加分）
    for (const row of section('武器')?.rows || []) {
        const label = String(row.label || '').trim();
        const bucket = label === '推荐' ? targets.weapon.recommend : label === '可选' ? targets.weapon.optional : label === '过渡' ? targets.weapon.transition : null;
        if (!bucket)
            continue;
        for (const item of row.items || []) {
            const name = String(item.text || '').trim();
            if (name)
                bucket.push(name);
        }
    }
    // 圣遗物套装 + 主词条
    const v2Artifacts = Array.isArray(guide?.v2?.artifacts) ? guide?.v2?.artifacts : null;
    if (v2Artifacts) {
        // 结构化口径：按 `kind` 的语义分桶（`preferred` → 推荐、`optional`/`transition` → 可选），
        // 标签（如「月结晶/月感电」）只负责显示 —— 只认「推荐/可选」字面量会漏掉自定义标签
        for (const row of v2Artifacts) {
            const kind = String(row?.kind || '').trim();
            const sets = Array.isArray(row?.sets) ? row.sets : [];
            const sep = String(row?.sep || '');
            if (sets.length && ['preferred', 'optional', 'transition', ''].includes(kind)) {
                const bucket = kind === 'preferred' || kind === '' ? targets.artifact.recommend : targets.artifact.optional;
                /*
                 * 2026-10-18 复审 R1：`sep` 是 `+` 且每项都带 `2` 前缀时，这是**一条 2+2 组合**
                 * （`2如雷` + `2宗室`），必须合成一个条目；旧代码逐个 push 成两个"四件套目标"，
                 * 于是按攻略穿 2+2 也算不中推荐，还会建议"凑『2如雷』4 件"。
                 */
                const names = sets.map((s) => String(s?.name ?? s ?? '').trim()).filter(Boolean);
                const isPair = /\+|＋/.test(sep) && names.length === 2 && names.every(n => /^(?:2|两)\s*/.test(n));
                if (isPair) {
                    bucket.push(names.join(' + '));
                }
                else {
                    for (const name of names)
                        bucket.push(name);
                }
                continue;
            }
            if (kind === 'main') {
                const stats = (row?.stats && typeof row.stats === 'object') ? row.stats : {};
                for (const [slot, raw] of Object.entries(stats)) {
                    const options = (Array.isArray(raw) ? raw : [raw]).map(x => String(x).trim()).filter(Boolean);
                    const slotName = String(slot).trim();
                    if (slotName && options.length)
                        targets.mainStats.push({ slot: slotName, options, optionViews: options.map(parseCondMark) });
                }
            }
        }
        // `sub` / `text`：副词条与自由文本只用于展示与建议，不参与这里的评分口径
    }
    else {
        for (const row of section('圣遗物')?.rows || []) {
            const label = String(row.label || '').trim();
            if (label === '推荐' || label === '可选') {
                const bucket = label === '推荐' ? targets.artifact.recommend : targets.artifact.optional;
                for (const item of row.items || []) {
                    const name = String(item.text || '').trim();
                    if (name)
                        bucket.push(name);
                }
                continue;
            }
            if (label.includes('主词条')) {
                for (const item of row.items || []) {
                    const text = String(item.text || '').trim();
                    const idx = text.search(/[:：]/);
                    if (idx < 0)
                        continue;
                    const options = text.slice(idx + 1).split('/').map(s => s.trim()).filter(Boolean);
                    targets.mainStats.push({
                        slot: text.slice(0, idx).trim(),
                        options,
                        optionViews: options.map(parseCondMark)
                    });
                }
            }
        }
    }
    // 天赋（目标等级 + 皇冠）
    for (const row of section('天赋')?.rows || []) {
        for (const item of row.items || []) {
            const key = String(item.text || '').trim().toUpperCase();
            if (!['A', 'E', 'Q'].includes(key))
                continue;
            const level = Number(item.talentLevel);
            if (!Number.isFinite(level) || level <= 0)
                continue;
            targets.talent.push({ key: key, target: level, crown: item.crown === true });
        }
    }
    // 关键命座（只提示）
    for (const row of section('命座')?.rows || []) {
        const m = String(row.label || '').match(/(\d+)/);
        if (m)
            targets.consKeys.push(Number(m[1]));
    }
    /*
     * 兜底分档（2026-10-27）：读 `meta.定位` + 已解析的面板/主词条。
     * 真正生效的口径来自 miao 面板当前激活的评分规则（`charWeight`），
     * 这里只在拿不到 miao 规则时被 `resolveGradeRule()` 取用。
     */
    const roleRow = (view.metaRows || []).find(r => String(r.label || '').includes('定位'));
    targets.roleText = String(roleRow?.value || '').trim();
    targets.gradeRole = classifyGradeRole({ roleText: targets.roleText, panel: targets.panel, mainStats: targets.mainStats });
    return targets;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
/* ------------------------------------------------------------------ *
 * 评分
 * ------------------------------------------------------------------ */
/**
 * 综合维度：圣遗物**有效词条**为主（miao 评分规则）+ 套装符合度
 *
 * 2026-10-15 用户定：面板与圣遗物合并成一维，且"以圣遗物词条数为主、毕业面板不设严格限制"——
 * 所以这里**不看面板数值**（面板只作参考展示），只看 miao 的圣遗物评分与套装是否穿对。
 */
/**
 * 通用套装判定（2026-10-18：计分 / 对比行 / 建议三处共用）
 *
 * @param specs   攻略条目（`炽烈的炎之魔女` / `2如雷 + 2宗室` / `2精通+2精通`）
 * @param counts  当前配装的「套装名 → 件数」
 * @param effectSets 效果词 → 提供该两件套效果的套装名（可选，由 app 注入）
 * @returns 命中的 spec；都没命中返回 null
 */
export function matchSetSpec(specs, counts, effectSets) {
    const sameSet = (a, b) => a === b || a.includes(b) || b.includes(a);
    const groupOf = (name) => {
        const eff = effectWordOf(name);
        return eff ? (effectSets?.(eff) ?? []) : [name];
    };
    const hasPieces = (name, n) => [...counts.entries()].some(([set, c]) => c >= n && sameSet(set, name));
    const hitGroup = (set, cands) => cands.some(c => sameSet(set, c));
    for (const spec of parseSetSpecs(specs)) {
        if (spec.kind !== 'pair') {
            if (hasPieces(spec.sets[0], 4))
                return spec;
            continue;
        }
        if (spec.sets.length !== 2)
            continue;
        const ga = groupOf(spec.sets[0]);
        const gb = groupOf(spec.sets[1]);
        for (const [setA, nA] of counts) {
            if (nA < 2 || !hitGroup(setA, ga))
                continue;
            for (const [setB, nB] of counts) {
                if (setB !== setA && nB >= 2 && hitGroup(setB, gb))
                    return spec;
            }
        }
    }
    return null;
}
/** 效果别名（攻略里的 `2精通` / `2生命`）→ 归档名；不是效果词返回空串（纯函数，不读文件） */
export function effectWordOf(name) {
    const n = String(name || '').trim();
    if (!n || n.length > 4)
        return '';
    const hit = EFFECT_WORDS.find(w => n === w || n.includes(w));
    return hit || '';
}
/** 效果词表（与 `model/artiEffect.ts` 的桶名一致） */
const EFFECT_WORDS = ['精通', '充能', '暴击', '爆伤', '治疗', '生命', '攻击', '防御', '增伤'];
/**
 * 解析攻略里的圣遗物条目 → spec 列表
 *
 * 数据里真实的两种写法（实测 data/gi）：
 *   `推荐：炽烈的炎之魔女`   → 4 件套
 *   `推荐：2如雷 + 2宗室`    → 2+2（部分角色的毕业搭法本身就是 2+2）
 * 解析时把 `2`/`两` 前缀、`件` 后缀剥掉，只留套装名；`+`/`＋` 分隔。
 */
export function parseSetSpecs(list) {
    const out = [];
    for (const raw of list || []) {
        const text = String(raw || '').trim();
        if (!text)
            continue;
        const parts = text.split(/[+＋]/).map(s => s.trim()).filter(Boolean);
        const isPair = parts.length === 2 && parts.every(s => /^(?:2|两)\s*/.test(s));
        if (isPair) {
            const names = parts.map(s => s.replace(/^(?:2|两)\s*/, '').replace(/件套?$/, '').replace(/^件/, '').trim()).filter(Boolean);
            if (names.length === 2) {
                out.push({ kind: 'pair', sets: names, label: text });
                continue;
            }
        }
        // 4 件套：去掉 `4件套` / `×4` 这类后缀
        const name = text.replace(/[×xX*]\s*4/g, '').replace(/4\s*件套?$/, '').trim();
        out.push({ kind: 'pc4', sets: [name || text], label: text });
    }
    return out;
}
/** 分量在 detail 里的中文名（顺序固定：词条 → 套装 → 主词条 → 面板） */
const PART_LABEL = { mark: '词条', set: '套装', main: '主词条', panel: '面板' };
const partNull = (key, reason, detail) => ({
    key,
    ratio: null,
    state: reason === 'target-missing' ? 'unscored' : 'unknown',
    reason,
    detail
});
/**
 * 套装分（沿用 2026-10-18 的 spec 判定：4 件套 / 2+2 / 效果型）
 *
 * 与「词条评分」完全独立：这里只看穿了什么套装，不看副词条质量。
 */
function scoreSetPart(targets, build, effectSets) {
    const hasTarget = targets.artifact.recommend.length > 0 || targets.artifact.optional.length > 0;
    if (!hasTarget)
        return partNull('set', 'target-missing', '攻略没有套装目标');
    const artis = build.artis || [];
    if (!artis.length)
        return partNull('set', 'data-missing', '未读取到圣遗物');
    const counts = new Map();
    for (const a of artis)
        counts.set(a.set, (counts.get(a.set) || 0) + 1);
    const recSpec = matchSetSpec(targets.artifact.recommend, counts, effectSets);
    const optSpec = matchSetSpec(targets.artifact.optional, counts, effectSets);
    const loosePairs = [...counts.entries()].filter(([, c]) => c >= 2).map(([s]) => s);
    let setScore = 0.3;
    let setNote = '套装不在攻略推荐内';
    if (recSpec) {
        setScore = 1;
        setNote = recSpec.kind === 'pair' ? `推荐 2+2（${recSpec.label}）` : `推荐套装 4 件（${recSpec.label}）`;
    }
    else if (optSpec) {
        setScore = 0.8;
        setNote = optSpec.kind === 'pair' ? `可选 2+2（${optSpec.label}）` : `可选套装 4 件（${optSpec.label}）`;
    }
    else if (loosePairs.length >= 2) {
        setScore = 0.7;
        setNote = `2+2 组合（${loosePairs.join(' + ')}）`;
    }
    return { key: 'set', ratio: setScore, state: setScore >= 1 ? 'met' : 'below', detail: setNote };
}
/** 词条分（miao 评分档位；与套装无绑定关系） */
function scoreMarkPart(build) {
    const markClass = String(build.artiMark?.markClass || '').toUpperCase();
    const markScore = MIAO_MARK_SCORE[markClass];
    if (!build.artiMark || !Number.isFinite(markScore)) {
        return partNull('mark', 'data-missing', '未取到 miao 词条评分');
    }
    // 规则标题来自 miao 面板的「评分规则：xxx」（`ArtisMarkCfg.classTitle`），让页面能对上用的是哪条规则
    const ruleTitle = String(build.artiRuleTitle || '').trim();
    return {
        key: 'mark',
        ratio: markScore,
        state: markScore >= 1 ? 'met' : 'below',
        detail: `miao 词条评分 ${num(Number(build.artiMark.total) || 0)}（${markClass}${ruleTitle ? `，规则 ${ruleTitle}` : ''}）`
    };
}
/** 主词条分：命中的目标部位 ÷ 玩家有装备的目标部位 */
export function scoreMainPart(targets, build) {
    if (!targets.mainStats.length)
        return partNull('main', 'target-missing', '攻略没有主词条目标');
    const artis = build.artis || [];
    const pairs = targets.mainStats
        .map(t => ({ t, piece: artis.find(a => a.slot === t.slot) }))
        .filter((x) => Boolean(x.piece));
    if (!pairs.length)
        return partNull('main', 'data-missing', '未读取到主词条');
    const cons = Number(build.cons) || 0;
    const hits = pairs.filter(x => mainStatAcceptable(x.t, x.piece.mainName, cons)).length;
    const ratio = hits / pairs.length;
    return { key: 'main', ratio, state: hits === pairs.length ? 'met' : 'below', detail: `主词条 ${hits}/${pairs.length}` };
}
/**
 * 面板目标达成度（多方向取达成度最高的方向）
 *
 * 条件型目标（`元素充能效率：185%（满命）`）在命座不足时跳过；取不到实际值的条目不进分母。
 */
export function panelAssessment(targets, build) {
    const list = targets.panel || [];
    if (!list.length)
        return { ratio: null, direction: [], met: 0, total: 0, detail: '攻略没有面板目标' };
    const cons = Number(build.cons) || 0;
    const groups = new Map();
    let usable = 0;
    for (const t of list) {
        if (!condSatisfied(t.cond, cons))
            continue;
        const actual = Number(build.attrs?.[t.attrKey]);
        if (!Number.isFinite(actual))
            continue;
        const score = t.min > 0 ? clamp01(actual / t.min) : 1;
        usable++;
        const dirs = t.groups.length ? t.groups : ['参考'];
        for (const dir of dirs) {
            const g = groups.get(dir) || { met: 0, total: 0, sum: 0 };
            g.total += 1;
            g.sum += score;
            if (score >= 0.999)
                g.met += 1;
            groups.set(dir, g);
        }
    }
    if (!usable)
        return { ratio: null, direction: [], met: 0, total: 0, detail: '未读取到面板数据' };
    let best = null;
    for (const g of groups.values()) {
        const ratio = g.sum / g.total;
        if (!best || ratio > best.ratio + 1e-9)
            best = { ratio, met: g.met, total: g.total };
    }
    const direction = [...groups.entries()]
        .filter(([, g]) => Math.abs(g.sum / g.total - best.ratio) < 1e-9)
        .map(([dir]) => dir);
    return {
        ratio: best ? best.ratio : null,
        direction,
        met: best ? best.met : 0,
        total: best ? best.total : 0,
        detail: `面板 ${best ? best.met : 0}/${best ? best.total : 0} 达标`
    };
}
function scorePanelPart(targets, build) {
    const pa = panelAssessment(targets, build);
    if (pa.ratio === null) {
        return { part: partNull('panel', targets.panel.length ? 'data-missing' : 'target-missing', pa.detail), direction: [] };
    }
    return {
        part: { key: 'panel', ratio: pa.ratio, state: pa.ratio >= 0.9 ? 'met' : 'below', detail: pa.detail },
        direction: pa.direction
    };
}
/** 一次性算齐四个分量（计分 / 对比行 / 建议共用，避免三处各判一次） */
export function scoreParts(targets, build, opts = {}) {
    const panel = scorePanelPart(targets, build);
    return {
        mark: scoreMarkPart(build),
        set: scoreSetPart(targets, build, opts.effectSets),
        main: scoreMainPart(targets, build),
        panel: panel.part,
        panelDirection: panel.direction
    };
}
/**
 * 综合维度：按规则聚合四个分量
 *
 * 规则决定「谁参与加权」与「谁必须过线」；加权分只用于三维条、毕业档与总分，
 * 达标由 `floors` 决定 —— 这样不会出现「综合 96% 却写未达标」这类矛盾（复审 R2）。
 */
function comprehensiveDimFromParts(parts, rule) {
    const label = '综合';
    const weightOf = (k) => Number(rule.weights[k]) || 0;
    const active = PART_KEYS.filter(k => weightOf(k) > 0 && parts[k].ratio !== null);
    const anyTarget = PART_KEYS.some(k => parts[k].reason !== 'target-missing');
    const detailOf = () => PART_KEYS
        .filter(k => weightOf(k) > 0 || parts[k].ratio !== null)
        .map(k => `${PART_LABEL[k]}：${parts[k].detail}`)
        .join('；');
    if (rule.requireMark && weightOf('mark') > 0 && parts.mark.ratio === null) {
        return {
            key: 'comprehensive',
            label,
            ratio: null,
            weight: 0,
            detail: `${detailOf() || parts.mark.detail}（规则要求词条评分，暂不计分）`,
            state: 'unknown',
            reason: 'data-missing'
        };
    }
    if (active.length < (rule.minParts ?? 2)) {
        return {
            key: 'comprehensive',
            label,
            ratio: null,
            weight: 0,
            detail: detailOf() || '攻略没有可评的圣遗物目标',
            state: anyTarget ? 'unknown' : 'unscored',
            reason: anyTarget ? 'data-missing' : 'target-missing'
        };
    }
    const weightSum = active.reduce((s, k) => s + weightOf(k), 0);
    const ratio = active.reduce((s, k) => s + weightOf(k) * parts[k].ratio, 0) / (weightSum || 1);
    const failed = active.filter(k => {
        const floor = Number(rule.floors[k]);
        return Number.isFinite(floor) && parts[k].ratio + 1e-9 < floor;
    });
    return {
        key: 'comprehensive',
        label,
        ratio,
        weight: 0,
        detail: detailOf(),
        state: failed.length === 0 ? 'met' : 'below'
    };
}
function scoreWeapon(targets, build) {
    const label = '武器';
    const all = [...targets.weapon.recommend, ...targets.weapon.optional, ...targets.weapon.transition];
    if (!all.length)
        return { key: 'weapon', label, ratio: null, weight: 0, detail: '该角色攻略没有武器目标', state: 'unscored', reason: 'target-missing' };
    const name = String(build.weapon?.name || '');
    // 没读到武器是**数据缺失**，不是"用的是差武器"（旧实现给 0 分，页面显示成未达标 0%）
    if (!name)
        return { key: 'weapon', label, ratio: null, weight: 0, detail: '未读取到武器', state: 'unknown', reason: 'data-missing' };
    const inBucket = (list) => list.some(w => w === name || w.includes(name) || name.includes(w));
    const met = (r, detail) => ({ key: 'weapon', label, ratio: r, weight: 0, detail, state: r >= 1 ? 'met' : 'below' });
    if (inBucket(targets.weapon.recommend)) {
        const sig = targets.weapon.recommend[0] === name;
        return met(1, `推荐档：${name}${sig ? '（专武，不加分）' : ''}`);
    }
    if (inBucket(targets.weapon.optional))
        return { ...met(0.75, `可选档：${name}`), state: 'met' }; // 可选档 = 达标（用户 2026-10-16 口径：只有过渡才是未达标）
    if (inBucket(targets.weapon.transition))
        return met(0.5, `过渡档：${name}`);
    return met(0.25, `不在攻略推荐内：${name}`);
}
function scoreTalent(targets, build) {
    const label = '天赋';
    if (!targets.talent.length)
        return { key: 'talent', label, ratio: null, weight: 0, detail: '该角色攻略没有天赋目标', state: 'unscored', reason: 'target-missing' };
    // 天赋一个都没读到 → 数据缺失（旧实现把 `Number(..)||0` 当 0 级，页面显示成未达标）
    if (build.hasTalent === false) {
        return { key: 'talent', label, ratio: null, weight: 0, detail: '未读取到天赋等级', state: 'unknown', reason: 'data-missing' };
    }
    let got = 0;
    let want = 0;
    const miss = [];
    for (const t of targets.talent) {
        const actual = Number(build.talent?.[t.key]) || 0;
        got += Math.min(actual, t.target);
        want += t.target;
        if (actual < t.target)
            miss.push(`${t.key} ${actual}→${t.target}`);
    }
    const ratio = want > 0 ? clamp01(got / want) : null;
    return {
        key: 'talent',
        label,
        ratio,
        weight: 0,
        detail: miss.length ? `未达标：${miss.join('、')}` : '全部达标',
        state: ratio !== null && ratio >= 1 ? 'met' : 'below'
    };
}
/**
 * 毕业档（大毕业 / 毕业 / 小毕业 / 未毕业）
 *
 * 2026-10-15 起按**综合（圣遗物词条）分**判定 —— 面板目标不再计分，也就不能拿它当门槛；
 * 等级门槛保留（未达攻略「建议等级」时最高「小毕业」）。
 */
export function panelTierOf(ratio, build, targets, tiers = DEFAULT_PANEL_TIERS) {
    if (ratio === null)
        return { tier: '无法评估', capped: false };
    let tier = ratio >= tiers.big ? '大毕业' : ratio >= tiers.normal ? '毕业' : ratio >= tiers.small ? '小毕业' : '未毕业';
    let capped = false;
    const need = targets.levelMin;
    if (need && Number(build.level) < need && (tier === '大毕业' || tier === '毕业')) {
        tier = '小毕业';
        capped = true;
    }
    return { tier, capped };
}
/** 档位判定 */
export function rankOf(total, thresholds = DEFAULT_RANK_THRESHOLDS) {
    for (const [name, min] of thresholds)
        if (total >= min)
            return name;
    return 'D';
}
/** 主评分：攻略目标 × 玩家配装 → 总分 / 档位 / 对比表 / 建议 */
export function gradeBuild(targets, build, opts = {}) {
    const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
    /*
     * 规则（2026-10-25）：调用方传「角色绑定的规则」；没传时按定位兜底
     * （数据表 → 配置 → 全局的解析在 app 层做，见 `resolveGradeRule()`）。
     */
    const rule = opts.rule ?? resolveGradeRule({ charName: targets.charName, role: targets.gradeRole }).rule;
    const parts = opts.parts ?? scoreParts(targets, build, opts);
    const compDim = comprehensiveDimFromParts(parts, rule);
    const dims = [compDim, scoreWeapon(targets, build), scoreTalent(targets, build)];
    // 只对"有目标"的维度加权（缺项不扣分），权重重归一
    const scored = dims.filter(d => d.ratio !== null);
    const weightSum = scored.reduce((s, d) => s + (Number(weights[d.key]) || 0), 0);
    for (const d of dims)
        d.weight = d.ratio === null ? 0 : (Number(weights[d.key]) || 0) / (weightSum || 1);
    const total = scored.length ? scored.reduce((s, d) => s + d.ratio * d.weight, 0) * 100 : 0;
    const panelInfo = panelTierOf(compDim.ratio, build, targets, opts.panelTiers);
    const notes = [];
    if (cappedNote(targets, build, panelInfo.capped)) {
        notes.push(`等级 ${build.level} 未达建议等级 ${targets.levelText}（毕业档按门槛最高「小毕业」）`);
    }
    for (const d of dims)
        if (d.ratio === null)
            notes.push(`${d.label}：${d.detail}（不计入总分）`);
    // 只有规则要求词条评分时才提示（辅助口径不看词条，缺评分不是问题）
    if (!build.artiMark && (Number(rule.weights.mark) || 0) > 0) {
        notes.push('圣遗物评分：未取到 miao 词条评分（该角色规则要求词条，综合判待评）');
    }
    const rows = buildCompareRows(targets, build, { ...opts, rule, parts });
    const suggestionRows = buildSuggestionRows(targets, build, dims, compDim, { ...opts, rule, parts });
    const suggestions = suggestionRows.map(s => s.text);
    /*
     * `assessable`：只要有一个维度是**未知**（数据没取到），总分就不可信 —— 2026-10-15 UI 契约
     * （设计规格 §12.2 采用默认：必需计分数据未知时隐藏总分并标"待评"，仍展示已知维度；
     * **不改变分母**，因此这里只加标记，`total`/`rank` 的计算口径与旧版逐字一致）。
     * 攻略缺该项（`unscored`）不算未知：那是现行"不计入分母"的口径。
     */
    const assessable = scored.length > 0 && !dims.some(d => d.state === 'unknown');
    return {
        charName: targets.charName || build.charName,
        total: Number(total.toFixed(1)),
        rank: rankOf(total, opts.rankThresholds),
        dims,
        panelTier: panelInfo.tier,
        rows,
        suggestions,
        suggestionRows,
        assessable,
        notes,
        ruleName: opts.ruleName ?? 'auto',
        ruleSource: opts.ruleSource
    };
}
function cappedNote(targets, build, capped) {
    return capped === true && !!targets.levelMin && Number(build.level) < targets.levelMin;
}
/** 对比表（只列主词条，不列副词条） */
export function buildCompareRows(targets, build, opts = {}) {
    const rows = [];
    /** 行统一收口：补稳定键、四态与"是否计分"（页面证据号用稳定键关联，不用中文名） */
    const push = (row) => {
        const state = row.verdict === 'ok'
            ? 'met'
            : row.verdict === 'warn'
                ? 'below'
                : row.verdict === 'info' ? 'unscored' : 'unknown';
        rows.push({ ...row, state, scored: row.verdict !== 'info' });
    };
    // 武器（与 `scoreWeapon` 共用同一套候选解析：组合项 `A\B\C` 要能命中）
    if (targets.weapon.recommend.length || targets.weapon.optional.length) {
        const name = String(build.weapon?.name || '—');
        /*
         * 档位判定（2026-10-16 用户口径）：**推荐 ∪ 可选 = 达标**，只有**过渡**才是未达标。
         * 旧实现把"可选"也写成 `warn`，导致装备可选档武器时被列进"未达标项"。
         */
        const bucket = (matchesGuideName(name, targets.weapon.recommend) || matchesGuideName(name, targets.weapon.optional))
            ? 'ok'
            : matchesGuideName(name, targets.weapon.transition) ? 'warn' : 'off';
        push({
            id: 'weapon:choice',
            group: '武器',
            name,
            target: [targets.weapon.recommend.length ? `推荐：${targets.weapon.recommend.join(' / ')}` : '', targets.weapon.optional.length ? `可选：${targets.weapon.optional.join(' / ')}` : ''].filter(Boolean).join('\n'),
            actual: name,
            verdict: bucket
        });
    }
    /*
     * 2026-10-18 复审 R1：对比行的"套装是否达标"必须与计分**同一套判定**。
     * 旧写法只按"与推荐名有交集"判 ok，认不出 2+2（`2如雷 + 2宗室`）与效果型（`2精通+2精通`），
     * 结果页面说未达标、计分却按推荐给了 1.0。
     */
    if (targets.artifact.recommend.length || targets.artifact.optional.length) {
        const counts = new Map();
        for (const a of build.artis || [])
            counts.set(a.set, (counts.get(a.set) || 0) + 1);
        const hit = Boolean(matchSetSpec(targets.artifact.recommend, counts, opts.effectSets) ||
            matchSetSpec(targets.artifact.optional, counts, opts.effectSets));
        push({
            id: 'artifact:set',
            group: '综合',
            name: '套装',
            target: targets.artifact.recommend.join(' / ') || '—',
            actual: [...counts.entries()].map(([s, n]) => `${s}×${n}`).join(' / ') || '—',
            verdict: hit ? 'ok' : counts.size ? 'warn' : 'off'
        });
    }
    // 圣遗物词条评分（综合维度的主依据；走 miao 的评分规则）
    if (build.artiMark) {
        push({
            id: 'artifact:mark',
            group: '综合',
            name: '词条评分',
            target: '走 miao 规则（MAX…D）',
            actual: `${num(build.artiMark.total)}（${build.artiMark.markClass}）`,
            verdict: (MIAO_MARK_SCORE[String(build.artiMark.markClass).toUpperCase()] ?? 0) >= 0.8 ? 'ok' : 'warn'
        });
    }
    // 主词条（只展示，不单独计分）—— 条件项（`生命值（二命）`）按玩家命座判定
    for (const t of targets.mainStats) {
        const piece = (build.artis || []).find(a => a.slot === t.slot);
        const actual = piece?.mainName || '—';
        const ok = piece ? mainStatAcceptable(t, actual, Number(build.cons) || 0) : false;
        push({
            id: `artifact:main:${t.slot}`,
            group: '主词条',
            name: t.slot,
            target: t.options.join(' / '),
            actual,
            verdict: ok ? 'ok' : piece ? 'warn' : 'off'
        });
    }
    // 天赋
    for (const t of targets.talent) {
        const actual = Number(build.talent?.[t.key]) || 0;
        push({
            id: `talent:${t.key}`,
            group: '天赋',
            name: `${t.key}${t.crown ? '（皇冠）' : ''}`,
            target: String(t.target),
            actual: String(actual),
            verdict: actual >= t.target ? 'ok' : 'warn'
        });
    }
    // 命座（只提示，不计分）
    if (targets.consKeys.length) {
        push({
            id: 'cons:key',
            group: '命座',
            name: '关键命座',
            target: targets.consKeys.join(' / '),
            actual: `C${Number(build.cons) || 0}`,
            verdict: 'info'
        });
    }
    /*
     * 面板（2026-10-25：**由规则决定是否计分**）
     *
     * `dps` 权重里没有 panel → 只作参考（`info`，与 2026-10-15 口径一致）；
     * `subdps` / `support` / 自定义规则含 panel → 计入未达标项（多方向角色只算选中的方向）。
     */
    const rule = opts.rule;
    const parts = opts.parts ?? scoreParts(targets, build, opts);
    const panelScored = Boolean(rule && (Number(rule.weights.panel) || 0) > 0);
    for (const t of targets.panel) {
        const actual = build.attrs?.[t.attrKey];
        const unit = t.percent ? '%' : '';
        const dirs = t.groups.length ? t.groups : ['参考'];
        const inDirection = parts.panelDirection.length === 0 || dirs.some(d => parts.panelDirection.includes(d));
        let verdict = 'info';
        if (panelScored && inDirection) {
            verdict = !Number.isFinite(actual)
                ? 'off'
                : clamp01(Number(actual) / (t.min > 0 ? t.min : 1)) >= 0.999 ? 'ok' : 'warn';
        }
        push({
            // 稳定键**含方向**（审核 4.3）：同一属性在不同方向下是不同目标
            id: `panel:${dirs.join('+')}:${t.attrKey}`,
            group: t.groups.length ? t.groups.join('/') : '参考',
            name: t.name,
            target: `${t.max > t.min ? `${num(t.min)}~${num(t.max)}` : num(t.min)}${unit}`,
            actual: Number.isFinite(actual) ? `${num(Number(actual))}${unit}` : '—',
            verdict
        });
    }
    return rows;
}
/** 提升建议（按"投入产出"排序，最多 4 条） —— 返回带证据绑定的行；字符串版由它派生 */
export function buildSuggestionRows(targets, build, dims, compDim, opts = {}) {
    const out = [];
    const add = (id, text, evidenceIds) => {
        out.push({ id, text, evidenceIds: evidenceIds.filter(Boolean), priority: out.length + 1, priorityBasis: 'cost-step' });
    };
    // ① 天赋（投入最小）
    const talentMiss = targets.talent.filter(t => (Number(build.talent?.[t.key]) || 0) < t.target);
    if (talentMiss.length) {
        add('talent', `天赋：${talentMiss.map(t => `${t.key} ${Number(build.talent?.[t.key]) || 0}→${t.target}`).join('、')}（投入最小）`, talentMiss.map(t => `talent:${t.key}`));
    }
    // ② 主词条（圣遗物里最直接的一步）—— 与对比行同一判据（含命座条件），避免"页面说达标、建议让换"
    const mainMiss = targets.mainStats.filter(t => {
        const piece = (build.artis || []).find(a => a.slot === t.slot);
        return piece && !mainStatAcceptable(t, piece.mainName, Number(build.cons) || 0);
    });
    if (mainMiss.length) {
        add('mainstat', `主词条：${mainMiss.map(t => `${t.slot}换「${t.optionViews[0]?.name || t.options[0]}」`).join('、')}`, mainMiss.map(t => `artifact:main:${t.slot}`));
    }
    /*
     * ③ 综合（2026-10-25：按规则给「套装 / 词条 / 面板」里真正没过闸的那几项）
     *
     * 权重从高到低取最多 2 条；判据与对比行、计分完全同源（`scoreParts()`），
     * 不再出现「页面说达标、建议让换」或「未达标却建议提升词条」。
     */
    {
        const rule = opts.rule;
        const parts = opts.parts ?? scoreParts(targets, build, opts);
        if (compDim.ratio !== null && rule) {
            const weightOf = (k) => Number(rule.weights[k]) || 0;
            const floorOf = (k) => Number(rule.floors[k]);
            const ratioOf = (k) => (parts[k].ratio === null ? 1 : parts[k].ratio);
            const items = [];
            if (weightOf('set') > 0 && Number.isFinite(floorOf('set')) && ratioOf('set') < floorOf('set')) {
                const want = targets.artifact.recommend[0] || targets.artifact.optional[0] || '';
                const first = parseSetSpecs([want])[0];
                items.push({
                    id: 'artifact:set',
                    weight: weightOf('set'),
                    text: first?.kind === 'pair' ? `圣遗物：凑推荐 2+2（${first.label}）` : `圣遗物：凑「${want}」4 件`,
                    evidence: ['artifact:set']
                });
            }
            if (weightOf('mark') > 0 && Number.isFinite(floorOf('mark')) && ratioOf('mark') < floorOf('mark')) {
                items.push({
                    id: 'artifact:mark',
                    weight: weightOf('mark'),
                    text: '圣遗物：提升有效词条（暴击 / 爆伤 / 攻击等，按 miao 评分口径）',
                    evidence: ['artifact:mark']
                });
            }
            if (weightOf('panel') > 0 && Number.isFinite(floorOf('panel')) && ratioOf('panel') < floorOf('panel')) {
                const cons = Number(build.cons) || 0;
                const gaps = [];
                for (const t of targets.panel) {
                    if (!condSatisfied(t.cond, cons))
                        continue;
                    const actual = Number(build.attrs?.[t.attrKey]);
                    if (!Number.isFinite(actual))
                        continue;
                    const dirs = t.groups.length ? t.groups : ['参考'];
                    // 只给「计分方向」内的缺口提建议（另一方向仍在参考区，不催）
                    if (parts.panelDirection.length && !dirs.some(d => parts.panelDirection.includes(d)))
                        continue;
                    if (t.min > 0 && actual / t.min >= 0.999)
                        continue;
                    const unit = t.percent ? '%' : '';
                    gaps.push({
                        text: `${t.name} ${num(Number(actual))}${unit}→${num(t.min)}${unit}`,
                        id: `panel:${dirs.join('+')}:${t.attrKey}`
                    });
                }
                if (gaps.length) {
                    items.push({
                        id: 'panel',
                        weight: weightOf('panel'),
                        text: `面板：${gaps.slice(0, 2).map(g => g.text).join('、')}`,
                        evidence: gaps.slice(0, 2).map(g => g.id)
                    });
                }
            }
            items.sort((a, b) => b.weight - a.weight);
            for (const item of items.slice(0, 2))
                add(item.id, item.text, item.evidence);
        }
    }
    // ④ 武器
    const weaponDim = dims.find(d => d.key === 'weapon');
    if (weaponDim?.ratio !== null && weaponDim !== undefined && weaponDim.ratio < 0.75) {
        add('weapon', `武器：换到推荐档（${targets.weapon.recommend.slice(0, 2).join(' / ')}）`, ['weapon:choice']);
    }
    // 全部达标：不带证据号（页面显示"通用建议"，不编造 E 号）
    /*
     * 2026-10-17 复审修复（#1）：只有**全部维度都真的达标**才说"均已达标"；
     * 有维度是 unknown（数据没取到）时给补数据提示，绝不把"没数据"说成"已达标"。
     */
    if (!out.length) {
        const hasUnknown = dims.some(d => d.state === 'unknown');
        const below = dims.filter(d => d.state === 'below');
        /*
         * 2026-10-18 复审 R2：兜底文案必须跟**维度真实状态**一致 ——
         * 之前只排除 unknown，`综合 92% (below)` + 武器/天赋达标 时会打出「各维度均已达标」，
         * 与 02 三维里的「!未达标」自相矛盾。现在低于达标线的维度一律不算"已达标"。
         */
        if (hasUnknown)
            add('data-gap', '数据不全：先补上缺失的装备 / 圣遗物信息再评估，暂不判定达标', ['data-gap']);
        else if (below.length)
            add('below-kept', `未达标：${below.map(d => `${d.label} ${Math.round((d.ratio ?? 0) * 100)}%`).join('、')}（按上面的对比项逐条优化）`, ['below-kept']);
        else
            add('all-met', '各维度均已达标', []);
    }
    return out.slice(0, 4);
}
/** 兼容入口：只要文本（旧模板 / 文本回退用） */
export function buildSuggestions(targets, build, dims, compDim) {
    return buildSuggestionRows(targets, build, dims, compDim).map(s => s.text);
}
/** 把配置里的 `panel:30,weapon:20` 这类紧凑写法解析成对象（非法项忽略） */ export function parseSpec(spec, keys) {
    const out = {};
    for (const part of String(spec || '').split(/[,，;；\s]+/)) {
        const [k, v] = part.split(/[:：=]/);
        const key = String(k || '').trim();
        const value = Number(String(v || '').trim());
        if (!key || !Number.isFinite(value) || !keys.includes(key))
            continue;
        out[key] = value;
    }
    return out;
}
/** 解析九档阈值写法 `MAX:95,ACE:88,…`（失败则回落默认） */
export function parseRankThresholds(spec) {
    const parsed = parseSpec(spec, DEFAULT_RANK_THRESHOLDS.map(([n]) => n));
    if (!Object.keys(parsed).length)
        return DEFAULT_RANK_THRESHOLDS;
    return DEFAULT_RANK_THRESHOLDS.map(([name, def]) => [name, Number.isFinite(parsed[name]) ? parsed[name] : def]);
}
//# sourceMappingURL=grade.js.map