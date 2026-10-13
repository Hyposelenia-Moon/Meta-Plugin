/**
 * 启动编排（只读磁盘、不发网络）
 *
 * 合并自两处启动职责，**顺序固定为：攻略数据 → 榜单缓存**（详见下面的"为什么"）：
 *   1. `CodexStore`（攻略数据）：`data/gi` 的角色顺序、`_index.json` 的清单 —— 攻略查询的地基；
 *   2. 榜单缓存（合并自 `Mhydps-Plugin/model/startup.js`）：`TeamStore.loadFromDisk()` 把
 *      **`out/`** 下的 `teams.json` / `teams2.json` / `meta.json` 读进内存，**不发网络请求**。
 *
 * 为什么两条都不发网络：插件加载有超时限制，而拉全量榜单要打两个接口（合计约 1 MB，且国内需走代理）；
 * 查询路径按 TTL 惰性刷新（`TeamStore.ensureFresh()`），手动刷新走 `#DPS更新`。
 *
 * 为什么 `CodexStore` 在前：它是**纯本地只读**且是攻略/榜单共同的名称来源（角色名、头像 id），
 * 失败只影响攻略内容；榜单缓存读的是另一套文件（`teams*.json`），两者无依赖关系，
 * 这个顺序只保证"日志先报攻略、再报榜单"，与合并前各自单独启动时的可观测顺序一致。
 *
 * 为什么依赖可注入：本模块只做编排、不含业务逻辑；`load` 默认就是真实的
 * `TeamStore.loadFromDisk`，注入假实现即可在没有数据的机器上驱动各条降级分支。
 *
 * **入口只有一个 `initStore(deps)`**：合并前 Mhydps 的 `initStore({load, log})` 与我们的
 * 攻略启动各自叫这个名字，这里合成同一个入口 —— 返回值同时带攻略字段与榜单字段
 * （`loaded` / `teams` / `teams2` / `fetchedAt` 沿用合并前的名字，迁移过来的套件因此不用改）。
 */
import { codexStore } from './CodexStore.js';
import { loadFromDisk as dpsLoadFromDisk } from './TeamStore.js';
/**
 * 启动编排：载入磁盘缓存并打印状态（**不抛错** —— 任一环节失败都不阻断插件加载）
 *
 * @param deps 依赖（供测试注入）：`load` 默认 `TeamStore.loadFromDisk`，`log` 默认全局 `logger`
 */
export async function initStore(deps = {}) {
    const { load = dpsLoadFromDisk, log = logger } = deps;
    // 步骤 1：攻略数据（只读磁盘；`listAll()` / `stats()` 都是惰性读，失败各自降级为空）
    let codexTotal = 0;
    let codexFilled = 0;
    try {
        codexTotal = codexStore.listAll().length;
        codexFilled = codexStore.stats().filled;
        log?.info?.(`[Meta] 攻略数据就位：${codexFilled}/${codexTotal} 个角色有内容`);
    }
    catch (err) {
        // 攻略数据读不动只影响攻略内容，不该阻断插件加载
        log?.warn?.(`[Meta] 攻略数据载入失败：${err?.message || err}`);
    }
    // 步骤 2：榜单缓存（沿用合并前 `startup.js` 的容错顺序与文案，仅前缀 `[Mhydps]` → `[Meta]`）
    try {
        const ret = load();
        const teams = Number(ret?.teams) || 0;
        const teams2 = Number(ret?.teams2) || 0;
        const fetchedAt = Number(ret?.fetchedAt) || 0;
        if (teams || teams2) {
            const time = fetchedAt ? new Date(fetchedAt).toLocaleString('zh-CN') : '未知';
            log?.info?.(`[Meta] 已载入本地缓存：DPS榜 ${teams} 条 / 危战榜 ${teams2} 条（抓取于 ${time}）`);
        }
        else {
            log?.info?.('[Meta] 暂无本地缓存，首次查询或 #DPS更新 时自动拉取');
        }
        return { codex: true, codexTotal, codexFilled, loaded: true, dpsLoaded: true, teams, teams2, fetchedAt };
    }
    catch (err) {
        // 缓存损坏不应阻断插件加载：查询路径会按「无数据」重新拉取
        log?.warn?.(`[Meta] 本地缓存载入失败：${err?.message || err}`);
        return { codex: true, codexTotal, codexFilled, loaded: false, dpsLoaded: false, teams: 0, teams2: 0, fetchedAt: 0 };
    }
}
//# sourceMappingURL=startup.js.map