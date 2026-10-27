/**
 * `#榜单刷新` / `#榜单刷新` / `#榜单刷新` —— 手动刷新榜单缓存（仅主人）
 *
 * 合并自 `Mhydps-Plugin/apps/admin.js`。两个接口合计约 1 MB，走代理时通常 1~3 秒；
 * 成功后内存与磁盘缓存同时更新（`TeamStore.refresh()` 内部并发共享，不会重复打站点）。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { COMMANDS, RULES, formatTime } from '../components/constants.js';
import { refresh } from '../model/TeamStore.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
import { moduleGateReply } from '../modules/moduleGate.js';
const META = COMMANDS.find(c => c.rules.includes('admin'));
export class MetaAdmin extends plugin {
    constructor() {
        super({
            name: META.name,
            dsc: META.dsc,
            event: 'message',
            priority: getPluginConfig()?.priority
                ? Number(getPluginConfig().priority) + META.priorityOffset
                : 8000 + META.priorityOffset,
            rule: [
                { reg: RULES.admin, fnc: 'handleUpdate', permission: META.permission }
            ]
        });
    }
    /**
     * `#榜单刷新` — 手动刷新榜单缓存
     */
    async handleUpdate(e) {
        if (await moduleGateReply('admin', e))
            return true;
        await e.reply('[Meta] 正在从 mhydps.cn 拉取榜单数据...', true);
        const ret = await refresh({ proxy: getProxy() });
        if (!ret.ok) {
            await e.reply(`[Meta] 更新失败：${ret.error}`, true);
            return true;
        }
        const sec = ((ret.ms || 0) / 1000).toFixed(1);
        await e.reply('[Meta] 更新完成\n' +
            `DPS ${ret.counts?.teams} 条 · 危战榜 ${ret.counts?.teams2} 条\n` +
            `耗时 ${sec}s · 数据时间 ${formatTime(ret.fetchedAt)}`, true);
        return true;
    }
}
//# sourceMappingURL=admin.js.map