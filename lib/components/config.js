/**
 * 配置读取（三层结构）
 *
 *   `defSet/config.yaml`          ← 锅巴模板（`${meta_*}` 占位符 + 注释）
 *   `guoba/index.js`              ← 读模板 → 替换变量 → 写 `config/config.yaml`
 *   `config/config.yaml`          ← 运行时配置（**不入库**）
 *   `config/config.yaml.example`  ← 参考默认值（入库，首次启动自动复制）
 *
 * 键名与旧 Mhydps-Plugin 的对照见设计文档 §14.8（变量前缀统一 `${meta_*}`）。
 * `META_CONFIG_FILE` 可指向别处：回归套件用它构造临时配置，避免动仓库里的 `config/config.yaml`。
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { configDir } from '../dir.js';
/** 默认配置（与 `config/config.yaml.example` 保持一致） */
export const defaultConfig = {
    priority: 8000,
    renderScale: 1.5,
    networkEnabled: false,
    proxy: '',
    dpsCacheTtlMinutes: 30,
    dpsPageSize: 10,
    dpsTimeoutMs: 30000,
    dpsAvatarEnabled: true,
    akashaEnabled: true,
    akashaDefaultUid: '',
    akashaProxy: '',
    akashaTimeoutMs: 60000,
    akashaCacheTtlMinutes: 30,
    akashaMaxChars: 12
};
/** 运行时配置文件路径（`META_CONFIG_FILE` 优先） */
export function configFile() {
    return process.env.META_CONFIG_FILE
        ? path.resolve(process.env.META_CONFIG_FILE)
        : path.join(configDir, 'config.yaml');
}
/** 参考默认值文件路径（入库） */
export function exampleFile() {
    return path.join(configDir, 'config.yaml.example');
}
/** 首次启动：缺 `config.yaml` 时从 example 复制一份（与 Atlas / Mhydps 同一约定） */
export function ensureConfigFile() {
    try {
        if (fs.existsSync(configFile()) || !fs.existsSync(exampleFile()))
            return;
        fs.mkdirSync(path.dirname(configFile()), { recursive: true });
        fs.copyFileSync(exampleFile(), configFile());
        logger?.info('[Meta] 已从 config.yaml.example 创建配置文件');
    }
    catch (err) {
        logger?.warn(`[Meta] 创建配置文件失败：${err.message}`);
    }
}
/** 深合并：运行时配置逐字段覆盖默认值（嵌套对象递归） */
function deepMerge(base, overlay) {
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay))
        return { ...base };
    const result = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        const baseValue = result[key];
        if (value && typeof value === 'object' && !Array.isArray(value) &&
            baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)) {
            result[key] = deepMerge(baseValue, value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
/** 读取配置（文件不存在 / 解析失败 → 全默认值，只告警不抛错） */
export function loadConfig() {
    try {
        const file = configFile();
        if (!fs.existsSync(file))
            return { ...defaultConfig };
        const raw = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
        return deepMerge(defaultConfig, raw);
    }
    catch (err) {
        logger?.warn(`[Meta] 配置解析失败，按默认值处理：${err.message}`);
        return { ...defaultConfig };
    }
}
/** 渲染缩放（渲染模块用） */
export function getRenderScale() {
    return loadConfig().renderScale;
}
/**
 * 榜单缓存 TTL（分钟）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getCacheTtlMinutes()`：非法值回落默认、最小 1 分钟。
 * TeamStore 与状态页都取自这里（单一出处）。
 */
export function getDpsCacheTtlMinutes() {
    const value = Number(loadConfig().dpsCacheTtlMinutes);
    if (!Number.isFinite(value) || value < 1)
        return defaultConfig.dpsCacheTtlMinutes;
    return Math.floor(value);
}
/**
 * 榜单请求超时（毫秒）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getTimeoutMs()`：夹取到 **3s ~ 120s**，
 * 避免用户把超时改得过大拖住消息处理。
 */
export function getDpsTimeoutMs() {
    const value = Number(loadConfig().dpsTimeoutMs);
    if (!Number.isFinite(value))
        return defaultConfig.dpsTimeoutMs;
    return Math.min(120000, Math.max(3000, Math.floor(value)));
}
/** 练度查询（akasha）代理：不填则直连（akasha 自己不在墙内） */
export function getAkashaProxy() {
    return String(loadConfig().akashaProxy ?? '');
}
/** 练度查询超时（毫秒；夹取到 3s ~ 120s，与榜单同一口径） */
export function getAkashaTimeoutMs() {
    const value = Number(loadConfig().akashaTimeoutMs);
    if (!Number.isFinite(value))
        return defaultConfig.akashaTimeoutMs;
    return Math.min(120000, Math.max(3000, Math.floor(value)));
}
/** 练度缓存 TTL（分钟；非法值回落默认、最小 1） */
export function getAkashaCacheTtlMinutes() {
    const value = Number(loadConfig().akashaCacheTtlMinutes);
    if (!Number.isFinite(value) || value < 1)
        return defaultConfig.akashaCacheTtlMinutes;
    return Math.floor(value);
}
/** 单次最多展示的角色数（练度查询） */
export function getAkashaMaxChars() {
    const value = Number(loadConfig().akashaMaxChars);
    if (!Number.isFinite(value) || value < 1)
        return defaultConfig.akashaMaxChars;
    return Math.floor(value);
}
//# sourceMappingURL=config.js.map