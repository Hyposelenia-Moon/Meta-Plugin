/**
 * MiaoPanelSource — 从 miao 读取玩家面板（轴编辑器的「从 miao 读取」）
 *
 * 与 `#练度查询` 用**同一套 miao 数据入口**：
 *   - 账号与角色来自 miao 的 `Player` 模型（本地面板缓存，缓存位置与练度查询同一份）；
 *   - 圣遗物的 mainId / attrIds 用 miao 自己的解码表 `resources/meta-gs/artifact/extra.js`
 *     解成「属性键 + 数值」，不另抄一份 id 映射。
 *
 * 差异：练度查询会顺带刷新米游社；这里只读缓存（编辑器里刷新要几十秒且会弹 miao 的提示），
 * 缓存时间由 `cachedAt` 透出，界面负责告诉用户「数据可能过期」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { botRoot } from '../dir.js';
import { miaoPluginDir } from './MiaoPanel.js';
/** miao 的部位顺序（1..5）→ 我们的 slot 键 */
const SLOT_KEYS = ['flower', 'plume', 'sands', 'goblet', 'circlet'];
/** miao 的属性键 → 本仓库的属性键（`hpPlus` 才是小生命，`hp` 反而是百分比） */
const KEY_MAP = {
    hpPlus: 'hp',
    atkPlus: 'atk',
    defPlus: 'def',
    hp: 'hpPct',
    atk: 'atkPct',
    def: 'defPct',
    mastery: 'mastery',
    recharge: 'recharge',
    cpct: 'cpct',
    cdmg: 'cdmg',
    heal: 'heal',
    phy: 'phy',
    pyro: 'pyro',
    hydro: 'hydro',
    electro: 'electro',
    cryo: 'cryo',
    anemo: 'anemo',
    geo: 'geo',
    dendro: 'dendro',
    dmg: 'dmg'
};
/**
 * 找 miao-plugin 目录（编辑器进程不在 Yunzai 里，`miaoPluginDir()` 的 bot 根可能定位不到）
 *
 * 顺序：`META_MIAO_PLUGIN` → `miaoPluginDir()` → 常见 Yunzai 安装位置。
 * 只认「目录里有 models/index.js」的候选，避免误判。
 */
export function resolveMiaoDir() {
    const looks = (dir) => !!dir && fs.existsSync(path.join(dir, 'models', 'index.js'));
    const env = String(process.env.META_MIAO_PLUGIN ?? '').trim();
    if (looks(env))
        return env;
    const fromBot = miaoPluginDir();
    if (fromBot && looks(fromBot))
        return fromBot;
    const miaoRoot = String(process.env.MIAO_ROOT ?? '').replace(/\\/g, '/').trim();
    if (miaoRoot) {
        const guess = path.dirname(path.dirname(miaoRoot));
        if (looks(guess))
            return guess;
    }
    for (const guess of ['D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin', 'D:/Yunzai/plugins/miao-plugin']) {
        if (looks(guess))
            return guess;
    }
    return null;
}
function miaoUrl(rel) {
    const dir = resolveMiaoDir();
    if (!dir)
        throw new Error('未找到 miao-plugin 目录');
    return `file:///${dir.replace(/\\/g, '/')}/${rel.replace(/\\/g, '/')}`;
}
let modelsPromise = null;
/** miao 的模型入口（与 MiaoProfile.ts 同一手法；进程内只加载一次） */
export function miaoModels() {
    if (!modelsPromise) {
        modelsPromise = import(miaoUrl('models/index.js')).then((mod) => {
            const anyMod = mod;
            return (anyMod?.default && typeof anyMod.default === 'object') ? { ...anyMod.default, ...anyMod } : anyMod;
        });
    }
    return modelsPromise;
}
let tablesPromise = null;
/** miao 的圣遗物解码表（mainId → 属性键；attrId → 该条属性与数值） */
export function artiTables() {
    if (!tablesPromise)
        tablesPromise = import(miaoUrl('resources/meta-gs/artifact/extra.js'));
    return tablesPromise;
}
/** 本机 miao 的玩家缓存目录（练度查询读的也是这一份） */
export function playerDataDir() {
    const dir = resolveMiaoDir();
    if (dir) {
        // <Yunzai>/plugins/miao-plugin → <Yunzai>/data/PlayerData/gs
        const guess = path.join(path.dirname(path.dirname(dir)), 'data', 'PlayerData', 'gs');
        if (fs.existsSync(guess))
            return guess;
    }
    return path.join(botRoot, 'data', 'PlayerData', 'gs');
}
/** 列出有本地缓存的 uid（按缓存时间倒序） */
export function listCachedUids() {
    const dir = playerDataDir();
    let files = [];
    try {
        files = fs.readdirSync(dir).filter(file => /^\d{9}\.json$/.test(file));
    }
    catch {
        return [];
    }
    const out = [];
    for (const file of files) {
        const uid = file.replace(/\.json$/, '');
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            // miao 的缓存把时间戳放在 `_info` / `_profile`（毫秒），没有 `_time`
            const stamp = Number(raw?._profile ?? raw?._info ?? 0);
            out.push({
                uid,
                name: String(raw?.name ?? ''),
                level: Number(raw?.level) || 0,
                cachedAt: stamp > 0 ? new Date(stamp).toISOString() : ''
            });
        }
        catch { /* 损坏的缓存跳过 */ }
    }
    return out.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
}
/** miao 的 `Artifact.get(部位名).set`（拿套装名）；模型不可用时退回空串 */
function setOfPiece(models, pieceName) {
    try {
        const arti = models?.Artifact?.get?.(pieceName);
        return String(arti?.set ?? '');
    }
    catch {
        return '';
    }
}
/** 解码一套圣遗物（1..5） */
export function decodeArtis(models, tables, artis) {
    const out = [];
    for (let idx = 1; idx <= 5; idx++) {
        const raw = (artis?.[idx] ?? artis?.[String(idx)]);
        if (!raw || !raw.name)
            continue;
        const mainKey = KEY_MAP[String(tables.mainIdMap[String(raw.mainId)] ?? '')] ?? '';
        const subs = [];
        for (const attrId of (Array.isArray(raw.attrIds) ? raw.attrIds : [])) {
            const hit = tables.attrIdMap[String(attrId)];
            if (!hit)
                continue;
            const key = KEY_MAP[String(hit.key)] ?? '';
            if (!key)
                continue;
            const value = Number(hit.value);
            if (!Number.isFinite(value))
                continue;
            subs.push({ key, value });
        }
        out.push({
            slot: SLOT_KEYS[idx - 1],
            set: setOfPiece(models, String(raw.name)),
            piece: String(raw.name),
            star: Number(raw.star) || 5,
            level: Number(raw.level) || 0,
            mainId: Number(raw.mainId) || 0,
            mainKey,
            subs
        });
    }
    return out;
}
/**
 * 读一个 uid 的全部角色面板（只读缓存，不联网刷新）
 *
 * 返回的 `artis` 只保留 1..5 都有数据且主词条可解码的角色；其余角色仍返回，
 * 由调用方按 `artis.length` 决定能不能用。
 */
