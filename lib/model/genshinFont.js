/**
 * 原神字体（汉仪文黑）解析
 *
 * 2026-10-17 用户定：标题区「角色攻略」用**原神字体**（汉仪文黑-65W，就是 miao / 面板图用的那套）。
 *
 * 为什么不直接抄 miao 的 `@font-face`：攻略页只引了 miao 的 `tpl.css`，而 `YS` 这个字体名只在
 * miao 的 `common.css` 里声明，且我们用 `{{_miao_path}}` 拼出来的 URL **带空格未编码** →
 * 浏览器报 `ERR_FILE_NOT_FOUND`，字体静默回落系统字体（实测 `document.fonts.check('20px YS')` = false）。
 * 所以这里由 Node 端解析出**真实文件 + 编码后的 file:// URL**，用独立字体名 `CodexGenshin` 注入，
 * 既不依赖 miao 的 CSS，也不复制字体文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { botRoot, pluginRoot } from '../dir.js';
/** 注入页面的字体族名（独立命名，避免与 miao 的 `YS` 撞车） */
export const GENSHIN_FONT_FAMILY = 'CodexGenshin';
/**
 * 找原神字体文件：按优先级取第一个存在的
 *
 * ① miao 的 `common/font/HYWH-65W.woff`（本插件本来就依赖 miao，最稳）；
 * ② genshin 插件的 `HYWenHei-55W.ttf`；
 * ③ Atlas / Axiu 的 `hk4e_zh-cn.ttf`（游戏客户端字体）、`HYWH-65W.woff`。
 * 都找不到 → 返回 null，模板不注入 `@font-face`，回落系统字体。
 */
export function genshinFontFile() {
    const miao = [
        path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'common', 'font', 'HYWH-65W.woff'),
        path.join(pluginRoot, 'resources', 'common', 'font', 'HYWH-65W.woff')
    ];
    const others = [
        path.join(botRoot, 'plugins', 'genshin', 'resources', 'font', 'HYWenHei-55W.ttf'),
        path.join(botRoot, 'plugins', 'Atlas-Plugin', 'resources', 'common', 'font', 'hk4e_zh-cn.ttf'),
        path.join(botRoot, 'plugins', 'Axiu-Plugin', 'resources', 'common', 'font', 'HK4e_zh-cn.ttf'),
        path.join(botRoot, 'plugins', 'Atlas-Plugin', 'resources', 'common', 'font', 'HYWH-65W.woff'),
        path.join(botRoot, 'plugins', 'Axiu-Plugin', 'resources', 'common', 'font', 'HYWH-65W.woff')
    ];
    for (const file of [...miao, ...others]) {
        try {
            if (fs.statSync(file).isFile() && fs.statSync(file).size > 0) {
                return { family: GENSHIN_FONT_FAMILY, url: pathToFileURL(file).href, file };
            }
        }
        catch { /* 试下一个 */ }
    }
    return null;
}
//# sourceMappingURL=genshinFont.js.map