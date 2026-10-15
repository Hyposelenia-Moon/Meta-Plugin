/**
 * grade — 练度评分器（v3 P2「提升指南」的核心）
 *
 * 设计口径（用户 2026-10-13 定，见 v3 方案 §4）：
 *   - **总体练度**：四维加权（面板 / 武器 / 圣遗物 / 天赋）→ 0~100 → `MAX…D` 九档
 *   - **面板**单独再给三档：大毕业 / 毕业 / 小毕业
 *   - **命座不计分**（抽卡结果，不是"练"出来的），只作提示
 *   - **等级作门槛**：未达攻略「建议等级」时，面板档最高「小毕业」
 *   - **攻略缺该项不扣分**：该维度不计入分母（权重重归一）
 *
 * 本模块**纯函数**：不读文件、不联网、不引 miao —— 攻略目标与玩家配装都由调用方准备好，
 * 因此可以用合成数据完整单测（`test/grade.test.mjs`）。
 *
 * 关于"面板与圣遗物重复计分"（用户 2026-10-13 修正）：面板数值本来就是圣遗物词条的产物，
 * 所以圣遗物维度**不再单列主词条得分**，而是「套装符合度 × 0.4 + miao 圣遗物评分档位 × 0.6」；
 * 主词条只在对比表里展示与提示。
 */
