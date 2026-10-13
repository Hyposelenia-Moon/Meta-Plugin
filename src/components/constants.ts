/**
 * 常量与纯判定（**不含 I/O**，便于回归套件直接 import 编译产物做行为断言）
 */

/**
 * 抢占优先级
 *
 * 我方必须早于两处占用者：Atlas-Plugin 快捷入口（`priority: -99999`）
 * 与 `plugins/genshin`「米游社攻略」（`priority: 50`）。
 *
 * ⚠ **写死、不做成配置项** —— 一旦让用户可改，改坏就等于抢占静默失效（设计文档 §14.8）。
 */
export const PREEMPT_PRIORITY = -100000

/**
 * 帮助入口的三个全局词：`#攻略` / `#攻略帮助` / `#攻略说明`
 *
 * 三者原属 `plugins/genshin` 的 `^#?攻略(说明|帮助)?$`，由本插件接管（设计文档 §5.2）。
 * 与角色后缀式（`#胡桃攻略`）**互不重叠**：那条要求串尾是「攻略」且前缀非空。
 * `#设置默认攻略N` 也不在此列（我们不接管，由 genshin 继续处理）。
 */
export const HELP_RULE = /^#?攻略(?:说明|帮助)?$/

/** 是否帮助入口（`accept()` 只做纯正则判定，不做任何 I/O） */
export function isHelpCommand (msg: string): boolean {
  return HELP_RULE.test(String(msg ?? ''))
}

/** 页脚版权行（模板里的 `{{copyright}}`） */
export const COPYRIGHT = 'Meta-Plugin · 原神攻略 / 强度榜单 / 练度查询'
