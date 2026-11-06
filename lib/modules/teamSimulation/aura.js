/*
 * 附着状态机（第 1 轮，最小可用集）：只在数据包显式打开 `auraMode: 'simulated'` 时启用。
 *
 * 只做三件事：
 * 1. 记录敌人身上的元素附着量与衰减；
 * 2. 按「本次命中元素 vs 现有附着」判定反应，并扣附着；
 * 3. 按命中次数/时间做 ICD，未附着的命中不产生反应。
 *
 * 不做：结晶/草原核/冻结碎冰（需要构造物与状态机）、段与图鉴 `icdSource` 的精确映射。
 * 缺省规则：普攻/战技按 Standard（每 3 次或 2.5 秒一次），爆发按 Independent；数据侧可用
 * `attachment.icd` 逐发覆盖。
 */
/** 可附着的元素（与 timeline 的 `HitElement` 同集合，这里单独定义避免循环依赖）。 */
export const AURA_ELEMENTS = ['physical', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
/** 附着量衰减：0.1 单位/秒，60fps 下约 0.00167/帧。数据未区分元素时先按同一速率。 */
export const AURA_DECAY_PER_FRAME = 0.1 / 60;
/** Standard ICD：每 3 次命中或 2.5 秒内只结算一次附着。 */
export const STANDARD_ICD_HITS = 3;
export const STANDARD_ICD_FRAMES = 150;
/** 增幅反应：新元素打旧附着，返回反应类型与被消耗的附着。 */
function amplifyingReaction(attacker, defender) {
    if (attacker === 'pyro' && defender === 'hydro')
        return 'vaporize';
    if (attacker === 'hydro' && defender === 'pyro')
        return 'vaporize';
    if (attacker === 'pyro' && defender === 'cryo')
        return 'melt';
    if (attacker === 'cryo' && defender === 'pyro')
        return 'melt';
    return undefined;
}
/** 剧变反应：新元素打旧附着，消耗全部剩余附着。 */
function transformativeReaction(attacker, defender) {
    const pair = new Set([attacker, defender]);
    if (pair.has('pyro') && pair.has('electro'))
        return 'overloaded';
    if (pair.has('hydro') && pair.has('electro'))
        return 'electro-charged';
    if (pair.has('cryo') && pair.has('electro'))
        return 'superconduct';
    if (pair.has('anemo') && (pair.has('pyro') || pair.has('hydro') || pair.has('electro') || pair.has('cryo')))
        return 'swirl';
    if (pair.has('hydro') && pair.has('dendro'))
        return 'bloom';
    if (pair.has('pyro') && pair.has('dendro'))
        return 'burning';
    return undefined;
}
/**
 * 附着状态机本体。一个实例对应一个目标；当前内核只有单目标，多目标时需要按目标拆实例。
 */
export class AuraTracker {
    aura = null;
    hits = new Map();
    /** 当前附着（已按帧衰减到 `frame`），供调试与断言使用。 */
    stateAt(frame) {
        if (!this.aura)
            return null;
        const decayed = this.decayTo(this.aura, frame);
        return decayed.gauge > 0 ? decayed : null;
    }
    /**
     * ICD 是否放行本次附着。键按「角色 + 元素」分组（不同元素的附着走各自计数，
     * 与游戏里按技能/元素分组的 ICD 近似）；独立 ICD 直接放行。
     */
    icdAllows(input) {
        if (input.icd === 'independent')
            return true;
        const key = `${input.actorId}:${input.element}`;
        const record = this.hits.get(key) ?? { count: 0, lastFrame: input.frame };
        // 过了 2.5 秒窗口就重新计数；Standard 是「每 3 次放行一次」，即第 1、4、7 次命中。
        if (input.frame - record.lastFrame >= STANDARD_ICD_FRAMES) {
            record.count = 0;
            record.lastFrame = input.frame;
        }
        const allow = record.count % STANDARD_ICD_HITS === 0;
        record.count += 1;
        this.hits.set(key, record);
        return allow;
    }
    decayTo(aura, frame) {
        const elapsed = Math.max(0, frame - aura.atFrame);
        return { ...aura, gauge: Math.max(0, aura.gauge - elapsed * AURA_DECAY_PER_FRAME), atFrame: frame };
    }
    /**
     * 施加一次命中：先补衰减，再判反应。
     * - 无附着：直接挂上。
     * - 同元素：刷新到较大值。
     * - 异元素：增幅消耗 0.5，剧变消耗全部；岩/物理不参与附着。
     */
    apply(input) {
        const gauge = input.gauge ?? 1;
        if (input.element === 'physical' || input.element === 'geo') {
            return { aura: this.stateAt(input.frame), attached: false };
        }
        const current = this.aura ? this.decayTo(this.aura, input.frame) : null;
        const alive = current && current.gauge > 0 ? current : null;
        if (!alive) {
            if (!this.icdAllows(input))
                return { aura: null, attached: false };
            this.aura = { element: input.element, gauge, atFrame: input.frame };
            return { aura: this.aura, attached: true };
        }
        if (alive.element === input.element) {
            if (!this.icdAllows(input))
                return { aura: alive, attached: false };
            this.aura = { element: alive.element, gauge: Math.max(alive.gauge, gauge), atFrame: input.frame };
            return { aura: this.aura, attached: true };
        }
        const amplifying = amplifyingReaction(input.element, alive.element);
        const transformative = amplifying ? undefined : transformativeReaction(input.element, alive.element);
        if (!amplifying && !transformative) {
            // 两者不成反应：新附着覆盖旧附着（岩/物理已在上面排除）。
            if (!this.icdAllows(input))
                return { aura: alive, attached: false };
            this.aura = { element: input.element, gauge, atFrame: input.frame };
            return { aura: this.aura, attached: true };
        }
        if (!this.icdAllows(input))
            return { aura: alive, attached: false };
        if (amplifying) {
            const consumed = 0.5;
            const left = Math.max(0, alive.gauge - consumed);
            this.aura = left > 0 ? { element: alive.element, gauge: left, atFrame: input.frame } : null;
            return { reaction: { kind: amplifying, aura: alive.element }, aura: this.aura, attached: true };
        }
        // 剧变消耗全部附着。
        this.aura = null;
        return { reaction: { kind: transformative, aura: alive.element }, aura: null, attached: true };
    }
}
//# sourceMappingURL=aura.js.map