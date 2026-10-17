/**
 * 模块开关闸门（**功能层**，键表见 `components/config.ts` 的 `MODULE_KEYS`）
 *
 * 关闭时的行为分两类（用户 2026-10-15 定）：
 *  - **非接管类**（业务命令，如 `#DPS榜` / `#危战` / `#meta状态`）：回一条统一文本并返回 `true` —— 命令被本插件消费，
 *    命名空间保持稳定，用户能看懂"为什么没反应"而不是以为插件坏了；
 *  - **接管类**（`#胡桃攻略` / 帮助页，抢占 `-100000`）：`accept` 不认领，且 handler 顶部
 *    返回 `false` —— 框架语义是"handler 返回 false 就继续匹配后面的规则"（`loader.js` 的
 *    `if (res === false) continue`），于是消息**放行**给 `plugins/genshin`「米游社攻略」/ Atlas。
 *
 * ⚠ 两层都要做：框架的 `accept` 只影响"认领"（`if (res) break` 终止认领循环），
 *   **不会**跳过本插件自己的 `rule` 匹配；只改 `accept` 会变成"不认领但照样吃掉消息"。
 */
import { isModuleEnabled, moduleOffText, type ModuleKey } from '../components/config.js'

/** 模块是否已关闭（接管类用；纯判定，无 I/O） */
export function moduleOff (key: ModuleKey): boolean {
  return !isModuleEnabled(key)
}

/**
 * 非接管类的拦截：模块关闭时回统一文本并返回 `true`
 *
 * 用法：`if (await moduleGateReply('rank', e)) return true`
 */
export async function moduleGateReply (key: ModuleKey, e: YunzaiEvent): Promise<boolean> {
  if (isModuleEnabled(key)) return false
  try {
    await e.reply(moduleOffText(key))
  } catch (err) {
    logger?.warn?.(`[Meta] 模块关闭提示发送失败（${key}）：${(err as Error)?.message || err}`)
  }
  return true
}
