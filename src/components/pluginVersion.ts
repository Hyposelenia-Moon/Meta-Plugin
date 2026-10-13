/**
 * pluginVersion — 版本信息（合并自 `Mhydps-Plugin/components/pluginVersion.js`）
 *
 * 状态页与页脚要显示「本插件版本 + 框架版本」，两个都从各自的 `package.json` 读；
 * 读不到就回落 `unknown`（开发工作区里插件不在 bot 的 `plugins/` 下，框架那份通常读不到）。
 *
 * ⚠ 路径全部取自 `dir.ts`：合并前是按 `components/` 的相对深度自己上溯
 *   （`lib/components/` 比 JS 插件多一层，照抄会读成 `<bot>/plugins/package.json`）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { botRoot, pluginRoot } from '../dir.js'
import { PLUGIN_SIGN } from './constants.js'

/** 读一个 `package.json` 的字段，失败返回空串 */
function readField (dir: string, field: string): string {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
    return json?.[field] ? String(json[field]) : ''
  } catch {
    return ''
  }
}

/** 本插件版本（插件根 `package.json` 的 `version`） */
export const pluginVersion = readField(pluginRoot, 'version') || 'unknown'

/** 框架版本（bot 根 `package.json` 的 `version`） */
export const yunzaiVersion = readField(botRoot, 'version') || 'unknown'

/** 页脚统一文案 */
export const versionText = `Created By Yz-Bot ${yunzaiVersion} & ${PLUGIN_SIGN} ${pluginVersion}`
