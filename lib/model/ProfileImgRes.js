/**
 * ProfileImgRes — 角色立绘（图库插件 **ProfileImg-Plugin** 兼容）
 *
 * 取图顺序（用户 2026-10-15 定）：**ProfileImg 图库源 → miao 默认图库 → 不显示**（全程降级不报错）。
 *
 * 为什么是"兼容接口"而不是 import 它：ProfileImg-Plugin **没有库级 API**（只导出框架 plugin class，
 * 见其 `docs/架构.md`）。它对外的稳定约定就是**目录 + 配置**：
 *   - 源列表在 miao 的 `config/profile.js`：`profileImgSrc = ['profile', <仓库绝对路径>, …]`
 *     （`'profile'` = miao 自带默认图库 `resources/profile`）
 *   - 每个源下按 `normal-character/{角色}/`、`super-character/{角色}/`、平铺 `{角色}/` 存放
 *   - 文件是图片本体，只认 `webp/png/jpg/jpeg`；`.bak` 视为屏蔽（miao 同样不认）
 *
 * 命中后**复制**进 `out/profileimg/`（未跟踪缓存；模板用 `{{_data_path}}/profileimg/…` 引用，
 * 与榜单头像同一套做法）。复制失败 / 找不到图都只返回失败，不影响页面其它内容。
 */
import fs from 'node:fs';
import path from 'node:path';
import { botRoot, outDir } from '../dir.js';
/** 立绘缓存子目录（`out/profileimg/`） */
export const PROFILEIMG_DIR = 'profileimg';
const IMG_EXTS = ['.webp', '.png', '.jpg', '.jpeg'];
/** miao 插件根（图库与配置都在它下面；缺失 = 没装 miao，由调用方另行处理） */
function miaoRoot() {
    return path.join(botRoot, 'plugins', 'miao-plugin');
}
/** ProfileImg 图库根（`plugins/ProfileImg-Plugin/resources/gallery/ProfileImg`） */
function galleryRoot() {
    return path.join(botRoot, 'plugins', 'ProfileImg-Plugin', 'resources', 'gallery', 'ProfileImg');
}
/** 从 `config/profile.js` 的文本里提取 `profileImgSrc`（纯函数，便于离线单测） */
export function parseProfileImgSrc(text) {
    const m = String(text || '').match(/profileImgSrc\s*=\s*\[([\s\S]*?)\]/);
    if (!m)
        return [];
    return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]).filter(Boolean);
}
/**
 * 读 miao `config/profile.js` 的 `profileImgSrc`
 *
 * 只做**文本提取**（不 import 用户的配置模块：它是可编辑 JS，import 会执行副作用）。
 * 读不到 / 写的是老格式 → 返回空数组（调用方退回默认图库）。
 */
export function readProfileImgSrc() {
    const file = path.join(miaoRoot(), 'config', 'profile.js');
    if (!fs.existsSync(file))
        return [];
    try {
        return parseProfileImgSrc(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return [];
    }
}
/** 源目录列表：ProfileImg 图库 → miao 默认图库（去重、保序、只留存在的） */
export function profileSources() {
    const out = [];
    const push = (dir) => {
        const abs = path.resolve(dir);
        if (fs.existsSync(abs) && !out.includes(abs))
            out.push(abs);
    };
    // ProfileImg 图库下的各仓库（含主仓库与第三方）——按目录名排序，保证同一角色取图稳定
    const gallery = galleryRoot();
    if (fs.existsSync(gallery)) {
        for (const name of fs.readdirSync(gallery).sort())
            push(path.join(gallery, name));
    }
    // miao 配置里登记过的源（'profile' = miao 默认图库）
    for (const entry of readProfileImgSrc()) {
        if (entry === 'profile')
            push(path.join(miaoRoot(), 'resources', 'profile'));
        else if (path.isAbsolute(entry))
            push(entry);
        else
            push(path.join(miaoRoot(), 'resources', entry));
    }
    // 最后兜底：miao 默认图库（配置没登记时也要能取到图）
    push(path.join(miaoRoot(), 'resources', 'profile'));
    return out;
}
/** 在某个源里找该角色的图片（按三种布局；同布局内排序取第一张，保证可复现） */
export function findPortrait(charName, source) {
    const name = String(charName || '').trim();
    if (!name)
        return '';
    const dirs = ['normal-character', 'super-character', ''].map(d => (d ? path.join(source, d, name) : path.join(source, name)));
    for (const dir of dirs) {
        if (!fs.existsSync(dir))
            continue;
        let entries = [];
        try {
            entries = fs.readdirSync(dir).sort();
        }
        catch {
            continue;
        }
        const hit = entries.find(f => IMG_EXTS.includes(path.extname(f).toLowerCase()));
        if (hit)
            return path.join(dir, hit);
    }
    return '';
}
/**
 * 取角色立绘并复制进 `out/profileimg/`
 *
 * @returns `{ ok, rel, source, note }`；`rel` 供模板拼 `{{_data_path}}/<rel>`（空串 = 不显示）
 */
export function portraitOf(charName, opts = {}) {
    const name = String(charName || '').trim();
    if (!name)
        return { ok: false, rel: '', source: '', note: '未给出角色名' };
    for (const source of profileSources()) {
        const file = findPortrait(name, source);
        if (!file)
            continue;
        const ext = path.extname(file).toLowerCase();
        const destDir = path.join(outDir, PROFILEIMG_DIR);
        const dest = path.join(destDir, `${name}${ext}`);
        try {
            fs.mkdirSync(destDir, { recursive: true });
            if (opts.force || !fs.existsSync(dest))
                fs.copyFileSync(file, dest);
            return { ok: true, rel: `${PROFILEIMG_DIR}/${name}${ext}`, source: source.split(/[\\/]/).pop() || source, note: '' };
        }
        catch (err) {
            return { ok: false, rel: '', source: '', note: `立绘复制失败：${err?.message || err}` };
        }
    }
    return { ok: false, rel: '', source: '', note: '图库里没有该角色的立绘（ProfileImg / miao 默认图库都没找到）' };
}
//# sourceMappingURL=ProfileImgRes.js.map