/**
 * AkashaBrowser — akasha.cv 的取数实现（浏览器会话）
 *
 * 为什么必须这样取数：akasha 的 `/api/` 在 Cloudflare 后面，**纯 HTTP 客户端一律 403**
 * （实测 Node fetch 带浏览器 UA + Referer 是挑战页；即使把浏览器里的 cf_clearance/connect.sid
 * 拿回来用纯 HTTP 调，仍然 403）。可行的办法是**用真浏览器打开它的页面，让页面自己发请求、
 * 我们拦截响应**——实测打开 `/profile/<uid>` 时它会请求
 *   `/api/user/<uid>`、`/api/getCalculationsForUser/<uid>`、`/api/textmap/...` 等，全部 200。
 *
 * 复用方式：优先用框架渲染后端那个已经在跑的 puppeteer 浏览器（不额外吃内存）；
 * 拿不到再按渲染后端的 chromiumPath 自己起一个，空闲 10 分钟自动关闭。
 *
 * 与 `AkashaClient` 的关系：本文件只实现 `transport(url, opts)` 这一层，
 * 由 app 层 `setTransport(akashaBrowserTransport)` 接进去，解析/缓存仍在 `AkashaClient`。
 *
 * ⚠ T1（框架 import 深度）：本文件运行时刻位于 `<插件根>/lib/model/`，比 Mhydps 的 JS 插件
 *   **多一层**，到 bot 根要 **四** 层 `../`（合并前写的是三层，直接照抄会解析到 `<bot>/plugins/lib/…`）。
 * ⚠ 业务查询联网开关：`networkEnabled` 关闭时直接抛错（不启动浏览器）；它只管查询类远程访问。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAkashaProxy, getAkashaTimeoutMs, isQueryNetworkEnabled, loadConfig, QUERY_NETWORK_OFF_HINT } from '../components/config.js';
/** 本模块关心的接口前缀（`/api/textmap/` 不在拦截集里：它是页面加载后才发的，见下面的两条路） */
const NEEDED = ['/api/user/', '/api/getCalculationsForUser/', '/api/textmap/', '/api/builds/', '/api/artifacts'];
/** 页面加载个人页时**自己会发**的接口 → 可以拦截响应（其余只能会话建立后在页面内 fetch） */
const INTERCEPTABLE_PREFIXES = ['/api/user/', '/api/getCalculationsForUser/', '/api/builds/', '/api/artifacts'];
/** 空闲多久关掉自己起的浏览器（毫秒） */
const IDLE_CLOSE_MS = 10 * 60 * 1000;
let ownBrowser = null;
/** 自建浏览器启动时用的代理（代理变了就不复用，见 `getBrowser`） */
let ownProxy = '';
/** 启动中的浏览器（并发调用共享它；见 getBrowser 注释） */
let launching = null;
let ownBrowserIdleTimer = null;
let puppeteerModule = null;
/**
 * 动态加载 puppeteer
 *
 * 插件装在 `<bot>/plugins/` 下时能直接 import 到 bot 的 `node_modules`；
 * 工作区（不在 bot 里）跑预览/测试时用 `createRequire` 以 bot 根为基准解析。
 */
async function loadPuppeteer() {
    if (puppeteerModule)
        return puppeteerModule;
    try {
        // @ts-expect-error puppeteer 不在本工程依赖里（只存在于 bot 的 node_modules），tsc 解析不到
        const mod = (await import('puppeteer'));
        puppeteerModule = (mod.default ?? mod);
        return puppeteerModule;
    }
    catch { /* 回落到 createRequire */ }
    const { createRequire } = await import('node:module');
    const req = createRequire(path.join(process.cwd(), 'package.json'));
    puppeteerModule = req('puppeteer');
    return puppeteerModule;
}
/**
 * 框架渲染后端（puppeteer）的实例
 *
 * 它暴露 `browser` 与启动配置，用它就能复用同一个浏览器，也不必自己猜 chromium 路径。
 */
async function rendererBackend() {
    try {
        // ⚠ 四层：`lib/model/` → lib → 插件根 → plugins → bot 根
        // @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见文件头 T1）
        const mod = (await import('../../../../lib/renderer/loader.js'));
        const loader = mod.default;
        const backend = loader?.getRenderer?.('puppeteer');
        return backend?.browser ? backend : null;
    }
    catch {
        return null;
    }
}
/** 从渲染后端配置里取 chromium 路径（自己起浏览器时用） */
function chromiumPathFrom(backend) {
    const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fromEnv)
        return fromEnv;
    const cfg = backend?.config || {};
    return cfg.executablePath || cfg.chromiumPath || '';
}
/** 当前应当使用的代理（`akashaProxy` 优先，留空回落通用 `proxy`） */
function currentProxy() {
    return (getAkashaProxy() || String(loadConfig().proxy || '')).trim();
}
/**
 * 渲染后端的浏览器能不能复用
 *
 * 它不是本插件起的，**代理不可知** —— 只有"没配代理"时复用才安全；
 * 配了代理就必须走自建浏览器，否则 `akashaProxy` 形同虚设（2026-10-15 四项目复核 P2）。
 */
