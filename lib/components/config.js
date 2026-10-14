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
import { MAX_PAGE_SIZE } from './constants.js';
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
    akashaMaxChars: 12,
    gradeWeights: 'panel:30,weapon:20,artifact:35,talent:15',
    gradePanelTiers: 'big:0.9,normal:0.6,small:0.3',
    gradeRankThresholds: 'MAX:95,ACE:88,SSS:80,SS:72,S:64,A:55,B:45,C:30'
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
/**
 * 渲染缩放的夹取（0.5 ~ 3）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `clampRenderScale()`：
 *   `null` / `undefined` / 空串视为「没配」→ 回落默认值（`Number(null)` 是 0，不特判会被夹成 0.5）。
 */
export function clampRenderScale(value) {
    if (value === null || value === undefined || value === '')
        return defaultConfig.renderScale;
    const num = Number(value);
    if (!Number.isFinite(num))
        return defaultConfig.renderScale;
    return Math.min(3, Math.max(0.5, num));
}
/** 渲染缩放（渲染模块用） */
export function getRenderScale() {
    return clampRenderScale(loadConfig().renderScale);
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
/** 练度查询（akasha）代理：不填则直连（akasha 自己不在墙内）；首尾空白会被修剪 */
export function getAkashaProxy() {
    return String(loadConfig().akashaProxy ?? '').trim();
}
/**
 * 练度查询超时（毫秒）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getAkashaTimeoutMs()`：夹取 **5s ~ 180s**
 * （akasha 走浏览器会话，单次比榜单慢，上下限都比 `dpsTimeoutMs` 宽）。
 */
export function getAkashaTimeoutMs() {
    const value = Number(loadConfig().akashaTimeoutMs);
    if (!Number.isFinite(value))
        return defaultConfig.akashaTimeoutMs;
    return Math.min(180000, Math.max(5000, Math.floor(value)));
}
/** 练度缓存 TTL（分钟；非法值回落默认、最小 1） */
export function getAkashaCacheTtlMinutes() {
    const value = Number(loadConfig().akashaCacheTtlMinutes);
    if (!Number.isFinite(value) || value < 1)
        return defaultConfig.akashaCacheTtlMinutes;
    return Math.floor(value);
}
/** 单次最多展示的角色数（练度查询；夹取 1 ~ 30） */
export function getAkashaMaxChars() {
    const value = Number(loadConfig().akashaMaxChars);
    if (!Number.isFinite(value) || value < 1)
        return defaultConfig.akashaMaxChars;
    return Math.min(30, Math.floor(value));
}
/** 榜单每页条数（夹取 1 ~ `MAX_PAGE_SIZE`，避免用户把图撑爆） */
export function getPageSize() {
    const value = Number(loadConfig().dpsPageSize);
    if (!Number.isFinite(value) || value < 1)
        return defaultConfig.dpsPageSize;
    return Math.min(MAX_PAGE_SIZE, Math.floor(value));
}
/** 练度查询开关（锅巴 → 数据源二 · akasha.cv） */
export function getAkashaEnabled() {
    return loadConfig().akashaEnabled !== false;
}
/** 榜单 / 危战请求代理（不填则直连）；首尾空白会被修剪 */
export function getProxy() {
    return String(loadConfig().proxy ?? '').trim();
}
/**
 * 完整配置对象（查询层用）
 *
 * 合并自 `Mhydps-Plugin/components/config.js` 的 `getPluginConfig()`。
 * ⚠ 键名已按设计文档 §14.8 改名：`avatarEnabled` → **`dpsAvatarEnabled`**、
 *   `pageSize` → `dpsPageSize`、`cacheTtlMinutes` → `dpsCacheTtlMinutes`、`timeoutMs` → `dpsTimeoutMs`。
 */
export function getPluginConfig() {
    return loadConfig();
}
/* ---------- 练度评分（v3 P2） ---------- */
/**
 * 评分权重
 *
 * 目前暂按「面板 30 / 武器 20 / 圣遗物 35 / 天赋 15」；用户 2026-10-13 说明权重**后续与另一位开发者探讨**，
 * 因此做成配置项：改权重不需要改代码（非法项忽略，缺失项用默认值）。
 */
export function getGradeWeights() {
    return { panel: 30, weapon: 20, artifact: 35, talent: 15, ...parseSpecSafe(loadConfig().gradeWeights) };
}
/** 面板三档阈值（大毕业 / 毕业 / 小毕业） */
export function getGradePanelTiers() {
    const parsed = parseSpecSafe(loadConfig().gradePanelTiers);
    const pick = (k, def) => {
        const v = Number(parsed[k]);
        return Number.isFinite(v) && v > 0 && v <= 1 ? v : def;
    };
    return { big: pick('big', 0.9), normal: pick('normal', 0.6), small: pick('small', 0.3) };
}
/** 总体练度九档阈值（写法 `MAX:95,ACE:88,…`；解析失败回落默认） */
export function getGradeRankThresholds() {
    return parseRankThresholdsSafe(loadConfig().gradeRankThresholds);
}
/** 紧凑写法解析（本文件内部用；评分模块另有一份带默认值的实现供离线单测） */
function parseSpecSafe(spec) {
    const out = {};
    for (const part of String(spec || '').split(/[,，;；\s]+/)) {
        const [k, v] = part.split(/[:：=]/);
        const key = String(k || '').trim();
        const value = Number(String(v || '').trim());
        if (!key || !Number.isFinite(value))
            continue;
        out[key] = value;
    }
    return out;
}
const RANK_ORDER = [
    ['MAX', 95], ['ACE', 88], ['SSS', 80], ['SS', 72], ['S', 64], ['A', 55], ['B', 45], ['C', 30]
];
function parseRankThresholdsSafe(spec) {
    const parsed = parseSpecSafe(spec);
    if (!Object.keys(parsed).length)
        return RANK_ORDER;
    return RANK_ORDER.map(([name, def]) => [name, Number.isFinite(parsed[name]) ? parsed[name] : def]);
}
//# sourceMappingURL=config.js.map