/** 默认权重（配置项 `gradeWeights` 可覆盖；权重会按"可评维度"归一） */
export const DEFAULT_WEIGHTS = {
    panel: 30,
    weapon: 20,
    artifact: 35,
    talent: 15
};
/** 面板三档阈值（配置项 `gradePanelTiers` 可覆盖） */
export const DEFAULT_PANEL_TIERS = { big: 0.9, normal: 0.6, small: 0.3 };
/** 九档阈值：分数 ≥ 阈值即该档（配置项 `gradeRankThresholds` 可覆盖） */
export const DEFAULT_RANK_THRESHOLDS = [
    ['MAX', 95], ['ACE', 88], ['SSS', 80], ['SS', 72], ['S', 64], ['A', 55], ['B', 45], ['C', 30]
];
/** miao 圣遗物评分档位 → 0~1（与 miao `ArtisMark.getMarkClass` 的档位一一对应） */
export const MIAO_MARK_SCORE = {
    MAX: 1, ACE: 0.95, SSS: 0.9, SS: 0.8, S: 0.7, A: 0.55, B: 0.4, C: 0.25, D: 0.1
};
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
        for (const item of row.items || []) {
            const text = String(item.text || '').trim();
            const idx = text.search(/[:：]/);
            if (idx < 0)
                continue;
            const name = text.slice(0, idx).trim();
            const attrKey = PANEL_ATTR_KEY[name] || (ELEM_DMG_RE.test(name) ? 'dmg' : '');
            if (!attrKey)
                continue;
            const range = parseTargetRange(text.slice(idx + 1));
            if (!range)
                continue;
            targets.panel.push({ raw: text, name, attrKey, min: range.min, max: range.max });
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
            if (sets.length && ['preferred', 'optional', 'transition', ''].includes(kind)) {
                const bucket = kind === 'preferred' || kind === '' ? targets.artifact.recommend : targets.artifact.optional;
                for (const s of sets) {
                    const name = String(s?.name ?? s ?? '').trim();
                    if (name)
                        bucket.push(name);
                }
                continue;
            }
            if (kind === 'main' && row?.stats && typeof row.stats === 'object') {
                for (const [slot, raw] of Object.entries(row.stats)) {
                    const options = (Array.isArray(raw) ? raw : [raw]).map(x => String(x).trim()).filter(Boolean);
                    const slotName = String(slot).trim();
                    if (slotName && options.length)
                        targets.mainStats.push({ slot: slotName, options });
                }
            }
            // `sub` / `text`：副词条与自由文本只用于展示与建议，不参与这里的评分口径
        }
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
                    targets.mainStats.push({
                        slot: text.slice(0, idx).trim(),
                        options: text.slice(idx + 1).split('/').map(s => s.trim()).filter(Boolean)
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
    return targets;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
/* ------------------------------------------------------------------ *
 * 评分
 * ------------------------------------------------------------------ */
function scorePanel(targets, build) {
    const label = '面板';
    if (!targets.panel.length) {
        return { key: 'panel', label, ratio: null, weight: 0, detail: '该角色攻略没有面板目标' };
    }
    let sum = 0;
    let worst = { name: '', ratio: 1 };
    for (const t of targets.panel) {
        const actual = build.attrs?.[t.attrKey];
        let ratio;
        if (!Number.isFinite(actual)) {
            ratio = 0;
        }
        else if (t.max > t.min) {
            ratio = clamp01((Number(actual) - t.min) / (t.max - t.min));
        }
        else {
            ratio = clamp01(Number(actual) / (t.min || 1));
        }
        sum += ratio;
        if (ratio < worst.ratio)
            worst = { name: t.name, ratio };
    }
    const ratio = sum / targets.panel.length;
    return {
        key: 'panel',
        label,
        ratio,
        weight: 0,
        detail: `${targets.panel.length} 项平均达成 ${pct(ratio)}` + (worst.name && worst.ratio < 1 ? `，最短板：${worst.name}` : '')
    };
}
function scoreWeapon(targets, build) {
    const label = '武器';
    const all = [...targets.weapon.recommend, ...targets.weapon.optional, ...targets.weapon.transition];
    if (!all.length)
        return { key: 'weapon', label, ratio: null, weight: 0, detail: '该角色攻略没有武器目标' };
    const name = String(build.weapon?.name || '');
    if (!name)
        return { key: 'weapon', label, ratio: 0, weight: 0, detail: '未读取到武器' };
    const inBucket = (list) => list.some(w => w === name || w.includes(name) || name.includes(w));
    if (inBucket(targets.weapon.recommend)) {
        const sig = targets.weapon.recommend[0] === name;
        return { key: 'weapon', label, ratio: 1, weight: 0, detail: `推荐档：${name}${sig ? '（专武，不加分）' : ''}` };
    }
    if (inBucket(targets.weapon.optional))
        return { key: 'weapon', label, ratio: 0.75, weight: 0, detail: `可选档：${name}` };
    if (inBucket(targets.weapon.transition))
        return { key: 'weapon', label, ratio: 0.5, weight: 0, detail: `过渡档：${name}` };
    return { key: 'weapon', label, ratio: 0.25, weight: 0, detail: `不在攻略推荐内：${name}` };
}
function scoreArtifact(targets, build) {
    const label = '圣遗物';
    const artis = build.artis || [];
    const hasTarget = targets.artifact.recommend.length > 0 || targets.artifact.optional.length > 0;
    // 攻略里没有套装目标 → 该维度不计分（与"缺项不扣分"同一口径）
    if (!hasTarget && !targets.mainStats.length) {
        return { key: 'artifact', label, ratio: null, weight: 0, detail: '该角色攻略没有套装目标（不计分）' };
    }
    if (!artis.length && !build.artiMark) {
        return { key: 'artifact', label, ratio: null, weight: 0, detail: '未读取到圣遗物' };
    }
    // 套装符合度
    const count = new Map();
    for (const a of artis)
        count.set(a.set, (count.get(a.set) || 0) + 1);
    const hit = (list) => [...count.entries()].filter(([set]) => list.some(s => s === set || s.includes(set) || set.includes(s)));
    const rec4 = hit(targets.artifact.recommend).find(([, n]) => n >= 4);
    const opt4 = hit(targets.artifact.optional).find(([, n]) => n >= 4);
    const pairs = [...hit(targets.artifact.recommend), ...hit(targets.artifact.optional)].filter(([, n]) => n >= 2);
    let setScore = 0.3;
    let setNote = '套装不在攻略推荐内';
    if (rec4) {
        setScore = 1;
        setNote = `推荐套装 4 件（${rec4[0]}）`;
    }
    else if (opt4) {
        setScore = 0.8;
        setNote = `可选套装 4 件（${opt4[0]}）`;
    }
    else if (new Set(pairs.map(([s]) => s)).size >= 2) {
        setScore = 0.7;
        setNote = `2+2 组合（${pairs.map(([s]) => s).join(' + ')}）`;
    }
    // miao 评分档位
    const markClass = String(build.artiMark?.markClass || '').toUpperCase();
    const markScore = MIAO_MARK_SCORE[markClass];
    const hasMark = Number.isFinite(markScore);
    // 没读到圣遗物明细（只有评分）时就只按评分算，避免"套装不在表内"被误判成 0.3
    const ratio = !artis.length && hasMark ? markScore : hasMark ? 0.4 * setScore + 0.6 * markScore : setScore;
    const markNote = hasMark
        ? `miao 评分 ${num(Number(build.artiMark?.total) || 0)}（${markClass}）`
        : '未取到 miao 评分（只按套装计）';
    return { key: 'artifact', label, ratio, weight: 0, detail: `${setNote}；${markNote}` };
}
function scoreTalent(targets, build) {
    const label = '天赋';
    if (!targets.talent.length)
        return { key: 'talent', label, ratio: null, weight: 0, detail: '该角色攻略没有天赋目标' };
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
        detail: miss.length ? `未达标：${miss.join('、')}` : '全部达标'
    };
}
/** 面板档（含等级门槛：未达建议等级 → 最高「小毕业」） */
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
    const dims = [scorePanel(targets, build), scoreWeapon(targets, build), scoreArtifact(targets, build), scoreTalent(targets, build)];
    // 只对"有目标"的维度加权（缺项不扣分），权重重归一
    const scored = dims.filter(d => d.ratio !== null);
    const weightSum = scored.reduce((s, d) => s + (Number(weights[d.key]) || 0), 0);
    for (const d of dims)
        d.weight = d.ratio === null ? 0 : (Number(weights[d.key]) || 0) / (weightSum || 1);
    const total = scored.length ? scored.reduce((s, d) => s + d.ratio * d.weight, 0) * 100 : 0;
    const panelDim = dims.find(d => d.key === 'panel');
    const panelInfo = panelTierOf(panelDim.ratio, build, targets, opts.panelTiers);
    const notes = [];
    if (cappedNote(targets, build, panelInfo.capped)) {
        notes.push(`等级 ${build.level} 未达建议等级 ${targets.levelText}（面板档按门槛最高「小毕业」）`);
    }
    for (const d of dims)
        if (d.ratio === null)
            notes.push(`${d.label}：${d.detail}（不计入总分）`);
    if (!build.artiMark)
        notes.push('圣遗物评分：未取到 miao 评分，本次只按套装计分');
    const rows = buildCompareRows(targets, build);
    const suggestions = buildSuggestions(targets, build, dims, panelDim);
    return {
        charName: targets.charName || build.charName,
        total: Number(total.toFixed(1)),
        rank: rankOf(total, opts.rankThresholds),
        dims,
        panelTier: panelInfo.tier,
        rows,
        suggestions,
        notes
    };
}
function cappedNote(targets, build, capped) {
    return capped === true && !!targets.levelMin && Number(build.level) < targets.levelMin;
}
/** 对比表（只列主词条，不列副词条） */
export function buildCompareRows(targets, build) {
    const rows = [];
    // 武器（与 `scoreWeapon` 共用同一套候选解析：组合项 `A\B\C` 要能命中）
    if (targets.weapon.recommend.length || targets.weapon.optional.length) {
        const name = String(build.weapon?.name || '—');
        const bucket = matchesGuideName(name, targets.weapon.recommend)
            ? 'ok'
            : matchesGuideName(name, targets.weapon.optional)
                ? 'warn'
                : matchesGuideName(name, targets.weapon.transition) ? 'warn' : 'off';
        rows.push({
            group: '武器',
            name,
            target: [targets.weapon.recommend.length ? `推荐：${targets.weapon.recommend.join(' / ')}` : '', targets.weapon.optional.length ? `可选：${targets.weapon.optional.join(' / ')}` : ''].filter(Boolean).join('；'),
            actual: name,
            verdict: bucket
        });
    }
    // 套装
    if (targets.artifact.recommend.length || targets.artifact.optional.length) {
        const sets = [...new Set((build.artis || []).map(a => a.set))].filter(Boolean);
        const hit = sets.some(s => matchesGuideName(s, targets.artifact.recommend));
        rows.push({
            group: '圣遗物',
            name: '套装',
            target: targets.artifact.recommend.join(' / ') || '—',
            actual: sets.map(s => `${s}×${(build.artis || []).filter(a => a.set === s).length}`).join(' / ') || '—',
            verdict: hit ? 'ok' : sets.length ? 'warn' : 'off'
        });
    }
    // 圣遗物评分
    if (build.artiMark) {
        rows.push({
            group: '圣遗物',
            name: 'miao 评分',
            target: '走 miao 规则（MAX…D）',
            actual: `${num(build.artiMark.total)}（${build.artiMark.markClass}）`,
            verdict: (MIAO_MARK_SCORE[String(build.artiMark.markClass).toUpperCase()] ?? 0) >= 0.8 ? 'ok' : 'warn'
        });
    }
    // 主词条（只展示，不单独计分）
    for (const t of targets.mainStats) {
        const piece = (build.artis || []).find(a => a.slot === t.slot);
        const actual = piece?.mainName || '—';
        rows.push({
            group: '主词条',
            name: t.slot,
            target: t.options.join(' / '),
            actual,
            verdict: t.options.includes(actual) ? 'ok' : piece ? 'warn' : 'off'
        });
    }
    // 天赋
    for (const t of targets.talent) {
        const actual = Number(build.talent?.[t.key]) || 0;
        rows.push({
            group: '天赋',
            name: `${t.key}${t.crown ? '（皇冠）' : ''}`,
            target: String(t.target),
            actual: String(actual),
            verdict: actual >= t.target ? 'ok' : 'warn'
        });
    }
    // 命座（只提示，不计分）
    if (targets.consKeys.length) {
        rows.push({
            group: '命座',
            name: '关键命座',
            target: targets.consKeys.join(' / '),
            actual: `C${Number(build.cons) || 0}`,
            verdict: 'info'
        });
    }
    // 面板
    for (const t of targets.panel) {
        const actual = build.attrs?.[t.attrKey];
        const inRange = Number.isFinite(actual) && Number(actual) >= t.min;
        rows.push({
            group: '面板',
            name: t.name,
            target: t.max > t.min ? `${num(t.min)}~${num(t.max)}` : num(t.min),
            actual: Number.isFinite(actual) ? num(Number(actual)) : '—',
            verdict: inRange ? 'ok' : Number.isFinite(actual) ? 'warn' : 'off'
        });
    }
    return rows;
}
/** 提升建议（按"投入产出"排序，最多 4 条） */
export function buildSuggestions(targets, build, dims, panelDim) {
    const out = [];
    // ① 天赋（投入最小）
    const talentMiss = targets.talent.filter(t => (Number(build.talent?.[t.key]) || 0) < t.target);
    if (talentMiss.length) {
        out.push(`天赋：${talentMiss.map(t => `${t.key} ${Number(build.talent?.[t.key]) || 0}→${t.target}`).join('、')}（投入最小）`);
    }
    // ② 主词条（圣遗物里最直接的一步）
    const mainMiss = targets.mainStats.filter(t => {
        const piece = (build.artis || []).find(a => a.slot === t.slot);
        return piece && !t.options.includes(piece.mainName);
    });
    if (mainMiss.length) {
        out.push(`主词条：${mainMiss.map(t => `${t.slot}换「${t.options[0]}」`).join('、')}`);
    }
    // ③ 面板短板
    if (panelDim.ratio !== null && panelDim.ratio < 1) {
        let worst = null;
        let worstRatio = 1;
        for (const t of targets.panel) {
            const actual = build.attrs?.[t.attrKey];
            const ratio = !Number.isFinite(actual)
                ? 0
                : t.max > t.min ? clamp01((Number(actual) - t.min) / (t.max - t.min)) : clamp01(Number(actual) / (t.min || 1));
            if (ratio < worstRatio) {
                worst = t;
                worstRatio = ratio;
            }
        }
        if (worst) {
            const actual = build.attrs?.[worst.attrKey];
            out.push(`面板：${worst.name} ${Number.isFinite(actual) ? num(Number(actual)) : '—'} → 目标 ${worst.max > worst.min ? `${num(worst.min)}~${num(worst.max)}` : num(worst.min)}`);
        }
    }
    // ④ 武器 / 套装
    const weaponDim = dims.find(d => d.key === 'weapon');
    if (weaponDim?.ratio !== null && weaponDim !== undefined && weaponDim.ratio < 0.75) {
        out.push(`武器：换到推荐档（${targets.weapon.recommend.slice(0, 2).join(' / ')}）`);
    }
    const artifactDim = dims.find(d => d.key === 'artifact');
    if (artifactDim && artifactDim.ratio !== null && artifactDim.ratio !== undefined && targets.artifact.recommend.length) {
        // 套装覆盖与词条质量**分开判断**：已经穿着推荐 4 件套时不该再建议"凑四件套"，
        // 分数低应归因到词条质量（2026-10-15 外部复核第 6 项发现）
        const counts = new Map();
        for (const a of build.artis || [])
            counts.set(a.set, (counts.get(a.set) || 0) + 1);
        const covered = [...counts.entries()].some(([set, n]) => n >= 4 && matchesGuideName(set, targets.artifact.recommend));
        if (!covered) {
            out.push(`圣遗物：凑「${targets.artifact.recommend[0]}」4 件`);
        }
        else if (artifactDim.ratio < 0.6) {
            out.push('圣遗物：套装已达标，提升词条质量（暴击 / 爆伤 / 有效词条数）');
        }
    }
    if (!out.length)
        out.push('各维度均已达标：可继续提升面板词条质量　〔看词条〕');
    return out.slice(0, 4);
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