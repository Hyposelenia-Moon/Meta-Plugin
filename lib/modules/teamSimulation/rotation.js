import { validateFrameTier } from './timeline.js';
/** 校验轴：帧率档位、窗口、步骤引用、角色初始资源与切人目标。 */
export function validateRotation(spec, pack) {
    const issues = [];
    const add = (code, path, message) => issues.push({ code, path, message });
    if (!spec || typeof spec !== 'object')
        return [{ code: 'missing', path: 'rotation', message: '必须提供轴定义' }];
    if (typeof spec.id !== 'string' || !spec.id.trim())
        add('invalid', 'rotation.id', '轴必须有稳定 id');
    if (!['fixed', 'asap-sequence'].includes(spec.scheduler))
        add('unsupported', 'rotation.scheduler', `未知调度方式 ${String(spec.scheduler)}`);
    issues.push(...validateFrameTier(spec.frameTier).map(issue => ({ ...issue, path: `rotation.${issue.path}` })));
    if (!Number.isInteger(spec.measurementEndFrame) || spec.measurementEndFrame <= 0)
        add('invalid', 'rotation.measurementEndFrame', '测量窗口必须是正整数帧');
    const actions = pack?.actions ?? {};
    if (!Array.isArray(spec.steps) || !spec.steps.length)
        add('invalid', 'rotation.steps', '轴必须显式列出步骤');
    else {
        spec.steps.forEach((step, i) => {
            const p = `rotation.steps.${i}`;
            if (!step || typeof step !== 'object') {
                add('invalid', p, '步骤必须是对象');
                return;
            }
            if (!step.id)
                add('missing', `${p}.id`, '步骤必须有 id');
            if (step.kind === 'action') {
                if (!step.actionId)
                    add('missing', `${p}.actionId`, '动作步骤必须指定动作');
                else if (!actions[step.actionId])
                    add('unsupported', `${p}.actionId`, `动作包里没有 ${String(step.actionId)}`);
                if (!step.actorId)
                    add('missing', `${p}.actorId`, '动作步骤必须指定角色');
            }
            else if (step.kind === 'switch') {
                if (!step.actorId)
                    add('missing', `${p}.actorId`, '切人步骤必须指定目标角色');
            }
            else if (step.kind === 'wait') {
                if (!Number.isInteger(step.frames) || step.frames <= 0)
                    add('invalid', `${p}.frames`, '等待步骤必须是正整数帧');
            }
            else {
                add('unsupported', `${p}.kind`, `未知步骤类型 ${String(step.kind)}`);
            }
            if (step.kind !== 'wait' && step.atFrame !== undefined && (!Number.isInteger(step.atFrame) || step.atFrame < 0))
                add('invalid', `${p}.atFrame`, '请求帧必须是非负整数');
        });
    }
    if (!Array.isArray(spec.actors) || !spec.actors.length)
        add('invalid', 'rotation.actors', '必须显式给出每个角色的初始能量');
    else {
        const seen = new Set();
        spec.actors.forEach((actor, i) => {
            const p = `rotation.actors.${i}`;
            if (!actor || typeof actor !== 'object') {
                add('invalid', p, '角色初始资源必须是对象');
                return;
            }
            if (typeof actor.actorId !== 'string' || !actor.actorId.trim())
                add('invalid', `${p}.actorId`, '必须给角色 id');
            else if (seen.has(actor.actorId))
                add('invalid', `${p}.actorId`, `角色 ${actor.actorId} 重复登记`);
            else
                seen.add(actor.actorId);
            if (typeof actor.energy !== 'number' || !Number.isFinite(actor.energy) || actor.energy < 0)
                add('invalid', `${p}.energy`, '初始能量必须是非负有限值');
            if (typeof actor.energyMax !== 'number' || !Number.isFinite(actor.energyMax) || actor.energyMax <= 0)
                add('invalid', `${p}.energyMax`, '能量上限必须是正有限值');
            if (typeof actor.energy === 'number' && typeof actor.energyMax === 'number' && actor.energy > actor.energyMax)
                add('invalid', `${p}.energy`, '初始能量不能超过上限');
        });
        if (typeof spec.activeActorId !== 'string' || !spec.activeActorId.trim())
            add('missing', 'rotation.activeActorId', '必须指定初始前台角色');
        else if (spec.actors.every(actor => actor?.actorId !== spec.activeActorId))
            add('invalid', 'rotation.activeActorId', '初始前台角色必须在角色表里');
    }
    if (spec.switchFrames !== undefined && (!Number.isInteger(spec.switchFrames) || spec.switchFrames < 0))
        add('invalid', 'rotation.switchFrames', '切人帧数必须是非负整数');
    if (spec.energyRecharge !== undefined) {
        if (!spec.energyRecharge || typeof spec.energyRecharge !== 'object' || Array.isArray(spec.energyRecharge))
            add('invalid', 'rotation.energyRecharge', '充能效率必须是按角色 id 的映射');
        else {
            for (const [actorId, value] of Object.entries(spec.energyRecharge)) {
                if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
                    add('invalid', `rotation.energyRecharge.${actorId}`, '充能效率必须是正的有限值');
            }
        }
    }
    if (spec.stateFlags !== undefined && !Array.isArray(spec.stateFlags))
        add('invalid', 'rotation.stateFlags', '状态标记必须是数组');
    return issues;
}
//# sourceMappingURL=rotation.js.map