/**
 * MiaoPanel — 用 miao-plugin 的面板渲染 **akasha 的数据**
 *
 * 需求：练度查询的画面对齐 miao 的面板（版式/图标/布局都用 miao 的代码），
 * 但**数据只来自 akasha.cv**（不碰 mhydps 的 Enka 代理，也不让 miao 自己去拉 Enka）。
 *
 * 做法：
 *   1) 把 akasha 的 `/api/builds`（等级/命座/天赋/武器/套装主词条）与
 *      `/api/getCalculationsForUser`（名次/伤害/武器）拼成 miao 的 **Avatar** ——
 *      复用 miao 的 `Avatar.create()` + `setAvatar(ds)`（`ds` 的形状与它自己的 `EnkaData` 一致）；
 *   2) 面板数值用 **akasha 的 `stats`**（它自己的聚合结果），不启用 miao 的属性推算
 *      （miao 推算需要圣遗物副词条，而 akasha 的接口不提供，见下）；
 *   3) 用 miao 的 `Common.render('character/profile-detail', …)` 出图。
 *
 * 已知缺口（**不要编数字**）：
 *   akasha 只给每件圣遗物的**主词条 key**，不给副词条，也不给圣遗物与角色的归属关系，
 *   因此面板的 5 张圣遗物卡与「圣遗物总分/评级」**留空**，并由调用方在文本里说明原因。
 *
 * ── 合并到 Meta-Plugin 时的三处**类型化**改动（逻辑/字符串/导出名逐字未动）──
 *   a. `miaoPluginDir()` 的"当前目录"：源码取 `process.cwd()`，这里改取 `dir.ts` 的 `botRoot`
 *      （= 插件根的上一级）—— `cwd` 在框架里依赖启动方式，而 `botRoot` 是唯一权威；两者
 *      在标准布局下是同一个目录，`<bot>/plugins/miao-plugin` 的解析结果不变。
 *   b. 配置读取：源码用 `components/config.js` 的 `getPluginConfig()`；本工程的对应物是
 *      `components/config.ts` 的 `loadConfig()`（同样是"逐字段合并默认值"的语义，且配置文件缺失时
 *      按默认值返回）。`getAkashaEnabled()` 的判定 `!== false` 同样内联为对 `akashaEnabled` 的判定。
 *   c. 本仓库**没有** akasha 客户端模块来提供 `loadFromDisk` 之类的启动加载 —— 本文件不做启动
 *      加载（它本来也只被查询路径使用），启动职责统一在 `model/startup.ts`。
 *   ⚠ miao-plugin 是外部无类型依赖：从它动态 import 的模型/组件在类型上用本文件内的窄接口描述，
 *     用不到的成员一概不声明（不引 `any`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { botRoot } from '../dir.js';
import { loadConfig } from '../components/config.js';
/* ============================================================
 *  定位与加载 miao-plugin
 * ============================================================ */
/**
 * 目录"像不像 miao-plugin"（能力判定，不看目录名）
 *
 * `models/index.js` 是导入入口；再要一个 miao 特有的资源/应用目录，避免误判其它插件。
 */
function looksLikeMiao(dir) {
    return fs.existsSync(path.join(dir, 'models', 'index.js')) &&
        (fs.existsSync(path.join(dir, 'resources', 'meta-gs')) ||
            fs.existsSync(path.join(dir, 'apps', 'profile')));
}
/** `plugins/*` 里所有目录（扫描用；读不到就返回空数组） */
function pluginDirs() {
    const base = path.join(botRoot, 'plugins');
    try {
        return fs.readdirSync(base, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => path.join(base, d.name));
    }
    catch {
        return [];
    }
}
/**
 * 本机 miao-plugin 目录（可用 `META_MIAO_PLUGIN` 环境变量或配置 `miaoPluginDir` 覆盖）
 *
 * ⚠ 修正（2026-10-14）：`dir.ts` 的 `botRoot` 是 **bot 根**（如 `D:\...\Yunzai`），
 *   不是 `<bot>/plugins` —— 原实现少拼了一层 `plugins`，于是永远找不到 miao。
 *   另外阿修 fork 版可能装成别的目录名，所以最后**扫描 `plugins/*` 做能力判定**兜底。
 */
