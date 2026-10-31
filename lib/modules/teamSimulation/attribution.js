import { simulateTeam } from './teamRun.js';
/** 深拷贝动作表并摘掉指定效果的触发标记，避免去掉效果后触发引用悬空。 */
function stripEffect(pack, effectId) {
    const actions = {};
    for (const [key, spec] of Object.entries(pack.actions)) {
        const hits = (spec.hits ?? []).map(hit => {
            if (!hit.triggerIds?.includes(effectId))
                return hit;
            const triggerIds = hit.triggerIds.filter(id => id !== effectId);
            return { ...hit, ...(triggerIds.length ? { triggerIds } : { triggerIds: [] }) };
        });
        actions[key] = { ...spec, hits };
    }
    const effects = { ...(pack.effects ?? {}) };
    delete effects[effectId];
    return { ...pack, actions, effects };
}
const totalOf = (result) => result.status === 'calculated' && result.damage.status === 'calculated' ? result.damage.total : null;
export function attributeEffects(input) {
    const baselineRun = simulateTeam(input);
    const baseline = totalOf(baselineRun);
    if (baseline === null) {
        const issue = baselineRun.issues[0];
        return { status: 'unavailable', reason: issue ? `${issue.path}: ${issue.message}` : '基线那一轮没有算出伤害', baseline: 0, rows: [], skipped: [] };
    }
    const effectIds = Object.keys(input.pack.effects ?? {});
    const triggerCounts = new Map();
    for (const trigger of baselineRun.timeline.triggers ?? []) {
        triggerCounts.set(trigger.effectId, (triggerCounts.get(trigger.effectId) ?? 0) + 1);
    }
    const rows = [];
    const skipped = [];
    for (const effectId of effectIds) {
        const withoutRun = simulateTeam({ ...input, pack: stripEffect(input.pack, effectId) });
        const without = totalOf(withoutRun);
        if (without === null) {
            skipped.push(effectId);
            rows.push({ effectId, baseline, without: 0, delta: 0, triggers: triggerCounts.get(effectId) ?? 0 });
            continue;
        }
        rows.push({ effectId, baseline, without, delta: baseline - without, triggers: triggerCounts.get(effectId) ?? 0 });
    }
    rows.sort((a, b) => b.delta - a.delta || a.effectId.localeCompare(b.effectId));
    return { status: 'ok', baseline, rows, skipped };
}
//# sourceMappingURL=attribution.js.map