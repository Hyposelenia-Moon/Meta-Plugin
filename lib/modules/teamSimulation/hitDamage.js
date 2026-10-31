import { calculateOrdinaryHit, TARGET_PRESETS } from './formula.js';
import { applyPanelModifiers } from './effects.js';
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
/** 元素命中只读该元素的加成键，物理命中只读物理键；`dmg` 是通用元素伤害加成。 */
function damageBonusFor(element, stats) {
    return element === 'physical' ? stats.phy : stats.dmg + stats[element];
}
function statFor(scaling, stats) {
    return scaling === 'atk' ? stats.atk : scaling === 'hp' ? stats.hp : stats.def;
}
function validateContext(context, prefix) {
    const issues = [];
    const add = (code, path, message) => issues.push({ code, path, message });
    if (!context || typeof context !== 'object')
        return [{ code: 'missing', path: prefix, message: '伤害上下文缺失' }];
    if (!Number.isInteger(context.level) || context.level < 1)
        add('invalid', `${prefix}.level`, '等级必须是正整数');
    if (!['expected', 'critical', 'non-critical'].includes(context.crit))
        add('unsupported', `${prefix}.crit`, `未知暴击口径 ${String(context.crit)}`);
    for (const key of ['gameVersion', 'source']) {
        const value = context[key];
        if (typeof value !== 'string' || !value.trim())
            add('invalid', `${prefix}.${key}`, '必须是非空字符串');
    }
    if (typeof context.targetPresetId !== 'string' || !TARGET_PRESETS[context.targetPresetId])
        add('unsupported', `${prefix}.targetPresetId`, `不支持的测试目标 ${String(context.targetPresetId)}`);
    const stats = context.stats;
    if (!stats || typeof stats !== 'object')
        add('missing', `${prefix}.stats`, '必须提供已算好的永久面板');
    else {
        for (const key of ['hp', 'atk', 'def', 'cpct', 'cdmg', 'dmg', 'phy', 'geo']) {
            if (!isFiniteNumber(stats[key]) || stats[key] < 0)
                add('invalid', `${prefix}.stats.${key}`, '面板数值必须是非负有限值');
        }
    }
    const debuffs = context.debuffs;
    if (!debuffs || typeof debuffs !== 'object')
        add('missing', `${prefix}.debuffs`, '必须显式提供队伍减益，P1 传 0');
    else {
        for (const key of ['defenseReduction', 'defenseIgnore', 'resistanceReduction']) {
            if (!isFiniteNumber(debuffs[key]))
                add('missing', `${prefix}.debuffs.${key}`, '必须显式给出数值，P1 传 0');
            else if (debuffs[key] !== 0)
                add('unsupported', `${prefix}.debuffs.${key}`, 'P1 没有建模队伍减防/减抗，不能把未建模的数值传进来');
        }
    }
    return issues;
}
/**
 * 把时间内核排出的每段命中接到普通直伤公式上。
 * 只做映射与汇总：倍率乘哪一项面板、元素加成读哪个键、目标口径与减益全部来自显式输入。
 * 面板按 actorId 分开取，四人队每人的面板不能混用。
 */
