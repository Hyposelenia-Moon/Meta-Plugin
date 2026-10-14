/**
 * `#xx dps` —— 角色各金档最高伤害队伍（v3 P1 新入口）
 *
 * 例：`#胡桃dps` / `#胡桃dps 12金` / `#胡桃 dps 金≤12` / `#胡桃dps 主C 绿玩`
 *
 * 与 `#DPS榜 胡桃` 的分工：榜单是"含该角色的记录按伤害排序"（一条长列表、可翻页）；
 * 本入口是"**每个金档各取前几条**"，回答"这个角色在不同投入下能打到多少"。
 * 旧 `#DPS…` 命令全部保留，两者共用同一份缓存与筛选语义。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { DPS_COPYRIGHT, ENTRY_COMMANDS, ENTRY_RULES, SITE_NAME, formatTime } from '../components/constants.js';
import { parseRankArgs } from '../modules/queryArgs.js';
import { queryCharDps } from '../modules/charDpsQuery.js';
import { respond, suggestLine } from '../modules/respond.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
/** 本 app 的命令元数据（见 components/constants.ts 的 ENTRY_COMMANDS） */
const META = ENTRY_COMMANDS.find(c => c.rules.includes('charDps'));
/** 文本回退：按金档列前几名 */
function charDpsText(result) {
    const lines = [`#${result.charName} · 各金档最高伤害队伍`, result.subtitle, ''];
    for (const tier of result.tiers) {
        lines.push(`【${tier.cost} 金】共 ${tier.count} 条`);
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
export class MetaCharDps extends plugin {
    constructor() {
        super({
            name: META.name,
            dsc: META.dsc,
            event: 'message',
            // 与 `#DPS…` 同档（默认 8000），仅偏移 -5：新旧入口的规则互不重叠，只影响与其它插件的先后
            priority: getPluginConfig()?.priority
                ? Number(getPluginConfig().priority) + META.priorityOffset
                : 8000 + META.priorityOffset,
            rule: [
                { reg: ENTRY_RULES.charDps, fnc: 'handleCharDps', permission: META.permission }
            ]
        });
    }
    /**
     * `#胡桃dps [金数/标签/主C/绿玩]` —— 该角色各金档最高伤害队伍
     */
    async handleCharDps(e) {
        const match = String(e.msg).match(ENTRY_RULES.charDps) || [];
        const char = (match[1] || '').trim();
        // 角色名只认前缀（`#胡桃dps 行秋` 里的"行秋"不应再当作角色筛掉记录）
        const parsed = parseRankArgs(match[2] || '');
        const { char: _ignoredChar, ...args } = parsed;
        const result = await queryCharDps(char, args, { proxy: getProxy() });
        if (!result.ok) {
            await e.reply(`[Meta] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        const data = {
            siteName: SITE_NAME,
            title: `#${result.charName} · 各金档 DPS`,
            subtitle: result.subtitle,
            fetchedAt: formatTime(result.fetchedAt),
            total: result.total,
            tierCount: result.tierCount,
            tiers: result.tiers,
            copyright: DPS_COPYRIGHT
        };
        return await respond(e, 'char-dps', data, () => charDpsText(result));
    }
}
//# sourceMappingURL=charDps.js.map