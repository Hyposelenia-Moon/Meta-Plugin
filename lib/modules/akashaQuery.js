/**
 * akashaQuery — akasha.cv 练度数据的解析与视图组装（合并自 `Mhydps-Plugin/modules/akashaQuery.js`）
 *
 * 纯函数为主，便于离线回归：输入是 `AkashaClient` 取回的原始 JSON（fixtures 里有脱敏样例），
 * 输出是「账号画像 + 每角色名次/伤害/武器/套装」的视图。
 *
 * 口径说明（图上/文案里要照抄）：
 *   - `result` 是 **akasha 自己的伤害公式**算出来的数字，与 mhydps.cn 的「期望 DPS」不是一回事；
 *   - `ranking / outOf` 是 akasha 该赛道（`COMBO`/`VAPE`/`LUNAR`…）榜里的名次，我们额外给出 top%；
 *   - 角色中文名走**本插件角色表**（akasha 返回的是英文名，如 `Hu Tao`），
 *     武器/套装名走 akasha 的 `textmap` 中文化（拿不到就保留英文）。
 */
import { characterById } from '../model/CharacterIndex.js';
import { getAkashaMaxChars } from '../components/config.js';
/** 无类型 JSON 的取值工具 */
function obj(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
/** 数字取整（akasha 的 playerInfo 里有 60.0000006639 这种浮点噪声） */
function int(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v) : 0;
}
/** 保留一位小数（不足则取整） */
function num(n) {
    const v = Number(n);
    if (!Number.isFinite(v))
        return 0;
    return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
}
/** 大数字 → 中文数量级（伤害动辄百万） */
export function bigNumText(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return '-';
    if (n >= 100000000)
        return `${(n / 100000000).toFixed(2)} 亿`;
    if (n >= 10000)
        return `${(n / 10000).toFixed(1)} 万`;
    return String(Math.round(n));
}
/** 名次 → top 百分比文本（`8205 / 1035102` → `top 1%`） */
export function topPercentText(ranking, outOf) {
    const r = Number(ranking);
    const o = Number(outOf);
    if (!Number.isFinite(r) || !Number.isFinite(o) || o <= 0 || r <= 0)
        return '-';
    const pct = (r / o) * 100;
    if (pct >= 10)
        return `top ${Math.round(pct)}%`;
    if (pct >= 1)
        return `top ${Math.round(pct * 10) / 10}%`;
    return `top ${pct.toFixed(2)}%`;
}
/**
 * 账号画像
 *
 * @param account `/api/user/<uid>` 的 `data.account`
 */
export function readAccount(account = {}) {
    const acc = obj(account);
    const info = obj(acc.playerInfo);
    const theater = obj(info.theater);
    return {
        uid: String(acc.uid || '').trim(),
        nickname: String(info.nickname || ''),
        signature: String(info.signature || ''),
        level: int(info.level), // 冒险等阶
        worldLevel: int(info.worldLevel),
        achievements: int(info.finishAchievementNum),
        abyss: { floor: int(info.towerFloorIndex), chamber: int(info.towerLevelIndex), stars: int(info.towerStarIndex) },
        theater: { act: int(theater.act), stars: int(theater.stars) },
        stygian: { index: int(info.stygianIndex), seconds: int(info.stygianSeconds), score: num(info.stygianScore) },
        owned: Array.isArray(acc.ownedCharacters) ? acc.ownedCharacters.length : 0,
        updatedAt: Number(acc.lastProfileUpdate) || 0
    };
}
/**
 * 单个角色的练度
 *
 * `calculations` 是「赛道 → 计算」的对象（实测常见只有 `fit`，也可能是多条）：
 * 取其中**名次最好的一条**作为主展示，其余作为补充。
 *
 * @param raw `/api/getCalculationsForUser/<uid>` 的 `data[]` 元素
 * @param translations 英文名 → 中文（akasha `textmap`）
 */