export function canReuseRendererBrowser(backendHasBrowser, proxy) {
    return Boolean(backendHasBrowser) && !String(proxy || '').trim();
}
/** 关掉自建浏览器（代理变更或空闲超时时用） */
async function closeOwnBrowser() {
    const browser = ownBrowser;
    ownBrowser = null;
    ownProxy = '';
    if (ownBrowserIdleTimer) {
        clearTimeout(ownBrowserIdleTimer);
        ownBrowserIdleTimer = null;
    }
    try {
        await browser?.close();
    }
    catch { /* 忽略 */ }
}
/**
 * 拿到一个可用的浏览器：按**代理能力**决定能否复用，再考虑自己起
 *
 * ⚠ 渲染后端那个浏览器不是本插件起的、代理不可知：配置了代理就不能拿它顶替，
 *   否则 `akashaProxy` 这条路径形同虚设（2026-10-15 四项目复核 P2）。
 */
async function getBrowser() {
    const proxy = currentProxy();
    const backend = await rendererBackend();
    if (canReuseRendererBrowser(Boolean(backend?.browser), proxy))
        return { browser: backend?.browser, owned: false };
    // 自建浏览器只在**代理没变**时可复用；代理改了必须重建，否则查询会走错出口
    if (ownBrowser?.connected && ownProxy === proxy)
        return { browser: ownBrowser, owned: true };
    if (ownBrowser && ownProxy !== proxy)
        await closeOwnBrowser();
    // ⚠ 2026-10-15 审核 P2 #12：冷启动并发。框架还没有可复用浏览器时，多个 getBrowser
    //    在 launch 完成前都看到 ownBrowser 为空 → 各自启动，最后只剩一个引用（其余泄漏）。
    //    这里**共享同一次启动 Promise**；失败时把启动状态清空，下一次调用可以重试。
    if (!launching) {
        launching = (async () => {
            try {
                const puppeteer = await loadPuppeteer();
                const exe = chromiumPathFrom(backend);
                // 配置里的代理必须真正落到启动参数上（审核附加项：proxy 之前只被接收、没被使用）
                const args = ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox', '--no-zygote'];
                if (proxy)
                    args.push(`--proxy-server=${proxy}`);
                const launchConfig = {
                    headless: 'new',
                    args,
                    ...(exe ? { executablePath: exe } : {})
                };
                const browser = await puppeteer.launch(launchConfig);
                ownBrowser = browser; // 在这里赋值：并发调用者随后就能直接复用
                ownProxy = proxy; // 记住启动时用的代理，供下次判断能否复用
                return browser;
            }
            finally {
                launching = null; // 成功或失败都清空，避免"启动中"状态卡死
            }
        })();
    }
    const browser = await launching;
    return { browser, owned: true };
}
/** 自己起的浏览器：空闲一段时间后关闭 */
function touchIdleTimer() {
    if (!ownBrowser)
        return;
    if (ownBrowserIdleTimer)
        clearTimeout(ownBrowserIdleTimer);
    ownBrowserIdleTimer = setTimeout(async () => {
        // 复用 `closeOwnBrowser`：顺手把 `ownProxy` 与定时器一起清掉，避免留下陈旧代理记忆
        await closeOwnBrowser();
    }, IDLE_CLOSE_MS);
    ownBrowserIdleTimer.unref?.();
}
/**
 * 用浏览器会话取一个 akasha URL
 *
 * 两条路，按接口选：
 *  1) 页面自己就会请求的接口（`/api/user/<uid>`、`/api/getCalculationsForUser/<uid>`）→ **拦截页面响应**
 *     （最稳：等同站点自己的通道，实测 200）；
 *  2) 其它接口（如 textmap 中文化）→ 页面加载完会话建立后，**在页面内 fetch 我们的 URL**；
 *     这条路可能被 Cloudflare 认出，失败就由上层降级（武器/套装名保留英文）。
 *
 * @param url akasha API 绝对地址
 * @returns 形如 `{ status, text }`（与 `AkashaClient` 的 transport 契约一致）
 */
