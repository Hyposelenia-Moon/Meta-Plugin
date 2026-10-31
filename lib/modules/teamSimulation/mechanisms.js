/**
 * P1 纯岩四角色的机制常量。
 *
 * 数值全部来自 miao-plugin `resources/meta-gs/character/<角色>/data.json`
 * 的天赋表（天赋 10 级）与技能描述，不含任何估算：
 * - 一斗 Q：攻击力提高 103.68%（基于防御），持续 11 秒；乱神之怪力上限 5 层、持续 60 秒。
 * - 五郎 E：防御力提升 371.09（固定值），岩元素伤害加成 15%（仅 3 名岩元素角色时），
 *   持续 10 秒，离开领域后效果再持续 2 秒。
 * - 阿贝多 E：阳华持续 30 秒，每 2 秒最多生成一次刹那之花，伤害 240.48%、基于防御力。
 * - 钟离长按 E：玉璋护盾持续 20 秒，庇护角色使附近敌人元素抗性与物理抗性降低 20%。
 *
 * 动作帧数、卡肉帧数、产球数据不在 miao 里（全仓无任何帧数据），
 * 这些字段由调用方的数据包声明；本模块只消费它们，不猜。
 */
export const GEO_MECHANICS = {
    source: 'miao-plugin resources/meta-gs/character（天赋 10 级文本与倍率表）',
    itto: {
        burstAtkFromDef: 1.0368,
        burstSeconds: 11,
        stackMax: 5,
        stackSeconds: 60,
    },
    gorou: {
        flatDef: 371.09,
        geoDamageBonus: 0.15,
        fieldSeconds: 10,
        lingerSeconds: 2,
    },
    albedo: {
        skillSeconds: 30,
        procIntervalSeconds: 2,
        procMotionValue: 2.4048,
    },
    zhongli: {
        shieldSeconds: 20,
        resistanceReduction: 0.2,
    },
};
const seconds = (value, tier) => Math.round(value * tier.fps);
/**
 * 按固定轴推算「每一帧前台是谁」。切人与起手都改变前台，动作本身的持续不改变前台。
 * ASAP 调度与等待步骤无法在不跑内核的前提下定帧，因此直接拒绝，不猜。
 */
function activeSegments(rotation, endFrame) {
    const issues = [];
    if (rotation.scheduler !== 'fixed') {
        issues.push({ code: 'unsupported', path: 'rotation.scheduler', message: '机制规划目前只支持 fixed 调度：ASAP 的实际帧要跑完内核才知道' });
        return { segments: [], issues };
    }
    if (rotation.steps.some(step => step.kind === 'wait')) {
        issues.push({ code: 'unsupported', path: 'rotation.steps', message: '机制规划不支持等待步骤：等待会改变后续动作的实际帧' });
        return { segments: [], issues };
    }
    const points = [];
    for (const [index, step] of rotation.steps.entries()) {
        if (step.kind === 'wait')
            continue;
        const frame = step.atFrame;
        if (!Number.isInteger(frame)) {
            issues.push({ code: 'invalid', path: `rotation.steps.${index}.atFrame`, message: '固定调度下每个动作/切人步骤都必须给出帧号' });
            return { segments: [], issues };
        }
        points.push({ frame: frame, actorId: step.actorId });
    }
    points.sort((a, b) => a.frame - b.frame);
    const segments = [];
    let cursor = 0;
    let actor = rotation.activeActorId;
    for (const point of points) {
        if (point.frame > cursor)
            segments.push({ fromFrame: cursor, toFrame: point.frame, actorId: actor });
        actor = point.actorId;
        cursor = point.frame;
    }
    if (cursor < endFrame)
        segments.push({ fromFrame: cursor, toFrame: endFrame, actorId: actor });
    return { segments, issues };
}
/** 把 [from, to) 按前台分段切开，只保留指定角色当场的片段。 */
function sliceByActive(segments, actorId, from, to) {
    const out = [];
    for (const segment of segments) {
        if (segment.actorId !== actorId)
            continue;
        const start = Math.max(from, segment.fromFrame);
        const end = Math.min(to, segment.toFrame);
        if (end > start)
            out.push({ fromFrame: start, toFrame: end });
    }
    return out;
}
/**
 * 机制规划：把角色机制折算成「面板窗口 / 敌人窗口 / 召唤物命中 / 资源合法性」四类结果。
 * 只做确定性的算术，不查表猜数值；缺标记或缺面板时返回 issues，由调用方决定整轮拒绝。
 */
