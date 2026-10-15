/**
 * ProfileImgRes — 角色面板图 / 立绘（**图库兼容，逻辑照抄 miao**）
 *
 * 对应 miao 的三处实现，本文件只做"读路径 + 选图"，**不 import 它的任何模块**（只读它的配置与目录）：
 *   - `models/character/CharImg.js:getProfileImgSrc()`  —— 图库源：`config/profile.js` →
 *     `config/system/profile_system.js` → `['profile']`，**第一个能解析出非空源列表的配置生效**；
 *   - `models/character/CharImg.js:getProfileImgPool / getProfileImgFiles / getProfileImgByIndex()` —— 候选池与按序号选图；
 *   - `models/avatar/ProfileAvatar.js:getCostumeSplash()` —— 取图顺序：**序号 → 彩蛋层 → 普通层（层内随机）→ miao 自带立绘**。
 *
 * 三条与 miao 一致的约定：
 *   1. 图库层目录 `{源}/{super-character|normal-character}/{角色}/`，第三方图库还可以平铺 `{源}/{角色}/`；
 *      角色名后既可以是目录，也可以是 `{角色}.webp|png|jpg|jpeg` 单文件；
 *   2. 文件名形如 `{角色}_{序号}_{原作者}_{来源}[_{备注}].{ext}`，`面板图N` 就是匹配这里的 `_{序号}_`；
 *   3. **只读、不复制**：图库可能在别的盘，模板按 miao 的做法直接引用（bot 内用 5 级相对前缀，bot 外走 `file://`）。
 *
 * 本插件**不写 miao 的配置**：要加图库由用户在 miao 侧配（`config/profile.js` 的 `profileImgSrc`），
 * 或经 ProfileImg-Plugin 登记（它会写入同一个 `profileImgSrc`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { botRoot } from '../dir.js';
/** 页面引用 bot 内资源的相对前缀（与模板里 `{{_res_path}}` 同深：`<bot>/plugins/...`） */
const PAGE_PREFIX = '../../../../..';
/** miao 认的后缀（`CharImg.js:14-15`） */
const IMG_EXT = ['webp', 'png', 'jpg', 'jpeg'];
const IMG_RE = /\.(png|webp|jpe?g)$/i;
/** miao 插件根（图库默认源与配置都在它下面） */
function miaoRoot() {
    return path.join(botRoot, 'plugins', 'miao-plugin');
}
/** miao 的 resources —— 相对图库源以它为基准（'profile' → `resources/profile`） */
function miaoResources() {
    return path.join(miaoRoot(), 'resources');
}
/** 从配置文件文本里提取 `profileImgSrc`（纯函数，便于离线单测） */
export function parseProfileImgSrc(text) {
    const m = String(text || '').match(/profileImgSrc\s*=\s*\[([\s\S]*?)\]/);
    if (!m)
        return [];
    return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]).filter(Boolean);
}
/** 读某个配置文件里的 `profileImgSrc`（文本提取；文件不在 / 格式变了 → 空数组） */
function readSrcFile(file) {
    try {
        return fs.existsSync(file) ? parseProfileImgSrc(fs.readFileSync(file, 'utf8')) : [];
    }
    catch {
        return [];
    }
}
/**
 * 图库源列表（绝对路径）—— 照抄 miao `CharImg.getProfileImgSrc()`
 *
 * 顺序：`config/profile.js`（用户自己那份）→ `config/system/profile_system.js`（系统默认）→ `['profile']`；
 * **第一个解析出非空列表的生效**（不是把几份配置合并）。相对路径以 miao 的 `resources` 为基准，
 * 绝对路径原样使用（跨盘图库就靠这个）。
 */
export function profileImgSources() {
    const candidates = [
        readSrcFile(path.join(miaoRoot(), 'config', 'profile.js')),
        readSrcFile(path.join(miaoRoot(), 'config', 'system', 'profile_system.js')),
        ['profile']
    ];
    for (const raw of candidates) {
        const list = (Array.isArray(raw) ? raw : [raw])
            .map(s => (typeof s === 'string' ? s.trim() : ''))
            .filter(Boolean)
            .map(s => (path.isAbsolute(s) ? s : path.join(miaoResources(), s)));
        if (list.length)
            return list;
    }
    return [path.join(miaoResources(), 'profile')];
}
/**
 * 某个图库层目录下该角色的图 —— 照抄 miao `CharImg.getProfileImgFiles()`
 *
 * 先单文件（`{base}/{角色}.{webp,png,jpg,jpeg}`），再目录形式（`{base}/{角色}/` 下所有图片）。
 * 源不存在 / 无权限 / 读取失败一律跳过该源，不影响其它源（miao 同）。
 */
export function profileImgFiles(base, name) {
    const out = [];
    const charName = String(name || '').trim();
    if (!charName)
        return out;
    for (const ext of IMG_EXT) {
        const file = path.join(base, `${charName}.${ext}`);
        try {
            if (fs.existsSync(file))
                out.push(file);
        }
        catch { /* 跳过该扩展名 */ }
    }
    const dir = path.join(base, charName);
    try {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            for (const f of fs.readdirSync(dir))
                if (IMG_RE.test(f))
                    out.push(path.join(dir, f));
        }
    }
    catch { /* 跳过该源 */ }
    return out;
}
/**
 * 候选池 —— 照抄 miao `CharImg.getProfileImgPool()`
 *
 * 彩蛋层（`super-character`）**不含平铺层**；普通层 = `normal-character` + 平铺 `{源}/{角色}`。
 * 所有源的同一层**合并**（不是取第一个命中的源），与 miao 的"同层级合并后随机"一致。
 */
