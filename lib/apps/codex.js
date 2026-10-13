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
import { CODEX_ARG_RULE, CODEX_GUIDE_RULE, CODEX_META_RULE, CODEX_SUFFIX_RULE, COPYRIGHT, PREEMPT_PRIORITY, isCodexCommand } from '../components/constants.js';
import { getRenderScale } from '../components/config.js';
import { renderPage } from '../components/render.js';
import { atlasRes } from '../model/AtlasRes.js';
import { codexStore } from '../model/CodexStore.js';
import { miaoRes } from '../model/MiaoRes.js';
import { filterView, isViewEmpty, parseArgQuery, parseSuffixQuery } from '../modules/branches.js';
import { findTeamContainers, findWeaponRecommenders } from '../modules/reverse.js';
import { buildCodexView, portraitOf, toPageData, viewToText, withIcons } from '../modules/subViews.js';
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
            dsc: '#〈角色〉攻略 · #攻略 <角色> [模块] · #攻略列表 / #攻略状态',
            event: 'message',
            // 抢占优先级：早于 Atlas 快捷入口(-99999) 与 genshin「米游社攻略」(50)；写死不可配置
            priority: PREEMPT_PRIORITY,
            rule: [
                { reg: CODEX_SUFFIX_RULE, fnc: 'handleSuffix', permission: 'all' },
                { reg: CODEX_GUIDE_RULE, fnc: 'handleSuffix', permission: 'all' },
                { reg: CODEX_META_RULE, fnc: 'handleMeta', permission: 'all' },
                { reg: CODEX_ARG_RULE, fnc: 'handleArg', permission: 'all' }
            ]
        });
    }
    /** 抢占：认领攻略类消息（纯正则，无 I/O） */
    async accept(e) {
        return isCodexCommand(e.msg);
    }
    /** `#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南` */
    async handleSuffix(e) {
        const query = parseSuffixQuery(e.msg);
        if (!query)
            return false;
        return await this.replyCharacter(e, query.character, { setIndex: query.setIndex });
    }
    /** `#攻略列表` / `#攻略状态` */
    async handleMeta(e) {
        const hit = String(e.msg ?? '').match(CODEX_META_RULE);
        if (!hit)
            return false;
        return hit[1] === '列表' ? await this.replyList(e) : await this.replyStatus(e);
    }
    /** `#攻略 …`（角色分支 / 反查 / 列表 / 状态） */
    async handleArg(e) {
        const query = parseArgQuery(e.msg, resolveCharacter);
        switch (query.kind) {
            case 'character':
                return await this.replyCharacter(e, query.character ?? query.head, { module: query.module, tier: query.tier });
            case 'reverseWeapon':
                return await this.replyReverseWeapon(e, query.weapon ?? '');
            case 'reverseTeam':
                return await this.replyReverseTeam(e, query.members ?? [], query.unresolved ?? []);
            case 'list':
                return await this.replyList(e);
            case 'status':
                return await this.replyStatus(e);
            default:
                return await this.replyText(e, [
                    `没有「${query.head}」的攻略数据`,
                    '写法：#〈角色〉攻略 / #攻略 〈角色〉 [武器|圣遗物|天赋|面板|命座|配队]',
                    '反查：#攻略 武器 〈武器名〉 / #攻略 配队 〈角色…〉'
                ].join('\n'));
        }
    }
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
            const sent = await renderPage(e, 'codex/codex', toPageData(view, {
                copyright: COPYRIGHT,
                renderScale: getRenderScale(),
                portrait: portraitOf(view.name) ?? '',
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
    async replyReverseWeapon(e, keyword) {
        const raw = String(keyword ?? '').trim();
        if (!raw) {
            await e.reply('用法：#攻略 武器 〈武器名〉');
            return true;
        }
        let weapon = raw;
        try {
            weapon = miaoRes.resolveName('weapon', raw) ?? raw;
        }
        catch { /* miao 缺失时按原词查 */ }
        const hits = findWeaponRecommenders(codexStore, weapon);
        if (!hits.length) {
            await e.reply(`[Meta] 没有查到推荐「${weapon}」的角色`);
            return true;
        }
        const lines = hits.map(hit => `· ${hit.character}${hit.tier ? `（${hit.tier}）` : ''}`);
        await e.reply([`【谁推荐了「${weapon}」】共 ${hits.length} 条`, ...lines].join('\n'));
        return true;
    }
    /** `#攻略 配队 <角色…>` —— 同时含这些角色的配队 */
    async replyReverseTeam(e, members, unresolved) {
        if (!members.length) {
            await e.reply('用法：#攻略 配队 〈角色1〉〈角色2〉…');
            return true;
        }
        const hits = findTeamContainers(codexStore, members);
        const head = `【含「${members.join(' + ')}」的配队】共 ${hits.length} 条`;
        const warn = unresolved.length ? `\n（未识别：${unresolved.join('、')}）` : '';
        if (!hits.length) {
            await e.reply(`[Meta] 没有查到同时含这些角色的配队${warn}`);
            return true;
        }
        const lines = hits.slice(0, 20).map(hit => `· ${hit.character}${hit.tag ? `（${hit.tag}）` : ''}：${hit.members.join(' + ')}`);
        const more = hits.length > 20 ? `\n…还有 ${hits.length - 20} 条` : '';
        await e.reply([head + warn, ...lines].join('\n') + more);
        return true;
    }
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
            '写法：#〈角色〉攻略 或 #攻略 〈角色〉 [模块]'
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