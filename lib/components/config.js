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
//# sourceMappingURL=config.js.map