export function profileImgPool(name, isSuper = false, sources = profileImgSources()) {
    const charName = String(name || '').trim();
    if (!charName)
        return [];
    const tier = isSuper ? 'super-character' : 'normal-character';
    let files = [];
    for (const src of sources) {
        files = files.concat(profileImgFiles(path.join(src, tier), charName));
        if (!isSuper)
            files = files.concat(profileImgFiles(src, charName));
    }
    return files;
}
/**
 * 按序号选图 —— 照抄 miao `CharImg.getProfileImgByIndex()`
 *
 * 序号来自文件名 `{角色}_{序号}_...`（ProfileImg 的命名称谓）；彩蛋层优先于普通层；找不到返回空串。
 */
export function profileImgByIndex(name, isSuper, index, sources = profileImgSources()) {
    const want = Number(index) || 0;
    if (want <= 0)
        return '';
    const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seqRe = new RegExp(`^${esc}_(\\d+)(?:_|\\.)`, 'i');
    for (const tier of (isSuper ? ['super', 'normal'] : ['normal'])) {
        for (const img of profileImgPool(name, tier === 'super', sources)) {
            const m = decodeURIComponent(path.basename(img)).match(seqRe);
            if (m && parseInt(m[1], 10) === want)
                return img;
        }
    }
    return '';
}
/**
 * 选图 —— 照抄 miao `ProfileAvatar.getCostumeSplash()` 的取图段
 *
 * `面板图N` 给了序号就按序号选（选不到继续往下走，miao 也是这个行为）；
 * 否则按层取候选池并**层内随机**（`lodash.sample` 的等价物）；池空返回空串（交给 miao 自带立绘兜底）。
 */
export function pickProfileImg(name, opts = {}) {
    const isSuper = opts.isSuper === true;
    const sources = opts.sources || profileImgSources();
    if ((Number(opts.index) || 0) > 0) {
        const hit = profileImgByIndex(name, isSuper, Number(opts.index), sources);
        if (hit)
            return hit;
    }
    for (const tier of (isSuper ? ['super', 'normal'] : ['normal'])) {
        const pool = profileImgPool(name, tier === 'super', sources);
        if (pool.length)
            return pool[Math.floor(Math.random() * pool.length)];
    }
    return '';
}
/**
 * miao 自带立绘兜底 —— 照抄 miao `getCostumeSplash()` 的 `defImgs`
 *
 * 彩蛋立绘先看 `splash0.webp`（miao 对 super 角色 `unshift` 的那张），再看 `splash.webp`。
 * 本插件不处理换装（`splash2.webp`），命中不到就返回空串（页面不画立绘）。
 */
export function miaoSplashFile(name, isSuper = false) {
    const charName = String(name || '').trim();
    if (!charName)
        return '';
    const base = path.join(miaoResources(), 'meta-gs', 'character', charName, 'imgs');
    for (const f of (isSuper ? ['splash0.webp', 'splash.webp'] : ['splash.webp'])) {
        const abs = path.join(base, f);
        try {
            if (fs.existsSync(abs))
                return abs;
        }
        catch { /* 换下一张 */ }
    }
    return '';
}
/**
 * 绝对路径 → 页面可引用的地址 —— 照抄 miao `CharImg.getProfileImgRes()` 的做法
 *
 * bot 目录内返回 5 级相对前缀（`../../../../../plugins/...`，与页面里已有的 miao 资源引用同深）；
 * 跨盘 / 网络盘返回 `file://` 绝对地址（miao 同）。文件名按 miao 的做法做 URI 编码。
 */
export function pageImageUrl(file, root = botRoot) {
    const abs = path.resolve(file);
    const dir = path.dirname(abs);
    const rel = path.relative(path.resolve(root), abs).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return `${PAGE_PREFIX}/${path.dirname(rel).replace(/\\/g, '/')}/${encodeURIComponent(path.basename(abs))}`;
    }
    return pathToFileURL(path.join(dir, path.basename(abs))).href;
}
/**
 * 面板图（立绘）取图 —— miao 同款顺序
 *
 * `图库（面板图N / 层内随机）` → `miao 自带立绘（splash0 / splash）` → 空串（页面不画）。
 * 任何异常都只降级（返回空串 + 原因），绝不抛到消息层。
 */
export function heroImageOf(charName, opts = {}) {
    const name = String(charName || '').trim();
    if (!name)
        return { rel: '', source: '', note: '未给出角色名' };
    try {
        const picked = pickProfileImg(name, opts);
        if (picked)
            return { rel: pageImageUrl(picked), source: '图库', note: '' };
        const splash = miaoSplashFile(name, opts.isSuper === true);
        if (splash)
            return { rel: pageImageUrl(splash), source: 'miao', note: '' };
    }
    catch (err) {
        return { rel: '', source: '', note: `立绘取图失败：${err?.message || err}` };
    }
    return { rel: '', source: '', note: '图库与 miao 默认立绘都没有该角色的图' };
}
//# sourceMappingURL=ProfileImgRes.js.map