/**
 * `respond` — 统一的「出图，失败回退文本」回复（合并自 `Mhydps-Plugin/modules/respond.js`）
 *
 * 出图链路（框架 puppeteer 后端）在没装浏览器、渲染超时等情况下会失败；
 * 把 try/catch 与回退收敛到一处，apps 层只管准备数据。
 *
 * 与攻略页的回退是同一套语义（`apps/codex.ts` 里 `renderPage` 返回 false 就发文本），
 * 这里保持 Mhydps 的**返回值约定**：恒为 `true`（消息已被消费），便于 app 直接 `return await respond(...)`。
 */
import { renderDps } from '../components/render.js';
/**
 * 渲染并回复；渲染失败时发文本
 *
 * @param e 消息事件
 * @param tpl 模板名（`resources/dps/<tpl>.html`）
 * @param data 模板数据
 * @param fallback 文本回退内容
 * @returns 恒为 `true`（已消费消息）
 */
export async function respond(e, tpl, data = {}, fallback = '') {
    try {
        const img = await renderDps(tpl, data);
        if (img) {
            await e.reply(img);
            return true;
        }
        logger?.warn?.(`[Meta] 模板 ${tpl} 渲染结果为空，改用文本回退`);
    }
    catch (err) {
        logger?.error?.(`[Meta] 模板 ${tpl} 渲染失败：${err?.message || String(err)}`);
    }
    await e.reply(typeof fallback === 'function' ? fallback() : String(fallback ?? ''));
    return true;
}
/**
 * 候选提示行（角色 / 首领没找到时给出相近项）
 *
 * @param suggestions 相近项
 * @returns 形如 `\n你是不是想找：胡桃、行秋`；没有候选时返回空串
 */
export function suggestLine(suggestions) {
    if (!Array.isArray(suggestions) || !suggestions.length)
        return '';
    return `\n你是不是想找：${suggestions.join('、')}`;
}
//# sourceMappingURL=respond.js.map