export function miaoPluginDir() {
    const cfg = loadConfig();
    const candidates = [
        String(process.env.META_MIAO_PLUGIN || ''),
        String(cfg.miaoPluginDir || '').trim(),
        path.join(botRoot, 'plugins', 'miao-plugin'),
        path.join(botRoot, 'miao-plugin')
    ];
    for (const p of candidates) {
        if (!p)
            continue;
        const dir = path.resolve(p);
        if (looksLikeMiao(dir))
            return dir;
    }
    // 兜底：目录名被改过（fork / 自定义）时按能力找
    for (const dir of pluginDirs()) {
        const name = path.basename(dir).toLowerCase();
        if (name.includes('meta') || name.includes('atlas') || name.includes('mhydps'))
            continue;
        if (looksLikeMiao(dir))
            return dir;
    }
    return '';
}
let loaded = null;
let loadError = '';
/** 上一次加载失败的原因（排查用） */
export function miaoLoadError() {
    return loadError;
}
/** 加载 miao 的模型与渲染入口（进程内一次） */
export async function loadMiao() {
    if (loaded)
        return loaded;
    const dir = miaoPluginDir();
    if (!dir) {
        loadError = 'not found';
        return null;
    }
    try {
        const url = (rel) => pathToFileURL(path.join(dir, rel)).href;
        // `import()` 的边界：specifier 由 `url()` 在运行时刻算出，tsc 拿到的是未类型化模块
        // （所以这里既没有编译错误、也没有 `@ts-expect-error` 可压）。显式断言成窄接口、不用 `any`，
        // 断言的正确性由 miao-plugin 的导出名保证。
        const models = (await import(url('models/index.js')));
        const components = (await import(url('components/index.js')));
        loaded = { dir, models, Common: components.Common, Format: components.Format };
        return loaded;
    }
    catch (err) {
        loadError = String(err?.message || err);
        logger?.warn?.(`[Meta] 加载 miao-plugin 失败：${loadError}`);
        return null;
    }
}
/* ============================================================
 *  akasha 数据 → miao Avatar
 * ============================================================ */
/** akasha 的英文属性名 → miao/面板用的字段名 */
const STAT_KEY = {
    hp: 'hp',
    baseHp: 'hpBase',
    atk: 'atk',
    baseAtk: 'atkBase',
    def: 'def',
    baseDef: 'defBase',
    elementalMastery: 'mastery',
    critRate: 'cpct',
    critDamage: 'cdmg',
    energyRecharge: 'recharge',
    healingBonus: 'heal'
};
/** 天赋位次（akasha 的 `talentsLevelMap` 键）→ miao 的 a/e/q */
const TALENT_KEY = {
    normalAttacks: 'a',
    elementalSkill: 'e',
    elementalBurst: 'q'
};
/** 从 akasha 的 build 对象拼出 miao Avatar 需要的 `ds`（形状与 miao 的 `EnkaData` 一致） */
export async function buildAkashaAvatar(charId, build = {}) {
    const miao = await loadMiao();
    if (!miao)
        return null;
    const { Avatar, Character, Weapon } = miao.models;
    const char = Character.get(charId);
    if (!char)
        return null;
    const weaponId = build?.weapon?.weaponId;
    let weaponName = String(build?.weapon?.name || '');
    let weapon = null;
    try {
        // 保留源码的短路写法（`weaponId && …` 在 JS 里返回的是 falsy 值本身，这里显式写成三元，语义一致）
        weapon = (weaponId ? Weapon.get(weaponId) : null) || (weaponName ? Weapon.get(weaponName, 'gs') : null) || null;
    }
    catch { /* 找不到就退回英文名 */ }
    if (weapon?.name)
        weaponName = weapon.name;
    const talent = {};
    for (const [key, one] of Object.entries(build?.talentsLevelMap || {})) {
        const mapped = TALENT_KEY[key] || (key === 'elementalSkill' ? 'e' : null);
        if (mapped)
            talent[mapped] = Number(one?.level) || 0;
    }
    const ds = {
        level: Number(build?.propMap?.level?.val) || 0,
        promote: Number(build?.propMap?.ascension?.val) || 0,
        cons: Number(build?.constellation) || 0,
        fetter: Number(build?.fetterInfo?.expLevel) || 0,
        costume: Number(build?.costumeId) || 0,
        elem: char.elem,
        weapon: {
            name: weaponName,
            level: Number(build?.weapon?.weaponInfo?.level) || 0,
            promote: Number(build?.weapon?.weaponInfo?.promoteLevel) || 0,
            affix: Number(build?.weapon?.weaponInfo?.refinementLevel?.value ?? 0) + 1
        },
        talent,
        // akasha 不提供圣遗物副词条 → 刻意留空（不编数字）
        artis: {}
    };
    const avatar = Avatar.create({ id: char.id }, 'gs');
    if (!avatar)
        return null;
    avatar.uid = String(build?.uid || '');
    avatar.setAvatar(ds, 'enka');
    return avatar;
}
/* ============================================================
 *  akasha stats → 面板数值
 * ============================================================ */