export function calculateTimelineDamage(input) {
    if (!input || typeof input !== 'object')
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'input', message: '输入必须是对象' }] };
    const timeline = input.timeline;
    if (!timeline || typeof timeline !== 'object' || !Array.isArray(timeline.hits)) {
        return { status: 'invalid', issues: [{ code: 'missing', path: 'timeline', message: '必须先跑时间内核' }] };
    }
    if (timeline.status !== 'simulated') {
        return { status: 'invalid', issues: timeline.issues?.length ? timeline.issues : [{ code: 'invalid', path: 'timeline.status', message: '时间内核没有排出可结算的轴' }] };
    }
    const contexts = input.contexts;
    if (!contexts || typeof contexts !== 'object' || Array.isArray(contexts) || !Object.keys(contexts).length) {
        return { status: 'incomplete', issues: [{ code: 'missing', path: 'contexts', message: '必须按 actorId 提供每个出手角色的面板' }] };
    }
    const issues = [];
    for (const [actorId, context] of Object.entries(contexts))
        issues.push(...validateContext(context, `contexts.${actorId}`));
    if (!issues.length) {
        // 同一次模拟必须使用同一版本、同一目标与同一减益口径，否则汇总出来的总数没有意义。
        const [firstId, first] = Object.entries(contexts)[0];
        for (const [actorId, context] of Object.entries(contexts)) {
            if (context.gameVersion !== first.gameVersion || context.source !== first.source)
                issues.push({ code: 'invalid', path: `contexts.${actorId}`, message: `版本与来源必须与 ${firstId} 一致` });
            if (context.targetPresetId !== first.targetPresetId)
                issues.push({ code: 'invalid', path: `contexts.${actorId}.targetPresetId`, message: `目标口径必须与 ${firstId} 一致` });
            if (JSON.stringify(context.debuffs) !== JSON.stringify(first.debuffs))
                issues.push({ code: 'invalid', path: `contexts.${actorId}.debuffs`, message: `队伍减益必须与 ${firstId} 一致` });
        }
    }
    if (issues.length)
        return { status: issues.some(i => i.code === 'unsupported') ? 'unsupported' : issues.some(i => i.code === 'invalid') ? 'invalid' : 'incomplete', issues };
    const anchor = Object.values(contexts)[0];
    const preset = TARGET_PRESETS[anchor.targetPresetId];
    const rows = [];
    const perActor = {};
    let total = 0;
    for (const [index, hit] of timeline.hits.entries()) {
        const context = contexts[hit.actorId];
        if (!context) {
            return { status: 'invalid', issues: [{ code: 'missing', path: `contexts.${hit.actorId}`, message: `命中来自 ${hit.actorId}，但没有提供该角色的面板` }] };
        }
        // 命中自带当帧生效的面板增量与敌人减益：内核已经按帧算好，这里只做加法，不回查效果表。
        const modifiers = hit.modifiers;
        if (!modifiers || typeof modifiers !== 'object' || !modifiers.enemy || typeof modifiers.stats !== 'object' || modifiers.stats === null) {
            return { status: 'invalid', issues: [{ code: 'missing', path: `hits.${index}.modifiers`, message: '命中缺少生效修饰快照，无法确定这一发吃到了哪些效果' }] };
        }
        const stats = applyPanelModifiers(context.stats, modifiers.stats);
        const defenseReduction = context.debuffs.defenseReduction + modifiers.enemy.defenseReduction;
        const defenseIgnore = context.debuffs.defenseIgnore + modifiers.enemy.defenseIgnore;
        const resistanceReduction = context.debuffs.resistanceReduction + modifiers.enemy.resistanceReduction;
        const spec = {
            kind: 'ordinary',
            reaction: 'none',
            gameVersion: context.gameVersion,
            source: context.source,
            targetId: preset.id,
            scaling: [{ stat: statFor(hit.scaling, stats), multiplier: hit.motionValue }],
            additiveBase: 0,
            damageBonus: damageBonusFor(hit.element, stats),
            canCrit: hit.canCrit,
            crit: context.crit,
            critRate: stats.cpct,
            critDamage: stats.cdmg,
            attackerLevel: context.level,
            enemyLevel: preset.level,
            defenseReduction,
            defenseIgnore,
            resistance: preset.resistance,
            resistanceReduction
        };
        const result = calculateOrdinaryHit(spec);
        if (result.status !== 'calculated') {
            return { status: result.status === 'unsupported' ? 'unsupported' : 'invalid', issues: result.issues.map(issue => ({ ...issue, path: `hits.${index}.${issue.path}` })) };
        }
        total += result.damage;
        perActor[hit.actorId] = (perActor[hit.actorId] ?? 0) + result.damage;
        rows.push({ frame: hit.frame, actorId: hit.actorId, actionId: hit.actionId, hitIndex: hit.hitIndex, element: hit.element, scaling: hit.scaling, motionValue: hit.motionValue, damage: result.damage });
    }
    return {
        status: 'calculated',
        scope: 'timeline-damage-no-reaction',
        simulationReady: false,
        total,
        rows,
        perActor,
        target: { id: preset.id, level: preset.level, resistance: preset.resistance },
        gameVersion: anchor.gameVersion,
        source: anchor.source,
        issues: []
    };
}
//# sourceMappingURL=hitDamage.js.map