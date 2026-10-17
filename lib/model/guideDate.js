/**
 * 攻略数据的「最后更新时间」
 *
 * 2026-10-17 用户定：这个时间必须是**攻略数据本身**的时间，不能受 UI、图片样式、文件系统时间影响。
 *
 * 为什么不用 mtime：`git pull` / 重新克隆 / 编辑器整目录重写都会把 mtime 刷成"今天"，
 * 于是页面上的日期看着像"刚更新过"，而数据其实几个月没动（实测本机 `data/gi/*.json` 的 mtime
 * 全都是仓库检出日 2026-10-04，与各角色数据的真实修改日无关）。
 *
 * 现在的口径：**该数据文件在 git 里的最后一次提交日期**（`git log -1 --date=format:%Y.%m.%d -- <file>`）。
 * 它只随"数据文件内容被提交"而变，改模板/图片/样式都不会动它。
 *
 * 降级：不在 git 仓库里（或机器没装 git / 命令超时）→ 返回空串，页面写「未提供」，绝不猜一个日期。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
/** 结果缓存：键 = `文件:mtime:size`，值 = `YYYY.MM.DD` 或 '' */
const cache = new Map();
/** 校验 git 输出的日期格式；不合法返回空串 */
function normalizeDate(raw) {
    const text = String(raw || '').trim();
    return /^\d{4}\.\d{2}\.\d{2}$/.test(text) ? text : '';
}
/**
 * 取某个指南数据文件的「最后提交日期」
 *
 * @param dataDir 数据目录（`<插件>/data/gi`）
 * @param name 角色名（文件名去掉 `.json`）
 * @returns `YYYY.MM.DD`；不在 git 里 / 取不到返回 ''
 */
export function guideUpdatedDate(dataDir, name) {
    const key = String(name || '').trim();
    if (!key)
        return '';
    const file = path.join(dataDir, `${key}.json`);
    /* 缓存键带上 mtime/size：文件一变就重算（未提交的改动也仍显示上次提交日期，这是有意为之） */
    let stamp = 'missing';
    try {
        const st = fs.statSync(file);
        stamp = `${st.mtimeMs}:${st.size}`;
    }
    catch {
        return '';
    }
    const hit = cache.get(`${file}:${stamp}`);
    if (hit !== undefined)
        return hit;
    let date = '';
    try {
        const repoRoot = path.resolve(dataDir, '..', '..'); // data/gi → 插件根
        const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
        const out = execFileSync('git', [
            '-C', repoRoot,
            'log', '-1',
            '--format=%cd',
            '--date=format:%Y.%m.%d',
            '--', rel
        ], { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        date = normalizeDate(out);
    }
    catch {
        date = '';
    }
    cache.set(`${file}:${stamp}`, date);
    return date;
}
//# sourceMappingURL=guideDate.js.map