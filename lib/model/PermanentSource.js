/**
 * 永久数据的**运行时**生成：按玩家实际的角色 + 武器 + 精炼现算，不再要求先跑离线脚本。
 *
 * 为什么放在 model 层：这里要读 miao 的 meta-gs 原始数据（角色白值、武器白值/副属性、套装文本），
 * 属于「外部数据源适配」；内核（teamSimulation/）只收已经成形的 `PermanentData`，保持纯函数。
 *
 * 口径与 `scripts/gen-permanent.mjs` 完全一致：
 *   - 角色 90 级白值 / 突破加成、武器白值与副属性取 miao 结构化字段；
 *   - 能一对一解析的 2 件套写 modifiers，其余（4 件套、命座、未登记武器被动）逐条进 unmodeled，
 *     绝不「不知道就当没有」；
 *   - 生成的 effects 覆盖全部套装与 1–6 命，换配装不需要重生成。
 *
 * 与脚本的差别只有一处：这里只按 `weaponId` 查武器（玩家配装里带的是 id），脚本按名字查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { botRoot } from '../dir.js';
/**
 * miao 数据根：优先环境变量，其次按 Yunzai 标准安装位置找；开发仓库不在 Yunzai/plugins 下时
 * 还要回落到本机已知路径，否则运行时现算会静默变成「读不到」。
 */
