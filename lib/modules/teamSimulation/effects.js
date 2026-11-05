/**
 * 面板键：只有这些键可以加到结算面板上。
 * `atkPct / hpPct / defPct` 是按**基础面板**（角色+武器白值）折算的百分比加成，结算时由 `applyPanelModifiers` 换算；
 * `normalDmg`…`burstDmg` 是技能类型伤害加成（4 件套等静态效果直接加进 A 乘区）。
 */
export const PANEL_STAT_KEYS = ['hp', 'atk', 'def', 'mastery', 'cpct', 'cdmg', 'recharge', 'dmg', 'phy', 'heal', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro', 'normalDmg', 'chargedDmg', 'plungeDmg', 'skillDmg', 'burstDmg', 'normalCpct', 'chargedCpct', 'plungeCpct', 'skillCpct', 'burstCpct', 'atkPct', 'hpPct', 'defPct'];
export const NO_ENEMY_MODIFIERS = { resistanceReduction: 0, defenseReduction: 0, defenseIgnore: 0 };
export const NO_REACTION_BONUS = { fypct: 0, elevated: 0, kNum: 0 };
/** 允许配 `icdFrames` 的命中类触发 */
export const HIT_TRIGGER_KINDS = ['hit', 'normal-hit', 'charged-hit', 'plunge-hit', 'skill-hit', 'geo-hit'];
export const EFFECT_TRIGGER_KINDS = [
    'cast-skill', 'cast-burst', 'hit', 'normal-hit', 'charged-hit', 'plunge-hit', 'skill-hit', 'geo-hit', 'particle', 'off-field-tick', 'always', 'energy-zero'
];
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isInteger = (value) => typeof value === 'number' && Number.isInteger(value);
const statKeySet = new Set(PANEL_STAT_KEYS);
/** 校验单个效果定义。路径用 `effects.<键>`，与数据包里的键对齐。 */
export function validateEffectSpec(effect, key) {
    const issues = [];
    const p = `effects.${key}`;
    const add = (code, path, message) => issues.push({ code, path, message });
    if (!effect || typeof effect !== 'object' || Array.isArray(effect))
        return [{ code: 'invalid', path: p, message: '效果必须是对象' }];
    const spec = effect;
    if (typeof spec.id !== 'string' || !spec.id.trim())
        add('missing', `${p}.id`, '效果必须有稳定 id');
    else if (spec.id !== key)
        add('invalid', `${p}.id`, `效果 id 必须与键一致，收到 ${spec.id}`);
    if (spec.target !== 'self' && spec.target !== 'team' && spec.target !== 'enemy')
        add('unsupported', `${p}.target`, `未知作用对象 ${String(spec.target)}`);
    if (spec.stats !== undefined) {
        if (spec.target === 'enemy')
            add('invalid', `${p}.stats`, '作用于敌人的效果不能带面板加成：两者口径不同');
        else if (!spec.stats || typeof spec.stats !== 'object' || Array.isArray(spec.stats))
            add('invalid', `${p}.stats`, '面板加成必须是对象');
        else {
            const entries = Object.entries(spec.stats);
            if (!entries.length)
                add('invalid', `${p}.stats`, '空面板加成没有意义，不需要这个效果就别写');
            for (const [stat, value] of entries) {
                if (!statKeySet.has(stat))
                    add('unsupported', `${p}.stats.${stat}`, `未知面板键 ${stat}：只能加 hp/atk/def/mastery/cpct/cdmg/recharge/dmg/phy/heal 与元素加成`);
                else if (!isFiniteNumber(value))
                    add('invalid', `${p}.stats.${stat}`, '面板增量必须是有限数值');
            }
        }
    }
    else if ((spec.target === 'self' || spec.target === 'team') && !spec.energyRestore && !spec.flatDamage) {
        add('missing', `${p}.stats`, '作用于己方的效果必须给面板加成');
    }
    if (spec.enemy !== undefined) {
        if (spec.target !== 'enemy')
            add('invalid', `${p}.enemy`, '只有作用于敌人的效果才能削减抗性与防御');
        else if (!spec.enemy || typeof spec.enemy !== 'object' || Array.isArray(spec.enemy))
            add('invalid', `${p}.enemy`, '敌人减益必须是对象');
        else {
            const entries = Object.entries(spec.enemy);
            if (!entries.length)
                add('invalid', `${p}.enemy`, '空敌人减益没有意义');
            for (const [field, value] of entries) {
                if (!['resistanceReduction', 'defenseReduction', 'defenseIgnore'].includes(field))
                    add('unsupported', `${p}.enemy.${field}`, `未知敌人减益 ${field}`);
                else if (!isFiniteNumber(value))
                    add('invalid', `${p}.enemy.${field}`, '减益必须是有限数值');
            }
        }
    }
    else if (spec.target === 'enemy') {
        add('missing', `${p}.enemy`, '作用于敌人的效果必须给至少一项减益');
    }
    if (spec.durationFrames !== undefined && (!isInteger(spec.durationFrames) || spec.durationFrames <= 0))
        add('invalid', `${p}.durationFrames`, '持续帧数必须是正整数；要一直有效就省略这个字段');
    if (spec.stacking !== undefined && !['refresh', 'stack', 'ignore'].includes(spec.stacking))
        add('unsupported', `${p}.stacking`, `未知叠加策略 ${String(spec.stacking)}`);
    if (spec.trigger !== undefined && !EFFECT_TRIGGER_KINDS.includes(spec.trigger))
        add('unsupported', `${p}.trigger`, `未知触发时机 ${String(spec.trigger)}`);
    if (spec.trigger !== undefined && spec.trigger !== 'always' && spec.trigger !== 'energy-zero' && spec.durationFrames === undefined)
        add('missing', `${p}.durationFrames`, '触发式效果必须给持续时间：常驻到窗口结束的那套写法只适用于开局即生效的效果');
    if (spec.offFieldOnly !== undefined && typeof spec.offFieldOnly !== 'boolean')
        add('invalid', `${p}.offFieldOnly`, '后台限定必须是布尔值');
    if (spec.trigger === 'always') {
        if (spec.icdFrames !== undefined)
            add('invalid', `${p}.icdFrames`, '常驻效果没有触发节奏，不需要触发冷却');
        if (spec.tickFrames !== undefined)
            add('invalid', `${p}.tickFrames`, '常驻效果没有计时触发，不需要计时间隔');
        if (spec.stacksPerTrigger !== undefined)
            add('invalid', `${p}.stacksPerTrigger`, '常驻效果不按触发叠层');
        if (spec.energyCost !== undefined)
            add('invalid', `${p}.energyCost`, '常驻效果不消耗能量');
        if (spec.energyRestore !== undefined)
            add('invalid', `${p}.energyRestore`, '常驻效果不按触发回能');
        if (spec.flatDamage !== undefined)
            add('invalid', `${p}.flatDamage`, '常驻效果不附加命中伤害');
    }
    if (spec.icdFrames !== undefined && (!isInteger(spec.icdFrames) || spec.icdFrames < 0))
        add('invalid', `${p}.icdFrames`, '触发冷却必须是非负整数帧');
    if (spec.tickFrames !== undefined && (!isInteger(spec.tickFrames) || spec.tickFrames <= 0))
        add('invalid', `${p}.tickFrames`, '计时间隔必须是正整数帧');
    if (spec.extraTriggers !== undefined) {
        if (!Array.isArray(spec.extraTriggers) || spec.extraTriggers.length === 0)
            add('invalid', `${p}.extraTriggers`, '附加触发必须是非空数组');
        else
            for (const [index, kind] of spec.extraTriggers.entries()) {
                if (!EFFECT_TRIGGER_KINDS.includes(kind))
                    add('unsupported', `${p}.extraTriggers.${index}`, `未知触发时机 ${String(kind)}`);
            }
    }
    const allTriggers = [spec.trigger, ...(spec.extraTriggers ?? [])].filter((kind) => Boolean(kind));
    if (allTriggers.includes('off-field-tick') && spec.tickFrames === undefined)
        add('missing', `${p}.tickFrames`, '后台计时触发必须给计时间隔');
    if (!allTriggers.includes('off-field-tick') && spec.tickFrames !== undefined)
        add('invalid', `${p}.tickFrames`, '只有后台计时触发才需要计时间隔');
    if (!allTriggers.some(kind => HIT_TRIGGER_KINDS.includes(kind)) && !allTriggers.includes('particle') && spec.icdFrames !== undefined)
        add('invalid', `${p}.icdFrames`, '只有命中类与产球触发才需要触发冷却');
    if (spec.stacking === 'stack') {
        if (!isInteger(spec.maxStacks) || spec.maxStacks <= 0)
            add('invalid', `${p}.maxStacks`, '叠层策略必须给出正整数层数上限');
    }
    else if (spec.maxStacks !== undefined) {
        add('invalid', `${p}.maxStacks`, '只有叠层策略才需要层数上限，其余策略写上限会被静默忽略');
    }
    if (spec.stacksPerTrigger !== undefined) {
        if (!isInteger(spec.maxStacks) || spec.stacking !== 'stack')
            add('invalid', `${p}.stacksPerTrigger`, '按来源给层数只对叠层策略有意义');
        else if (!spec.stacksPerTrigger || typeof spec.stacksPerTrigger !== 'object' || Array.isArray(spec.stacksPerTrigger))
            add('invalid', `${p}.stacksPerTrigger`, '按来源给层数必须是对象');
        else
            for (const [kind, amount] of Object.entries(spec.stacksPerTrigger)) {
                if (!EFFECT_TRIGGER_KINDS.includes(kind))
                    add('unsupported', `${p}.stacksPerTrigger.${kind}`, `未知触发时机 ${kind}`);
                else if (!allTriggers.includes(kind))
                    add('invalid', `${p}.stacksPerTrigger.${kind}`, `来源 ${kind} 不在这个效果的触发列表里`);
                else if (!isInteger(amount) || amount <= 0)
                    add('invalid', `${p}.stacksPerTrigger.${kind}`, '每层数必须是正整数');
            }
    }
    if (spec.energyCost !== undefined) {
        if (!isInteger(spec.energyCost) || spec.energyCost <= 0)
            add('invalid', `${p}.energyCost`, '触发消耗必须是正整数能量');
        else if (!allTriggers.some(kind => kind === 'cast-skill' || kind === 'cast-burst'))
            add('invalid', `${p}.energyCost`, '消耗能量只适用于起手触发（cast-skill / cast-burst）');
    }
    if (spec.energyRestore !== undefined) {
        const r = spec.energyRestore;
        if (!r || typeof r !== 'object' || Array.isArray(r))
            add('invalid', `${p}.energyRestore`, '回能必须是对象');
        else {
            if (!isFiniteNumber(r.amount) || r.amount <= 0)
                add('invalid', `${p}.energyRestore.amount`, '回能量必须是正数');
            if (r.target !== 'team' && r.target !== 'self')
                add('unsupported', `${p}.energyRestore.target`, `未知回能对象 ${String(r.target)}`);
            if (r.excludeSelf !== undefined && typeof r.excludeSelf !== 'boolean')
                add('invalid', `${p}.energyRestore.excludeSelf`, 'excludeSelf 必须是布尔值');
            if (r.everyFrames !== undefined && (!isInteger(r.everyFrames) || r.everyFrames <= 0))
                add('invalid', `${p}.energyRestore.everyFrames`, '回能间隔必须是正整数帧');
            if (r.times !== undefined && (!isInteger(r.times) || r.times <= 0))
                add('invalid', `${p}.energyRestore.times`, '回能次数必须是正整数');
            if (r.everyFrames !== undefined && r.times === undefined)
                add('missing', `${p}.energyRestore.times`, '按间隔回能必须给次数');
            if (r.times !== undefined && r.everyFrames === undefined)
                add('missing', `${p}.energyRestore.everyFrames`, '多次回能必须给间隔');
        }
        if (spec.flatDamage !== undefined) {
            const f = spec.flatDamage;
            if (!f || typeof f !== 'object' || Array.isArray(f))
                add('invalid', `${p}.flatDamage`, '固定值伤害必须是对象');
            if (f && !['atk', 'def', 'hp', 'mastery'].includes(String(f.scaling)))
                add('unsupported', `${p}.flatDamage.scaling`, `未知折算属性 ${String(f.scaling)}`);
            if (f && (!isFiniteNumber(f.ratio) || f.ratio <= 0))
                add('invalid', `${p}.flatDamage.ratio`, '固定值伤害倍率必须是正数');
            if (f && !allTriggers.some(kind => HIT_TRIGGER_KINDS.includes(kind)))
                add('invalid', `${p}.flatDamage`, '固定值伤害只能挂在命中类触发上');
        }
    }
    return issues;
}
export function validateEffects(effects) {
    if (effects === undefined)
        return [];
    if (!effects || typeof effects !== 'object' || Array.isArray(effects))
        return [{ code: 'invalid', path: 'effects', message: '效果表必须是对象' }];
    const issues = [];
    for (const [key, effect] of Object.entries(effects))
        issues.push(...validateEffectSpec(effect, key));
    return issues;
}
/**
 * 创建一个按帧查询的效果运行时。`endFrame` 只用来把「持续到窗口结束」展开成有限的到期帧，
 * 好让结果里能直接读出到期时刻，而不是留一个 Infinity 让调用方自己解释。
 */
export function createEffectRuntime(effects, actorIds, endFrame) {
    const table = effects ?? {};
    const entries = new Map();
    const triggers = [];
    const expiryOf = (spec, frame) => frame + (spec.durationFrames ?? Math.max(1, endFrame - frame + 1));
    const entryKey = (spec, actorId) => spec.target === 'self' ? `${spec.id}@${actorId}` : spec.id;
    return {
        has: effectId => Object.prototype.hasOwnProperty.call(table, effectId),
        specOf: effectId => table[effectId],
        trigger(effectId, frame, actorId, amount = 1) {
            const spec = table[effectId];
            if (!spec)
                return undefined;
            const key = entryKey(spec, actorId);
            const expiresAt = expiryOf(spec, frame);
            const existing = entries.get(key);
            const policy = spec.stacking ?? 'refresh';
            const gain = Math.max(1, Math.trunc(amount));
            const cap = spec.maxStacks ?? 1;
            // 旧记录已经到期就按新状态重来：否则叠层会带着上一轮的层数与起点继续累，层数封顶后永远回不到 1。
            if (existing && frame >= existing.expiresAt)
                entries.delete(key);
            const live = entries.get(key);
            if (live) {
                if (policy === 'ignore')
                    return undefined;
                if (policy === 'stack') {
                    live.stacks = Math.min(cap, live.stacks + gain);
                    live.expiresAt = expiresAt;
                }
                else {
                    live.stacks = 1;
                    live.expiresAt = expiresAt;
                }
                const record = { frame, actorId, effectId, stacks: live.stacks, startsAt: live.startedAt, expiresAt: live.expiresAt };
                triggers.push(record);
                return record;
            }
            const entry = { spec, key, actorId: spec.target === 'self' ? actorId : undefined, stacks: Math.min(cap, gain), startedAt: frame, expiresAt };
            entries.set(key, entry);
            const record = { frame, actorId, effectId, stacks: entry.stacks, startsAt: frame, expiresAt };
            triggers.push(record);
            return record;
        },
        modifiersAt(actorId, frame, options) {
            const stats = {};
            const enemy = { ...NO_ENEMY_MODIFIERS };
            const reaction = { ...NO_REACTION_BONUS };
            for (const entry of entries.values()) {
                if (frame >= entry.expiresAt)
                    continue;
                const { spec } = entry;
                if (spec.offFieldOnly && !options?.offField)
                    continue;
                if (spec.target === 'enemy') {
                    const mods = spec.enemy ?? {};
                    enemy.resistanceReduction += (mods.resistanceReduction ?? 0) * entry.stacks;
                    enemy.defenseReduction += (mods.defenseReduction ?? 0) * entry.stacks;
                    enemy.defenseIgnore += (mods.defenseIgnore ?? 0) * entry.stacks;
                    continue;
                }
                if (spec.target === 'self' && entry.actorId !== actorId)
                    continue;
                for (const [key, value] of Object.entries(spec.stats ?? {})) {
                    const stat = key;
                    stats[stat] = (stats[stat] ?? 0) + value * entry.stacks;
                }
                const bonus = spec.reactionBonus;
                if (bonus) {
                    reaction.fypct = (reaction.fypct ?? 0) + (bonus.fypct ?? 0) * entry.stacks;
                    reaction.elevated = (reaction.elevated ?? 0) + (bonus.elevated ?? 0) * entry.stacks;
                    reaction.kNum = (reaction.kNum ?? 0) + (bonus.kNum ?? 0) * entry.stacks;
                }
            }
            return { stats, enemy, reaction };
        },
        stacksAt(effectId, actorId, frame) {
            const spec = table[effectId];
            if (!spec)
                return 0;
            const entry = entries.get(entryKey(spec, actorId));
            if (!entry || frame >= entry.expiresAt)
                return 0;
            return entry.stacks;
        },
        activeAt(actorId, frame) {
            const ids = new Set();
            for (const entry of entries.values()) {
                if (frame >= entry.expiresAt)
                    continue;
                const { spec } = entry;
                if (spec.target === 'self' && entry.actorId !== actorId)
                    continue;
                ids.add(spec.id);
            }
            return [...ids].sort();
        },
        shiftAfter(frame, delta) {
            if (delta <= 0)
                return;
            for (const entry of entries.values())
                if (entry.expiresAt > frame)
                    entry.expiresAt += delta;
            for (const record of triggers)
                if (record.expiresAt > frame)
                    record.expiresAt += delta;
        },
        snapshot() {
            return [...entries.values()].map(entry => ({
                effectId: entry.spec.id,
                target: entry.spec.target,
                actorIds: entry.spec.target === 'self' ? [entry.actorId] : entry.spec.target === 'team' ? [...actorIds] : [],
                stacks: entry.stacks,
                startedAt: entry.startedAt,
                expiresAt: entry.expiresAt
            }));
        }
    };
}
/**
 * 把面板增量加到一个已算好的面板上，返回新对象；不改调用方那份。
 *
 * `atkPct / hpPct / defPct` 按 `base` 折算成点数；`base` 缺省时这三项记 0，
 * 但调用方（hitDamage）会先校验、缺 base 直接报错，不会静默少算。
 */
export function applyPanelModifiers(stats, modifiers, base) {
    if (!modifiers)
        return { ...stats };
    const merged = { ...stats };
    for (const [key, value] of Object.entries(modifiers)) {
        if (key === 'atkPct') {
            merged.atk += (base?.atk ?? 0) * value;
            continue;
        }
        if (key === 'hpPct') {
            merged.hp += (base?.hp ?? 0) * value;
            continue;
        }
        if (key === 'defPct') {
            merged.def += (base?.def ?? 0) * value;
            continue;
        }
        // 可选键（技能类型加成/暴击）在面板里可能没有初始化，先按 0 起算，避免 undefined + x = NaN。
        merged[key] =
            (merged[key] ?? 0) + value;
    }
    return merged;
}
//# sourceMappingURL=effects.js.map