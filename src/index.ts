/**
 * 插件入口（编译为 `lib/index.js`，由根目录 `index.js` 转交加载）
 *
 * 顺序：**配置初始化 → 启动编排（只读磁盘、不发网络）→ 加载 apps/**
 * apps 的加载方式与 Atlas-Plugin / Mhydps-Plugin 一致：`readdir` + `Promise.allSettled`，
 * 每个 app 文件导出一个 `class extends plugin`，这里收集成 `apps` 后统一导出。
 *
 * ⚠ 动态 import 的路径是相对**本文件运行时刻的位置**（`lib/index.js`）→ `./apps/x.js` 指向 `lib/apps/x.js`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { libDir, pluginRoot } from './dir.js'
import { ensureConfigFile } from './components/config.js'
import { initStore } from './model/startup.js'

ensureConfigFile()

logger?.info('----Meta-Plugin----')
logger?.info(`[Meta] 插件根：${pluginRoot}`)

// 只载入磁盘数据，不发网络（网络请求交给查询时的惰性刷新与主人指令）
await initStore()

const appsDir = path.join(libDir, 'apps')
const files = fs.existsSync(appsDir) ? fs.readdirSync(appsDir).filter(f => f.endsWith('.js')) : []
if (!files.length) logger?.warn('[Meta] 没有可加载的 apps（目录不存在或为空）')

const loaded = await Promise.allSettled(files.map(f => import(`./apps/${f}`)))

const apps: Record<string, unknown> = {}
for (let i = 0; i < files.length; i++) {
  const name = files[i].replace(/\.js$/, '')
  const r = loaded[i]
  if (r.status === 'fulfilled') {
    const mod = r.value as Record<string, unknown>
    apps[name] = mod[Object.keys(mod)[0]]
    logger?.info(`[Meta] 载入: ${name}`)
  } else {
    logger?.error(`[Meta] 载入失败: ${name}`, r.reason)
  }
}

logger?.info('[Meta] 载入完成')
logger?.info('----Meta-Plugin----')

export { apps }