/** akasha 的 stats → 面板的 attr 结构（只给总值，基础/加成留 `-`） */
export function akashaAttr(stats = {}, Format) {
    const attr = {};
    for (const [from, to] of Object.entries(STAT_KEY)) {
        const value = stats?.[from]?.value;
        if (value === undefined || value === null)
            continue;
        attr[to] = to === 'mastery' ? Format.comma(Number(value), 1) : Format.pct(Number(value));
        attr[`${to}Base`] = '-';
        attr[`${to}Plus`] = '-';
    }
    // 生命/攻击/防御在 akasha 里给的是 base，换算成展示用的整数
    if (stats?.baseAtk?.value)
        attr.atk = Format.comma(Number(stats.baseAtk.value), 1);
    return attr;
}
/** miao 面板的属性表需要的 8 项键（缺的补 `-`） */
const ATTR_KEYS = ['hp', 'atk', 'def', 'mastery', 'cpct', 'cdmg', 'recharge', 'dmg'];
/** 组装 miao 面板模板的 renderData（数值来自 akasha） */
export async function toPanelData({ uid, avatar, attr = {}, costumeSplash = '' }) {
    const miao = await loadMiao();
    if (!miao || !avatar)
        return null;
    const { Artifact } = miao.models;
    const { Format } = miao;
    const full = {};
    for (const key of ATTR_KEYS) {
        full[key] = attr[key] ?? '-';
        full[`${key}Base`] = attr[`${key}Base`] ?? '-';
        full[`${key}Plus`] = attr[`${key}Plus`] ?? '-';
    }
    const data = avatar.getData('name,abbr,cons,level,talent,imgs,costumeSplash');
    if (costumeSplash)
        data.costumeSplash = costumeSplash;
    try {
        data.weapon = avatar.getWeaponDetail?.();
    }
    catch {
        data.weapon = null;
    }
    // 圣遗物区留空：akasha 不提供副词条，强行渲染只会得到空卡或假数字
    const artisDetail = {};
    try {
        Object.assign(artisDetail, avatar.getArtisMark?.() || {});
    }
    catch { /* 没有圣遗物时 miao 可能直接抛错，忽略 */ }
    artisDetail.artis = {};
    artisDetail.allAttr = Array.from({ length: 9 }, () => ({}));
    artisDetail.mark = '';
    artisDetail.markClass = '';
    if (Format?.comma === undefined)
        return null;
    return {
        save_id: uid,
        uid: String(uid),
        game: 'gs',
        data,
        attr: full,
        elem: avatar.char?.elem || '',
        hsr_paths: avatar.char?.weapon || '',
        dmgCalc: { dmgData: [] },
        artisDetail,
        artisKeyTitle: Artifact.getArtisKeyTitle('gs'),
        bodyClass: `char-${avatar.char?.name || ''}`,
        mode: 'profile',
        wCfg: {},
        changeProfile: false
    };
}
/** 调 miao 自己的渲染入口出图（模板/样式/图标/缩放都是 miao 的） */
export async function renderMiaoPanel(e, panelData, scale = 1.6) {
    const miao = await loadMiao();
    if (!miao || !panelData)
        return false;
    await miao.Common.render('character/profile-detail', panelData, { e, scale });
    return true;
}
/** 面板是否可用（配置 + miao 是否就位） */
export async function miaoPanelReady() {
    // 等于源码的 `getAkashaEnabled()`：只有显式 `akashaEnabled: false` 才算关闭
    if (loadConfig().akashaEnabled === false)
        return false;
    return Boolean(await loadMiao());
}
//# sourceMappingURL=MiaoPanel.js.map