function resolveMiaoRoot() {
    const candidates = [];
    if (process.env.MIAO_ROOT)
        candidates.push(process.env.MIAO_ROOT);
    candidates.push(path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs'));
    candidates.push('D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs');
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'character')))
            return candidate;
    }
    return candidates[0] ?? '';
}
const MIAO_ROOT = resolveMiaoRoot();
const CHARACTER_DIR = path.join(MIAO_ROOT, 'character');
const ARTIFACT_FILE = path.join(MIAO_ROOT, 'artifact', 'data.json');
const WEAPON_DIR = path.join(MIAO_ROOT, 'weapon');
const GAME_VERSION = '7.1';
const BUNDLE_ID = 'permanent-7.1';
const SOURCE = 'miao meta-gs 7.1（白值/突破/武器副属性）+ 运行时按玩家配装生成；套装与被动按本仓库已审计结论披露';
const LEVEL = 90;
const ASCENSION = 6;
const ELEMENTS = { 火: 'pyro', 水: 'hydro', 雷: 'electro', 冰: 'cryo', 风: 'anemo', 岩: 'geo', 草: 'dendro' };
const ELEMENT_KEYS = new Set(['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro']);
const round6 = (value) => Math.round(value * 1e6) / 1e6;
const pct = (raw) => round6(Number(raw) / 100);
const flat = (raw) => round6(Number(raw));
const UTILITY_PASSIVE = /锻造|烹饪|合成|采集|派遣|钓鱼|矿石|料理|药剂/;
/** 武器被动的人审结论（与 scripts/gen-permanent.mjs 的 WEAPON_NOTES 同步维护）。 */
const WEAPON_NOTES = {
    13303: { status: 'known-no-static', static: [], runtimeRequired: false, unmodeled: undefined },
    11415: { status: 'verified-static', static: [], runtimeRequired: true, unmodeled: '元素战技伤害提高防御力的 40%（R1）：内核没有「按防御折算伤害」通道，未计入' },
    12510: { status: 'verified-static', static: [{ key: 'defPct', value: 0.28 }], runtimeRequired: true, unmodeled: '普通攻击与重击伤害提高防御力的 40%（R1）：内核没有「按防御折算伤害」通道，未计入' },
    15401: { status: 'known-no-static', static: [], runtimeRequired: true, unmodeled: '暴击产生元素微粒回能（60% 概率 / 12 秒一次）：产球随机与暴击依赖都未建模' }
};
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
/** 按目录类型（sword/claymore/polearm/bow/catalyst）找武器；类型要跟着返回，4 件套条件要用。 */
function findWeaponById(weaponId) {
    let types = [];
    try {
        types = fs.readdirSync(WEAPON_DIR);
    }
    catch {
        return null;
    }
    for (const type of types) {
        let names = [];
        try {
            names = fs.readdirSync(path.join(WEAPON_DIR, type));
        }
        catch {
            continue;
        }
        for (const name of names) {
            const raw = readJson(path.join(WEAPON_DIR, type, name, 'data.json'));
            if (raw && typeof raw === 'object' && String(raw.id) === weaponId)
                return { weapon: raw, type };
        }
    }
    return null;
}
function ascensionModifier(character) {
    const grow = character.growAttr;
    if (!grow || typeof grow.key !== 'string')
        return { status: 'unsupported', modifiers: [], reason: '突破加成缺失' };
    const value = Number(grow.value);
    if (!Number.isFinite(value))
        return { status: 'unsupported', modifiers: [], reason: '突破加成不是数字' };
    switch (grow.key) {
        case 'dmg': {
            const key = ELEMENT_KEYS.has(String(character.elem)) ? String(character.elem) : ELEMENTS[String(character.elem)];
            return key ? { status: 'verified-static', modifiers: [{ key: key, value: pct(value) }] } : { status: 'unsupported', modifiers: [], reason: `无法把 dmg 突破加成映射到元素（elem=${character.elem}）` };
        }
        case 'cpct':
        case 'cdmg':
        case 'atkPct':
        case 'defPct':
        case 'hpPct':
        case 'recharge':
        case 'phy':
        case 'heal':
            return { status: 'verified-static', modifiers: [{ key: grow.key, value: pct(value) }] };
        case 'mastery':
            return { status: 'verified-static', modifiers: [{ key: 'mastery', value: flat(value) }] };
        default:
            return { status: 'unsupported', modifiers: [], reason: `未收录的突破加成键 ${grow.key}` };
    }
}
function weaponSubstat(weapon) {
    const key = weapon.attr?.bonusKey;
    const raw = weapon.attr?.bonusData?.[String(LEVEL)];
    if (!key || !Number.isFinite(Number(raw)))
        return null;
    return ['mastery', 'hp', 'atk', 'def'].includes(key)
        ? { key: key, value: flat(raw) }
        : { key: key, value: pct(raw) };
}
function parseTwoPiece(text) {
    if (typeof text !== 'string')
        return null;
    const t = text.trim().replace(/[。.]$/, '');
    let r;
    if ((r = /^攻击力提高(\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: 'atkPct', value: pct(r[1]) };
    if ((r = /^防御力提高(\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: 'defPct', value: pct(r[1]) };
    if ((r = /^生命值(?:上限)?提[升高](\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: 'hpPct', value: pct(r[1]) };
    if ((r = /^元素充能效率提高(\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: 'recharge', value: pct(r[1]) };
    if ((r = /^元素精通提高(\d+(?:\.\d+)?)点$/.exec(t)))
        return { key: 'mastery', value: flat(r[1]) };
    if ((r = /^暴击率提高(\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: 'cpct', value: pct(r[1]) };
    if ((r = /^造成的物理伤害提高(\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: 'phy', value: pct(r[1]) };
    if ((r = /^(?:角色造成的)?(?:治疗加成|治疗效果)提[升高](\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: 'heal', value: pct(r[1]) };
    if ((r = /^生命值上限提高(\d+(?:\.\d+)?)点$/.exec(t)))
        return { key: 'hp', value: flat(r[1]) };
    if ((r = /^防御力提高(\d+(?:\.\d+)?)点$/.exec(t)))
        return { key: 'def', value: flat(r[1]) };
    if ((r = /^(?:获得)?(\d+(?:\.\d+)?)%(火|水|雷|冰|风|岩|草)元素伤害加成$/.exec(t)))
        return { key: ELEMENTS[r[2]], value: pct(r[1]) };
    if ((r = /^(?:获得)?(火|水|雷|冰|风|岩|草)元素伤害加成提高(\d+(?:\.\d+)?)%$/.exec(t)))
        return { key: ELEMENTS[r[1]], value: pct(r[2]) };
    return null;
}
function passiveNames(character) {
    const list = Array.isArray(character.passive) ? character.passive : [];
    return list
        .filter(item => !UTILITY_PASSIVE.test(String(item?.desc ?? '')))
        .map(item => item?.name)
        .filter((name) => typeof name === 'string' && name.length > 0);
}
function constellationName(character, level) {
    const cons = character.cons;
    if (!cons || typeof cons !== 'object')
        return null;
    const entry = cons[String(level)];
    return entry && typeof entry === 'object' ? String(entry.name ?? '') : null;
}
/**
 * 不依赖触发条件、可直接进面板的 4 件套（2026-11-02 切片 1）。
 *
 * `weaponTypes` 为空表示不限武器；有值时按实装武器类型判断，
 * 条件不成立就不加面板，但要写进 `unmodeled` 披露（否则报告会说「已计入」）。
 */
const STATIC_FOUR_PIECE = {
    '400089': {
        key: 'normalDmg',
        value: 0.35,
        weaponTypes: ['sword', 'claymore', 'polearm'],
        note: '4 件套：普通攻击造成的伤害 +35%（单手剑/大剑/长柄武器）'
    },
    '400099': {
        key: 'chargedDmg',
        value: 0.35,
        weaponTypes: ['catalyst', 'bow'],
        note: '4 件套：重击造成的伤害 +35%（法器/弓）'
    }
};
/**
 * 触发式 4 件套（2026-11-02 切片 2）：由时间轴在该角色起手对应动作时激活。
 *
 * 生效时长按 60fps 帧数写（与现有动作包的帧口径一致）；换档位时尚未折算，
 * 与 §「帧数口径」里记录的限制相同。
 */
const TRIGGERED_FOUR_PIECE = {
    '400164': {
        effect: {
            id: 'artifact-set:400164:4pc',
            target: 'self',
            stats: { normalDmg: 0.3, chargedDmg: 0.3 },
            durationFrames: 900,
            trigger: 'cast-skill'
        },
        note: '4 件套：施放元素战技后 15 秒内普攻与重击伤害 +30%'
    },
    '400119': {
        effect: {
            id: 'artifact-set:400119:4pc',
            target: 'team',
            stats: { atkPct: 0.2 },
            durationFrames: 720,
            trigger: 'cast-burst',
            stacking: 'ignore'
        },
        note: '4 件套：施放元素爆发后全队攻击力 +20%，持续 12 秒（同队不叠加）'
    },
    '400169': {
        effect: {
            id: 'artifact-set:400169:4pc',
            target: 'team',
            stats: { atkPct: 0.2 },
            durationFrames: 180,
            trigger: 'skill-hit',
            stacking: 'refresh'
        },
        note: '4 件套：元素战技命中敌人后全队攻击力 +20%，持续 3 秒；护盾强效 30% 不影响伤害、未建模'
    }
};
function buildEffects(character, weapon, refine, artifactData, weaponType) {
    const effects = {};
    const runtimeEffects = {};
    const notes = [];
    const ascension = ascensionModifier(character);
    const passives = passiveNames(character);
    effects[`character:${character.id}:a${ASCENSION}`] = ascension.status === 'unsupported'
        ? { status: 'unsupported', modifiers: [], runtimeRequired: false }
        : {
            status: 'verified-static',
            modifiers: ascension.modifiers,
            runtimeRequired: false,
            ...(passives.length ? { unmodeled: `固有天赋条件效果未建模：${passives.join('、')}` } : {})
        };
    if (ascension.status === 'unsupported')
        notes.push(`角色 ${character.name} 突破加成未收录：${ascension.reason}`);
    const note = WEAPON_NOTES[String(weapon.id)];
    const substat = weaponSubstat(weapon);
    if (note) {
        const modifiers = [...(substat ? [substat] : []), ...(note.static ?? [])];
        const status = modifiers.length > 0 && note.status === 'known-no-static' ? 'verified-static' : note.status;
        effects[`weapon:${weapon.id}:r${refine}`] = {
            status,
            modifiers,
            runtimeRequired: note.runtimeRequired,
            ...(note.unmodeled ? { unmodeled: note.unmodeled } : {})
        };
    }
    else {
        effects[`weapon:${weapon.id}:r${refine}`] = {
            status: 'verified-static',
            modifiers: substat ? [substat] : [],
            runtimeRequired: true,
            unmodeled: `武器被动「${weapon.affixTitle ?? ''}」未逐项审计：${String(weapon.affixData?.text ?? '').replace(/\$\[\d\]/g, 'X').slice(0, 60)}`
        };
    }
    for (const [setId, set] of Object.entries(artifactData)) {
        const two = set?.skills?.['2'];
        const four = set?.skills?.['4'];
        if (typeof two === 'string') {
            const parsed = parseTwoPiece(two);
            effects[`artifact-set:${setId}:2pc`] = parsed
                ? { status: 'verified-static', modifiers: [parsed], runtimeRequired: false }
                : { status: 'unsupported', modifiers: [], runtimeRequired: false };
        }
        else {
            effects[`artifact-set:${setId}:2pc`] = { status: 'unsupported', modifiers: [], runtimeRequired: false };
        }
        if (typeof four === 'string') {
            const staticFour = STATIC_FOUR_PIECE[setId];
            const triggered = TRIGGERED_FOUR_PIECE[setId];
            const applies = staticFour !== undefined && (!staticFour.weaponTypes || staticFour.weaponTypes.includes(weaponType));
            if (triggered) {
                // 审计条目只声明「运行时生效」，数值与触发时机放在 runtimeEffects 里。
                effects[`artifact-set:${setId}:4pc`] = {
                    status: 'verified-static',
                    modifiers: [],
                    runtimeRequired: true
                };
                runtimeEffects[`artifact-set:${setId}:4pc`] = triggered.effect;
            }
            else if (staticFour && applies) {
                effects[`artifact-set:${setId}:4pc`] = {
                    status: 'verified-static',
                    modifiers: [{ key: staticFour.key, value: staticFour.value }],
                    runtimeRequired: false
                };
            }
            else if (staticFour) {
                effects[`artifact-set:${setId}:4pc`] = {
                    status: 'verified-static',
                    modifiers: [],
                    runtimeRequired: false,
                    unmodeled: `${staticFour.note}；当前武器类型 ${weaponType} 不满足触发条件，未计入`
                };
            }
            else {
                effects[`artifact-set:${setId}:4pc`] = {
                    status: 'verified-static',
                    modifiers: [],
                    runtimeRequired: true,
                    unmodeled: `${set?.name ?? setId} 4 件套未建模：${four.replace(/\s+/g, ' ').slice(0, 80)}`
                };
            }
        }
    }
    for (let level = 1; level <= 6; level += 1) {
        const name = constellationName(character, level);
        if (!name)
            continue;
        effects[`constellation:${character.id}:${level}`] = {
            status: 'verified-static',
            modifiers: [],
            runtimeRequired: true,
            unmodeled: `命座 ${level}「${name}」未建模`
        };
    }
    return { effects, runtimeEffects, notes };
}
const cache = new Map();
/**
 * 按玩家配装现算永久数据。同一角色 + 武器 + 精炼在进程内缓存，不吃重复解析 miao 的成本。
 * 任何一环拿不到（角色/武器/白值/套装表）都返回可读错误，由调用方转成 issue，不静默降级。
 */
export function buildRuntimePermanent(input) {
    const refine = Number(input.refinement);
    if (!Number.isInteger(refine) || refine < 1 || refine > 5)
        return { ok: false, error: `精炼等级 ${input.refinement} 不在 1–5` };
    const key = `${input.characterId}-${input.weaponId}-r${refine}`;
    const hit = cache.get(key);
    if (hit)
        return { ok: true, data: hit, source: 'runtime' };
    const characterFile = path.join(CHARACTER_DIR, input.name, 'data.json');
    const character = readJson(characterFile);
    if (!character || typeof character !== 'object')
        return { ok: false, error: `读不到 ${input.name} 的 miao 角色数据（${characterFile}）` };
    if (String(character.id) !== String(input.characterId)) {
        return { ok: false, error: `${input.name} 的 miao charId 是 ${character.id}，与配装里的 ${input.characterId} 不一致` };
    }
    const found = findWeaponById(String(input.weaponId));
    if (!found)
        return { ok: false, error: `读不到武器 ${input.weaponId} 的 miao 数据` };
    const { weapon, type: weaponType } = found;
    const artifactData = readJson(ARTIFACT_FILE);
    if (!artifactData || typeof artifactData !== 'object')
        return { ok: false, error: `读不到套装表 ${ARTIFACT_FILE}` };
    const details = character.attr?.details?.[String(LEVEL)];
    if (!Array.isArray(details) || details.length < 3)
        return { ok: false, error: `${input.name} 没有 ${LEVEL} 级白值` };
    const baseAtk = Number(weapon.attr?.atk?.[String(LEVEL)]);
    if (!Number.isFinite(baseAtk))
        return { ok: false, error: `${weapon.name} 没有 ${LEVEL} 级武器白值` };
    const [hp, atk, def] = details;
    if (![hp, atk, def].every(value => Number.isFinite(Number(value))))
        return { ok: false, error: `${input.name} 的 ${LEVEL} 级白值不是数字` };
    const { effects, runtimeEffects } = buildEffects(character, weapon, refine, artifactData, weaponType);
    const data = {
        gameVersion: GAME_VERSION,
        bundleId: BUNDLE_ID,
        source: SOURCE,
        character: {
            id: String(character.id),
            level: LEVEL,
            ascension: ASCENSION,
            base: { hp: Number(hp), atk: Number(atk), def: Number(def) },
            bonuses: []
        },
        weapon: {
            id: String(weapon.id),
            level: LEVEL,
            ascension: ASCENSION,
            baseAtk,
            bonuses: []
        },
        effects,
        ...(Object.keys(runtimeEffects).length ? { runtimeEffects } : {})
    };
    cache.set(key, data);
    return { ok: true, data, source: 'runtime' };
}
//# sourceMappingURL=PermanentSource.js.map