export async function readMiaoPanels(uid) {
    const clean = String(uid || '').trim();
    if (!/^\d{9}$/.test(clean))
        return { ok: false, error: 'uid 应为 9 位数字' };
    if (!resolveMiaoDir())
        return { ok: false, error: '未找到 miao-plugin（必需依赖）' };
    let models;
    let tables;
    try {
        models = await miaoModels();
        tables = await artiTables();
    }
    catch (err) {
        return { ok: false, error: `加载 miao 数据失败：${err?.message ?? err}` };
    }
    const Player = models.Player;
    if (!Player)
        return { ok: false, error: 'miao 模型缺少 Player（版本不兼容？）' };
    let player;
    try {
        player = typeof Player.get === 'function' ? Player.get(clean) : Player.create({ uid: clean });
    }
    catch (err) {
        return { ok: false, error: `读取玩家 ${clean} 失败：${err?.message ?? err}` };
    }
    if (!player)
        return { ok: false, error: `本机没有 ${clean} 的面板缓存（先在 miao 里查一次面板）` };
    const avatars = player._avatars && typeof player._avatars === 'object' ? player._avatars : {};
    const characters = [];
    for (const avatar of Object.values(avatars)) {
        if (!avatar?.name || !avatar?.id)
            continue;
        const talent = avatar.talent && typeof avatar.talent === 'object' ? avatar.talent : {};
        const weapon = avatar.weapon?.name
            ? { name: String(avatar.weapon.name), level: Number(avatar.weapon.level) || 0, affix: Number(avatar.weapon.affix) || 1 }
            : null;
        characters.push({
            charId: String(avatar.id),
            name: String(avatar.name),
            level: Number(avatar.level) || 0,
            cons: Number(avatar.cons) || 0,
            talent: {
                A: Number(talent.a?.level ?? talent.a) || 0,
                E: Number(talent.e?.level ?? talent.e) || 0,
                Q: Number(talent.q?.level ?? talent.q) || 0
            },
            weapon,
            artis: decodeArtis(models, tables, avatar.artis && typeof avatar.artis === 'object' ? avatar.artis : {})
        });
    }
    let cachedAt = '';
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(playerDataDir(), `${clean}.json`), 'utf8'));
        const stamp = Number(raw?._profile ?? raw?._info ?? 0);
        if (stamp > 0)
            cachedAt = new Date(stamp).toISOString();
    }
    catch { /* 缓存文件读不到就不显示时间 */ }
    return { ok: true, uid: clean, cachedAt, characters: characters.sort((a, b) => a.name.localeCompare(b.name, 'zh')) };
}
//# sourceMappingURL=MiaoPanelSource.js.map