export async function akashaBrowserTransport(url, opts = {}) {
    // 业务查询联网开关：关闭时不启动浏览器
    if (!isQueryNetworkEnabled()) {
        throw new Error(`${QUERY_NETWORK_OFF_HINT}；阿卡莎取数需要浏览器会话`);
    }
    const timeoutMs = opts.timeoutMs || getAkashaTimeoutMs();
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    // 页面加载个人页时自己会请求这几个接口 → 可拦截（实测 200）
    // ⚠ P5：榜条目 / 角色筛选 / 赛道分类 这几条只会在**对应页面**上被页面自身请求（页面里自己 fetch 会被 CF 403），
    //    所以这里的可拦截判断要认它们；页面地址由 opts.pageUrl 指定（默认仍是个人页 / 首页）
    const interceptable = INTERCEPTABLE_PREFIXES.some(prefix => pathname.startsWith(prefix)) ||
        /^\/api\/(leaderboards|filters|v2\/leaderboards|builds)/.test(pathname);
    // UID 也可能只在 query 上（如 `/api/builds/?uid=…`，审核附加项：之前只从路径取，导致 pageUrl
    // 落成首页、builds 请求根本没被发出）
    const uidFromPath = pathname.match(/\/(?:user|getCalculationsForUser)\/(\d{9,10})/)?.[1] || '';
    const uidFromQuery = String(parsed.searchParams.get('uid') || '').trim();
    const uid = /^\d{9,10}$/.test(uidFromQuery) ? uidFromQuery : uidFromPath;
    const pageUrl = opts.pageUrl || (uid ? `https://akasha.cv/profile/${uid}` : 'https://akasha.cv/');
    const { browser } = await getBrowser();
    touchIdleTimer();
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });
        // 页面自身的 textmap 响应（含它当下要显示的词）——顺手收下来给中文化兜底
        const harvested = {};
        page.on('response', (res) => {
            if (!res.url().includes('/api/textmap/'))
                return;
            void (async () => {
                try {
                    const json = JSON.parse(await res.text());
                    Object.assign(harvested, json?.translation || {});
                }
                catch { /* 忽略 */ }
            })();
        });
        // 路径 1：拦截页面自身发出的同路径响应
        let intercepted = null;
        if (interceptable) {
            intercepted = new Promise((resolve) => {
                page.on('response', (res) => {
                    const resUrl = res.url();
                    if (!resUrl.includes('/api/'))
                        return;
                    try {
                        if (!new URL(resUrl).pathname.startsWith(pathname))
                            return;
                    }
                    catch {
                        return;
                    }
                    void (async () => {
                        try {
                            resolve({ status: res.status(), text: await res.text() });
                        }
                        catch { /* 读流失败继续等 */ }
                    })();
                });
            });
        }
        await page.goto(pageUrl, { waitUntil: interceptable ? 'domcontentloaded' : 'networkidle2', timeout: timeoutMs }).catch(() => { });
        if (interceptable && intercepted) {
            const timeout = new Promise((_, reject) => {
                const t = setTimeout(() => reject(new Error(`akasha 页面在 ${Math.round(timeoutMs / 1000)}s 内没有请求该接口（可能改版或限流）`)), timeoutMs);
                t.unref?.();
            });
            return await Promise.race([intercepted, timeout]);
        }
        // 路径 2：会话建好后在页面内 fetch；失败就把「页面自己那份 textmap」还回去（至少能中文化一部分）
        const direct = await page.evaluate(async (target) => {
            try {
                const res = await fetch(target, { headers: { Accept: 'application/json' } });
                return { status: res.status, text: await res.text() };
            }
            catch (err) {
                return { status: 0, text: JSON.stringify({ error: String(err?.message || err) }) };
            }
        }, url);
        if (direct.status === 200)
            return direct;
        if (pathname.includes('/api/textmap/') && Object.keys(harvested).length) {
            return { status: 200, text: JSON.stringify({ translation: harvested }) };
        }
        return direct;
    }
    finally {
        try {
            await page.close();
        }
        catch { /* 忽略 */ }
    }
}
/** 关闭自己起的浏览器（插件卸载/测试用） */
export async function closeAkashaBrowser() {
    await closeOwnBrowser();
}
/** 当前取数状态（状态页/排查用） */
export async function akashaBrowserInfo() {
    const backend = await rendererBackend();
    return {
        // 配了代理时**不会**复用渲染后端的浏览器（它的代理不可知）→ 状态页要如实反映
        reuseRendererBrowser: canReuseRendererBrowser(Boolean(backend?.browser), currentProxy()),
        ownBrowser: Boolean(ownBrowser?.connected),
        rendererDir: backend?.config?.executablePath || backend?.config?.chromiumPath || ''
    };
}
/** 小工具：把本地图片路径转成模板可用的 `file://` 地址 */
export const fileUrl = (p) => (p ? pathToFileURL(p).href : '');
/** 判断某个文件是否存在（供上层做可选资源探测） */
export const exists = (p) => {
    try {
        return Boolean(p) && fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
};
//# sourceMappingURL=AkashaBrowser.js.map