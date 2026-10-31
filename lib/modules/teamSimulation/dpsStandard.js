export const DPS_STANDARD = {
    targetId: 'ruin-guard-lv110',
    enemyLevel: 110,
    resistance: 0.1,
    windowSeconds: 120,
    initialEnergy: 0
};
/** 120 秒窗口在给定档位下折算成多少帧（帧是调度单位，档位决定一秒有几帧）。 */
export function dpsWindowFrames(tier) {
    return Math.round(DPS_STANDARD.windowSeconds * tier.fps);
}
/**
 * 核对一轮轴是否符合 DPS 标准。返回空数组才算合格；任何一条不符都点名，不自动修正。
 *
 * 刻意要求 `energy` 显式写 0：缺省与 0 在语义上不同（前者是"没写"，后者是"确认从 0 起"）。
 */
export function checkDpsStandard(input) {
    const out = [];
    const tier = input?.frameTier;
    if (!tier || typeof tier.fps !== 'number' || !Number.isFinite(tier.fps) || tier.fps <= 0) {
        return [{ path: 'frameTier', message: '缺少帧率档位，无法把 120 秒折算成帧' }];
    }
    if (input?.targetPresetId !== DPS_STANDARD.targetId) {
        out.push({
            path: 'targetPresetId',
            message: `DPS 标准目标必须是 ${DPS_STANDARD.targetId}（${DPS_STANDARD.enemyLevel} 级、${DPS_STANDARD.resistance * 100}% 抗性），实际 ${String(input?.targetPresetId)}`
        });
    }
    const expected = dpsWindowFrames(tier);
    if (input?.measurementEndFrame !== expected) {
        out.push({
            path: 'measurementEndFrame',
            message: `DPS 标准窗口是 ${DPS_STANDARD.windowSeconds} 秒，在 ${tier.id} 档应为 ${expected} 帧，实际 ${String(input?.measurementEndFrame)}`
        });
    }
    const actors = Array.isArray(input?.actors) ? input.actors : [];
    if (!actors.length) {
        out.push({ path: 'actors', message: 'DPS 标准要求每个角色都显式登记开局能量，不能空表' });
    }
    actors.forEach((actor, index) => {
        const energy = actor?.energy;
        if (typeof energy !== 'number' || !Number.isFinite(energy)) {
            out.push({ path: `actors.${index}.energy`, message: '开局能量必须显式写 0，缺省不算合格' });
        }
        else if (energy !== DPS_STANDARD.initialEnergy) {
            out.push({ path: `actors.${index}.energy`, message: `开局能量必须是 0，实际 ${energy}` });
        }
    });
    return out;
}
//# sourceMappingURL=dpsStandard.js.map