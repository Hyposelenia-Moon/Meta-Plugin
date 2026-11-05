/**
 * Atlas-Plugin 适配层（**可选依赖**：缺失或异常必须降级，绝不报错）
 *
 * 别名走正式公共门面 `modules/aliasApi.js`，动态 import + 探测；
 * 不 import 内部实现，不写 Atlas 数据；导入或调用异常只返回空候选。
 * 双向候选由调用方按本仓库标准角色集合裁决，不能直接采用 primary。
 * 图标 / 实体信息仍预留窄接口，等待对应稳定导出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { botRoot } from '../dir.js';
/** Atlas 插件目录：`META_ATLAS_DIR` 优先；默认 `<bot>/plugins/Atlas-Plugin` */
export function defaultAtlasRoot() {
    return process.env.META_ATLAS_DIR
        ? path.resolve(process.env.META_ATLAS_DIR)
        : path.join(botRoot, 'plugins', 'Atlas-Plugin');
}
/** 图鉴富文本 → 纯文本（去颜色/链接标记，换行归一成空格） */
function plainGameText(value) {
    let text = String(value ?? '');
    text = text.replace(/<color=[^>]*>/gi, '').replace(/<\/color>/gi, '');
    text = text.replace(/\{LINK#[^}]*\}/gi, '').replace(/\{\/LINK\}/gi, '');
    text = text.replace(/<[^>]+>/g, '');
    return text.replace(/\s+/g, ' ').trim();
}
/** 数字字段：`0.05` / `'5%'` / 空 → number | undefined */
function numberOrUndefined(value) {
    if (value === null || value === undefined || value === '')
        return undefined;
    const text = String(value).trim();
    const direct = Number(text);
    if (Number.isFinite(direct))
        return direct;
    const m = text.match(/^(-?\d+(?:\.\d+)?)%$/);
    return m ? Number(m[1]) / 100 : undefined;
}
/** 图鉴元素名 → 本仓库元素键 */
const ELEMENT_BY_ATLAS = {
    Pyro: 'pyro', Hydro: 'hydro', Electro: 'electro', Cryo: 'cryo',
    Anemo: 'anemo', Geo: 'geo', Dendro: 'dendro'
};
/** 图鉴武器类型 → 本仓库武器类型键 */
const WEAPON_BY_ATLAS = {
    WEAPON_SWORD_ONE_HAND: 'sword',
    WEAPON_CLAYMORE: 'claymore',
    WEAPON_POLEARM: 'polearm',
    WEAPON_BOW: 'bow',
    WEAPON_CATALYST: 'catalyst'
};
export class AtlasRes {
    root;
    /** 实体查询缓存（同一进程内只读一次 JSON） */
    entityCache = new Map();
    codexCache = new Map();
    constructor(root = defaultAtlasRoot()) {
        this.root = root;
    }
    exists(rel) {
        try {
            return fs.existsSync(path.join(this.root, rel));
        }
        catch {
            return false;
        }
    }
    /** 插件目录在场 */
    get present() {
        return this.exists('package.json') || this.exists('index.js');
    }
    /** codex 相关文件仍在（`model/codexIndex/*`） */
    hasCodex() {
        return this.exists('model/codexIndex/parse.js') || this.exists('model/codexIndex/index.js');
    }
    /** 是否有可用的 Atlas 能力（导入落地前只表示"在场"，不表示能取到数据） */
    available() {
        return this.present;
    }
    /** 只载入正式公共门面；模块缓存交给 ESM，别名结果不缓存以支持实时变更。 */
    async resolveAlias(name) {
        try {
            const file = path.join(this.root, 'modules', 'aliasApi.js');
            if (!fs.existsSync(file))
                return [];
            const api = await import(pathToFileURL(file).href);
            if (typeof api.resolveAlias !== 'function')
                return [];
            const result = await api.resolveAlias(name, 'gi');
            return Array.isArray(result?.candidates)
                ? [...new Set(result.candidates.filter((v) => typeof v === 'string' && !!v.trim()))]
                : [];
        }
        catch {
            return [];
        }
    }
    /**
     * 解析图标（`kind` + 名字 → **绝对文件 URL**）
     *
     * 数据来源是 Atlas 后端（`tool/nanoka-atlas-backend`）导出的图鉴记录与
     * `gallery/gi/<iconKey>.webp` 本地图片。返回的是整串 `file:///` 地址：
     * 与本插件 resources 不在同一目录树，模板不能拿 `{{_miao_path}}` 拼，
     * 调用方（`subViews.ts`）会按 `iconSource === 'atlas'` 原样输出。
     *
     * 任何缺失（没装 Atlas、没有这张图、JSON 坏）都返回 `null`，绝不抛错。
     */
    icon(kind, name) {
        const entity = this.entityOf(kind, name);
        const file = entity?.iconFile;
        if (!file)
            return null;
        try {
            if (!fs.existsSync(file))
                return null;
            return { rel: pathToFileURL(file).href, source: 'atlas' };
        }
        catch {
            return null;
        }
    }
    /**
     * 实体信息（星级 / 元素 / 武器类型 / 图标文件）
     *
     * 目前只接**角色**与**武器**：这两类在 miao 缺数据时最影响攻略页（新角色的
     * 元素底色、头像、武器图标）。圣遗物套装仍由 miao 提供，Atlas 侧暂不索引。
     */
    entityOf(kind, name) {
        const key = `${kind}:${name}`;
        if (this.entityCache.has(key))
            return this.entityCache.get(key) ?? null;
        const entity = this.readEntity(kind, name);
        this.entityCache.set(key, entity);
        return entity;
    }
    readEntity(kind, name) {
        try {
            const file = this.findRecord(kind, name);
            if (!file)
                return null;
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            const list = raw.content?.list ?? {};
            const detail = raw.content?.detail ?? {};
            const iconKey = String(list.icon ?? detail.icon ?? '').trim();
            const iconFile = iconKey ? this.iconFileOf(iconKey) : null;
            const base = { kind, name, file, iconKey: iconKey || undefined, iconFile: iconFile ?? undefined };
            if (kind === 'character') {
                return {
                    ...base,
                    star: this.starOf(list.rank ?? detail.rarity),
                    element: ELEMENT_BY_ATLAS[String(list.element ?? '').trim()],
                    weaponType: WEAPON_BY_ATLAS[String(list.weapon ?? '').trim()]
                };
            }
            if (kind === 'weapon') {
                return {
                    ...base,
                    star: this.starOf(detail.rarity),
                    weaponType: WEAPON_BY_ATLAS[String(detail.weapon_type ?? '').trim()]
                };
            }
            return base;
        }
        catch {
            return null;
        }
    }
    /** 记录文件定位（图鉴导出的目录结构：角色/武器按星级分目录） */
    findRecord(kind, name) {
        const root = this.itemsRoot();
        const dirs = kind === 'character'
            ? ['角色/五星', '角色/四星']
            : (kind === 'weapon' ? ['武器/五星', '武器/四星', '武器/三星', '武器/二星', '武器/一星'] : []);
        for (const dir of dirs) {
            const file = path.join(root, dir.replace(/\//g, path.sep), `${name}.json`);
            if (fs.existsSync(file))
                return file;
        }
        return null;
    }
    /** 图鉴数据根：`<Atlas 插件>/tool/nanoka-atlas-backend/nanoka-atlas-backend/data/items/简体中文/原神` */
    itemsRoot() {
        return path.join(this.backendRoot(), 'data', 'items', '简体中文', '原神');
    }
    backendRoot() {
        return process.env.META_ATLAS_BACKEND
            ? path.resolve(process.env.META_ATLAS_BACKEND)
            : path.join(this.root, 'tool', 'nanoka-atlas-backend', 'nanoka-atlas-backend');
    }
    /** 图标 key → 本地图片（`gallery/gi/<key>.webp`） */
    iconFileOf(iconKey) {
        if (!/^[A-Za-z0-9_]+$/.test(iconKey))
            return null;
        const file = path.join(this.backendRoot(), 'gallery', 'gi', `${iconKey}.webp`);
        return fs.existsSync(file) ? file : null;
    }
    /** `QUALITY_ORANGE` / 5 / '5' → 5；`QUALITY_PURPLE` → 4 */
    starOf(rank) {
        const text = String(rank ?? '').trim();
        if (text === 'QUALITY_ORANGE')
            return 5;
        if (text === 'QUALITY_PURPLE')
            return 4;
        if (text === 'QUALITY_BLUE')
            return 3;
        const n = Number(text);
        return Number.isFinite(n) && n >= 1 && n <= 5 ? n : undefined;
    }
    /**
     * 图鉴正文（天赋技能 / 命座 / 基础属性）
     *
     * 攻略数据没写或只写了概括时，用图鉴的官方文本补全。只读、缓存、
     * 缺字段就少给（调用方按项判断），任何异常返回 null。
     */
    codexOf(name) {
        if (this.codexCache.has(name))
            return this.codexCache.get(name) ?? null;
        const codex = this.readCodex(name);
        this.codexCache.set(name, codex);
        return codex;
    }
    readCodex(name) {
        const entity = this.entityOf('character', name);
        if (!entity)
            return null;
        try {
            const raw = JSON.parse(fs.readFileSync(entity.file, 'utf8'));
            const detail = raw.content?.detail ?? {};
            const letters = ['A', 'E', 'Q'];
            const skills = Array.isArray(detail.skills)
                ? detail.skills.slice(0, 3).map((skill, i) => ({
                    letter: letters[i] ?? 'A',
                    name: String(skill.name ?? '').trim(),
                    desc: plainGameText(skill.desc)
                })).filter(skill => !!skill.name || !!skill.desc)
                : [];
            const constellations = Array.isArray(detail.constellations)
                ? detail.constellations.map((cons, i) => ({
                    index: i + 1,
                    name: String(cons.name ?? '').trim(),
                    desc: plainGameText(cons.desc)
                })).filter(cons => !!cons.name || !!cons.desc)
                : [];
            return {
                skills,
                constellations,
                base: {
                    hp: numberOrUndefined(detail.base_hp),
                    atk: numberOrUndefined(detail.base_atk),
                    def: numberOrUndefined(detail.base_def),
                    critRate: numberOrUndefined(detail.crit_rate),
                    critDmg: numberOrUndefined(detail.crit_dmg),
                    mastery: numberOrUndefined(detail.elemental_mastery)
                }
            };
        }
        catch {
            return null;
        }
    }
    /** 状态上报 */
    status() {
        const present = this.present;
        const codex = this.hasCodex();
        return {
            root: this.root,
            present,
            codex,
            note: !present
                ? '未安装（可选依赖，缺失不影响攻略查询）'
                : (this.exists('modules/aliasApi.js')
                    ? '在场（别名门面可探测；图标 / 实体信息按图鉴导出读取）'
                    : (codex ? '在场（codex 模块尚未剥离；别名门面未提供）' : '在场（codex 已剥离，别名门面未提供）'))
        };
    }
}
/** 插件运行期共用的实例 */
export const atlasRes = new AtlasRes();
//# sourceMappingURL=AtlasRes.js.map