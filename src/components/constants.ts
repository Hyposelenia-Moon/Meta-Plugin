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

/**
 * 角色攻略的**后缀式**：`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`
 *
 * 与 `plugins/genshin`「米游社攻略」的 `^#?(更新)?\S+攻略([1-7])?$` 同形，由我们接管。
 * ⚠ 负向断言 `(?!.*设置默认攻略)` 必须保留：`#设置默认攻略3` 也以「攻略3」结尾，
 *   否则会被这条正则吞掉，导致 genshin 的设置命令失效（设计文档 §5.2 / §12）。
 */
export const CODEX_SUFFIX_RULE = /^#?(更新)?(?!.*设置默认攻略)([^#\s]\S*?)攻略([1-7])?$/

/** 角色攻略的「指南」后缀式（Atlas 的 codex 快捷入口也用这个词） */
export const CODEX_GUIDE_RULE = /^#(.+)指南$/

/**
 * **前缀式**入口：`#攻略 <角色> [模块|档位]`、`#攻略 武器 <武器名>`、`#攻略 配队 <角色…>`
 *
 * 这里只判断"是不是前缀式"，参数怎么解释交给 `modules/branches.ts`
 * （`武器`/`圣遗物`/`配队` 既是模块名又是反查头部，需要按"能否解析成角色"来定夺）。
 */
export const CODEX_ARG_RULE = /^#攻略\s+(.+)$/

/** 列表与状态：`#攻略列表` / `#攻略状态` */
export const CODEX_META_RULE = /^#攻略(列表|状态)$/

/** 三个档位词（`#攻略 <角色> 过渡` 只看某一档） */
export const TIER_WORDS = ['推荐', '可选', '过渡'] as const

export type TierWord = (typeof TIER_WORDS)[number]

/** 是否角色攻略的后缀式（`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`） */
export function isCodexSuffix (msg: string): boolean {
  const text = String(msg ?? '')
  return CODEX_SUFFIX_RULE.test(text) || CODEX_GUIDE_RULE.test(text)
}

/** 是否前缀式（`#攻略 …`） */
export function isCodexArg (msg: string): boolean {
  return CODEX_ARG_RULE.test(String(msg ?? ''))
}

/** 是否列表 / 状态（`#攻略列表` / `#攻略状态`） */
export function isCodexMeta (msg: string): boolean {
  return CODEX_META_RULE.test(String(msg ?? ''))
}

/**
 * 攻略命令的抢占判定（`accept()` 用；**纯正则、无 I/O**）
 *
 * 覆盖本插件规则会处理的**全部形态**：后缀式 + 指南 + 前缀式 + 列表/状态。
 * 为什么连前缀式一起认领：`accept` 返回 true 会 break 掉框架的 accept 循环
 * （`loader.js`：`if (res) break`），从而让排在其后的 miao accept 不再执行 ——
 * 它可能返回 `"return"` 直接终止整条消息（那样连 rule 阶段都不会跑）。
 * 因此凡是我们自己要处理的，都必须先认领。
 * （`#攻略` / `#攻略帮助` / `#攻略说明` 由帮助 app 认领，这里不重复。）
 */
export function isCodexCommand (msg: string): boolean {
  return isCodexSuffix(msg) || isCodexArg(msg) || isCodexMeta(msg)
}
