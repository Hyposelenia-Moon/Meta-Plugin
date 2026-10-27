/**
 * `#DPS榜` —— DPS 数据库配队榜单（合并自 `Mhydps-Plugin/apps/rank.js`）
 *
 * 例：`#DPS榜` / `#DPS榜 胡桃` / `#DPS榜 胡桃 12金` / `#DPS榜 胡桃 主C 绿玩 -p2`
 *
 * 优先级取自 `COMMANDS`（默认 8000 = `config.priority`）：高于 Atlas（10000）；
 * 只认领自己的命令，未命中的消息自然放行给其它插件（2026-10-15 起命令表统一在 `RULES`）。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPageSize, getPluginConfig, getProxy } from '../components/config.js';
import { COMMANDS, DPS_COPYRIGHT, RULES, SITE_NAME, formatTime } from '../components/constants.js';
import { parseRankArgs, takeVideoToken } from '../modules/queryArgs.js';
import { queryCharDps, queryCostTiers } from '../modules/charDpsQuery.js';
import { queryRank } from '../modules/rankQuery.js';
import { rankText } from '../modules/formatText.js';
import { respond, suggestLine } from '../modules/respond.js';
import { resolveCommandArgs } from '../modules/quoteGuard.js';
import { replyRankVideo } from '../modules/videoLookup.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
import { moduleGateReply } from '../modules/moduleGate.js';
/** 本 app 的命令元数据（名称 / 文案 / 权限 / 优先级偏移都取它，见 components/constants.ts） */
const META = COMMANDS.find(c => c.rules.includes('rank'));
const TITLE = '#DPS榜';
/** 金数筛选视图的硬上限（用户 2026-10-27 定：最多 10 条，配置调大也不超过） */
const FLAT_MAX_ROWS = 10;
/** 角色档位视图的文本回退（原 `apps/charDps.ts` 的 `charDpsText`，2026-10-15 随合并迁入） */
function charDpsText(result) {
    const lines = [`#${result.charName} · 各金档最高伤害队伍`, result.subtitle, ''];
    for (const tier of result.tiers) {
        lines.push(`【${tier.label}】共 ${tier.count} 条`);
        for (const row of tier.rows) {
            const team = row.chars.map(c => `${c.name}${c.constellation ? `C${c.constellation}` : ''}`).join(' + ');
            const tags = [...(row.tags || []), row.clean ? '绿玩' : '', row.lvl ? '满级' : ''].filter(Boolean).join('/');
            lines.push(`  ${row.rank}. ${team} — ${row.damageText || row.damage || '—'}｜限${row.limitcost}/常${row.normalcost}` + (tags ? `｜${tags}` : ''));
        }
    }
    if (!result.tiers.length)
        lines.push('没有查询到该角色的配队记录');
    return lines.join('\n');
}
/** 全库金档视图的文本回退（与角色页同构，2026-10-27） */
function costTiersText(result) {
    const lines = ['【全库 · 各金档最高伤害队伍】', result.subtitle, ''];
    for (const tier of result.tiers) {
        lines.push(`【${tier.label}】共 ${tier.count} 条`);
        for (const row of tier.rows) {
            const team = row.chars.map(c => `${c.name}${c.constellation ? `C${c.constellation}` : ''}`).join(' + ');
            const tags = [...(row.tags || []), row.clean ? '绿玩' : '', row.lvl ? '满级' : ''].filter(Boolean).join('/');
            lines.push(`  ${row.rank}. ${team} — ${row.damageText || row.damage || '—'}｜限${row.limitcost}/常${row.normalcost}` + (tags ? `｜${tags}` : ''));
        }
    }
    if (!result.tiers.length)
        lines.push('没有查询到配队记录');
    return lines.join('\n');
}
export class MetaRank extends plugin {
    constructor() {
        super({
            name: META.name,
            dsc: META.dsc,
            event: 'message',
            priority: getPluginConfig()?.priority
                ? Number(getPluginConfig().priority) + META.priorityOffset
                : 8000 + META.priorityOffset,
            rule: [
                { reg: RULES.rank, fnc: 'handleRank', permission: META.permission }
            ]
        });
    }
    /**
     * `#DPS榜` — 原神 DPS 数据库配队榜单
     */
    async handleRank(e) {
        if (await moduleGateReply('rank', e))
            return true;
        /*
         * 后缀式视频名次（用户 2026-10-15 定）：`#DPS榜 刻晴 48金视频1` —— 先摘掉 `视频N`，
         * 剩下的 `刻晴 48金` 照常交给榜单解析器；序号含义 = **在当前筛选（含金数）之内、按伤害排名**的第 N 名。
         */
        /*
         * 参数来源（2026-10-17 复审修复 #2/#3）：**先用用户自己打的文本**。
         *   - 旧写法 `looksLikeOurEcho(e.msg)` 会连引用内容一起判 → 合法的新命令被当成回灌、零回复；
         *   - 旧写法 `stripQuotedArgs` 会把与引用原文相同的重打参数整段剔掉 → 角色丢失、掉成总榜。
         */
        const resolved = await resolveCommandArgs(e, RULES.rank);
        if (resolved.echo)
            return false;
        const clean = resolved.text;
        const { videoNo, rest: rawText } = takeVideoToken(clean);
        if (videoNo > 0) {
            // 视频名次走「榜单视频」模块开关（2026-10-15：原来独立 app 的开关，随后缀化并进榜单命令）
            if (await moduleGateReply('video', e))
                return true;
            return await replyRankVideo(e, rawText, videoNo);
        }
        const args = parseRankArgs(rawText);
        /*
         * 2026-10-27 用户定（命令面拆成三种形态）：
         *   ① 带角色、不带金数 → 角色各金档视图（**不变**，最多 41 行）；
         *   ② 带 `总榜` / 带金数（`12金`、`9-12金`）→ 平铺榜单：按伤害排序、一页（金数视图最多 10 条）、可 `页N`；
         *      带角色时自动按该角色过滤（`#DPS榜 胡桃 12金`）。
         *   ③ 什么都不带 → **全库各金档视图**（新增；分档与角色页完全一致）。
         */
        const hasCost = args.costMin !== null || args.costMax !== null;
        if (args.all || hasCost) {
            // 金数筛选的“最多 10 条”是硬上限（配置调大也不超过 10）；`总榜` 仍按配置分页
            const pageSize = !args.all && hasCost ? Math.min(FLAT_MAX_ROWS, getPageSize()) : undefined;
            return await this.replyRankPage(e, args, pageSize);
        }
        if (args.char)
            return await this.replyCharTiers(e, args);
        return await this.replyCostTiers(e, args);
    }
    /** 平铺榜单（总榜 / 金数筛选 / 角色+金数）：与旧总榜同一张页面，只是筛选与分页不同 */
    async replyRankPage(e, args, pageSize) {
        const result = await queryRank(args, { proxy: getProxy(), ...(pageSize ? { pageSize } : {}) });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        const data = {
            siteName: SITE_NAME,
            title: TITLE,
            // 标签条件被忽略/无法核实时如实说明（与文本回退同源，不另发一条消息）
            subtitle: [result.subtitle, result.tags?.notice].filter(Boolean).join('｜'),
            fetchedAt: formatTime(result.fetchedAt),
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            pageSize: result.pageSize,
            rows: result.rows,
            copyright: DPS_COPYRIGHT
        };
        return await respond(e, 'rank', data, () => rankText(result, TITLE));
    }
    /**
     * 全库金档视图（`#DPS榜` 不带参数，2026-10-27）
     *
     * 分档口径与角色档位视图完全一致（≤4 / 5-8 / … / 29-48 金，每档 6/5/4 条），只是不限定角色。
     */
    async replyCostTiers(e, args) {
        const { char: _ignoredChar, all: _ignoredAll, ...filters } = args;
        const result = await queryCostTiers(filters, { proxy: getProxy() });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        const data = {
            siteName: SITE_NAME,
            title: '全库 · 各金档 DPS',
            gameName: 'Meta-Plugin · 金档总览',
            fetchedAt: formatTime(result.fetchedAt),
            total: result.total,
            tierCount: result.tierCount,
            tiers: result.tiers,
            notice: result.tags?.notice || '',
            copyright: DPS_COPYRIGHT
        };
        return await respond(e, 'char-dps', data, () => costTiersText(result));
    }
    /**
     * 角色档位视图（原 `#胡桃dps`，2026-10-15 合并进榜单命令）
     *
     * 回答"这个角色在不同投入下能打到多少"：每个金档各取前几条；
     * 筛选语义（金数 / 标签 / 主C / 绿玩）与总榜完全一致。
     */
    async replyCharTiers(e, args) {
        const { char: _ignoredChar, ...filters } = args;
        const result = await queryCharDps(args.char, filters, { proxy: getProxy() });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        /*
         * 页面数据：**不传 `subtitle`** —— 2026-10-15 用户定，角色档位页不渲染副标题行
         * （页头已有「命中 N 条 / N 个金档 / 数据时间」）。`result.subtitle` 仍给文本回退用。
         */
        const data = {
            siteName: SITE_NAME,
            title: `#${result.charName} · 各金档 DPS`,
            fetchedAt: formatTime(result.fetchedAt),
            total: result.total,
            tierCount: result.tierCount,
            tiers: result.tiers,
            // 2026-10-17 复审修复（#8）：被忽略/无法核实条件的诊断原本只进文本回退，
            // 成功图里看不到 → 单独一行 notice（不恢复长副标题，正常情况不渲染）
            notice: result.tags?.notice || '',
            copyright: DPS_COPYRIGHT
        };
        return await respond(e, 'char-dps', data, () => charDpsText(result));
    }
}
//# sourceMappingURL=rank.js.map