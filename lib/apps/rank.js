/**
 * `#DPS榜` —— DPS 数据库配队榜单（合并自 `Mhydps-Plugin/apps/rank.js`）
 *
 * 例：`#DPS榜` / `#DPS榜 胡桃` / `#DPS榜 胡桃 12金` / `#DPS榜 胡桃 主C 绿玩 -p2`
 *
 * 优先级取自 `DPS_COMMANDS`（默认 8000 = `config.priority`）：高于 Atlas（10000），
 * `#DPS…` 先由本插件接管，未命中的消息自然放行给其它插件。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { DPS_COMMANDS, DPS_COPYRIGHT, DPS_RULES, SITE_NAME, formatTime } from '../components/constants.js';
import { parseRankArgs } from '../modules/queryArgs.js';
import { queryRank } from '../modules/rankQuery.js';
import { rankText } from '../modules/formatText.js';
import { respond, suggestLine } from '../modules/respond.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
/** 本 app 的命令元数据（名称 / 文案 / 权限 / 优先级偏移都取它，见 components/constants.ts） */
const META = DPS_COMMANDS.find(c => c.rules.includes('rank'));
const TITLE = '#DPS榜';
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
                { reg: DPS_RULES.rank, fnc: 'handleRank', permission: META.permission }
            ]
        });
    }
    /**
     * `#DPS榜` — 原神 DPS 数据库配队榜单
     */
    async handleRank(e) {
        const text = (String(e.msg).match(DPS_RULES.rank) || [])[1] || '';
        const args = parseRankArgs(text);
        const result = await queryRank(args, { proxy: getProxy() });
        if (!result.ok) {
            await e.reply(`[Mhydps] ${result.error}${suggestLine(result.suggestions)}`);
            return true;
        }
        const data = {
            siteName: SITE_NAME,
            title: TITLE,
            subtitle: result.subtitle,
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
}
//# sourceMappingURL=rank.js.map