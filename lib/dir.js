/**
 * 路径常量 —— 全插件**唯一**的路径出处
 *
 * 为什么集中在这里：本插件是 TS 工程（源码 `src/` → 编译产物 `lib/`），运行时刻的文件位于
 * `<插件根>/lib/…`，比 JS 插件的目录深度**多一层**；相对路径散落各文件极易写错
 * （见设计文档 §14.2 陷阱 T1：框架模块要从 `lib/` 起算，多写一层 `../`）。
 *
 * 它同时是"插件区（TS：src/lib）⇄ 维护者区（ESM JS：scripts、templates、data）"的唯一桥。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** 运行时刻本文件所在目录：`<插件根>/lib` */
const here = path.dirname(fileURLToPath(import.meta.url));
/** 插件根（= 仓库根） */
export const pluginRoot = path.resolve(here, '..');
/** 编译产物目录（框架实际读取） */
export const libDir = path.join(pluginRoot, 'lib');
/** 源码目录（仅构建期有意义） */
export const srcDir = path.join(pluginRoot, 'src');
/** 攻略数据本体（随插件分发） */
export const dataDir = path.join(pluginRoot, 'data');
/** 渲染资源：模板 / CSS / 字体 */
export const resourcesDir = path.join(pluginRoot, 'resources');
/** 运行时配置目录（`config/config.yaml` 不入库，example 入库） */
export const configDir = path.join(pluginRoot, 'config');
/**
 * 运行时缓存目录（**未跟踪**，已进 `.gitignore`）
 *
 * 设计文档 §13.1 B14 的硬规则：运行时刻只允许写 `out/`（缓存）与 `config/`（配置）。
 * 榜单头像缓存（合并自 Mhydps 的 `data/avatar/`）就落在这里 ——
 * 本仓库的 `data/` 是**入库的攻略数据**，绝不能往里面写缓存。
 */
export const outDir = path.join(pluginRoot, 'out');
/** 框架根（bot 根）：`<bot>/plugins/<插件名>` → 上两级 */
export const botRoot = path.resolve(pluginRoot, '..', '..');
//# sourceMappingURL=dir.js.map