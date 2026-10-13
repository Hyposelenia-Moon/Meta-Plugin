/**
 * CharacterIndex — 角色表 / 危战首领表索引
 *
 * 两张表随插件分发（`resources/data/`），来源是站点前端 bundle 里内嵌的静态数据：
 *   `characters.json` —— 123 条：`name` / `alias[]` / `rarity` / `element` / `character_id`
 *   `bosses.json`     —— 36 条：`id` / `name` / `ver`（危战每期三个首领）
 * 它们决定三件事：角色搜索（别名命中）、头像路径（`character_id`）、危战榜单的版本与首领筛选。
 * 站点若改版，重新抓一次 bundle 覆盖这两个文件即可（见 README「数据表维护」）。
 *
 * 与合并前 `Mhydps-Plugin/model/CharacterIndex.js` 的差异**只有两处**（行为不变）：
 *   1. 数据目录改由 `dir.ts` 的 `resourcesDir` 派生（`path.join(resourcesDir, 'data')`）——
 *      源码里是 `path.resolve(__dirname, '../resources/data')`，那是按 `model/` 的相对深度自己拼目录；
 *      本工程是真 `resources/` 目录（不是源码相对路径），只有 `dir.ts` 知道插件根的权威位置；
 *   2. 日志前缀 `[Mhydps]` → `[Meta]`（本文件当前没有日志，规则留给后续改动守）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resourcesDir } from '../dir.js';
import { ELEMENT_CN } from '../components/constants.js';
/**
 * 数据目录：`<插件根>/resources/data`
 *
 * ⚠ 不要在这里再拼一次目录：`dir.ts` 是全插件**唯一**的路径出处，
 * 相对源文件位置拼路径在 TS 工程里会多算一层（源码 `src/model/` ≠ 运行时刻 `lib/model/`）。
 */
const dataDir = path.join(resourcesDir, 'data');
/** 缓存（惰性加载）。用 `undefined` 表示"没读过"，空数组也算已读 —— 与源码的 `if (!cache)` 等价 */
let characterCache;
let bossCache;
/** 归一化关键词：小写 + 去空白 */
const norm = (s) => String(s ?? '').trim().toLowerCase();
/** 读 JSON 文件，失败抛错（数据表缺失属于安装不完整） */
function readJson(file) {
    const p = path.join(dataDir, file);
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    if (!Array.isArray(json))
        throw new Error(`${file} 结构异常：应为数组`);
    return json;
}
/** 角色表（惰性加载 + 缓存） */
export function characters() {
    if (!characterCache)
        characterCache = readJson('characters.json');
    return characterCache;
}
/** 危战首领表（惰性加载 + 缓存） */
export function bosses() {
    if (!bossCache)
        bossCache = readJson('bosses.json');
    return bossCache;
}
/** 清缓存（测试与热更新用） */
export function resetCache() {
    characterCache = undefined;
    bossCache = undefined;
}
/** 元素英文 → 中文（未知原样返回） */
export function elementCn(element) {
    // 源码是 `ELEMENT_CN[element] || element || ''`：这里先把键收成字符串，
    // 于是 `element == null` 时返回 `''`（源码会返回 `''`，因为 `null || ''` 就是 `''`），其余取值逐字一致
    const key = String(element ?? '');
    return ELEMENT_CN[key] || key;
}
/** 按 `character_id` 取角色记录 */
export function characterById(id) {
    const target = Number(id);
    if (!Number.isFinite(target))
        return null;
    return characters().find(c => c.character_id === target) || null;
}
/**
 * 按名字/别名找角色，返回带评分的候选（分数越小越贴近）
 *
 * 评分次序（与源码逐字一致）：精确 0 → 别名精确 1 → 前缀 2 → 别名前缀 3 → 包含 4 → 别名包含 5。
 * 同分时按 `rarity` 降序（更可能是玩家想找的那个）、名字长度升序。
 */
function candidates(keyword) {
    const key = norm(keyword);
    if (!key)
        return [];
    const out = [];
    for (const record of characters()) {
        const name = norm(record.name);
        let best = null;
        if (name === key)
            best = { record, score: 0, hit: record.name };
        else if ((record.alias || []).some(a => norm(a) === key))
            best = { record, score: 1, hit: key };
        else if (name.startsWith(key))
            best = { record, score: 2, hit: record.name };
        else if ((record.alias || []).some(a => norm(a).startsWith(key)))
            best = { record, score: 3, hit: key };
        else if (name.includes(key))
            best = { record, score: 4, hit: record.name };
        else if ((record.alias || []).some(a => norm(a).includes(key)))
            best = { record, score: 5, hit: key };
        if (best)
            out.push(best);
    }
    return out.sort((a, b) => a.score - b.score
        || (b.record.rarity || 0) - (a.record.rarity || 0)
        || String(a.record.name).length - String(b.record.name).length);
}
/** 关键词 → 单个角色（取最贴近的一个） */
export function findCharacter(keyword) {
    return candidates(keyword)[0]?.record || null;
}
/** 关键词 → 角色候选列表 */
export function searchCharacters(keyword, limit = 8) {
    return candidates(keyword).slice(0, limit).map(c => c.record);
}
/** 判断榜单里的成员名是否命中某个角色记录（成员名可能是别名，如「爷」「龟」） */
export function memberIs(memberName, record) {
    if (!memberName || !record)
        return false;
    const key = norm(memberName);
    if (norm(record.name) === key)
        return true;
    return (record.alias || []).some(a => norm(a) === key);
}
/** 角色名 → 立绘 id（用于头像路径）；找不到返回空串 */
export function avatarIdOf(name) {
    // 保留源码的两次 `findCharacter`（第二次可能拿到 null，靠可选链兜住）—— 这里只做类型收窄，不改语义
    return findCharacter(name)?.character_id ? String(findCharacter(name)?.character_id) : '';
}
/** 全部危战版本（降序，7.1 → 5.7） */
export function versions() {
    const list = [...new Set(bosses().map(b => b.ver))];
    return list.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
/** 按 id 取首领 */
export function bossById(id) {
    const target = Number(id);
    if (!Number.isFinite(target))
        return null;
    return bosses().find(b => b.id === target) || null;
}
/** 某版本下的全部首领 */
export function bossesOfVer(ver) {
    return bosses().filter(b => b.ver === ver);
}
/** 关键词 → 首领（名字精确 > 名字包含） */
export function findBoss(keyword) {
    const key = norm(keyword);
    if (!key)
        return null;
    const list = bosses();
    return list.find(b => norm(b.name) === key)
        || list.find(b => norm(b.name).includes(key))
        || list.find(b => key.includes(norm(b.name)))
        || null;
}
//# sourceMappingURL=CharacterIndex.js.map