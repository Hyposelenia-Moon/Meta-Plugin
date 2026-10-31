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
            if (bound !== null && isInteger(hit.atFrame) && hit.atFrame >= bound)
                add('invalid', `${hp}.atFrame`, '命中帧不能超出动作时长');
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
            if (hit.element !== 'geo' && hit.element !== 'physical')
                add('unsupported', `${hp}.element`, `P1 只支持岩与物理命中，收到 ${String(hit.element)}`);
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
                if (!['geo', 'physical', 'clear'].includes(particle?.element))
                    add('unsupported', `${pp}.element`, `未知粒子元素 ${String(particle?.element)}`);
                if (!isInteger(particle?.travelFrames) || particle.travelFrames < 0)
                    add('invalid', `${pp}.travelFrames`, '粒子飞行帧数必须是非负整数');
            });
        }
    }
    if (spec.energyCost !== undefined && (!isFiniteNumber(spec.energyCost) || spec.energyCost < 0))
        add('invalid', `${p}.energyCost`, '能量消耗必须是非负有限数值');
    if (spec.cooldownFrames !== undefined && (!isInteger(spec.cooldownFrames) || spec.cooldownFrames < 0))
        add('invalid', `${p}.cooldownFrames`, '冷却帧数必须是非负整数');
    if (spec.requires !== undefined && !Array.isArray(spec.requires))
        add('invalid', `${p}.requires`, '门槛标记必须是数组');
    if (spec.hitlagFrames !== undefined && (!isInteger(spec.hitlagFrames) || spec.hitlagFrames < 0))
        add('invalid', `${p}.hitlagFrames`, '卡肉帧数必须是非负整数');
    return issues;
}
const phaseIndex = (phase) => EVENT_PHASES.indexOf(phase);
const phaseOf = (kind) => {
    switch (kind) {
        case 'action-start': return 'action-start';
        case 'hit': return 'hit';
        case 'particle': return 'energy';
        case 'action-end': return 'state';
    }
};
export function simulateTimeline(input) {
    const issues = [];
    const events = [];
    const hits = [];
    const requests = [];
    const approximateItems = [];
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
    const durationCache = new Map();
    const durationOf = (spec) => {
        const cached = durationCache.get(spec.id);
        if (cached)
            return cached;
        const resolved = resolveActionTiming(spec.timing, input?.frameTier);
        durationCache.set(spec.id, resolved);
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
    const push = (item) => {
        const phase = phaseOf(item.kind);
        queue.push({ frame: item.frame, phase, sequence: sequence++, item });
        queue.sort((a, b) => a.frame - b.frame || phaseIndex(a.phase) - phaseIndex(b.phase) || a.sequence - b.sequence);
    };
    const record = (frame, phase, kind, actorId, actionId, detail) => {
        events.push({ frame, phase, sequence: sequence++, kind, ...(actorId ? { actorId } : {}), ...(actionId ? { actionId } : {}), ...(detail ? { detail } : {}) });
    };
    /** 新动作开始时取消上一个动作尚未发生的命中、产球与收尾。 */
    const cancelPending = (frame) => {
        queue = queue.filter(queued => queued.frame <= frame || queued.item.kind === 'action-start');
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
            hits.push({ frame: queued.frame, actorId: item.actorId, actionId: item.actionId, hitIndex: item.hitIndex, motionValue: item.hit.motionValue, scaling: item.hit.scaling, element: item.hit.element, canCrit: item.hit.canCrit, triggerIds: item.hit.triggerIds ?? [] });
            record(queued.frame, 'hit', 'hit', item.actorId, item.actionId, { hitIndex: item.hitIndex, motionValue: item.hit.motionValue, element: item.hit.element });
            return;
        }
        if (item.kind === 'particle') {
            const actor = actors.get(item.actorId);
            const gain = item.particle.count * (recharge[item.actorId] ?? 1);
            if (actor)
                actor.energy = Math.min(actor.energyMax, actor.energy + gain);
            record(queued.frame, 'energy', 'particle', item.actorId, item.actionId, { count: item.particle.count, element: item.particle.element, gain });
            return;
        }
        if (item.kind === 'action-end') {
            record(queued.frame, 'state', 'action-end', item.actorId, item.actionId);
            return;
        }
        record(queued.frame, 'action-start', 'action-start', item.actorId, item.actionId);
    };
    const processUntil = (frame) => {
        while (queue.length && queue[0].frame < frame)
            handle(queue.shift());
    };
    const reject = (step, frame) => {
        record(frame, 'action-start', 'rejected', step.actorId, step.actionId, { reason: 'not-ready' });
        return { stepId: step.id, requestedFrame: frame, actualFrame: null, ok: false, reason: 'not-ready' };
    };
    /** 检查动作在指定帧是否成立：只收集问题，不改能量与冷却，便于 ASAP 反复试探。 */
    const checkAction = (step, spec, frame) => {
        const problems = [];
        const p = `steps.${step.id}`;
        processUntil(frame);
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
        if (spec.hitlagFrames)
            approximateItems.push(`hitlag:${spec.id}`);
        cancelPending(frame);
        const frames = durationOf(spec).frames;
        record(frame, 'action-start', 'action-start', step.actorId, step.actionId);
        push({ kind: 'action-end', frame: frame + frames, actorId: step.actorId, actionId: spec.id });
        spec.hits.forEach((hit, hitIndex) => push({ kind: 'hit', frame: frame + hit.atFrame, actorId: step.actorId, actionId: spec.id, hitIndex, hit }));
        for (const particle of spec.particles ?? [])
            push({ kind: 'particle', frame: frame + particle.atFrame + particle.travelFrames, actorId: step.actorId, actionId: spec.id, particle });
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
        const frame = node.atFrame ?? 0;
        if (node.kind === 'switch') {
            processUntil(frame);
            const switchFrames = input.switchFrames ?? 0;
            if (node.actorId === activeActorId) {
                add('invalid', `steps.${node.id}.actorId`, '目标已经是前台角色');
                continue;
            }
            if (!actors.has(node.actorId)) {
                add('missing', `steps.${node.id}.actorId`, `切换目标 ${node.actorId} 不在队伍中`);
                continue;
            }
            activeActorId = node.actorId;
            record(frame, 'state', 'switch', node.actorId, undefined, { switchFrames });
            currentFrame = Math.max(currentFrame, frame + switchFrames);
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
            let request = Math.max(frame, currentFrame);
            for (;;) {
                const problems = checkAction(node, spec, request);
                if (!problems.length) {
                    requests.push(perform(node, spec, request, request));
                    break;
                }
                const deferrable = problems.every(problem => problem.path.endsWith('.energy') || problem.path.endsWith('.cooldown'));
                if (!deferrable) {
                    issues.push(...problems);
                    requests.push(reject(node, request));
                    break;
                }
                const next = readyFrame(node.actorId, spec, request);
                if (!Number.isFinite(next) || next > input.measurementEndFrame || attempt++ > 64) {
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
    if (approximateItems.length)
        approximateItems.push('hitlag 未建模：命名帧未校准，时长与窗口内命中数只能算近似');
    return finish(issues.length ? 'invalid' : 'simulated');
    function finish(status) {
        const tier = input?.frameTier;
        const validFps = tier && isFiniteNumber(tier.fps) && tier.fps > 0;
        const realMsPerFrame = validFps ? 1000 / tier.fps : 0;
        const tick = tier && isInteger(tier.timerTickMs) && tier.timerTickMs > 0 ? tier.timerTickMs : 0;
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
                gameMs: currentFrame * tick,
                realMs: currentFrame * realMsPerFrame,
                assumptions: ['constant-frame-rate']
            },
            approximateItems: [...new Set(approximateItems)],
            endFrame: currentFrame,
            events,
            hits,
            actors: [...actors.values()].map(a => ({ actorId: a.actorId, energy: a.energy, energyMax: a.energyMax, cooldowns: { ...a.cooldowns } })),
            requests,
            issues
        };
    }
}
//# sourceMappingURL=timeline.js.map