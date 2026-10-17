/**
 * MiaoPanel — 定位本机的 miao-plugin 目录（**唯一职责**）
 *
 * miao-plugin 是**必需依赖**（面板 / 立绘 / 图标都来自它），而它可能被装成别的目录名
 * （阿修 fork / 自定义部署），所以定位按"能力判定"兜底扫描 `plugins/*`。
 * `#练度查询` 的面板取数在 `model/MiaoProfile.ts`，只需要这里的目录定位。
 */
import fs from 'node:fs'
import path from 'node:path'
import { botRoot } from '../dir.js'
import { loadConfig } from '../components/config.js'

/**
 * 目录"像不像 miao-plugin"（能力判定，不看目录名）
 *
 * `models/index.js` 是导入入口；再要一个 miao 特有的资源/应用目录，避免误判其它插件。
 */
function looksLikeMiao (dir: string): boolean {
  return fs.existsSync(path.join(dir, 'models', 'index.js')) &&
    (fs.existsSync(path.join(dir, 'resources', 'meta-gs')) ||
     fs.existsSync(path.join(dir, 'apps', 'profile')))
}

/** `plugins/*` 里所有目录（扫描用；读不到就返回空数组） */
function pluginDirs (): string[] {
  const base = path.join(botRoot, 'plugins')
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(base, d.name))
  } catch {
    return []
  }
}

/**
 * 本机 miao-plugin 目录（可用 `META_MIAO_PLUGIN` 环境变量或配置 `miaoPluginDir` 覆盖）
 *
 * ⚠ 修正（2026-10-14）：`dir.ts` 的 `botRoot` 是 **bot 根**（如 `D:\...\Yunzai`），
 *   不是 `<bot>/plugins` —— 原实现少拼了一层 `plugins`，于是永远找不到 miao。
 *   另外阿修 fork 版可能装成别的目录名，所以最后**扫描 `plugins/*` 做能力判定**兜底。
 */
export function miaoPluginDir (): string {
  const cfg = loadConfig() as unknown as { miaoPluginDir?: unknown }
  const candidates: string[] = [
    String(process.env.META_MIAO_PLUGIN || ''),
    String(cfg.miaoPluginDir || '').trim(),
    path.join(botRoot, 'plugins', 'miao-plugin'),
    path.join(botRoot, 'miao-plugin')
  ]
  for (const p of candidates) {
    if (!p) continue
    const dir = path.resolve(p)
    if (looksLikeMiao(dir)) return dir
  }
  // 兜底：目录名被改过（fork / 自定义）时按能力找
  for (const dir of pluginDirs()) {
    const name = path.basename(dir).toLowerCase()
    if (name.includes('meta') || name.includes('atlas') || name.includes('mhydps')) continue
    if (looksLikeMiao(dir)) return dir
  }
  return ''
}
