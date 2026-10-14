/**
 * `#危战` —— 幽境危战 n6 / n7 两档（v3 P1 新入口）
 *
 * 例：`#危战` / `#危战 7.1` / `#危战 矮灵雕刻师` / `#危战 7.1 玛薇卡`
 *
 * 与 `#DPS危战榜` 的分工：榜单是"按金数升序、同金比耗时"的一览（可翻页）；
 * 本入口把同样的记录切成**两个水平档**：
 *   n7 = ≤70s（65s + 允许 1~5s 浮动）、n6 = 其余（按耗时降序，"险胜"在前）
 * 旧 `#DPS危战榜` 保留，筛选语义完全一致。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { DPS_COPYRIGHT, ENTRY_COMMANDS, ENTRY_RULES, SITE_NAME, formatTime } from '../components/constants.js';
import { parseRaidArgs } from '../modules/queryArgs.js';
import { queryRaidTiers } from '../modules/raidTiersQuery.js';
import { respond, suggestLine } from '../modules/respond.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
/** 本 app 的命令元数据（见 components/constants.ts 的 ENTRY_COMMANDS） */
const META = ENTRY_COMMANDS.find(c => c.rules.includes('raidTiers'));
/** 文本回退：两档各列前几条 */
function raidTiersText(result) {
    const lines = ['幽境危战 · n6 / n7 两档', result.subtitle, ''];
    for (const tier of result.tiers) {
        lines.push(`【${tier.label}】共 ${tier.count} 条 —— ${tier.note}`);
        for (const row of tier.rows) {
            const team = row.chars.map(c => `${c.name}${c.constellation ? `C${c.constellation}` : ''}`).join(' + ');
            const head = [row.ver, row.bossName].filter(Boolean).join(' ');
            lines.push(`  ${row.rank}. ${row.speedText || `${row.speed}s`} — ${team}｜${row.cost}金` + (head ? `｜${head}` : '') + (row.video ? '｜有视频' : ''));
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
                { reg: ENTRY_RULES.raidTiers, fnc: 'handleRaidTiers', permission: META.permission }
            ]
        });
    }
    /**
     * `#危战 [版本] [首领] [角色] [金数]` —— n6 / n7 两档
     */
    async handleRaidTiers(e) {
        const match = String(e.msg).match(ENTRY_RULES.raidTiers) || [];
        const args = parseRaidArgs(match[1] || '');
        const result = await queryRaidTiers(args, { proxy: getProxy() });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        const data = {
            siteName: SITE_NAME,
            title: '幽境危战 · n6 / n7',
            subtitle: result.subtitle,
            fetchedAt: formatTime(result.fetchedAt),
            total: result.total,
            tiers: result.tiers,
            copyright: DPS_COPYRIGHT
        };
        return await respond(e, 'tiers', data, () => raidTiersText(result));
    }
}
//# sourceMappingURL=raidTiers.js.map