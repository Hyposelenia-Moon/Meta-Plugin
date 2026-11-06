import { calculateOrdinaryHit, resistanceMultiplier, TARGET_PRESETS } from './formula.js';
import { applyPanelModifiers } from './effects.js';
import { isReactiveKind, isSpecialKind, reactionClass, reactionCoefficient, specialMasteryFactor, specialMultiplier, transformativeBase } from './reactions.js';
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const DAMAGE_KIND_BONUS = {
    normal: 'normalDmg',
    charged: 'chargedDmg',
    plunge: 'plungeDmg',
    skill: 'skillDmg',
    burst: 'burstDmg'
};
/** 技能类型暴击率：与 `cpct` 加算（行者之心「重击的暴击率 +30%」这类）。 */
const DAMAGE_KIND_CRIT = {
    normal: 'normalCpct',
    charged: 'chargedCpct',
    plunge: 'plungeCpct',
    skill: 'skillCpct',
    burst: 'burstCpct'
};
function critRateFor(stats, kind) {
    const base = Number(stats.cpct ?? 0);
    if (!kind)
        return base;
    return base + Number(stats[DAMAGE_KIND_CRIT[kind]] ?? 0);
}
/** 动作 id 形如 `itto.normal-1` / `itto.charged-1` / `bennett.skill` / `bennett.burst`。 */
function damageKindOf(actionId) {
    if (/\.normal(?:-|$)/.test(actionId))
        return 'normal';
    if (/\.charged(?:-|$)/.test(actionId))
        return 'charged';
    if (/\.plunge(?:-|$)/.test(actionId))
        return 'plunge';
    if (/\.skill$/.test(actionId))
        return 'skill';
    if (/\.burst$/.test(actionId))
        return 'burst';
    return null;
}
/** 元素命中只读该元素的加成键，物理命中只读物理键；`dmg` 是通用元素伤害加成。 */
function damageBonusFor(element, stats, kind) {
    const base = element === 'physical' ? stats.phy : stats.dmg + stats[element];
    if (!kind)
        return base;
    // 4 件套这类「普攻/重击/战技/爆发伤害 +X%」直接加算进 A 乘区。
    return base + Number(stats[DAMAGE_KIND_BONUS[kind]] ?? 0);
}
function statFor(scaling, stats) {
    if (scaling === 'mastery')
        return stats.mastery;
    return scaling === 'atk' ? stats.atk : scaling === 'hp' ? stats.hp : stats.def;
}
function windowStats(plan, actorId, frame) {
    if (!plan)
        return [];
    return plan.statWindows.filter(window => window.actorId === actorId && frame >= window.fromFrame && frame < window.toFrame);
}
function windowEnemies(plan, frame) {
    if (!plan)
        return [];
    return plan.enemyWindows.filter(window => frame >= window.fromFrame && frame < window.toFrame);
}
/** 把当帧的面板增量与机制窗口叠加成一份新对象，不改动调用方的面板。 */
function mergedStats(base, extra) {
    const out = { ...base };
    for (const delta of extra) {
        for (const [key, value] of Object.entries(delta)) {
            if (typeof value !== 'number')
                continue;
            out[key] = (out[key] ?? 0) + value;
        }
    }
    return out;
}
function mergedEnemy(base, extra) {
    const out = { ...base };
    for (const delta of extra) {
        out.resistanceReduction += delta.resistanceReduction;
        out.defenseReduction += delta.defenseReduction;
        out.defenseIgnore += delta.defenseIgnore;
        for (const [element, amount] of Object.entries(delta.resistanceByElement ?? {})) {
            const key = element;
            out.resistanceByElement = { ...(out.resistanceByElement ?? {}), [key]: (out.resistanceByElement?.[key] ?? 0) + (amount ?? 0) };
        }
    }
    return out;
}
/** 当帧在场的 id：效果表里触发的效果 + 机制层按帧开出的窗口，去重排序。 */
function activeIds(plan, actorId, frame, effects) {
    const ids = new Set(effects ?? []);
    // 机制窗口的 id 带实例后缀（同一来源可以开多个窗口），归因用来源名，同一来源只算一项。
    for (const window of windowStats(plan, actorId, frame))
        ids.add(window.source);
    for (const window of windowEnemies(plan, frame))
        ids.add(window.source);
    return [...ids].sort();
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
                add('unsupported', `${prefix}.debuffs.${key}`, 'P1 没有建模常驻队伍减防/减抗，减益必须走机制窗口');
        }
    }
    if (context.base !== undefined) {
        if (!context.base || typeof context.base !== 'object')
            add('invalid', `${prefix}.base`, '基础面板必须是对象');
        else {
            for (const key of ['hp', 'atk', 'def']) {
                if (!isFiniteNumber(context.base[key]) || context.base[key] < 0)
                    add('invalid', `${prefix}.base.${key}`, '基础面板数值必须是非负有限值');
            }
        }
    }
    return issues;
}
/**
 * 把时间内核排出的每段命中接到普通直伤公式上。
 * 只做映射与汇总：倍率乘哪一项面板、元素加成读哪个键、目标口径与减益全部来自显式输入。
 * 面板按 actorId 分开取，四人队每人的面板不能混用；机制窗口按帧叠加，召唤物命中在同一层展开。
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
    const plan = input.plan;
    const rows = [];
    const perActor = {};
    const perAction = {};
    let total = 0;
    const settle = (options) => {
        const context = contexts[options.actorId];
        if (!context)
            return [{ code: 'missing', path: `contexts.${options.actorId}`, message: `命中来自 ${options.actorId}，但没有提供该角色的面板` }];
        const hasPct = ['atkPct', 'hpPct', 'defPct'].some(key => {
            const value = options.stats?.[key];
            return typeof value === 'number' && Math.abs(value) > 1e-12;
        });
        if (hasPct && !context.base) {
            return [{ code: 'missing', path: `contexts.${options.actorId}.base`, message: '面板增量含 atkPct / hpPct / defPct，但上下文没有提供基础面板 base，无法折算' }];
        }
        const stats = applyPanelModifiers(context.stats, options.stats, context.base);
        const flatBase = (options.flatBase ?? []).reduce((sum, flat) => sum + statFor(flat.scaling, stats) * flat.ratio, 0);
        const defenseReduction = context.debuffs.defenseReduction + options.enemy.defenseReduction;
        const defenseIgnore = context.debuffs.defenseIgnore + options.enemy.defenseIgnore;
        const resistanceReduction = context.debuffs.resistanceReduction + options.enemy.resistanceReduction + (options.enemy.resistanceByElement?.[options.element] ?? 0);
        const spec = {
            kind: 'ordinary',
            reaction: 'none',
            gameVersion: context.gameVersion,
            source: context.source,
            targetId: preset.id,
            scaling: [{ stat: statFor(options.scaling, stats), multiplier: options.motionValue }],
            additiveBase: flatBase,
            damageBonus: damageBonusFor(options.element, stats, damageKindOf(options.actionId)),
            canCrit: options.canCrit,
            crit: context.crit,
            critRate: critRateFor(stats, damageKindOf(options.actionId)),
            critDamage: stats.cdmg,
            attackerLevel: context.level,
            enemyLevel: preset.level,
            defenseReduction,
            defenseIgnore,
            resistance: preset.resistance,
            resistanceReduction
        };
        const base = calculateOrdinaryHit(spec);
        if (base.status !== 'calculated') {
            return base.issues.map(issue => ({ ...issue, path: `${options.path}.${issue.path}` }));
        }
        let damage = base.damage;
        let reactionRecord;
        let reactionRow;
        // 月反应与星烁是独立的一段伤害，不能挂在直伤行上（否则会被读成「这一发被强化了」）。
        let specialRow;
        // 月反应与星烁：官方口径的倍率取决于天赋与叠层计数，精通曲线也与剧变不同（6 而不是 16），
        // 所以单独成段而不是复用剧变分支。公式见 docs/队伍模拟-P3-月反应与星烁.md。
        const special = options.reaction && isSpecialKind(options.reaction.kind) ? options.reaction : undefined;
        if (special) {
            const kind = special.kind;
            const coefficient = reactionCoefficient(context.level);
            if (coefficient === undefined)
                return [{ code: 'unsupported', path: `${options.path}.reaction`, message: `等级 ${context.level} 不在反应系数表内` }];
            const multiplier = specialMultiplier(kind, { talent: special.talent, count: special.count });
            // 数据写死的加成与效果表提供的加成相加；数据里的 kNum 是乘数，效果里的是加数（最终 1 + 合计）。
            const bonus = options.reactionBonus;
            const fypct = (special.fypct ?? 0) + (bonus?.fypct ?? 0);
            const fyplus = special.fyplus ?? 0;
            const elevated = (special.elevated ?? 0) + (bonus?.elevated ?? 0);
            const kNum = (special.kNum ?? 1) * (1 + (bonus?.kNum ?? 0));
            const critRate = Math.min(1, Math.max(0, stats.cpct));
            const critDamage = Math.max(0, stats.cdmg);
            const critFactor = options.canCrit ? 1 + critRate * critDamage : 1;
            const reactionDamage = (coefficient * (1 + fypct) * multiplier * specialMasteryFactor(stats.mastery) + fyplus) *
                (1 + elevated) *
                kNum *
                critFactor *
                resistanceMultiplier(preset.resistance - resistanceReduction);
            specialRow = {
                frame: options.frame,
                actorId: options.actorId,
                actionId: options.actionId,
                hitIndex: options.hitIndex,
                element: options.element,
                scaling: options.scaling,
                motionValue: options.motionValue,
                damage: reactionDamage,
                origin: 'reaction',
                effects: options.effects,
                reaction: { kind, damage: reactionDamage }
            };
        }
        else {
            const declared = options.reaction && isReactiveKind(options.reaction.kind) ? options.reaction : undefined;
            if (declared) {
                const kind = declared.kind;
                const cls = reactionClass(kind);
                if (cls === 'transformative') {
                    // 剧变：不吃防御、不吃增伤、不暴击，只乘抗性区，单独成一段。
                    const reactionElement = kind === 'swirl' ? declared.aura
                        : kind === 'overloaded' || kind === 'burning' ? 'pyro'
                            : kind === 'electro-charged' ? 'electro'
                                : kind === 'superconduct' ? 'cryo' : 'dendro';
                    const reactionResistanceReduction = context.debuffs.resistanceReduction + options.enemy.resistanceReduction + (options.enemy.resistanceByElement?.[reactionElement] ?? 0);
                    const coefficient = transformativeBase(kind, context.level, stats.mastery);
                    if (coefficient === undefined)
                        return [{ code: 'unsupported', path: `${options.path}.reaction`, message: `等级 ${context.level} 不在反应系数表内` }];
                    const reactionBonus = options.reactionBonus?.dmg?.[kind] ?? 0;
                    const reactionDamage = coefficient * (1 + reactionBonus) * resistanceMultiplier(preset.resistance - reactionResistanceReduction);
                    reactionRecord = { kind, damage: reactionDamage };
                    reactionRow = {
                        frame: options.frame,
                        actorId: options.actorId,
                        actionId: options.actionId,
                        hitIndex: options.hitIndex,
                        element: reactionElement,
                        scaling: options.scaling,
                        motionValue: options.motionValue,
                        damage: reactionDamage,
                        origin: 'reaction',
                        effects: options.effects,
                        reaction: reactionRecord
                    };
                }
                else {
                    // 增幅与激化：走同一条直伤公式，反应只是换了基础伤害区的算法。
                    const withReaction = { ...spec, reaction: kind, element: options.element, aura: declared.aura, mastery: stats.mastery };
                    const reacted = calculateOrdinaryHit(withReaction);
                    if (reacted.status !== 'calculated') {
                        return reacted.issues.map(issue => ({ ...issue, path: `${options.path}.reaction.${issue.path}` }));
                    }
                    damage = reacted.damage;
                    reactionRecord = { kind, damage: reacted.damage - base.damage };
                }
            }
        }
        const row = {
            frame: options.frame,
            actorId: options.actorId,
            actionId: options.actionId,
            hitIndex: options.hitIndex,
            element: options.element,
            scaling: options.scaling,
            motionValue: options.motionValue,
            damage,
            origin: options.origin,
            effects: options.effects,
            ...(reactionRecord ? { reaction: reactionRecord } : {})
        };
        const add = (target) => {
            total += target.damage;
            perActor[target.actorId] = (perActor[target.actorId] ?? 0) + target.damage;
            const actionKey = `${target.actorId}/${target.actionId}`;
            perAction[actionKey] = (perAction[actionKey] ?? 0) + target.damage;
            rows.push(target);
        };
        add(row);
        if (reactionRow)
            add(reactionRow);
        if (specialRow)
            add(specialRow);
        return [];
    };
    for (const [index, hit] of timeline.hits.entries()) {
        // 命中自带当帧生效的面板增量与敌人减益：内核已经按帧算好，这里只做加法，不回查效果表。
        const modifiers = hit.modifiers;
        if (!modifiers || typeof modifiers !== 'object' || !modifiers.enemy || typeof modifiers.stats !== 'object' || modifiers.stats === null) {
            return { status: 'invalid', issues: [{ code: 'missing', path: `hits.${index}.modifiers`, message: '命中缺少生效修饰快照，无法确定这一发吃到了哪些效果' }] };
        }
        const stats = mergedStats(modifiers.stats, windowStats(plan, hit.actorId, hit.frame).map(window => window.stats));
        const enemy = mergedEnemy(modifiers.enemy, windowEnemies(plan, hit.frame).map(window => window.enemy));
        const hitIssues = settle({
            frame: hit.frame,
            actorId: hit.actorId,
            actionId: hit.actionId,
            hitIndex: hit.hitIndex,
            motionValue: hit.motionValue,
            scaling: hit.scaling,
            element: hit.element,
            canCrit: hit.canCrit,
            origin: 'action',
            stats,
            enemy,
            effects: activeIds(plan, hit.actorId, hit.frame, hit.activeEffects),
            ...(hit.flatBase ? { flatBase: hit.flatBase } : {}),
            reaction: hit.reaction,
            reactionBonus: modifiers.reaction,
            path: `hits.${index}`
        });
        if (hitIssues.length)
            return { status: hitIssues.some(i => i.code === 'unsupported') ? 'unsupported' : 'invalid', issues: hitIssues };
    }
    // 召唤物命中：主线没有把它排进事件队列（见文档已知限制），这里按帧展开再结算。
    // 窗口边界由 plan 负责裁剪（施放点 + 持续，且不超过测量窗口），结算层不再拿动作结束帧拦。
    for (const [index, summon] of (plan?.summonHits ?? []).entries()) {
        const stats = mergedStats({}, windowStats(plan, summon.ownerId, summon.atFrame).map(window => window.stats));
        const enemy = mergedEnemy({ resistanceReduction: 0, defenseReduction: 0, defenseIgnore: 0 }, windowEnemies(plan, summon.atFrame).map(window => window.enemy));
        const summonIssues = settle({
            frame: summon.atFrame,
            actorId: summon.ownerId,
            actionId: 'summon',
            hitIndex: -1 - index,
            motionValue: summon.motionValue,
            scaling: summon.scaling,
            element: summon.element,
            canCrit: summon.canCrit,
            origin: 'summon',
            stats,
            enemy,
            effects: activeIds(plan, summon.ownerId, summon.atFrame, undefined),
            path: `summons.${index}`
        });
        if (summonIssues.length)
            return { status: summonIssues.some(i => i.code === 'unsupported') ? 'unsupported' : 'invalid', issues: summonIssues };
    }
    rows.sort((a, b) => a.frame - b.frame || (a.origin === b.origin ? 0 : a.origin === 'action' ? -1 : 1));
    return {
        status: 'calculated',
        scope: rows.some(row => row.reaction) ? 'timeline-damage-with-reaction' : 'timeline-damage-no-reaction',
        simulationReady: false,
        total,
        rows,
        perActor,
        perAction,
        target: { id: preset.id, level: preset.level, resistance: preset.resistance },
        gameVersion: anchor.gameVersion,
        source: anchor.source,
        issues: []
    };
}
//# sourceMappingURL=hitDamage.js.map