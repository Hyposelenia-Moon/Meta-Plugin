/**
 * `#危战` —— 幽境危战 n6 / n7 分档（v3 P1 新入口；2026-10-15 改为**显式选档**）
 *
 * 例：`#危战 矮灵 n7` / `#危战 7.1 n6` / `#危战 胡桃 n6`
 *
 * 2026-10-15（用户定）：两档**剥离**，每次只出一档 ——
 *   n7 = ≤70s（65s + 1~5s 浮动），**耗时降序**（越接近 70s 越靠前）；
 *   n6 = 其余（>70s），**金数优先**（金数越低越好），同金数按耗时升序（越短越好）。
 *   不写档位时**不发图**，只回一条"请选档 + 两档各多少条"的提示（提示选档）。
 * ⚠ 旧 `#危战`（按金数/耗时排序的一览）与 `#危战视频` 的名次口径仍挂在榜单排序上，
 *   其去留与视频改名一起走后续的命名重构，本轮不动。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { DPS_COPYRIGHT, COMMANDS, RULES, SITE_NAME, formatTime } from '../components/constants.js';
import { parseRaidArgs, takeVideoToken } from '../modules/queryArgs.js';
import { N7_SECONDS_LIMIT, queryRaidTiers } from '../modules/raidTiersQuery.js';
import { respond, suggestLine } from '../modules/respond.js';
import { isolatedText, ownTextOf, resolveCommandArgs } from '../modules/quoteGuard.js';
import { replyRaidVideo } from '../modules/videoLookup.js';
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
        /*
         * 2026-10-18 复审 R4 / 2026-10-27 复审 R4：档位与视频名次必须从**已隔离的命令全文**解析。
         * 旧代码直接读 `e.msg`（含引用正文）：引用「请用 n6」再发 `#危战 矮灵 n7` 会被改成 n6；
         * 没有 message 段时更无法区分。现在：own 文本优先，其次 `isolatedText()`（切掉末尾的引用副本），
         * 最后才退回 e.msg（框架已按它匹配到本规则）。
         */
        const ownMsg = ownTextOf(e).trim();
        const isolated = ownMsg || (await isolatedText(e));
        const isolatedMatch = isolated.match(RULES.raidTiers);
        // 兜底：隔离后仍匹配不到才退回 e.msg（框架已按它匹配到本规则；这里面可能带引用正文）
        const match = isolatedMatch || String(e.msg).match(RULES.raidTiers) || [];
        const tier = (match[2] || '') === '7' ? 'n7' : 'n6';
        /*
         * 后缀式视频名次（用户 2026-10-15 定）：`#危战 矮灵 n7 视频3` —— 正则第 3 组拿到名次，
         * 前面的筛选词（第 1 组）原样交给视频查询；档位是展示口径、与名次无关（名次按**全榜排序**，
         * 就是档页每行标的「全榜 #N」）。
         */
        const videoNo = Number(match[3]) || 0;
        // 参数来源：优先用用户自己打的文本（2026-10-17 复审修复 #2/#3，见 resolveCommandArgs）
        const resolved = await resolveCommandArgs(e, RULES.raidTiers);
        if (resolved.echo)
            return false;
        /*
         * 没有 message 段时，`resolveCommandArgs` 对"带引用的 e.msg"可能把引用正文也当筛选词
         * （例：`#危战 矮灵 n7` + 引用「请用 n6」→ 第 1 组变成 `矮灵 n7 请用`）。
         * 只要能对隔离后的全文匹配上，就**以隔离结果为准**。
         */
        const clean = isolatedMatch ? String(isolatedMatch[1] || '') : resolved.text;
        if (videoNo > 0) {
            // 视频名次走「榜单视频」模块开关（与 `#DPS … 视频N` 同一个开关）
            if (await moduleGateReply('video', e))
                return true;
            return await replyRaidVideo(e, clean, videoNo);
        }
        const args = parseRaidArgs(clean);
        const result = await queryRaidTiers(args, { proxy: getProxy(), tier });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        if (!result.total) {
            await e.reply('[Meta] 没有符合条件的危战记录：换个首领 / 版本 / 角色，或先让主人执行 #榜单刷新');
            return true;
        }
        /*
         * 页面数据：**不传 `subtitle`** —— 2026-10-15 用户定，危战页不渲染副标题行。
         * `result.subtitle` 仍保留给文本回退与「请选档」提示用（那里没有 page-meta，需要它交代口径）。
         */
        const data = {
            siteName: SITE_NAME,
            title: titleOf(result),
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
        /*
         * 视频名次写在档位前面（`#危战 矮灵 视频3 n7`）或没写档位（`#危战 矮灵 视频3`）时会落到这条兜底规则：
         * 名次查询与档位无关，直接按视频名次走（`视频N` 之外的部分照常当筛选词）。
         */
        /*
         * 2026-10-18 复审 R4（prompt 路径）：净化后的命令里若**已经带了档位**，直接按档位出图，
         * 不要反过来提示"重新选档"（引用整条榜单后落到兜底规则时就是这样被吞掉档位的）。
         *
         * 2026-10-27 复审 R4：判断要用**隔离后的全文**（own 缺失时靠 `isolatedText()`），
         * 否则"自身 `#危战 矮灵 n7` + 引用整条榜单"这条路径永远只会提示选档。
         */
        const own = ownTextOf(e).trim();
        const full = own || (await isolatedText(e)) || String(e.msg);
        if (RULES.raidTiers.test(full))
            return await this.handleRaidTiers(e);
        const resolved = await resolveCommandArgs(e, RULES.raidTiersPrompt);
        if (resolved.echo)
            return false;
        // 没有 message 段时，筛选词也要从隔离后的全文取（否则会混进引用正文）
        let clean = resolved.text;
        if (!own) {
            const hit = full.match(RULES.raidTiersPrompt);
            if (hit)
                clean = hit[1];
        }
        const { videoNo, rest } = takeVideoToken(clean);
        if (videoNo > 0) {
            if (await moduleGateReply('video', e))
                return true;
            return await replyRaidVideo(e, rest, videoNo);
        }
        const args = parseRaidArgs(clean);
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