/**
 * 攻略命令（**抢占式接管**，设计文档 §5）
 *
 * 接管范围（与 `isCodexCommand()` 一致）：
 *   1. 后缀式 `#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`（原属 `plugins/genshin`「米游社攻略」与 Atlas 快捷入口）
 *   2. 前缀式 `#攻略 <角色> [模块|档位]`
 *   3. 反查式 `#攻略 武器 <武器名>` / `#攻略 配队 <角色…>`（v1 只做这两个）
 *   4. `#攻略列表` / `#攻略状态`
 *
 * 优先级 `PREEMPT_PRIORITY`（-100000，写死不可配置）：早于 Atlas 快捷入口（-99999）与
 * genshin「米游社攻略」（50）。`accept()` 认领同一批消息以 break 框架的 accept 循环
 * （否则 miao 的 accept 可能 `return` 掉整条消息）；`accept` 内**只做纯正则判定**。
 *
 * 处理函数返回 `true` = 已处理（框架随后结束全部规则匹配），返回 `false` = 放行。
 *
 * ⚠ 本文件只导出插件类（`src/index.ts` 的加载器取「模块首个导出」）。
 */
import { CODEX_META_RULE, CODEX_SUFFIX_RULE, COPYRIGHT, PREEMPT_PRIORITY, isCodexCommand } from '../components/constants.js';
import { getRenderScale } from '../components/config.js';
import { renderPage } from '../components/render.js';
import { atlasRes } from '../model/AtlasRes.js';
import { codexStore } from '../model/CodexStore.js';
import { miaoRes } from '../model/MiaoRes.js';
import { pickPagePortrait } from '../model/ProfileImgRes.js';
import { filterView, isViewEmpty, parseSuffixQuery } from '../modules/branches.js';
import { moduleOff } from '../modules/moduleGate.js';
import { buildCodexView, toPageData, viewToText, withIcons } from '../modules/subViews.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
/**
 * 角色名解析：数据标准名（含去空白 / 唯一包含匹配）→ miao 别名
 *
 * miao 缺失时只用数据侧（不报错）。
 */
