/**
 * 元素反应的算术内核：反应倍率、精通曲线、等级系数。
 *
 * 等级系数表 `REACTION_COEFFICIENT` 是社区通用的「剧变反应等级系数」（90 级 1446.852）。
 * 表由 `out/reaction-coef.json` 从 miao-plugin `models/dmg/DmgCalcMeta.js` 的 `eleBaseDmg`
 * 乘 4 生成（miao 用 1/4 的系数配 4 倍的反应倍率，乘积与原表一致），没有手抄任何数值。
 *
 * 这个文件只做算术：不判断附着量、不判断 ICD、不决定哪一发能触发反应。附着由数据声明，
 * 见 `docs/队伍模拟-P1数据包格式.md` 的反应段。
 */
/** 剧变反应等级系数，键为角色等级。 */
export const REACTION_COEFFICIENT = {
    1: 17.164,
    2: 18.536,
    3: 19.904,
    4: 21.276,
    5: 22.644,
    6: 24.648,
    7: 26.64,
    8: 28.868,
    9: 31.368,
    10: 34.144,
    11: 37.2,
    12: 40.66,
    13: 44.448,
    14: 48.564,
    15: 53.748,
    16: 59.08,
    17: 64.42,
    18: 69.724,
    19: 75.124,
    20: 80.584,
    21: 86.112,
    22: 91.704,
    23: 97.244,
    24: 102.812,
    25: 108.408,
    26: 113.2,
    27: 118.104,
    28: 122.98,
    29: 129.728,
    30: 136.292,
    31: 142.672,
    32: 149.028,
    33: 155.416,
    34: 161.824,
    35: 169.108,
    36: 176.52,
    37: 184.072,
    38: 191.708,
    39: 199.556,
    40: 207.384,
    41: 215.4,
    42: 224.164,
    43: 233.504,
    44: 243.352,
    45: 256.064,
    46: 268.544,
    47: 281.528,
    48: 295.012,
    49: 309.068,
    50: 323.6,
    51: 336.756,
    52: 350.532,
    53: 364.484,
    54: 378.62,
    55: 398.6,
    56: 416.4,
    57: 434.388,
    58: 452.952,
    59: 472.608,
    60: 492.884,
    61: 513.568,
    62: 539.104,
    63: 565.512,
    64: 592.54,
    65: 624.444,
    66: 651.472,
    67: 679.496,
    68: 707.796,
    69: 736.672,
    70: 765.64,
    71: 794.772,
    72: 824.676,
    73: 851.156,
    74: 877.744,
    75: 914.228,
    76: 946.748,
    77: 979.412,
    78: 1011.224,
    79: 1044.792,
    80: 1077.444,
    81: 1109.996,
    82: 1142.976,
    83: 1176.368,
    84: 1210.184,
    85: 1253.836,
    86: 1288.952,
    87: 1325.484,
    88: 1363.456,
    89: 1405.096,
    90: 1446.852,
    95: 1561.468,
    100: 1674.088,
};
/** 增幅反应的精通系数：25/9 × EM / (EM + 1400)（游戏内写作 2.78，内核与 miao 一致取分数）。 */
const AMPLIFY_EM = 25 / 9;
/** 剧变反应的精通系数：16 × EM / (EM + 2000)。 */
const TRANSFORM_EM = 16;
/** 激化反应的精通系数：5 × EM / (EM + 1200)。 */
const CATALYZE_EM = 5;
export const REACTIONS = {
    vaporize: {
        label: '蒸发',
        cls: 'amplifying',
        pairs: [['hydro', 'pyro', 2], ['pyro', 'hydro', 1.5]]
    },
    melt: {
        label: '融化',
        cls: 'amplifying',
        pairs: [['pyro', 'cryo', 2], ['cryo', 'pyro', 1.5]]
    },
    aggravate: {
        label: '超激化',
        cls: 'catalyze',
        pairs: [['electro', 'dendro', 1.15]]
    },
    spread: {
        label: '蔓激化',
        cls: 'catalyze',
        pairs: [['dendro', 'electro', 1.25]]
    },
    overloaded: {
        label: '超载',
        cls: 'transformative',
        multiplier: 2.75,
        pairs: [['pyro', 'electro', 0], ['electro', 'pyro', 0]]
    },
    'electro-charged': {
        label: '感电',
        cls: 'transformative',
        multiplier: 2,
        pairs: [['hydro', 'electro', 0], ['electro', 'hydro', 0]]
    },
    superconduct: {
        label: '超导',
        cls: 'transformative',
        multiplier: 1.5,
        pairs: [['cryo', 'electro', 0], ['electro', 'cryo', 0]]
    },
    swirl: {
        label: '扩散',
        cls: 'transformative',
        multiplier: 0.6,
        pairs: [
            ['anemo', 'pyro', 0],
            ['anemo', 'hydro', 0],
            ['anemo', 'electro', 0],
            ['anemo', 'cryo', 0]
        ]
    },
    bloom: {
        label: '绽放',
        cls: 'transformative',
        multiplier: 2,
        pairs: [['dendro', 'hydro', 0], ['hydro', 'dendro', 0]]
    },
    burning: {
        label: '燃烧',
        cls: 'transformative',
        multiplier: 0.25,
        pairs: [['pyro', 'dendro', 0], ['dendro', 'pyro', 0]]
    }
};
/** P1 未建模、需要额外状态的反应：{ 键: 缺什么状态 }。 */
const STATEFUL = {
    shatter: '碎冰需要「冻结」状态',
    burgeon: '烈绽放需要「草原核」状态',
    hyperbloom: '超绽放需要「草原核」状态',
    crystallize: '结晶不产生伤害，P1 只做伤害结算',
    frozen: '冻结是状态而不是伤害反应'
};
export function isReactiveKind(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REACTIONS, value);
}
export function isStatefulKind(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATEFUL, value);
}
export function statefulReason(kind) {
    return STATEFUL[kind];
}
export function reactionLabel(kind) {
    return REACTIONS[kind].label;
}
export function reactionClass(kind) {
    return REACTIONS[kind].cls;
}
export function reactionMultiplier(kind) {
    return REACTIONS[kind].multiplier;
}
/** 触发元素与附着元素这一对是否成立；成立返回该对的倍率，不成立返回 undefined。 */
export function pairMultiplier(kind, trigger, aura) {
    const pair = REACTIONS[kind].pairs.find(([t, a]) => t === trigger && a === aura);
    return pair ? pair[2] : undefined;
}
/** 反应与元素是否匹配；不匹配时返回可直接进 issue 的说明。 */
export function describeMismatch(kind, trigger, aura) {
    if (pairMultiplier(kind, trigger, aura) !== undefined)
        return undefined;
    const expects = REACTIONS[kind].pairs.map(([t, a]) => `${t} 打 ${a}`).join(' / ');
    return `${reactionLabel(kind)}只能由 ${expects} 触发，收到的是 ${trigger} 打 ${aura}`;
}
export function reactionCoefficient(level) {
    if (!Number.isInteger(level))
        return undefined;
    return REACTION_COEFFICIENT[level];
}
/** 增幅反应的总倍率：反应倍率 × (1 + (25/9)EM/(EM+1400))，游戏内常写作 2.78。 */
export function amplifyingFactor(kind, trigger, aura, mastery) {
    const base = pairMultiplier(kind, trigger, aura);
    if (base === undefined)
        return undefined;
    const em = Math.max(0, mastery);
    return base * (1 + (AMPLIFY_EM * em) / (em + 1400));
}
/** 激化加成：反应比例 × 等级系数 × (1 + 5EM/(EM+1200))，直接加进基础伤害区。 */
export function catalyzeBonus(kind, level, mastery) {
    const coefficient = reactionCoefficient(level);
    const ratio = REACTIONS[kind].pairs[0][2];
    if (coefficient === undefined || !ratio)
        return undefined;
    const em = Math.max(0, mastery);
    return coefficient * ratio * (1 + (CATALYZE_EM * em) / (em + 1200));
}
/** 剧变反应的基础伤害（未过抗性）：等级系数 × 反应倍率 × (1 + 16EM/(EM+2000))。 */
export function transformativeBase(kind, level, mastery) {
    const coefficient = reactionCoefficient(level);
    const multiplier = reactionMultiplier(kind);
    if (coefficient === undefined || multiplier === undefined)
        return undefined;
    const em = Math.max(0, mastery);
    return coefficient * multiplier * (1 + (TRANSFORM_EM * em) / (em + 2000));
}
export const SPECIAL_REACTIONS = {
    'lunar-bloom': {
        label: '月绽放',
        cls: 'lunar',
        multiplier: 1,
        pairs: [['dendro', 'hydro'], ['hydro', 'dendro']]
    },
    'lunar-charged': {
        label: '月感电',
        cls: 'lunar',
        multiplier: 3,
        talentMultiplier: 7.2,
        pairs: [['hydro', 'electro'], ['electro', 'hydro']]
    },
    'lunar-crystallize': {
        label: '月结晶',
        cls: 'lunar',
        multiplier: 1.6,
        talentMultiplier: 3.84,
        pairs: [['geo', 'hydro'], ['hydro', 'geo']]
    },
    'stellar-conduct': {
        label: '星超导',
        cls: 'stellar',
        multiplier: 1,
        countTable: [1, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95, 2],
        pairs: [['cryo', 'electro'], ['electro', 'cryo']]
    },
    'stellar-swirl': {
        label: '星扩散',
        cls: 'stellar',
        multiplier: 1,
        talentMultiplier: 3,
        pairs: [['anemo', 'pyro'], ['anemo', 'hydro'], ['anemo', 'electro'], ['anemo', 'cryo']]
    },
    'stellar-vortex': {
        label: '星辉冰旋',
        cls: 'stellar',
        multiplier: 8,
        countThreshold: { atLeast: 3, multiplier: 12 },
        pairs: [['anemo', 'cryo']]
    }
};
/** 星超导计数在数据包缺省时的兜底值，与 miao 的默认一致。 */
export const STELLAR_CONDUCT_DEFAULT_COUNT = 12;
/** 星辉冰旋计数缺省时的兜底值，与 miao 的默认一致。 */
export const STELLAR_VORTEX_DEFAULT_COUNT = 6;
/** 月反应与星烁的精通系数：6 × EM / (EM + 2000)，与剧变的 16 不同。 */
const SPECIAL_EM = 6;
export function isSpecialKind(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPECIAL_REACTIONS, value);
}
export function specialLabel(kind) {
    return SPECIAL_REACTIONS[kind].label;
}
export function specialClass(kind) {
    return SPECIAL_REACTIONS[kind].cls;
}
/** 触发元素与附着元素这一对是否成立（不看倍率，倍率由计数与天赋决定）。 */
export function specialPairMatches(kind, trigger, aura) {
    return SPECIAL_REACTIONS[kind].pairs.some(([t, a]) => t === trigger && a === aura);
}
export function describeSpecialMismatch(kind, trigger, aura) {
    if (specialPairMatches(kind, trigger, aura))
        return undefined;
    const expects = SPECIAL_REACTIONS[kind].pairs.map(([t, a]) => `${t} 打 ${a}`).join(' / ');
    return `${specialLabel(kind)}只能由 ${expects} 触发，收到的是 ${trigger} 打 ${aura}`;
}
/** 反应倍率：月反应看 `talent`，星超导查计数表，星辉冰旋看计数阈值。 */
export function specialMultiplier(kind, options = {}) {
    const spec = SPECIAL_REACTIONS[kind];
    if (spec.countTable) {
        const count = Math.trunc(options.count ?? STELLAR_CONDUCT_DEFAULT_COUNT);
        const index = Math.min(Math.max(count, 1), spec.countTable.length) - 1;
        return spec.countTable[index];
    }
    if (spec.countThreshold && (options.count ?? STELLAR_VORTEX_DEFAULT_COUNT) >= spec.countThreshold.atLeast) {
        return spec.countThreshold.multiplier;
    }
    if (options.talent && spec.talentMultiplier !== undefined)
        return spec.talentMultiplier;
    return spec.multiplier ?? 1;
}
/** 精通系数：1 + 6EM/(EM+2000)。 */
export function specialMasteryFactor(mastery) {
    const em = Math.max(0, Number.isFinite(mastery) ? mastery : 0);
    return 1 + (SPECIAL_EM * em) / (em + 2000);
}
//# sourceMappingURL=reactions.js.map