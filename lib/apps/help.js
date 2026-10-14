/**
 * `#攻略帮助` —— 帮助页
 *
 * 接管的三个全局词：`#攻略` / `#攻略帮助` / `#攻略说明`（原属 `plugins/genshin`「米游社攻略」）。
 *
 * `accept()` 与本 app 的 `rule` 覆盖**完全同一批消息**：只认领自己会处理的那三个词，其余一律放行，
 * 这样无论框架是"认领后只跑该插件的规则"还是"认领后继续按优先级跑所有规则"，行为都一致，
 * 也保证 Atlas 的图鉴类抢占逐字不变（设计文档 §5.1 / §5.3）。
 *
 * 渲染失败时**回落同源文本**（内容与出图取自同一份数据，不会出现"图挂了就没内容"）。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resourcesDir } from '../dir.js';
import { render } from '../components/render.js';
import { COPYRIGHT, DPS_RULES, HELP_RULE, META_HELP_RULE, PREEMPT_PRIORITY, isHelpCommand, isMetaHelpCommand } from '../components/constants.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
const TITLE = '#攻略帮助';
/**
 * 读帮助配置：动态 import（带时间戳绕过 ESM 缓存）—— 改 `resources/help/help-cfg.js` 无需重启 bot
 * 用 `pathToFileURL` 而不是拼 `file://`，避免路径含中文/空格时出错
 */
async function loadHelpView(page = 'meta') {
    const fallback = { helpCfg: { title: TITLE, subTitle: '' }, helpGroup: [] };
    try {
        const file = path.join(resourcesDir, 'help', 'help-cfg.js');
        const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
        // 两小一大：meta = 总帮助，guide / dps = 分功能；取不到就回落总帮助
        const picked = mod.helpPages?.[page] || { cfg: mod.helpCfg, list: mod.helpList };
        return {
            helpCfg: picked.cfg || fallback.helpCfg,
            helpGroup: (picked.list || []).map(group => ({
                group: group.group,
                list: (group.list || []).map(item => ({ title: item.title, desc: item.desc }))
            }))
        };
    }
    catch (err) {
        logger?.error?.(`[Meta] 读取帮助配置失败：${err?.message || err}`);
        return fallback;
    }
}
/** 按消息判断要出哪一页 */
function helpPageOf(msg) {
    if (isMetaHelpCommand(msg))
        return 'meta';
    if (DPS_RULES.help.test(String(msg ?? '')))
        return 'dps';
    return 'guide';
}
/** 文本回退：按分组列「命令 — 一行说明」 */
function textOf(view) {
    const lines = [view.helpCfg?.title || TITLE];
    if (view.helpCfg?.subTitle)
        lines.push(view.helpCfg.subTitle);
    for (const group of view.helpGroup) {
        lines.push('', `【${group.group}】`);
        for (const item of group.list) {
            lines.push(`· ${item.title}${item.desc ? ` — ${item.desc}` : ''}`);
        }
    }
    if (view.helpCfg?.note)
        lines.push('', view.helpCfg.note);
    return lines.join('\n');
}
export class MetaHelp extends plugin {
    constructor() {
        super({
            name: 'Meta攻略帮助',
            dsc: '#meta（总帮助）/ #攻略帮助（攻略+练度）/ #DPS帮助（伤害+榜单）',
            event: 'message',
            // 抢占优先级：早于 Atlas 快捷入口(-99999) 与 genshin「米游社攻略」(50)；写死不可配置
            priority: PREEMPT_PRIORITY,
            rule: [
                { reg: HELP_RULE, fnc: 'handleHelp', permission: 'all' },
                { reg: META_HELP_RULE, fnc: 'handleHelp', permission: 'all' },
                // 阶段 5 合并：原 Mhydps 的 `#DPS帮助` 并入同一份帮助页（不再有两套帮助图）
                { reg: DPS_RULES.help, fnc: 'handleHelp', permission: 'all' }
            ]
        });
    }
    /** 抢占：只认领三个全局词（纯正则，无 I/O） */
    async accept(e) {
        return isHelpCommand(e.msg) || isMetaHelpCommand(e.msg);
    }
    /** `#攻略帮助` / `#攻略` / `#攻略说明` —— 出帮助图，失败回落文本 */
    async handleHelp(e) {
        const view = await loadHelpView(helpPageOf(String(e.msg ?? '')));
        try {
            const img = await render('help', {
                helpCfg: view.helpCfg,
                helpGroup: view.helpGroup,
                copyright: COPYRIGHT
            });
            if (img) {
                await e.reply(img);
                return true;
            }
            throw new Error('渲染结果为空');
        }
        catch (err) {
            logger?.error?.(`[Meta] 帮助图渲染失败：${err?.message || err}`);
        }
        await e.reply(textOf(view));
        return true;
    }
}
//# sourceMappingURL=help.js.map