export function resolveCharacter(keyword) {
    const raw = String(keyword ?? '').trim();
    if (!raw)
        return null;
    const byData = codexStore.findCharacter(raw);
    if (byData)
        return byData;
    try {
        return miaoRes.resolveName('character', raw);
    }
    catch {
        return null;
    }
}
export class MetaCodex extends plugin {
    constructor() {
        super({
            name: 'Meta攻略',
            dsc: '#〈角色〉攻略 · #攻略列表 / #攻略状态',
            event: 'message',
            // 抢占优先级：早于 Atlas 快捷入口(-99999) 与 genshin「米游社攻略」(50)；写死不可配置
            priority: PREEMPT_PRIORITY,
            rule: [
                { reg: CODEX_SUFFIX_RULE, fnc: 'handleSuffix', permission: 'all' },
                { reg: CODEX_META_RULE, fnc: 'handleMeta', permission: 'all' },
            ]
        });
    }
    /** 抢占：认领攻略类消息（纯正则，无 I/O） */
    async accept(e) {
        // 模块关闭时不认领：放行给 genshin「米游社攻略」/ Atlas 的原有入口（见 modules/moduleGate.ts）
        if (moduleOff('codex'))
            return false;
        return isCodexCommand(e.msg);
    }
    /** `#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南` */
    async handleSuffix(e) {
        // 框架的 accept 不跳过自己的 rule 匹配，所以 handler 也要放行（返回 false = 继续匹配后续规则）
        if (moduleOff('codex'))
            return false;
        const query = parseSuffixQuery(e.msg);
        if (!query)
            return false;
        return await this.replyCharacter(e, query.character, { setIndex: query.setIndex });
    }
    /** `#攻略列表` / `#攻略状态` */
    async handleMeta(e) {
        if (moduleOff('codex'))
            return false;
        const hit = String(e.msg ?? '').match(CODEX_META_RULE);
        if (!hit)
            return false;
        return hit[1] === '列表' ? await this.replyList(e) : await this.replyStatus(e);
    }
    /** `#攻略 …`（角色分支 / 反查 / 列表 / 状态） */
    // ---------------- 具体回复 ----------------
    /** 角色攻略页（可带模块 / 档位收窄） */
    async replyCharacter(e, keyword, opts) {
        const name = resolveCharacter(keyword);
        if (!name) {
            await e.reply(`[Meta] 没有「${keyword}」的攻略数据`);
            return true;
        }
        const guide = codexStore.getGuide(name);
        if (!guide || !codexStore.isFilled(guide)) {
            await e.reply(`[Meta] ${name} 的攻略待补充`);
            return true;
        }
        let view = buildCodexView(guide, {
            signature: codexStore.getSignature(name),
            weaponTags: codexStore.getWeaponTags()
        });
        if (!view) {
            await e.reply(`[Meta] ${name} 的攻略数据读取失败`);
            return true;
        }
        view = withIcons(view, { character: name });
        if (opts.module || opts.tier) {
            view = filterView(view, { module: opts.module, tier: opts.tier });
            if (isViewEmpty(view)) {
                const what = opts.tier || opts.module || '';
                await e.reply(`[Meta] ${name} 没有「${what}」的内容`);
                return true;
            }
        }
        const notes = [];
        if (opts.setIndex && opts.setIndex > 1)
            notes.push('仅收录一套攻略');
        if (opts.tier)
            notes.push(`仅显示「${opts.tier}」档`);
        return await this.replyPage(e, view, notes);
    }
    /** 出攻略图；失败回落同源文本 */
    async replyPage(e, view, notes) {
        try {
            /*
             * 立绘：**图库优先、但只接受不小于默认立绘的图**（2026-10-17 用户定）。
             * `ratio` 是默认立绘的宽高比，模板拿它给立绘框定高、再用 `object-fit: cover` 把图裁满，
             * 所以图库大图（常见 1920×1080）能用，版面高度与用 miao 立绘时一致。
             * 攻略页与账号无关，只走普通层（不碰 `super-character` 彩蛋层）。
             */
            const hero = pickPagePortrait(view.name);
            const sent = await renderPage(e, 'codex', toPageData(view, {
                copyright: COPYRIGHT,
                renderScale: getRenderScale(),
                portraitSrc: hero.src,
                portraitRatio: hero.ratio,
                // 元素决定 miao 布局套哪张底图（`elem-pyro` 等）；取不到就交给布局默认
                element: miaoRes.characterElement(view.name) ?? '',
                subTitle: notes.length ? notes.join(' · ') : '角色攻略'
            }));
            // 框架的 runtime.render 默认自己把图发出去并返回 true（retType=default）
            if (sent)
                return true;
            throw new Error('渲染结果为空');
        }
        catch (err) {
            logger?.error?.(`[Meta] 攻略图渲染失败：${err?.message ?? err}`);
        }
        await e.reply(viewToText(view));
        return true;
    }
    /** `#攻略 武器 <武器名>` —— 谁推荐了这把武器 */
    /** `#攻略 配队 <角色…>` —— 同时含这些角色的配队 */
    /** `#攻略列表` */
    async replyList(e) {
        const stats = codexStore.stats();
        const names = codexStore.listCharacters();
        const lines = [];
        for (let i = 0; i < names.length; i += 8)
            lines.push(names.slice(i, i + 8).join('、'));
        await e.reply([
            `【Meta 攻略收录】${stats.filled}/${stats.total} 名角色${stats.empty.length ? `（空档：${stats.empty.join('、')}）` : ''}`,
            ...lines,
            '',
            '写法：#〈角色〉攻略（如 #胡桃攻略）'
        ].join('\n'));
        return true;
    }
    /** `#攻略状态` */
    async replyStatus(e) {
        const stats = codexStore.stats();
        const miao = miaoRes.status();
        const atlas = atlasRes.status();
        let miaoLine = `miao：${miao.ok ? '✔' : '✖'} ${miao.root}`;
        if (miao.ok) {
            const c = miaoRes.counts();
            miaoLine += `（立绘 ${c.character} / 武器 ${c.weapon} / 圣遗物 ${c.artifact}）`;
        }
        else {
            miaoLine += `（缺：${miao.missing.join('、')}）`;
        }
        await e.reply([
            '【Meta 攻略状态】',
            `数据版本：${stats.generatedAt ?? '未知'}`,
            `收录：${stats.total} 条（有内容 ${stats.filled} / 空档 ${stats.empty.length}）`,
            miaoLine,
            `Atlas：${atlas.present ? '✔' : '✖'} ${atlas.note}`
        ].join('\n'));
        return true;
    }
    /** 纯文本回复 */
    async replyText(e, text) {
        await e.reply(text);
        return true;
    }
}
//# sourceMappingURL=codex.js.map