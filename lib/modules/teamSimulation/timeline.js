import { createEffectRuntime, EFFECT_TRIGGER_KINDS, HIT_TRIGGER_KINDS } from './effects.js';
import { describeMismatch, describeSpecialMismatch, isReactiveKind, isSpecialKind, isStatefulKind, statefulReason } from './reactions.js';
/** 数据编帧用的标称帧率。60 档位上一帧的真实时长是 16.667ms，不是整数毫秒。 */
export const FRAME_RATE = 60;
const tierSource = '原神帧率学 计时器型帧率档位表（BV1Z8rLBGEeo）';
export const FRAME_TIERS = {
    'fps-56': { id: 'fps-56', fps: 56.31477, timerTickMs: 18, source: tierSource },
    'fps-60': { id: 'fps-60', fps: 60.36144, timerTickMs: 17, source: tierSource },
    'fps-64': { id: 'fps-64', fps: 64.41135, timerTickMs: 16, source: tierSource },
    'fps-73': { id: 'fps-73', fps: 73.5355, timerTickMs: 14, source: tierSource },
    'fps-104': { id: 'fps-104', fps: 105.0891, timerTickMs: 10, source: tierSource },
    'fps-217': { id: 'fps-217', fps: 221.7778, timerTickMs: 5, source: tierSource },
    'fps-384': { id: 'fps-384', fps: 399.1304, timerTickMs: 3, source: tierSource },
    'fps-625': { id: 'fps-625', fps: 665.7423, timerTickMs: 2, source: tierSource }
};
/**
 * 同帧事件的相位顺序由机制规则决定，不能按角色 id 或插入顺序排。
 * 这里固定的是结算骨架：起手 → 扣费 → 施放快照 → 命中 → 伤害 → 触发 → 回能 → 其他状态。
 * 未查清且会改变结果的同帧先后，只能记歧义，不能拿这个表硬套。
 */
