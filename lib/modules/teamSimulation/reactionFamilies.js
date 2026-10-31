export const REACTION_FAMILIES = {
    amplifying: {
        family: 'amplifying',
        label: '增幅（蒸发/融化）',
        cls: 'amplifying',
        coverage: 'fixture-covered',
        evidence: 'test/team-sim-reactions.test.mjs'
    },
    catalyze: {
        family: 'catalyze',
        label: '激化（超激化/蔓激化）',
        cls: 'catalyze',
        coverage: 'fixture-covered',
        evidence: 'test/team-sim-reactions.test.mjs'
    },
    transformative: {
        family: 'transformative',
        label: '剧变（超载/感电/超导/扩散/绽放/燃烧）',
        cls: 'transformative',
        coverage: 'fixture-covered',
        evidence: 'test/team-sim-reactions.test.mjs'
    },
    lunar: {
        family: 'lunar',
        label: '月反应',
        cls: 'lunar',
        coverage: 'fixture-covered',
        evidence: 'test/team-sim-special-reactions.test.mjs'
    },
    stellar: {
        family: 'stellar',
        label: '星烁',
        cls: 'stellar',
        coverage: 'fixture-covered',
        evidence: 'test/team-sim-special-reactions.test.mjs'
    }
};
export const BLOCKED_FAMILIES = Object.keys(REACTION_FAMILIES)
    .filter(family => REACTION_FAMILIES[family].coverage === 'blocked');
/** 数据包声明某个家族前先过这道门；`unknown` 与 `blocked` 都不允许继续。 */
export function gateReactionFamily(name) {
    if (typeof name !== 'string' || !(name in REACTION_FAMILIES)) {
        return { status: 'unknown', message: `未知反应家族 ${String(name)}` };
    }
    const family = name;
    const spec = REACTION_FAMILIES[family];
    if (spec.coverage === 'blocked') {
        return { status: 'blocked', family, message: `${spec.label}尚未建模：${spec.reason ?? '缺少 fixture 与实测'}` };
    }
    return { status: 'ok', family };
}
/** 覆盖率自检：任何 `fixture-covered` 的家族都必须在测试里被点名。 */
export function familyCoverage() {
    const all = Object.values(REACTION_FAMILIES);
    return {
        covered: all.filter(spec => spec.coverage === 'fixture-covered').length,
        blocked: all.filter(spec => spec.coverage === 'blocked').length,
        total: all.length
    };
}
//# sourceMappingURL=reactionFamilies.js.map