export function readAkashaChar(raw = {}, translations = {}) {
    const r = obj(raw);
    const id = String(r.characterId || '');
    const record = characterById(r.characterId);
    const zh = (name) => translations[String(name || '').toLowerCase()] || String(name || '');
    const variants = Object.entries(obj(r.calculations)).map(([key, one]) => {
        const c = obj(one);
        const w = obj(c.weapon);
        return {
            key,
            short: String(c.short || '').toUpperCase(),
            name: String(c.name || ''),
            result: Number(c.result) || 0,
            damageText: bigNumText(c.result),
            ranking: int(c.ranking),
            outOf: int(c.outOf),
            topText: topPercentText(c.ranking, c.outOf),
            weapon: {
                name: zh(w.name),
                refinement: int(w.refinement),
                rarity: int(w.rarity)
            }
        };
    });
    // 主展示：名次最好（top% 最小）的那条；没名次就用伤害最高的
    const score = (v) => (v.ranking > 0 && v.outOf > 0 ? v.ranking / v.outOf : Number.POSITIVE_INFINITY);
    const best = [...variants].sort((a, b) => score(a) - score(b) || b.result - a.result)[0] || null;
    const sets = Object.entries(obj(r.artifactSets))
        .map(([name, one]) => ({ name: zh(name), rawName: name, count: int(obj(one).count), icon: String(obj(one).icon || '') }))
        .sort((a, b) => b.count - a.count);
    const w = obj(r.weapon);
    const flat = obj(w.flat);
    const weaponInfo = obj(w.weaponInfo);
    const refinementLevel = obj(weaponInfo.refinementLevel);
    return {
        id,
        name: record?.name || zh(r.name) || `#${id}`,
        nameEn: String(r.name || ''),
        icon: String(r.icon || ''),
        element: record?.element || '',
        rarity: record?.rarity || 5,
        constellation: int(r.constellation),
        weapon: {
            name: best?.weapon?.name || zh(flat.name) || '',
            refinement: best?.weapon?.refinement || (int(refinementLevel.value) + 1) || 1,
            level: int(weaponInfo.level),
            // 与展示的武器名保持同一来源：优先用该赛道计算里的武器，其次才是当前装备
            rarity: best?.weapon?.rarity || int(flat.stars) || 5
        },
        sets,
        best,
        variants,
        updatedAt: Number(r.lastBuildUpdate) || 0
    };
}
/**
 * akasha 原始数据 → 视图
 *
 * @param payload `{ uid, account, calculations }`
 * @param opts `{ translations, max }`
 */
export function buildAkashaView(payload = {}, opts = {}) {
    const p = obj(payload);
    const translations = opts.translations || {};
    const max = opts.max || getAkashaMaxChars();
    const calculations = Array.isArray(p.calculations) ? p.calculations : [];
    const chars = calculations
        .map(raw => readAkashaChar(raw, translations))
        .sort((a, b) => {
        // 有 top% 的排前面（名次百分比升序），其余按伤害降序
        const sa = a.best && a.best.ranking > 0 && a.best.outOf > 0 ? a.best.ranking / a.best.outOf : Number.POSITIVE_INFINITY;
        const sb = b.best && b.best.ranking > 0 && b.best.outOf > 0 ? b.best.ranking / b.best.outOf : Number.POSITIVE_INFINITY;
        return sa - sb || (b.best?.result || 0) - (a.best?.result || 0);
    });
    return {
        player: readAccount(p.account),
        chars: chars.slice(0, max),
        total: chars.length
    };
}
/**
 * 按角色名/别名过滤（与榜单同一套角色表，`桃`/`火神`/`爷` 都认）
 *
 * @param chars `buildAkashaView` 的 chars
 * @param records `findCharacter` 的结果
 */
export function filterAkashaChars(chars, records = []) {
    if (!records.length)
        return chars;
    const ids = new Set(records.map(r => String(r.character_id)));
    return chars.filter(c => ids.has(String(c.id)));
}
/** 收集需要中文化的词（武器名 + 套装名） */
export function collectNameWords(calculations = []) {
    const words = new Set();
    for (const raw of calculations) {
        const r = obj(raw);
        for (const name of Object.keys(obj(r.artifactSets)))
            words.add(name);
        for (const one of Object.values(obj(r.calculations))) {
            const weapon = obj(obj(one).weapon);
            if (weapon.name)
                words.add(String(weapon.name));
        }
    }
    return [...words];
}
//# sourceMappingURL=akashaQuery.js.map