export const EVENT_PHASES = ['action-start', 'cost', 'snapshot', 'hit', 'damage', 'trigger', 'energy', 'state'];
const HIT_ELEMENTS = ['physical', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
const isInteger = (value) => typeof value === 'number' && Number.isInteger(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
/** 校验帧率档位：帧率与计时器取整必须自洽，否则一帧到底多长没有唯一答案。 */
export function validateFrameTier(tier) {
    if (tier === undefined || tier === null)
        return [{ code: 'missing', path: 'frameTier', message: '必须显式给出帧率档位：一帧的现实时长与计时器时长都由它决定' }];
    const issues = [];
    if (typeof tier.id !== 'string' || !tier.id.trim())
        issues.push({ code: 'invalid', path: 'frameTier.id', message: '档位 id 不能为空' });
    if (!isFiniteNumber(tier.fps) || tier.fps <= 0)
        issues.push({ code: 'invalid', path: 'frameTier.fps', message: '帧率必须是正的有限数值' });
    if (!isInteger(tier.timerTickMs) || tier.timerTickMs <= 0)
        issues.push({ code: 'invalid', path: 'frameTier.timerTickMs', message: '计时器每帧推进的毫秒数必须是正整数' });
    if (isFiniteNumber(tier.fps) && tier.fps > 0 && isInteger(tier.timerTickMs)) {
        const expected = Math.round(1000 / tier.fps);
        if (tier.timerTickMs !== expected) {
            issues.push({ code: 'invalid', path: 'frameTier.timerTickMs', message: `计时器取整与帧率不自洽：${1000 / tier.fps}ms 应取整为 ${expected}ms，不是 ${tier.timerTickMs}ms` });
        }
    }
    return issues;
}
/**
 * 把动作时长折算成帧：计时器型直接取帧数，响应型按 `k × 帧生成时间 + bMs` 算现实时长再向上取整到帧。
 * 向上取整是因为引擎逐帧检查动作是否结束：到点后的第一帧才真正结束。
 */
export function resolveActionTiming(timing, tier) {
    const msPerFrame = tier && isFiniteNumber(tier.fps) && tier.fps > 0 ? 1000 / tier.fps : NaN;
    if (!timing || typeof timing !== 'object')
        return { frames: NaN, realMs: NaN, model: 'timer' };
    if (timing.type === 'frames') {
        const valid = isInteger(timing.frames) && timing.frames > 0;
        return { frames: valid ? timing.frames : NaN, realMs: valid ? timing.frames * msPerFrame : NaN, model: 'timer' };
    }
    if (timing.type !== 'response')
        return { frames: NaN, realMs: NaN, model: 'timer' };
    const { k, bMs } = timing;
    if (!isFiniteNumber(k) || !isFiniteNumber(bMs) || k < 0 || bMs < 0 || k + bMs <= 0 || !Number.isFinite(msPerFrame)) {
        return { frames: NaN, realMs: NaN, model: 'response' };
    }
    const realMs = k * msPerFrame + bMs;
    return { frames: Math.ceil(realMs / msPerFrame - 1e-9), realMs, model: 'response' };
}
/** 校验单个动作数据：帧、倍率、窗口、产球与冷却。任何小数帧都不放过。 */
export function validateActionSpec(spec) {
    const issues = [];
    const p = `actions.${spec?.id ?? '<missing>'}`;
    const add = (code, path, message) => issues.push({ code, path, message });
    if (!spec || typeof spec !== 'object')
        return [{ code: 'missing', path: p, message: '动作数据缺失' }];
    if (!spec.id)
        add('missing', `${p}.id`, '动作必须有稳定 id');
    if (!spec.actorId)
        add('missing', `${p}.actorId`, '动作必须归属一个角色');
    if (!['normal', 'charged', 'plunge', 'skill', 'burst', 'switch'].includes(spec.kind))
        add('unsupported', `${p}.kind`, `未知动作类型 ${String(spec.kind)}`);
    const timing = spec.timing;
    // 时长的结构校验与帧数校验分开：响应型的帧数要等档位给定后才能算，不能在这里假装知道。
    if (!timing || typeof timing !== 'object')
        add('missing', `${p}.timing`, '必须显式声明动作时长口径（frames 或 response）');
    else if (timing.type === 'frames') {
        if (!isInteger(timing.frames) || timing.frames <= 0)
            add('invalid', `${p}.timing.frames`, '动作总帧必须是正整数，帧不取整');
    }
    else if (timing.type === 'response') {
        if (!isFiniteNumber(timing.k) || timing.k < 0)
            add('invalid', `${p}.timing.k`, '响应型系数 k 必须是非负有限数值');
        if (!isFiniteNumber(timing.bMs) || timing.bMs < 0)
            add('invalid', `${p}.timing.bMs`, '响应型偏置 bMs 必须是非负有限毫秒');
        if (isFiniteNumber(timing.k) && isFiniteNumber(timing.bMs) && timing.k + timing.bMs <= 0)
            add('invalid', `${p}.timing`, 'k 与 bMs 不能同时为 0，否则动作时长为 0');
    }
    else {
        add('unsupported', `${p}.timing.type`, `未知时长口径 ${String(timing.type)}`);
    }
    // 帧上界只在计时器型下可以就地判断；响应型要拿档位折算后的帧数，交给内核在模拟时校验。
    const bound = timing && timing.type === 'frames' && isInteger(timing.frames) && timing.frames > 0 ? timing.frames : null;
    if (!Array.isArray(spec.hits))
        add('missing', `${p}.hits`, '动作必须显式列出命中段，不能留空由内核猜');
    else {
        let last = -1;
        spec.hits.forEach((hit, i) => {
            const hp = `${p}.hits.${i}`;
            if (!hit || typeof hit !== 'object') {
                add('invalid', hp, '命中段必须是对象');
                return;
            }
            if (!isInteger(hit.atFrame) || hit.atFrame < 0)
                add('invalid', `${hp}.atFrame`, '命中帧必须是非负整数');
            if (hit.delayed !== undefined && typeof hit.delayed !== 'boolean')
                add('invalid', `${hp}.delayed`, '延迟命中标记必须是布尔值');
            if (bound !== null && isInteger(hit.atFrame) && hit.atFrame >= bound && hit.delayed !== true)
                add('invalid', `${hp}.atFrame`, '命中帧不能超出动作时长；若这是后续触发的延迟命中，请显式标 delayed: true');
            if (isInteger(hit.atFrame) && hit.atFrame < last)
                add('invalid', `${hp}.atFrame`, '命中帧必须按时间递增，同帧多段按数组顺序结算');
            if (isInteger(hit.atFrame))
                last = Math.max(last, hit.atFrame);
            if (!isFiniteNumber(hit.motionValue) || hit.motionValue <= 0)
                add('invalid', `${hp}.motionValue`, '倍率必须是正有限数值');
            if (hit.scaling === undefined)
                add('missing', `${hp}.scaling`, '必须声明该段按 attack、hp 还是 def 结算');
            else if (!['atk', 'hp', 'def'].includes(hit.scaling))
                add('unsupported', `${hp}.scaling`, `未知结算属性 ${String(hit.scaling)}`);
            if (!HIT_ELEMENTS.includes(hit.element))
                add('unsupported', `${hp}.element`, `未知命中元素 ${String(hit.element)}`);
            if (typeof hit.canCrit !== 'boolean')
                add('invalid', `${hp}.canCrit`, '必须显式声明该段是否可暴击');
            // 触发标记将来要按 id 统计命中次数；元素不是非空字符串的话，统计会静默丢项。
            if (hit.triggerIds !== undefined) {
                if (!Array.isArray(hit.triggerIds))
                    add('invalid', `${hp}.triggerIds`, '触发标记必须是数组');
                else
                    hit.triggerIds.forEach((triggerId, j) => {
                        if (typeof triggerId !== 'string' || !triggerId.trim())
                            add('invalid', `${hp}.triggerIds.${j}`, '触发标记必须是非空字符串');
                    });
            }
            if (hit.hitlagFrames !== undefined && (!isInteger(hit.hitlagFrames) || hit.hitlagFrames < 0))
                add('invalid', `${hp}.hitlagFrames`, '卡肉帧数必须是非负整数');
            if (hit.reaction !== undefined) {
                const reaction = hit.reaction;
                if (!reaction || typeof reaction !== 'object' || Array.isArray(reaction))
                    add('invalid', `${hp}.reaction`, '反应必须写成 { kind, aura }');
                else {
                    const auraOk = typeof reaction.aura === 'string' && ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'].includes(reaction.aura);
                    if (!auraOk)
                        add('invalid', `${hp}.reaction.aura`, '附着元素必须是七种元素之一');
                    const elementOk = typeof hit.element === 'string' && hit.element !== 'physical';
                    if (!elementOk)
                        add('invalid', `${hp}.element`, '物理命中不触发元素反应');
                    if (isStatefulKind(reaction.kind))
                        add('unsupported', `${hp}.reaction.kind`, `P1 不建模：${statefulReason(reaction.kind)}`);
                    else if (isSpecialKind(reaction.kind)) {
                        if (auraOk && elementOk) {
                            const mismatch = describeSpecialMismatch(reaction.kind, hit.element, reaction.aura);
                            if (mismatch)
                                add('invalid', `${hp}.reaction`, mismatch);
                        }
                        if (reaction.talent !== undefined && typeof reaction.talent !== 'boolean')
                            add('invalid', `${hp}.reaction.talent`, '天赋倍率开关必须是布尔值');
                        if (reaction.count !== undefined && (!isInteger(reaction.count) || reaction.count < 1))
                            add('invalid', `${hp}.reaction.count`, '叠层计数必须是正整数');
                        if (reaction.countFrom !== undefined && (typeof reaction.countFrom !== 'string' || !reaction.countFrom.trim()))
                            add('invalid', `${hp}.reaction.countFrom`, '计数来源必须是效果 id');
                        if (reaction.count !== undefined && reaction.countFrom !== undefined)
                            add('invalid', `${hp}.reaction`, '计数只能二选一：写死数字用 count，读效果层数用 countFrom');
                        for (const key of ['fypct', 'fyplus', 'elevated']) {
                            const value = reaction[key];
                            if (value !== undefined && (!isFiniteNumber(value) || value < 0))
                                add('invalid', `${hp}.reaction.${key}`, '加成必须是非负有限数值');
                        }
                        if (reaction.kNum !== undefined && (!isFiniteNumber(reaction.kNum) || reaction.kNum <= 0))
                            add('invalid', `${hp}.reaction.kNum`, '反应系数乘区必须是正有限数值');
                    }
                    else if (!isReactiveKind(reaction.kind))
                        add('unsupported', `${hp}.reaction.kind`, '不支持的反应');
                    else if (auraOk && elementOk) {
                        const mismatch = describeMismatch(reaction.kind, hit.element, reaction.aura);
                        if (mismatch)
                            add('invalid', `${hp}.reaction`, mismatch);
                    }
                }
            }
        });
    }
    if (spec.cancelWindows !== undefined) {
        if (!Array.isArray(spec.cancelWindows))
            add('invalid', `${p}.cancelWindows`, '取消窗口必须是数组');
        else {
            spec.cancelWindows.forEach((w, i) => {
                const wp = `${p}.cancelWindows.${i}`;
                if (!isInteger(w?.fromFrame) || !isInteger(w?.toFrame)) {
                    add('invalid', wp, '取消窗口边界必须是整数帧');
                    return;
                }
                if (w.fromFrame < 0 || w.toFrame < w.fromFrame)
                    add('invalid', wp, '取消窗口必须先有起点且终点不早于起点');
                if (bound !== null && w.toFrame > bound)
                    add('invalid', wp, '取消窗口不能超出动作时长');
            });
        }
    }
    if (spec.particles !== undefined) {
        if (!Array.isArray(spec.particles))
            add('invalid', `${p}.particles`, '产球必须是数组');
        else {
            spec.particles.forEach((particle, i) => {
                const pp = `${p}.particles.${i}`;
                if (!isInteger(particle?.atFrame) || particle.atFrame < 0 || (bound !== null && particle.atFrame >= bound))
                    add('invalid', `${pp}.atFrame`, '产球帧必须是非负整数且落在动作内');
                if (!isInteger(particle?.count) || particle.count <= 0)
                    add('invalid', `${pp}.count`, '产球数量必须是正整数');
                if (particle?.chance !== undefined && (!(typeof particle.chance === 'number') || !Number.isFinite(particle.chance) || particle.chance <= 0 || particle.chance > 1))
                    add('invalid', `${pp}.chance`, '产球概率必须在 (0, 1] 之间（缺省按 1 处理）');
                if (![...HIT_ELEMENTS, 'clear'].includes(particle?.element))
                    add('unsupported', `${pp}.element`, `未知粒子元素 ${String(particle?.element)}`);
                if (!isInteger(particle?.travelFrames) || particle.travelFrames < 0)
                    add('invalid', `${pp}.travelFrames`, '粒子飞行帧数必须是非负整数');
            });
        }
    }
    if (spec.delayedParticles !== undefined) {
        if (!Array.isArray(spec.delayedParticles))
            add('invalid', `${p}.delayedParticles`, '延迟产球必须是数组');
        else {
            spec.delayedParticles.forEach((particle, i) => {
                const pp = `${p}.delayedParticles.${i}`;
                // 延迟产球允许超出动作时长（召唤物在动作结束后仍会产球），但仍要与动作起手帧相对、非负。
                if (!isInteger(particle?.atFrame) || particle.atFrame < 0)
                    add('invalid', `${pp}.atFrame`, '延迟产球帧必须是非负整数（可超出动作时长）');
                if (!isInteger(particle?.count) || particle.count <= 0)
                    add('invalid', `${pp}.count`, '产球数量必须是正整数');
                if (particle?.chance !== undefined && (!(typeof particle.chance === 'number') || !Number.isFinite(particle.chance) || particle.chance <= 0 || particle.chance > 1))
                    add('invalid', `${pp}.chance`, '产球概率必须在 (0, 1] 之间（缺省按 1 处理）');
                if (![...HIT_ELEMENTS, 'clear'].includes(particle?.element))
                    add('unsupported', `${pp}.element`, `未知粒子元素 ${String(particle?.element)}`);
                if (!isInteger(particle?.travelFrames) || particle.travelFrames < 0)
                    add('invalid', `${pp}.travelFrames`, '粒子飞行帧数必须是非负整数');
            });
        }
    }
    if (spec.energyRestore !== undefined) {
        if (!Array.isArray(spec.energyRestore))
            add('invalid', `${p}.energyRestore`, '回能必须是数组');
        else {
            spec.energyRestore.forEach((restore, i) => {
                const pp = `${p}.energyRestore.${i}`;
                if (!isInteger(restore?.atFrame) || restore.atFrame < 0)
                    add('invalid', `${pp}.atFrame`, '回能帧必须是非负整数（可超出动作时长）');
                if (!isFiniteNumber(restore?.amount) || restore.amount < 0)
                    add('invalid', `${pp}.amount`, '回能量必须是非负有限数值');
                if (restore?.target !== undefined && restore.target !== 'team' && restore.target !== 'self')
                    add('invalid', `${pp}.target`, '回能目标只能是 team 或 self');
                if (restore?.rechargeScaling !== undefined && typeof restore.rechargeScaling !== 'boolean')
                    add('invalid', `${pp}.rechargeScaling`, 'rechargeScaling 必须是布尔值');
            });
        }
    }
    if (spec.energyCost !== undefined && (!isFiniteNumber(spec.energyCost) || spec.energyCost < 0))
        add('invalid', `${p}.energyCost`, '能量消耗必须是非负有限数值');
    if (spec.cooldownFrames !== undefined && (!isInteger(spec.cooldownFrames) || spec.cooldownFrames < 0))
        add('invalid', `${p}.cooldownFrames`, '冷却帧数必须是非负整数');
    if (spec.requires !== undefined && !Array.isArray(spec.requires))
        add('invalid', `${p}.requires`, '门槛标记必须是数组');
    if (spec.mechanism !== undefined && (typeof spec.mechanism !== 'string' || !spec.mechanism.trim()))
        add('invalid', `${p}.mechanism`, '机制标记必须是非空字符串');
    return issues;
}
const phaseIndex = (phase) => EVENT_PHASES.indexOf(phase);
const phaseOf = (kind) => {
    switch (kind) {
        case 'action-start': return 'action-start';
        case 'hit': return 'hit';
        case 'particle': return 'energy';
        case 'energy-restore': return 'energy';
        case 'action-end': return 'state';
        case 'effect-tick': return 'state';
    }
};
export function simulateTimeline(input) {
    const issues = [];
    const events = [];
    const hits = [];
    const requests = [];
    const approximateItems = [];
    const triggers = [];
    const add = (code, path, message) => issues.push({ code, path, message });
    const actions = input?.actions ?? {};
    issues.push(...validateFrameTier(input?.frameTier));
    if (!Array.isArray(input?.steps))
        return finish('invalid');
    if (!Array.isArray(input?.actors) || !input.actors.length)
        add('missing', 'actors', '至少需要一个角色的初始能量');
    if (!isInteger(input?.measurementEndFrame) || input.measurementEndFrame <= 0)
        add('invalid', 'measurementEndFrame', '测量终点必须是正整数帧');
    if (input?.switchFrames !== undefined && (!isInteger(input.switchFrames) || input.switchFrames < 0))
        add('invalid', 'switchFrames', '切人帧必须是非负整数');
    const actors = new Map((input?.actors ?? []).map(a => [a.actorId, { actorId: a.actorId, energy: a.energy, energyMax: a.energyMax, cooldowns: {} }]));
    for (const a of actors.values()) {
        if (!isFiniteNumber(a.energy) || a.energy < 0)
            add('invalid', `actors.${a.actorId}.energy`, '初始能量必须是非负有限数值');
        if (!isFiniteNumber(a.energyMax) || a.energyMax <= 0)
            add('invalid', `actors.${a.actorId}.energyMax`, '能量上限必须是正有限数值');
    }
    const flags = new Set(input?.stateFlags ?? []);
    const recharge = input?.energyRecharge ?? {};
    let activeActorId = input?.activeActorId;
    if (!actors.has(activeActorId))
        add('missing', 'activeActorId', '前台角色必须在 actors 里');
    // 效果运行时按帧累积状态：命中结算时先取当帧修饰，再结算这一发携带的触发，所以触发不会反过来加强自己。
    const effectRuntime = createEffectRuntime(input?.effects ?? {}, [...actors.keys()], isInteger(input?.measurementEndFrame) ? input.measurementEndFrame : 0);
    /*
     * 动作起手触发（4 件套触发式）：声明必须能兑现——效果要在效果表里登记、角色要在 actors 里，
     * 否则直接报错，不静默跳过（跳过会让「说触发了其实没触发」变成隐形低估）。
     */
    const effectTriggers = Array.isArray(input?.effectTriggers) ? input.effectTriggers : [];
    for (const [index, item] of effectTriggers.entries()) {
        const p = `effectTriggers.${index}`;
        if (!item || typeof item !== 'object') {
            add('invalid', p, '触发项必须是对象');
            continue;
        }
        if (typeof item.effectId !== 'string' || !item.effectId)
            add('missing', `${p}.effectId`, '触发项必须指出效果 id');
        else if (!effectRuntime.has(item.effectId))
            add('unsupported', `${p}.effectId`, `触发效果 ${item.effectId} 在效果表里没有登记`);
        if (!actors.has(item.actorId))
            add('missing', `${p}.actorId`, `触发角色 ${String(item.actorId)} 不在本队`);
        if (!EFFECT_TRIGGER_KINDS.includes(item.on))
            add('unsupported', `${p}.on`, `未知触发时机 ${String(item.on)}`);
        else if (HIT_TRIGGER_KINDS.includes(item.on)) {
            const spec = effectRuntime.specOf(item.effectId);
            if ((spec?.stacking === 'stack') && !spec.icdFrames)
                add('missing', `${p}.on`, '命中类触发要叠层时必须给 icdFrames（触发冷却），否则会按每一段命中无上限叠层');
        }
        else if (item.on === 'off-field-tick' && !effectRuntime.specOf(item.effectId)?.tickFrames)
            add('missing', `${p}.on`, '后台计时触发必须给 tickFrames（计时间隔）');
    }
    /*
     * 常驻效果（trigger: 'always'）：开局即生效、持续到窗口结束。
     * 在校验之后、正式推进之前注册；`offFieldOnly` 的过滤发生在每次命中结算时。
     */
    for (const item of effectTriggers) {
        if (item.on !== 'always')
            continue;
        effectRuntime.trigger(item.effectId, 0, item.actorId);
    }
    const durationCache = new Map();
    const durationOf = (spec) => {
        const cached = durationCache.get(spec);
        if (cached)
            return cached;
        const resolved = resolveActionTiming(spec.timing, input?.frameTier);
        durationCache.set(spec, resolved);
        return resolved;
    };
    /** 响应型的帧上界要拿档位折算后才能判断：同一动作换档位可能放不下原来的命中帧。 */
    const boundIssues = (spec, frames) => {
        const problems = [];
        const p = `actions.${spec.id}`;
        const tierId = input?.frameTier?.id ?? '<missing>';
        const why = spec.timing?.type === 'response' ? '响应型按当前档位折算' : '计时器型';
        (spec.hits ?? []).forEach((hit, i) => {
            if (isInteger(hit?.atFrame) && hit.atFrame >= frames)
                problems.push({ code: 'invalid', path: `${p}.hits.${i}.atFrame`, message: `在 ${tierId} 档位下动作只有 ${frames} 帧（${why}），命中帧 ${hit.atFrame} 放不进动作` });
        });
        (spec.cancelWindows ?? []).forEach((w, i) => {
            if (isInteger(w?.toFrame) && w.toFrame > frames)
                problems.push({ code: 'invalid', path: `${p}.cancelWindows.${i}`, message: `取消窗口终点 ${w.toFrame} 超出 ${tierId} 档位下的 ${frames} 帧` });
        });
        (spec.particles ?? []).forEach((particle, i) => {
            if (isInteger(particle?.atFrame) && particle.atFrame >= frames)
                problems.push({ code: 'invalid', path: `${p}.particles.${i}.atFrame`, message: `产球帧 ${particle.atFrame} 超出 ${tierId} 档位下的 ${frames} 帧` });
        });
        return problems;
    };
    let queue = [];
    let sequence = 0;
    let currentFrame = 0;
    /** 累计卡肉帧数与冻结期的结束帧（现实帧口径）。 */
    let hitlagWindows = [];
    let hitlagUntil = -1;
    /** 效果 × 角色的上一次岩元素触发帧（`geo-hit` 的 ICD 用）。 */
    const hitTriggerAt = new Map();
    const push = (item) => {
        const phase = phaseOf(item.kind);
        queue.push({ frame: item.frame, phase, sequence: sequence++, item });
        queue.sort((a, b) => a.frame - b.frame || phaseIndex(a.phase) - phaseIndex(b.phase) || a.sequence - b.sequence);
    };
    const record = (frame, phase, kind, actorId, actionId, detail) => {
        events.push({ frame, phase, sequence: sequence++, kind, ...(actorId ? { actorId } : {}), ...(actionId ? { actionId } : {}), ...(detail ? { detail } : {}) });
    };
    /**
     * 触发成功后按效果声明回能（流放者/学士）：立刻一次，或按间隔补发几次。
     * 排进队列而不是直接加，保证与粒子到达、动作结算的顺序一致。
     */
    const scheduleEffectEnergy = (effectId, frame, actorId, actionId) => {
        const restore = effectRuntime.specOf(effectId)?.energyRestore;
        if (!restore)
            return;
        const offsets = restore.everyFrames !== undefined && restore.times !== undefined
            ? Array.from({ length: restore.times }, (_, i) => restore.everyFrames * (i + 1))
            : [0];
        for (const offset of offsets) {
            push({ kind: 'energy-restore', frame: frame + offset, actorId, actionId: actionId ?? '', restore: { atFrame: offset, amount: restore.amount, target: restore.target, excludeSelf: restore.excludeSelf } });
        }
    };
    /*
     * 后台计时触发（华馆）：先按间隔把 tick 排进队列，处理时再判断角色当时在不在场。
     * 排进队列而不是在推进帧时直接算，原因是 ASAP 会反复试探候选帧，直接算会把同一次 tick 结算多遍。
     */
    for (const entry of effectTriggers) {
        if (entry.on !== 'off-field-tick')
            continue;
        const interval = Number(effectRuntime.specOf(entry.effectId)?.tickFrames) || 0;
        if (interval <= 0)
            continue;
        for (let frame = interval; frame <= input.measurementEndFrame; frame += interval) {
            push({ kind: 'effect-tick', frame, actorId: entry.actorId, effectId: entry.effectId });
        }
    }
    /**
     * 新动作开始时取消上一个动作尚未发生的命中与收尾。
     * 产球**不取消**：粒子已经发出（或召唤物会在之后产出），换人/接下一个动作不会让它消失，
     * 只按 `travelFrames` 延迟到账。2026-11-02 起由 `delayedParticles` 承载召唤物产球。
     */
    const cancelPending = (frame) => {
        queue = queue.filter(queued => queued.frame <= frame || queued.item.kind === 'action-start' ||
            queued.item.kind === 'particle' || queued.item.kind === 'energy-restore' || queued.item.kind === 'effect-tick' ||
            (queued.item.kind === 'hit' && queued.item.hit.delayed === true));
    };
    /**
     * 卡肉：`[atFrame, atFrame + frames)` 内游戏时钟冻结。做法是把排在这之后的一切整体顺延同样帧数——
     * 队列里未发生的事件、冷却期限、效果到期、当前最早可取消帧；现实帧照常消耗，所以动作变长而游戏内时间不变。
     */
    const applyHitlag = (atFrame, frames) => {
        if (frames <= 0)
            return;
        const end = atFrame + frames;
        // 同一帧的多段命中落在同一段冻结里时不叠加：只顺延超出已冻结区间的那部分。
        const delta = Math.max(0, end - Math.max(atFrame, hitlagUntil));
        hitlagWindows.push({ from: atFrame, to: end });
        hitlagUntil = Math.max(hitlagUntil, end);
        if (delta <= 0)
            return;
        approximateItems.push(`hitlag:${atFrame}:${frames}`);
        for (const queued of queue)
            if (queued.frame > atFrame)
                queued.frame += delta;
        queue.sort((a, b) => a.frame - b.frame || phaseIndex(a.phase) - phaseIndex(b.phase) || a.sequence - b.sequence);
        for (const actor of actors.values()) {
            for (const cooldownId of Object.keys(actor.cooldowns))
                if (actor.cooldowns[cooldownId] > atFrame)
                    actor.cooldowns[cooldownId] += delta;
        }
        effectRuntime.shiftAfter(atFrame, delta);
        if (currentFrame > atFrame)
            currentFrame += delta;
    };
    const readyFrame = (actorId, action, from) => {
        const actor = actors.get(actorId);
        const cooldownId = action.cooldownId ?? action.id;
        let frame = Math.max(from, actor?.cooldowns[cooldownId] ?? 0);
        if (actor && (action.energyCost ?? 0) > actor.energy) {
            const arrival = queue.find(queued => queued.item.kind === 'particle' && queued.item.actorId === actorId);
            // 粒子到达当帧先结算到达，动作最早在下一帧成立。
            frame = arrival ? Math.max(frame, arrival.frame + 1) : Number.POSITIVE_INFINITY;
        }
        return frame;
    };
    const handle = (queued) => {
        const { item } = queued;
        if (item.kind === 'hit') {
            // 后台限定（黄金剧团）：命中者在命中当帧不是前台，就算在后台。
            const modifiers = effectRuntime.modifiersAt(item.actorId, queued.frame, { offField: item.actorId !== activeActorId });
            /*
             * 能量为零时才生效的按发条件（深廊终曲）：直接在命中当帧读角色能量，
             * 不注册成持续效果——它的开关是能量状态，不是时间窗。
             */
            for (const entry of effectTriggers) {
                if (entry.on !== 'energy-zero' || entry.actorId !== item.actorId)
                    continue;
                const actor = actors.get(item.actorId);
                if ((actor?.energy ?? 0) !== 0)
                    continue;
                const spec = effectRuntime.specOf(entry.effectId);
                if (!spec?.stats)
                    continue;
                modifiers.stats = { ...modifiers.stats };
                for (const [key, value] of Object.entries(spec.stats)) {
                    const stat = key;
                    modifiers.stats[stat] = (modifiers.stats[stat] ?? 0) + (value ?? 0);
                }
            }
            // 叠层计数在命中当帧解析：效果先于本发结算，所以读到的是本发之前已经累好的层数。
            const declaredReaction = item.hit.reaction;
            const reaction = declaredReaction && declaredReaction.countFrom
                ? { ...declaredReaction, count: effectRuntime.stacksAt(declaredReaction.countFrom, item.actorId, queued.frame) }
                : declaredReaction;
            const activeEffects = effectRuntime.activeAt(item.actorId, queued.frame);
            const hitKind = actions[item.actionId]?.kind;
            const matchesHitKind = (on) => on === 'hit' ||
                (on === 'skill-hit' && hitKind === 'skill') ||
                (on === 'normal-hit' && hitKind === 'normal') ||
                (on === 'charged-hit' && hitKind === 'charged') ||
                (on === 'plunge-hit' && hitKind === 'plunge') ||
                (on === 'geo-hit' && item.hit.element === 'geo');
            /*
             * 固定值伤害（来歆余响）必须在同一发命中里结算，所以先于 `hits.push` 触发；
             * 这类效果没有面板加成，触发只用来记事件与显示，伤害走 `flatBase`。
             */
            const flatBase = [];
            const consumed = new Set();
            for (const entry of effectTriggers) {
                if (entry.actorId !== item.actorId)
                    continue;
                const flat = effectRuntime.specOf(entry.effectId)?.flatDamage;
                if (!flat || !matchesHitKind(entry.on))
                    continue;
                const fired = effectRuntime.trigger(entry.effectId, queued.frame, item.actorId);
                if (!fired)
                    continue;
                triggers.push(fired);
                consumed.add(entry.effectId);
                record(queued.frame, 'trigger', 'trigger', item.actorId, item.actionId, { effectId: entry.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: entry.on });
                flatBase.push({ effectId: entry.effectId, scaling: flat.scaling, ratio: flat.ratio });
            }
            hits.push({ frame: queued.frame, actorId: item.actorId, actionId: item.actionId, hitIndex: item.hitIndex, motionValue: item.hit.motionValue, scaling: item.hit.scaling, element: item.hit.element, canCrit: item.hit.canCrit, triggerIds: item.hit.triggerIds ?? [], reaction, modifiers, activeEffects, ...(flatBase.length ? { flatBase } : {}) });
            record(queued.frame, 'hit', 'hit', item.actorId, item.actionId, { hitIndex: item.hitIndex, motionValue: item.hit.motionValue, element: item.hit.element });
            for (const [index, effectId] of (item.hit.triggerIds ?? []).entries()) {
                if (!effectRuntime.has(effectId)) {
                    add('unsupported', `actions.${item.actionId}.hits.${item.hitIndex}.triggerIds.${index}`, `触发标记 ${effectId} 在效果表里没有登记，无法兑现`);
                    continue;
                }
                const trigger = effectRuntime.trigger(effectId, queued.frame, item.actorId);
                if (!trigger)
                    continue;
                triggers.push(trigger);
                record(queued.frame, 'trigger', 'trigger', item.actorId, item.actionId, { effectId, stacks: trigger.stacks, expiresAt: trigger.expiresAt });
            }
            /*
             * 命中类触发（skill-hit / normal-hit / charged-hit / plunge-hit / geo-hit / hit）：
             * 按动作类型与命中元素匹配，`icdFrames` 限制同效果同角色的触发间隔；
             * 与 `triggerIds` 一样在本发结算之后激活，不影响本次命中。
             */
            {
                for (const entry of effectTriggers) {
                    if (entry.actorId !== item.actorId)
                        continue;
                    if (consumed.has(entry.effectId))
                        continue;
                    if (!matchesHitKind(entry.on))
                        continue;
                    const spec = effectRuntime.specOf(entry.effectId);
                    if (spec?.hitElements && !spec.hitElements.some(element => element === item.hit.element))
                        continue;
                    const icd = Number(spec?.icdFrames) || 0;
                    const key = `${entry.effectId}@${entry.actorId}`;
                    const last = hitTriggerAt.get(key);
                    if (last !== undefined && queued.frame - last < icd)
                        continue;
                    const fired = effectRuntime.trigger(entry.effectId, queued.frame, entry.actorId, spec?.stacksPerTrigger?.[entry.on] ?? 1);
                    if (!fired)
                        continue;
                    if (icd > 0)
                        hitTriggerAt.set(key, queued.frame);
                    triggers.push(fired);
                    record(queued.frame, 'trigger', 'trigger', item.actorId, item.actionId, { effectId: entry.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: entry.on });
                    scheduleEffectEnergy(entry.effectId, queued.frame, entry.actorId, item.actionId);
                }
            }
            /*
             * 反应触发（教官一类）：本发声明的反应结算之后激活，按 `icdFrames` 限制间隔。
             * 声明在命中上的反应由数据负责，引擎不推断附着，所以这里只认「本发带了反应声明」。
             */
            if (reaction && reaction.kind !== 'none') {
                for (const entry of effectTriggers) {
                    if (entry.actorId !== item.actorId || entry.on !== 'reaction')
                        continue;
                    const spec = effectRuntime.specOf(entry.effectId);
                    const icd = Number(spec?.icdFrames) || 0;
                    const key = `${entry.effectId}@${entry.actorId}`;
                    const last = hitTriggerAt.get(key);
                    if (last !== undefined && queued.frame - last < icd)
                        continue;
                    const fired = effectRuntime.trigger(entry.effectId, queued.frame, entry.actorId);
                    if (!fired)
                        continue;
                    if (icd > 0)
                        hitTriggerAt.set(key, queued.frame);
                    triggers.push(fired);
                    record(queued.frame, 'trigger', 'trigger', item.actorId, item.actionId, { effectId: entry.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: 'reaction' });
                    scheduleEffectEnergy(entry.effectId, queued.frame, entry.actorId, item.actionId);
                }
            }
            applyHitlag(queued.frame, item.hit.hitlagFrames ?? 0);
            return;
        }
        if (item.kind === 'effect-tick') {
            // 后台计时（华馆）：角色此刻不在场才叠层；在场时这次 tick 不产生任何效果。
            if (item.actorId === activeActorId) {
                record(queued.frame, 'state', 'effect-tick', item.actorId, undefined, { effectId: item.effectId, skipped: 'on-field' });
                return;
            }
            const fired = effectRuntime.trigger(item.effectId, queued.frame, item.actorId);
            if (!fired)
                return;
            triggers.push(fired);
            record(queued.frame, 'trigger', 'trigger', item.actorId, undefined, { effectId: item.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: 'off-field-tick' });
            return;
        }
        if (item.kind === 'particle') {
            /*
             * 2026-11-02：产球按队伍共享结算（游戏里粒子是全队回能，不只是发出者）。
             * 每名角色按自己的充能效率结算 `count × ER`；暂不区分前台/后台折扣，也不做同元素加成，
             * 这两点都写进近似说明，不假装比实测更准。
             */
            const gains = {};
            const dropped = item.particle.count * (item.particle.chance ?? 1);
            for (const actor of actors.values()) {
                const gain = dropped * (recharge[actor.actorId] ?? 1);
                gains[actor.actorId] = gain;
                actor.energy = Math.min(actor.energyMax, actor.energy + gain);
            }
            record(queued.frame, 'energy', 'particle', item.actorId, item.actionId, { count: item.particle.count, chance: item.particle.chance ?? 1, element: item.particle.element, gain: gains });
            // 产球触发（学士）：获得元素微粒/晶球后回能；`icdFrames` 限制同效果的触发间隔。
            for (const entry of effectTriggers) {
                if (entry.on !== 'particle' || entry.actorId !== item.actorId)
                    continue;
                const particleSpec = effectRuntime.specOf(entry.effectId);
                const icd = Number(particleSpec?.icdFrames) || 0;
                const key = `${entry.effectId}@${entry.actorId}`;
                const last = hitTriggerAt.get(key);
                if (last !== undefined && queued.frame - last < icd)
                    continue;
                const fired = effectRuntime.trigger(entry.effectId, queued.frame, entry.actorId);
                if (!fired)
                    continue;
                if (icd > 0)
                    hitTriggerAt.set(key, queued.frame);
                triggers.push(fired);
                record(queued.frame, 'trigger', 'trigger', item.actorId, item.actionId, { effectId: entry.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: 'particle' });
                scheduleEffectEnergy(entry.effectId, queued.frame, entry.actorId, item.actionId);
            }
            return;
        }
        if (item.kind === 'energy-restore') {
            /*
             * 动作直接回能（爆发/领域）：与粒子不同，不走充能效率（雷神 A4 是显式倍率）。
             * `target: 'team'` 时全队每人各加一份；记录里写清实际加了多少。
             */
            const restore = item.restore;
            const casterEr = recharge[item.actorId] ?? 1;
            const scale = restore.rechargeScaling === true
                ? 1 + 0.006 * Math.floor(Math.max(casterEr - 1, 0) * 100)
                : 1;
            const amount = restore.amount * scale;
            const target = restore.target ?? 'team';
            const gains = {};
            for (const actor of actors.values()) {
                if (restore.excludeSelf && actor.actorId === item.actorId)
                    continue;
                if (target === 'self' && actor.actorId !== item.actorId)
                    continue;
                gains[actor.actorId] = amount;
                actor.energy = Math.min(actor.energyMax, actor.energy + amount);
            }
            record(queued.frame, 'energy', 'energy-restore', item.actorId, item.actionId, { amount, scale, target, gain: gains });
            return;
        }
        if (item.kind === 'action-end') {
            record(queued.frame, 'state', 'action-end', item.actorId, item.actionId);
            return;
        }
        record(queued.frame, 'action-start', 'action-start', item.actorId, item.actionId);
    };
    /**
     * 结算 `frame` 之前的事件。`includeHitsAtFrame` 额外结算落在 `frame` 当帧的命中——
     * 请求帧正好压在命中帧上时必须先知道这一发的卡肉，否则动作会在冻结期里起手；
     * 产球等后续相位仍留到下一帧，保持「能量到达后先结算、动作下一帧成立」的口径。
     */
    const processUntil = (frame, includeHitsAtFrame = false) => {
        while (queue.length) {
            const head = queue[0];
            if (head.frame < frame) {
                handle(queue.shift());
                continue;
            }
            if (includeHitsAtFrame && head.frame === frame && phaseIndex(head.phase) <= phaseIndex('hit')) {
                handle(queue.shift());
                continue;
            }
            break;
        }
    };
    const reject = (step, frame) => {
        record(frame, 'action-start', 'rejected', step.actorId, step.actionId, { reason: 'not-ready' });
        return { stepId: step.id, requestedFrame: frame, actualFrame: null, ok: false, reason: 'not-ready' };
    };
    /** 检查动作在指定帧是否成立：只收集问题，不改能量与冷却，便于 ASAP 反复试探。 */
    const checkAction = (step, spec, frame) => {
        const problems = [];
        const p = `steps.${step.id}`;
        processUntil(frame, true);
        if (spec.actorId !== step.actorId)
            problems.push({ code: 'invalid', path: `${p}.actorId`, message: `动作 ${spec.id} 属于 ${spec.actorId}，不能由 ${step.actorId} 发起` });
        if (step.actorId !== activeActorId)
            problems.push({ code: 'invalid', path: `${p}.actorId`, message: `动作必须由前台角色发起，当前前台是 ${activeActorId}` });
        const missing = (spec.requires ?? []).filter(flag => !flags.has(flag));
        if (missing.length)
            problems.push({ code: 'missing', path: `${p}.requires`, message: `动作前置状态未满足：${missing.join('、')}` });
        if (frame < currentFrame)
            problems.push({ code: 'invalid', path: `${p}.atFrame`, message: `动作请求帧 ${frame} 早于上一动作最早可取消帧 ${currentFrame}` });
        if (frame > input.measurementEndFrame)
            problems.push({ code: 'invalid', path: `${p}.atFrame`, message: `动作请求帧 ${frame} 超出测量窗口 ${input.measurementEndFrame}` });
        const actor = actors.get(step.actorId);
        if (actor && (spec.energyCost ?? 0) > actor.energy)
            problems.push({ code: 'invalid', path: `${p}.energy`, message: `动作需要 ${spec.energyCost} 能量，当前 ${actor.energy}` });
        const cooldownId = spec.cooldownId ?? spec.id;
        if (actor && frame < (actor.cooldowns[cooldownId] ?? 0))
            problems.push({ code: 'invalid', path: `${p}.cooldown`, message: `冷却到 ${actor.cooldowns[cooldownId]} 帧才结束，请求在 ${frame} 帧` });
        if (frame < hitlagUntil)
            problems.push({ code: 'invalid', path: `${p}.hitlag`, message: `第 ${frame} 帧仍在卡肉冻结期内（冻结到第 ${hitlagUntil - 1} 帧），游戏时钟不走，动作最早只能在 ${hitlagUntil} 帧开始` });
        return problems;
    };
    /** 成立后执行：扣能量、进冷却、取消上一动作未发生的段并登记事件。 */
    const perform = (step, spec, frame, requestedFrame) => {
        processUntil(frame);
        const actor = actors.get(step.actorId);
        const cooldownId = spec.cooldownId ?? spec.id;
        if (actor) {
            actor.energy -= spec.energyCost ?? 0;
            if (spec.cooldownFrames)
                actor.cooldowns[cooldownId] = frame + spec.cooldownFrames;
        }
        cancelPending(frame);
        const frames = durationOf(spec).frames;
        record(frame, 'action-start', 'action-start', step.actorId, step.actionId);
        // 4 件套触发式：施放战技 / 爆发当帧激活；同帧先于本次动作的命中结算。
        const castTrigger = spec.kind === 'skill' ? 'cast-skill' : spec.kind === 'burst' ? 'cast-burst' : null;
        if (castTrigger) {
            for (const item of effectTriggers) {
                if (item.actorId !== step.actorId || item.on !== castTrigger)
                    continue;
                const castSpec = effectRuntime.specOf(item.effectId);
                const cost = Number(castSpec?.energyCost) || 0;
                if (cost > 0) {
                    if (!actor || actor.energy < cost) {
                        record(frame, 'state', 'trigger', step.actorId, spec.id, { effectId: item.effectId, skipped: 'energy', required: cost, current: actor?.energy ?? 0 });
                        continue;
                    }
                    actor.energy -= cost;
                    record(frame, 'energy', 'trigger-cost', step.actorId, spec.id, { effectId: item.effectId, amount: cost, remaining: actor.energy });
                }
                const fired = effectRuntime.trigger(item.effectId, frame, step.actorId);
                if (!fired)
                    continue;
                triggers.push(fired);
                record(frame, 'trigger', 'trigger', step.actorId, spec.id, { effectId: item.effectId, stacks: fired.stacks, expiresAt: fired.expiresAt, source: 'cast' });
                scheduleEffectEnergy(item.effectId, frame, step.actorId, spec.id);
            }
        }
        push({ kind: 'action-end', frame: frame + frames, actorId: step.actorId, actionId: spec.id });
        spec.hits.forEach((hit, hitIndex) => push({ kind: 'hit', frame: frame + hit.atFrame, actorId: step.actorId, actionId: spec.id, hitIndex, hit }));
        for (const particle of spec.particles ?? [])
            push({ kind: 'particle', frame: frame + particle.atFrame + particle.travelFrames, actorId: step.actorId, actionId: spec.id, particle });
        for (const particle of spec.delayedParticles ?? [])
            push({ kind: 'particle', frame: frame + particle.atFrame + particle.travelFrames, actorId: step.actorId, actionId: spec.id, particle });
        for (const restore of spec.energyRestore ?? [])
            push({ kind: 'energy-restore', frame: frame + restore.atFrame, actorId: step.actorId, actionId: spec.id, restore });
        const earliestCancel = spec.cancelWindows?.length ? Math.min(...spec.cancelWindows.map(w => w.fromFrame)) : frames;
        currentFrame = frame + earliestCancel;
        return { stepId: step.id, requestedFrame, actualFrame: frame, ok: true };
    };
    for (const step of input.steps) {
        if (!step || typeof step !== 'object') {
            add('invalid', 'steps', '步骤必须是对象');
            continue;
        }
        const node = step;
        const kind = node.kind ?? '';
        if (kind !== 'wait' && kind !== 'switch' && kind !== 'action') {
            add('unsupported', `steps.${node.id ?? '<unknown>'}.kind`, `未知步骤类型 ${kind || '<missing>'}`);
            continue;
        }
        if (node.kind === 'wait') {
            if (!isInteger(node.frames) || node.frames <= 0) {
                add('invalid', `steps.${node.id}.frames`, '等待帧数必须是正整数');
                continue;
            }
            currentFrame += node.frames;
            record(currentFrame, 'state', 'wait', undefined, undefined, { frames: node.frames });
            continue;
        }
        if (node.atFrame !== undefined && (!isInteger(node.atFrame) || node.atFrame < 0))
            add('invalid', `steps.${node.id}.atFrame`, '请求帧必须是非负整数');
        /*
         * `asap-sequence` 下没有显式帧：动作按顺序尽早执行，换人也一样。
         * 换人最早只能发生在上一动作的最早可取消帧（`currentFrame`），所以缺省请求帧取这个位置；
         * 若落在卡肉冻结里，下面会再顺延到 `hitlagUntil`。
         */
        const frame = node.atFrame ?? (input.scheduler === 'asap-sequence' && node.kind === 'switch' ? Math.max(currentFrame, hitlagUntil) : 0);
        if (node.kind === 'switch') {
            processUntil(frame, true);
            const switchFrames = input.switchFrames ?? 0;
            if (node.actorId === activeActorId) {
                add('invalid', `steps.${node.id}.actorId`, '目标已经是前台角色');
                continue;
            }
            if (!actors.has(node.actorId)) {
                add('missing', `steps.${node.id}.actorId`, `切换目标 ${node.actorId} 不在队伍中`);
                continue;
            }
            if (frame > input.measurementEndFrame) {
                add('invalid', `steps.${node.id}.atFrame`, `换人请求帧 ${frame} 超出测量窗口 ${input.measurementEndFrame}`);
                continue;
            }
            // 换人与动作同口径：压在上一动作最早可取消帧之前就换不出去，画面还在动作里。
            if (frame < currentFrame) {
                add('invalid', `steps.${node.id}.atFrame`, `换人请求帧 ${frame} 早于上一动作最早可取消帧 ${currentFrame}，这时还换不出去`);
                continue;
            }
            // 卡肉冻结期内不能切人：请求帧落在冻结里就顺延到冻结结束，结果里两个帧都记下。
            const actual = Math.max(frame, hitlagUntil);
            const from = activeActorId;
            // 换人取消上一动作尚未发生的命中与产球：后摇被换人打断，落空的那几段不能再结算。
            cancelPending(actual);
            activeActorId = node.actorId;
            record(actual, 'state', 'switch', node.actorId, undefined, { switchFrames, requestedFrame: frame, from });
            currentFrame = Math.max(currentFrame, actual + switchFrames);
            continue;
        }
        const spec = actions[node.actionId];
        if (!spec) {
            add('unsupported', `steps.${node.id}`, `动作 ${node.actionId} 未登记，拒绝轴`);
            record(Math.max(frame, currentFrame), 'action-start', 'rejected', node.actorId, node.actionId, { reason: 'action-not-registered' });
            requests.push({ stepId: node.id ?? '<unknown>', requestedFrame: frame, actualFrame: null, ok: false, reason: 'action-not-registered' });
            continue;
        }
        const specIssues = validateActionSpec(spec);
        if (specIssues.length) {
            issues.push(...specIssues);
            requests.push(reject(node, frame));
            continue;
        }
        if (spec.timing?.type === 'response') {
            const resolved = durationOf(spec);
            if (!Number.isFinite(resolved.frames)) {
                add('invalid', `actions.${spec.id}.timing`, `无法在 ${input?.frameTier?.id ?? '当前档位'} 下折算响应型时长：帧率或 k、bMs 不自洽`);
                requests.push(reject(node, frame));
                continue;
            }
            const bounds = boundIssues(spec, resolved.frames);
            if (bounds.length) {
                issues.push(...bounds);
                requests.push(reject(node, frame));
                continue;
            }
        }
        if (input.scheduler === 'asap-sequence') {
            let attempt = 0;
            let request = Math.max(frame, currentFrame, hitlagUntil);
            /*
             * 可选步骤（`optional: true`）：攒不够能量/冷却没转好时**跳过这一步继续往下排**，
             * 而不是把整份轴判死。典型用途是 0 能量起手的循环轴里放爆发——前几轮放不出就跳过，
             * 后面攒够了自然会打出去；非 optional 的步骤仍按原口径报错。
             */
            const skipOptional = (reason) => {
                requests.push({ stepId: node.id ?? '<unknown>', requestedFrame: request, actualFrame: null, ok: false, reason });
            };
            for (;;) {
                const problems = checkAction(node, spec, request);
                if (!problems.length) {
                    requests.push(perform(node, spec, request, frame));
                    break;
                }
                const deferrable = problems.every(problem => problem.path.endsWith('.energy') || problem.path.endsWith('.cooldown') || problem.path.endsWith('.hitlag'));
                if (!deferrable) {
                    if (node.optional === true) {
                        skipOptional('optional-skipped');
                        break;
                    }
                    issues.push(...problems);
                    requests.push(reject(node, request));
                    break;
                }
                const next = Math.max(readyFrame(node.actorId, spec, request), hitlagUntil);
                if (!Number.isFinite(next) || next > input.measurementEndFrame || attempt++ > 64) {
                    if (node.optional === true) {
                        skipOptional('optional-skipped');
                        break;
                    }
                    add('invalid', `steps.${node.id}.deadlock`, `ASAP 在测量窗口内等不到可用状态，最后请求帧 ${request}`);
                    requests.push(reject(node, request));
                    break;
                }
                request = next;
            }
            continue;
        }
        const problems = checkAction(node, spec, frame);
        if (problems.length) {
            issues.push(...problems);
            requests.push(reject(node, frame));
            continue;
        }
        requests.push(perform(node, spec, frame, frame));
    }
    while (queue.length)
        handle(queue.shift());
    if (hitlagWindows.length)
        approximateItems.push('hitlag 时长来自数据、未经实测校准：受影响的收尾、冷却与效果到期都按数据顺延');
    return finish(issues.length ? 'invalid' : 'simulated');
    function finish(status) {
        const tier = input?.frameTier;
        const validFps = tier && isFiniteNumber(tier.fps) && tier.fps > 0;
        const realMsPerFrame = validFps ? 1000 / tier.fps : 0;
        const tick = tier && isInteger(tier.timerTickMs) && tier.timerTickMs > 0 ? tier.timerTickMs : 0;
        // 只统计落在结束帧之前的冻结段，重叠的冻结段先合并再累加（同帧多段命中不叠加）。
        const frozenFrames = (() => {
            const windows = hitlagWindows
                .map(w => ({ from: w.from, to: Math.min(currentFrame, w.to) }))
                .filter(w => w.to > w.from)
                .sort((a, b) => a.from - b.from);
            let total = 0;
            let from = -1;
            let to = -1;
            for (const w of windows) {
                if (w.from > to) {
                    if (to > from)
                        total += to - from;
                    from = w.from;
                    to = w.to;
                }
                else {
                    to = Math.max(to, w.to);
                }
            }
            if (to > from)
                total += to - from;
            return total;
        })();
        return {
            status,
            simulationReady: false,
            accuracy: approximateItems.length ? 'approximate' : 'verified',
            timing: {
                tierId: tier?.id ?? '',
                fps: validFps ? tier.fps : 0,
                timerTickMs: tick,
                gameMsPerFrame: tick,
                realMsPerFrame,
                timerSecondsPerGameSecond: tick > 0 ? realMsPerFrame / tick : 0,
                hitlagFrames: frozenFrames,
                gameMs: (currentFrame - frozenFrames) * tick,
                realMs: currentFrame * realMsPerFrame,
                assumptions: ['constant-frame-rate']
            },
            approximateItems: [...new Set(approximateItems)],
            endFrame: currentFrame,
            events,
            hits,
            triggers,
            effects: effectRuntime.snapshot(),
            actors: [...actors.values()].map(a => ({ actorId: a.actorId, energy: a.energy, energyMax: a.energyMax, cooldowns: { ...a.cooldowns } })),
            requests,
            issues
        };
    }
}
//# sourceMappingURL=timeline.js.map