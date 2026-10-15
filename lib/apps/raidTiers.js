/**
 * `#危战` —— 幽境危战 n6 / n7 分档（v3 P1 新入口；2026-10-15 改为**显式选档**）
 *
 * 例：`#危战 矮灵 n7` / `#危战 7.1 n6` / `#危战 胡桃 n6`
 *
 * 2026-10-15（用户定）：两档**剥离**，每次只出一档 ——
 *   n7 = ≤70s（65s + 1~5s 浮动），越快越靠前；n6 = 其余（>70s），越接近站点上限 120s 越靠前。
 *   不写档位时**不发图**，只回一条"请选档 + 两档各多少条"的提示（提示选档）。
 * ⚠ 旧 `#危战`（按金数/耗时排序的一览）与 `#危战视频` 的名次口径仍挂在榜单排序上，
 *   其去留与视频改名一起走后续的命名重构，本轮不动。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { DPS_COPYRIGHT, COMMANDS, RULES, SITE_NAME, formatTime } from '../components/constants.js';
import { parseRaidArgs } from '../modules/queryArgs.js';
import { N7_SECONDS_LIMIT, queryRaidTiers } from '../modules/raidTiersQuery.js';
import { respond, suggestLine } from '../modules/respond.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
import { moduleGateReply } from '../modules/moduleGate.js';
/** 本 app 的命令元数据（见 components/constants.ts 的 COMMANDS） */
const META = COMMANDS.find(c => c.rules.includes('raidTiers'));
/** 指定档位时的页面标题 */
function titleOf(result) {
    const block = result.tiers[0];
    return `幽境危战 · ${block?.label || result.tier || ''}`;
}
/** 未指定档位时的提示（提示选档：不回图，只报两档条数与用法） */
function pickTierText(result) {
    const { n7, n6 } = result.counts;
    return [
        `[Meta] 请指定危战档位（${result.subtitle}）`,
        `· n7 = 速通档（≤ ${N7_SECONDS_LIMIT}s，按耗时降序：时间越长越靠前）：${n7} 条`,
        `· n6 = 险胜档（> ${N7_SECONDS_LIMIT}s，同样降序：越接近 120s 越靠前）：${n6} 条`,
        '例：#危战 矮灵 n7　#危战 7.1 n6　#危战 胡桃 n6',
        '· 档页每行的「全榜 #N」就是视频名次：#危战视频 N'
    ].join('\n');
}
/** 文本回退：单档列出前几条 */
function raidTiersText(result) {
    const lines = [titleOf(result), result.subtitle, ''];
    for (const tier of result.tiers) {
        lines.push(`【${tier.label}】共 ${tier.count} 条 —— ${tier.note}`);
        for (const row of tier.rows) {
            const team = row.chars.map(c => `${c.name}${c.constellation ? `C${c.constellation}` : ''}`).join(' + ');
            const head = [row.ver, row.bossName].filter(Boolean).join(' ');
            lines.push(`  ${row.rank}. ${row.speedText || `${row.speed}s`}（全榜 #${row.overallRank || '-'}） — ${team}｜${row.cost}金` + (head ? `｜${head}` : '') + (row.video ? '｜有视频' : ''));
        }
        if (!tier.rows.length)
            lines.push('  （本档暂无记录）');
    }
    return lines.join('\n');
}
export class MetaRaidTiers extends plugin {
    constructor() {
        super({
            name: META.name,
            dsc: META.dsc,
            event: 'message',
            priority: getPluginConfig()?.priority
                ? Number(getPluginConfig().priority) + META.priorityOffset
                : 8000 + META.priorityOffset,
            rule: [
                { reg: RULES.raidTiers, fnc: 'handleRaidTiers', permission: META.permission },
                // 写了筛选但忘了档位 → 只回"请选档"提示（裸 `#危战` 不在此列，那是 miao 的命令）
                { reg: RULES.raidTiersPrompt, fnc: 'handlePickTier', permission: META.permission }
            ]
        });
    }
    /**
     * `#危战 <版本/首领/角色> n6|n7` —— 单档成绩
     *
     * 档位从正则第 2 组拿（第 1 组是其余筛选词）。
     */
    async handleRaidTiers(e) {
        if (await moduleGateReply('raidTiers', e))
            return true;
        const match = String(e.msg).match(RULES.raidTiers) || [];
        const tier = (match[2] || '') === '7' ? 'n7' : 'n6';
        const args = parseRaidArgs(match[1] || '');
        const result = await queryRaidTiers(args, { proxy: getProxy(), tier });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        if (!result.total) {
            await e.reply('[Meta] 没有符合条件的危战记录：换个首领 / 版本 / 角色，或先让主人执行 #榜单刷新');
            return true;
        }
        const data = {
            siteName: SITE_NAME,
            title: titleOf(result),
            subtitle: result.subtitle,
            fetchedAt: formatTime(result.fetchedAt),
            total: result.total,
            tiers: result.tiers,
            copyright: DPS_COPYRIGHT
        };
        return await respond(e, 'tiers', data, () => raidTiersText(result));
    }
    /**
     * `#危战 <筛选>`（写了筛选但没写档位）—— 只回"请选档 + 两档各多少条"
     *
     * 不发图：两档排序口径相反，发哪一档都可能不是用户要的（用户 2026-10-15 定）。
     */
    async handlePickTier(e) {
        if (await moduleGateReply('raidTiers', e))
            return true;
        const match = String(e.msg).match(RULES.raidTiersPrompt) || [];
        const args = parseRaidArgs(match[1] || '');
        const result = await queryRaidTiers(args, { proxy: getProxy() });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        if (!result.total) {
            await e.reply('[Meta] 没有符合条件的危战记录：换个首领 / 版本 / 角色，或先让主人执行 #榜单刷新');
            return true;
        }
        await e.reply(pickTierText(result));
        return true;
    }
}
//# sourceMappingURL=raidTiers.js.map