export function planMechanisms(input) {
    const empty = { statWindows: [], enemyWindows: [], summonHits: [], checks: [], approximate: [] };
    if (!input || typeof input !== 'object') {
        return { plan: empty, issues: [{ code: 'invalid', path: 'mechanisms', message: '机制规划输入必须是对象' }] };
    }
    const { pack, rotation, contexts, builds, tier } = input;
    if (!tier || typeof tier.fps !== 'number' || tier.fps <= 0) {
        return { plan: empty, issues: [{ code: 'missing', path: 'mechanisms.frameTier', message: '必须先确定帧率档位，秒数才能折算成帧' }] };
    }
    const issues = [];
    const { segments, issues: segmentIssues } = activeSegments(rotation, rotation.measurementEndFrame);
    if (segmentIssues.length)
        return { plan: empty, issues: segmentIssues };
    const geoCount = Object.values(builds).filter(build => build.element === 'geo').length;
    const plan = { statWindows: [], enemyWindows: [], summonHits: [], checks: [], approximate: [] };
    const tagged = [];
    for (const [index, step] of rotation.steps.entries()) {
        if (step.kind !== 'action')
            continue;
        const action = pack.actions[step.actionId];
        if (!action) {
            issues.push({ code: 'unsupported', path: `rotation.steps.${index}.actionId`, message: `动作 ${step.actionId} 不在数据包内` });
            continue;
        }
        const tag = action.mechanism;
        if (tag === undefined)
            continue;
        if (typeof tag !== 'string') {
            issues.push({ code: 'invalid', path: `actions.${action.id}.mechanism`, message: '机制标记必须是非空字符串' });
            continue;
        }
        const frame = step.atFrame;
        if (!Number.isInteger(frame)) {
            issues.push({ code: 'invalid', path: `rotation.steps.${index}.atFrame`, message: '带机制标记的动作必须给出起手帧' });
            continue;
        }
        tagged.push({ frame: frame, tag: tag, actorId: step.actorId });
    }
    if (issues.length)
        return { plan: empty, issues };
    for (const { frame, tag, actorId } of tagged) {
        if (tag === 'itto-q') {
            const context = contexts[actorId];
            if (!context) {
                issues.push({ code: 'unsupported', path: `mechanisms.${tag}`, message: `角色 ${actorId} 没有面板，无法按防御力折算攻击力` });
                continue;
            }
            const duration = seconds(GEO_MECHANICS.itto.burstSeconds, tier);
            const atk = context.stats.def * GEO_MECHANICS.itto.burstAtkFromDef;
            for (const slice of sliceByActive(segments, actorId, frame, frame + duration)) {
                plan.statWindows.push({
                    id: `itto-q:${slice.fromFrame}`,
                    actorId,
                    fromFrame: slice.fromFrame,
                    toFrame: slice.toFrame,
                    stats: { atk },
                    source: 'itto-q'
                });
            }
            plan.approximate.push('一斗 Q 的攻击速度提升 10% 未进入帧表：动作帧数沿用数据声明');
        }
        if (tag === 'gorou-e') {
            const duration = seconds(GEO_MECHANICS.gorou.fieldSeconds + GEO_MECHANICS.gorou.lingerSeconds, tier);
            const stats = { def: GEO_MECHANICS.gorou.flatDef };
            if (geoCount >= 3)
                stats.geo = GEO_MECHANICS.gorou.geoDamageBonus;
            for (const segment of segments) {
                const start = Math.max(frame, segment.fromFrame);
                const end = Math.min(frame + duration, segment.toFrame);
                if (end <= start)
                    continue;
                plan.statWindows.push({ id: `gorou-e:${start}`, actorId: segment.actorId, fromFrame: start, toFrame: end, stats, source: 'gorou-e' });
            }
            plan.checks.push({
                id: 'gorou-e.geo-count',
                status: 'ok',
                message: `施放时岩元素角色 ${geoCount} 名：${geoCount >= 3 ? '同时获得防御力与岩元素伤害加成' : geoCount >= 1 ? '只有防御力提升，岩伤加成需要 3 名岩元素角色' : '没有岩元素角色，领域效果为空'}`
            });
        }
        if (tag === 'zhongli-hold-e') {
            plan.enemyWindows.push({
                id: `zhongli-shield:${frame}`,
                fromFrame: frame,
                toFrame: frame + seconds(GEO_MECHANICS.zhongli.shieldSeconds, tier),
                enemy: { resistanceReduction: GEO_MECHANICS.zhongli.resistanceReduction, defenseReduction: 0, defenseIgnore: 0 },
                source: 'zhongli-shield'
            });
            plan.checks.push({ id: 'zhongli-shield.uptime', status: 'ok', message: `玉璋护盾 ${GEO_MECHANICS.zhongli.shieldSeconds} 秒内提供 20% 减抗，护盾吸收量与坚璧叠层不参与伤害结算` });
        }
        if (tag === 'albedo-e') {
            const interval = seconds(GEO_MECHANICS.albedo.procIntervalSeconds, tier);
            const end = frame + seconds(GEO_MECHANICS.albedo.skillSeconds, tier);
            let count = 0;
            for (let atFrame = frame + interval; atFrame < Math.min(end, rotation.measurementEndFrame); atFrame += interval) {
                plan.summonHits.push({
                    ownerId: actorId,
                    atFrame,
                    motionValue: GEO_MECHANICS.albedo.procMotionValue,
                    scaling: 'def',
                    element: 'geo',
                    canCrit: true,
                    source: 'albedo-solar-isotoma'
                });
                count += 1;
            }
            plan.approximate.push('阿贝多刹那之花按固定 2 秒一次的周期展开：触发条件（领域内敌人受到伤害）与随机产球未建模');
            plan.checks.push({ id: 'albedo-e.procs', status: 'ok', message: `阳华持续期内展开 ${count} 次刹那之花` });
        }
    }
    // 一斗乱神之怪力：NA2 给 1 层、NA4 给 2 层，逆袈裟每段消耗 1 层；层数不能为负。
    const ittoSteps = rotation.steps.filter(step => step.kind === 'action');
    let stacks = 0;
    let stackViolation = null;
    for (const step of ittoSteps) {
        const action = pack.actions[step.actionId];
        if (!action)
            continue;
        const tag = action.mechanism;
        if (tag === 'itto-na2')
            stacks = Math.min(GEO_MECHANICS.itto.stackMax, stacks + 1);
        if (tag === 'itto-na4')
            stacks = Math.min(GEO_MECHANICS.itto.stackMax, stacks + 2);
        if (tag === 'itto-charged') {
            const hits = action.hits.length;
            stacks -= hits;
            if (stacks < 0) {
                stackViolation = `逆袈裟需要 ${hits} 层乱神之怪力，但前序普通攻击只攒到 ${stacks + hits} 层`;
                stacks = 0;
            }
        }
    }
    plan.checks.push({
        id: 'itto.stacks',
        status: stackViolation ? 'violation' : 'ok',
        message: stackViolation ?? `乱神之怪力层数合法，结束时 ${stacks} 层（上限 ${GEO_MECHANICS.itto.stackMax}、持续 ${GEO_MECHANICS.itto.stackSeconds} 秒）`
    });
    return { plan, issues: [] };
}
//# sourceMappingURL=mechanisms.js.map