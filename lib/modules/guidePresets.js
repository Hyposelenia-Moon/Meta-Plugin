export const PRESET_WEIGHTS = {
    dps: { artifact: 30, panel: 30, weapon: 20, talent: 20 },
    support: { artifact: 0, panel: 50, weapon: 25, talent: 25 }
};
/** 名称信号先于属性比例；西风辅助的暴击需求不能把它分类为输出。 */
export function normalizeRuleRole(value) {
    const text = String(value || '').trim();
    if (/纯辅|辅助|治疗|奶妈|护盾|盾辅|增伤|充能辅|西风.*辅|support|healer/i.test(text))
        return 'support';
    if (/输出|主[Cc]|副[Cc]|站场|速切|伤害|dps/i.test(text))
        return 'dps';
    return null;
}
export function presetWeights(preset) {
    const weights = { ...PRESET_WEIGHTS[preset.role] };
    for (const key of Object.keys(weights)) {
        const value = preset.weights?.[key];
        if (value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0)
            weights[key] = Number(value);
    }
    return weights;
}
export function listGuidePresets(guide) {
    if (Array.isArray(guide.presets)) {
        return guide.presets.filter(p => p && typeof p === 'object').map((raw, index) => {
            const p = raw;
            return {
                ...p, id: String(p.id || `preset-${index + 1}`), name: String(p.name || `预设${index + 1}`),
                role: p.role === 'support' ? 'support' : 'dps',
                meta: p.meta && typeof p.meta === 'object' ? p.meta : {},
                v2: p.v2 && typeof p.v2 === 'object' ? p.v2 : {}
            };
        });
    }
    return [{
            id: 'default', name: '默认', role: normalizeRuleRole(guide.meta?.定位) || 'dps',
            meta: guide.meta || {}, v2: guide.v2 || {},
            freeModules: guide.freeModules,
            topConstellations: guide.topConstellations,
            unparsed: guide.unparsed
        }];
}
export function selectGuidePreset(guide, selected) {
    const preset = typeof selected === 'string'
        ? listGuidePresets(guide).find(p => p.id === selected || p.name === selected) : selected;
    if (!preset)
        throw new Error(`不存在攻略预设：${String(selected)}`);
    const { presets: _presets, meta: _meta, v2: _v2, freeModules: _free, topConstellations: _top, unparsed: _unparsed, ...common } = guide;
    return { ...common, schema: 2, meta: structuredClone(preset.meta), v2: structuredClone(preset.v2),
        freeModules: structuredClone(preset.freeModules || []), topConstellations: structuredClone(preset.topConstellations || []),
        unparsed: structuredClone(preset.unparsed || {}), presetId: preset.id, presetName: preset.name, presetRole: preset.role };
}
/** 明确指定 → 规则精确名/正则 → 规则名称方向 → 属性权重 → 单预设；歧义始终返回候选。 */
export function matchGuidePreset(guide, input = {}) {
    const presets = listGuidePresets(guide);
    const choose = (hits, reason) => ({ preset: hits.length === 1 ? hits[0] : null, reason, candidates: hits.length ? hits : presets });
    if (input.requested)
        return choose(presets.filter(p => p.name === input.requested || p.id === input.requested), '手动指定');
    const title = String(input.ruleTitle || '').trim();
    if (title) {
        const names = presets.filter(p => p.match?.names?.some(n => n === title));
        if (names.length)
            return choose(names, 'miao 规则名称');
        const patterns = presets.filter(p => p.match?.patterns?.some(pattern => {
            // 编辑器保存时也校验；运行时忽略无效或过长模式，异常不得中断查询。
            if (!pattern || pattern.length > 256)
                return false;
            try {
                return new RegExp(pattern, 'iu').test(title.slice(0, 512));
            }
            catch {
                return false;
            }
        }));
        if (patterns.length)
            return choose(patterns, 'miao 规则正则');
        const role = normalizeRuleRole(title);
        if (role && presets.length > 1)
            return choose(presets.filter(p => p.role === role), 'miao 规则方向');
    }
    if (presets.length === 1)
        return choose(presets, '单预设');
    const weights = input.charWeight;
    if (weights) {
        const sum = (keys) => keys.reduce((n, k) => n + Math.max(0, Number(weights[k]) || 0), 0);
        const out = sum(['atk', 'cpct', 'cdmg', 'dmg', 'phy']);
        const utility = sum(['hp', 'def', 'mastery', 'recharge', 'heal']);
        if (out + utility > 0)
            return choose(presets.filter(p => p.role === (out / (out + utility) >= 0.5 ? 'dps' : 'support')), 'miao 属性权重');
    }
    return choose([], '无法唯一匹配');
}
//# sourceMappingURL=guidePresets.js.map