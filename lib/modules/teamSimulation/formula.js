import { amplifyingFactor, catalyzeBonus, describeMismatch, isReactiveKind, isStatefulKind, reactionClass, reactionCoefficient, reactionLabel, statefulReason } from './reactions.js';
/** 只读测试目标口径：等级与抗性是固定常量，调用方不能传别的数值冒充同一目标。 */
export const TARGET_PRESETS = {
    'dummy-lv100': { id: 'dummy-lv100', level: 100, resistance: 0.1, defenseRule: 'standard', health: 'infinite', stationary: true },
    /* 队伍 DPS 的固定标准目标：110 级遗迹守卫（小宝），10% 抗性。口径写死在常量里，调用方不得覆盖。 */
    'ruin-guard-lv110': { id: 'ruin-guard-lv110', level: 110, resistance: 0.1, defenseRule: 'standard', health: 'infinite', stationary: true }
};
const REACTION_ELEMENTS = ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
/** 抗性乘区：负抗按 1 - r/2 放大且不截断，75% 以上按 1/(1+4r) 衰减。 */
export function resistanceMultiplier(resistance) {
    return resistance < 0 ? 1 - resistance / 2 : resistance >= 0.75 ? 1 / (1 + 4 * resistance) : 1 - resistance;
}
/** 单次直伤：`reaction: 'none'` 是普通直伤，其余走 reactions.ts 的倍率与精通曲线。 */
export function calculateOrdinaryHit(input) {
    const issues = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'hit', message: '伤害输入必须是对象' }] };
    }
    const h = input;
    const issue = (code, path, message) => issues.push({ code, path, message });
    for (const [key, allowed] of [['kind', ['ordinary']], ['crit', ['expected', 'critical', 'non-critical']]]) {
        const value = h[key];
        if (value === undefined)
            issue('missing', key, '必须显式提供');
        else if (!allowed.includes(value))
            issue('unsupported', key, '不支持此取值');
    }
    for (const key of ['gameVersion', 'source']) {
        if (h[key] === undefined)
            issue('missing', key, '必须显式提供');
        else if (typeof h[key] !== 'string' || !h[key].trim())
            issue('invalid', key, '必须是非空字符串');
    }
    if (h.canCrit === undefined)
        issue('missing', 'canCrit', '必须显式提供');
    else if (typeof h.canCrit !== 'boolean')
        issue('invalid', 'canCrit', '必须是布尔值');
    const numeric = ['additiveBase', 'damageBonus', 'critRate', 'critDamage', 'attackerLevel', 'enemyLevel', 'defenseReduction', 'defenseIgnore', 'resistance', 'resistanceReduction'];
    for (const key of numeric) {
        const value = h[key];
        if (value === undefined)
            issue('missing', key, '必须显式提供');
        else if (typeof value !== 'number' || !Number.isFinite(value))
            issue('invalid', key, '必须是有限数值');
        else if (['additiveBase', 'critRate', 'critDamage', 'attackerLevel', 'enemyLevel', 'defenseReduction', 'defenseIgnore'].includes(key) && value < 0)
            issue('invalid', key, '不得为负数');
    }
    for (const key of ['attackerLevel', 'enemyLevel']) {
        if (typeof h[key] === 'number' && Number.isFinite(h[key]) && !Number.isInteger(h[key]))
            issue('invalid', key, '等级必须是整数');
    }
    if (h.defenseReduction > 1)
        issue('invalid', 'defenseReduction', '减防比例必须在 0..1；0.9以上按上限计算');
    if (h.defenseIgnore > 1)
        issue('invalid', 'defenseIgnore', '无视防御必须在 0..1');
    // 反应：只接受 reactions.ts 建模的种类；剧变的伤害段由 hitDamage 另起一行，不走这里。
    const reaction = h.reaction;
    if (reaction === undefined)
        issue('missing', 'reaction', '必须显式提供（无反应写 none）');
    else if (reaction !== 'none') {
        if (isStatefulKind(reaction))
            issue('unsupported', 'reaction', `P1 不建模：${statefulReason(reaction)}`);
        else if (!isReactiveKind(reaction))
            issue('unsupported', 'reaction', '不支持的反应');
        else {
            if (h.element === undefined)
                issue('missing', 'element', '反应需要显式给出触发元素');
            else if (!REACTION_ELEMENTS.includes(h.element))
                issue('unsupported', 'element', `元素 ${h.element} 不参与元素反应`);
            if (h.aura === undefined)
                issue('missing', 'aura', '反应需要显式给出附着元素');
            else if (!REACTION_ELEMENTS.includes(h.aura))
                issue('unsupported', 'aura', `附着元素 ${h.aura} 不参与元素反应`);
            if (h.mastery === undefined)
                issue('missing', 'mastery', '反应需要显式给出精通');
            else if (typeof h.mastery !== 'number' || !Number.isFinite(h.mastery) || h.mastery < 0)
                issue('invalid', 'mastery', '精通必须是非负有限数值');
            if (reactionClass(reaction) === 'transformative')
                issue('unsupported', 'reaction', `${reactionLabel(reaction)}是剧变反应，伤害是独立的一段，不走直伤公式`);
            if (h.element && h.aura && REACTION_ELEMENTS.includes(h.element) && REACTION_ELEMENTS.includes(h.aura)) {
                const mismatch = describeMismatch(reaction, h.element, h.aura);
                if (mismatch)
                    issue('invalid', 'reaction', mismatch);
            }
            if (reactionCoefficient(h.attackerLevel) === undefined)
                issue('unsupported', 'attackerLevel', `等级 ${h.attackerLevel} 不在反应系数表内`);
        }
    }
    // 绑定目标口径时，等级与抗性必须等于预设值；否则结果会带着目标名字却算的是别的数值。
    const preset = h.targetId === undefined ? undefined : TARGET_PRESETS[h.targetId];
    if (h.targetId !== undefined) {
        if (typeof h.targetId !== 'string' || !preset)
            issue('unsupported', 'targetId', '不支持的测试目标');
        else {
            if (h.enemyLevel !== preset.level)
                issue('invalid', 'enemyLevel', `目标 ${preset.id} 的等级必须是 ${preset.level}`);
            if (h.resistance !== preset.resistance)
                issue('invalid', 'resistance', `目标 ${preset.id} 的抗性必须是 ${preset.resistance}`);
        }
    }
    if (h.damageBonus < -1)
        issue('invalid', 'damageBonus', '伤害加成不得使乘区为负');
    if (!Array.isArray(h.scaling))
        issue(h.scaling === undefined ? 'missing' : 'invalid', 'scaling', '必须显式提供倍率数组');
    else {
        if (!h.scaling.length)
            issue('invalid', 'scaling', '倍率数组不得为空');
        h.scaling.forEach((term, i) => {
            for (const key of ['stat', 'multiplier']) {
                const value = term && term[key];
                if (value === undefined)
                    issue('missing', `scaling.${i}.${key}`, '必须显式提供');
                else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
                    issue('invalid', `scaling.${i}.${key}`, '必须是非负有限数值');
            }
        });
    }
    if (issues.length)
        return { status: issues.some(i => i.code === 'invalid') ? 'invalid' : issues.some(i => i.code === 'unsupported') ? 'unsupported' : 'incomplete', issues };
    let base = h.scaling.reduce((sum, term) => sum + term.stat * term.multiplier, h.additiveBase);
    let reactionFactor = 1;
    if (reaction !== 'none' && isReactiveKind(reaction)) {
        if (reactionClass(reaction) === 'amplifying') {
            // 增幅：2.0 / 1.5 的倍率乘上精通曲线，整体乘在基础伤害上。
            reactionFactor = amplifyingFactor(reaction, h.element, h.aura, h.mastery ?? 0) ?? 1;
            base *= reactionFactor;
        }
        else if (reactionClass(reaction) === 'catalyze') {
            // 激化：加成直接加进基础伤害区，随后一起过增伤、暴击与防御。
            base += catalyzeBonus(reaction, h.attackerLevel, h.mastery ?? 0) ?? 0;
        }
    }
    const effectiveCritRate = Math.min(1, Math.max(0, h.critRate));
    const crit = !h.canCrit || h.crit === 'non-critical' ? 1 : h.crit === 'critical' ? 1 + h.critDamage : 1 + effectiveCritRate * h.critDamage;
    const effectiveDefenseReduction = Math.min(0.9, h.defenseReduction);
    const defense = (h.attackerLevel + 100) / ((h.attackerLevel + 100) + (h.enemyLevel + 100) * (1 - effectiveDefenseReduction) * (1 - h.defenseIgnore));
    const effectiveResistance = h.resistance - h.resistanceReduction;
    const resistance = resistanceMultiplier(effectiveResistance);
    const factors = { base, damageBonus: 1 + h.damageBonus, crit, defense, resistance, reaction: reactionFactor, effectiveCritRate, effectiveDefenseReduction, effectiveResistance };
    const damage = base * factors.damageBonus * crit * defense * resistance;
    if (base < 0 || !Number.isFinite(damage) || !Object.values(factors).every(Number.isFinite)) {
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'result', message: '计算产生负基础伤害或非有限数值' }] };
    }
    const hasReaction = reaction !== undefined && reaction !== 'none';
    return {
        status: 'calculated',
        scope: hasReaction ? 'ordinary-hit-with-reaction' : 'ordinary-hit-no-reaction',
        damage,
        factors,
        target: { id: preset?.id ?? 'custom', level: preset?.level ?? h.enemyLevel, resistance: preset?.resistance ?? h.resistance },
        gameVersion: h.gameVersion,
        source: h.source
    };
}
//# sourceMappingURL=formula.js.map