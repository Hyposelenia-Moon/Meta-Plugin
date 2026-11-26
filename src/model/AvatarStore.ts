/**
 * AvatarStore — 角色立绘缓存（合并自 `Mhydps-Plugin/model/AvatarStore.js`）
 *
 * 站点自托管角色立绘：`https://www.mhydps.cn/charactor/<character_id>.webp`（实测约 30 KB/张）。
 * 渲染成图时浏览器只在本地找图，所以这里负责把用到的立绘按需抓到 **`out/avatar/`** 下。
 * 抓不到不影响功能：模板在 `avatar` 为空时渲染文字占位，不会出现裂图。
 *
 * ⚠ 缓存目录改到 `out/`（未跟踪）：合并前写的是 Mhydps 自己的 `data/`（它 gitignore 了），
 *   而本仓库的 `data/` 是**入库的攻略数据**，运行时往里写会挡住 bot 侧 `#更新`（设计文档 §13.1 B14）。
 *   目录本身仍从 `TeamStore.dataDir` 派生，故 `META_DATA_DIR` 一样能重定向（套件用）。
 *
 * ⚠ 联网总开关：`networkEnabled` 关闭时**直接跳过下载**（返回统计里 `downloaded`/`failed`
 *   都是 0），原因记进 `avatarFillStatus()` 由 `#meta状态` 写出；页面侧则改用本地兜底头像
 *   （`modules/teamView.ts` 的 `faceSrc`），所以关着联网也能看到脸。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getDpsTimeoutMs, isQueryNetworkEnabled } from '../components/config.js'
import { AVATAR_DIR, avatarUrl } from '../components/constants.js'
import { downloadTo } from './MhydpsClient.js'
import { dataDir } from './TeamStore.js'

/** 立绘缓存目录（`out/avatar/`；受 `META_DATA_DIR` 影响） */
export const avatarDir = path.join(dataDir, AVATAR_DIR)

/** 下载选项 */
export interface AvatarOptions {
  /** 代理地址，默认读配置 */
  proxy?: string
  /** 单张超时（毫秒），默认读配置 */
  timeoutMs?: number
  /** 并发下载数，默认 4（夹取到 1~8） */
  concurrency?: number
}

/** 缓存统计 */
export interface AvatarStats {
  total: number
  cached: number
  downloaded: number
  failed: number
}

/**
 * 最近一次补图的结果（给 `#meta状态` 用）
 *
 * 为什么要记：补图失败的默认表现是"页面只是没有头像"，看不出是没联网、
 * 站点挂了还是写盘失败 —— 状态页要把这一次的原因显式写出来（不静默）。
 */
export interface AvatarFillStatus {
  /** 记录时间（毫秒） */
  at: number
  total: number
  cached: number
  downloaded: number
  failed: number
  /**
   * `network-off` 联网开关关闭、`all-cached` 一张不缺、`done` 跑过一轮、`no-targets` 没有要补的 id
   */
  reason: 'network-off' | 'all-cached' | 'done' | 'no-targets'
  /** 首条失败原因（`<id>: <message>`，成功时为空串） */
  error: string
}

/** 最近一次补图状态（进程内） */
let lastFill: AvatarFillStatus | null = null

/** 读取最近一次补图状态（从未补过图时为 null） */
export function avatarFillStatus (): AvatarFillStatus | null {
  return lastFill
}

/** 单张立绘路径 */
export function avatarFile (id: string | number): string {
  return path.join(avatarDir, `${String(id)}.webp`)
}

/** 是否已缓存（文件存在且非空） */
export function hasAvatar (id: string | number): boolean {
  try {
    const p = avatarFile(id)
    return fs.existsSync(p) && fs.statSync(p).size > 0
  } catch {
    return false
  }
}

/** 已缓存的立绘 id 集合 */
export function cachedIds (): Set<string> {
  try {
    return new Set(
      fs.readdirSync(avatarDir)
        .filter(f => f.endsWith('.webp'))
        .map(f => f.replace(/\.webp$/, ''))
    )
  } catch {
    return new Set()
  }
}

/**
 * 缓存统计
 *
 * @param ids 关心的 id 列表；不传则统计全部已缓存数量
 */
export function avatarStats (ids?: Array<string | number>): { total: number, cached: number } {
  if (!Array.isArray(ids)) {
    const n = cachedIds().size
    return { total: n, cached: n }
  }
  const uniq = [...new Set(ids.map(String).filter(Boolean))]
  return { total: uniq.length, cached: uniq.filter(id => hasAvatar(id)).length }
}

/**
 * 确保这些立绘已缓存（缺哪张抓哪张）
 *
 * @param ids `character_id` 列表
 * @param opts 代理 / 超时 / 并发（默认 4，夹取 1~8）
 */
export async function ensureAvatars (
  ids: Array<string | number> | undefined,
  opts: AvatarOptions = {}
): Promise<AvatarStats> {
  const uniq = [...new Set((ids || []).map(String).filter(Boolean))]
  const concurrency = Math.max(1, Math.min(8, opts.concurrency || 4))
  const timeoutMs = opts.timeoutMs || getDpsTimeoutMs()

  const record = (stat: AvatarStats, reason: AvatarFillStatus['reason'], error = ''): AvatarStats => {
    lastFill = { at: Date.now(), ...stat, reason, error }
    return stat
  }

  if (!uniq.length) return record({ total: 0, cached: 0, downloaded: 0, failed: 0 }, 'no-targets')

  // 业务查询联网关闭：不下载、不报错（页面退化成没有头像）；榜单头像属查询类资源，受该开关管辖
  if (!isQueryNetworkEnabled()) {
    logger?.debug?.('[Meta] 联网已关闭，跳过立绘下载（榜单页将不含头像）')
    const stat = { total: uniq.length, cached: uniq.filter(id => hasAvatar(id)).length, downloaded: 0, failed: 0 }
    return record(stat, 'network-off')
  }

  let downloaded = 0
  let failed = 0
  let firstError = ''
  const queue = uniq.filter(id => !hasAvatar(id))
  if (!queue.length) {
    const stat = { total: uniq.length, cached: uniq.length, downloaded: 0, failed: 0 }
    return record(stat, 'all-cached')
  }

  const worker = async (): Promise<void> => {
    while (queue.length) {
      const id = queue.shift() as string
      try {
        await downloadTo(avatarUrl(id), avatarFile(id), { proxy: opts.proxy, timeoutMs })
        downloaded++
      } catch (err) {
        failed++
        const message = (err as Error)?.message || String(err)
        if (!firstError) firstError = `${id}: ${message}`
        logger?.debug?.(`[Meta] 立绘下载失败 ${id}: ${message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))

  const stat = { total: uniq.length, cached: uniq.filter(id => hasAvatar(id)).length, downloaded, failed }
  // 失败不再只进 debug：留一条 warn（一次补图只报一条，附带首条原因），状态页也能看到
  if (failed) {
    logger?.warn?.(`[Meta] 立绘补图失败 ${failed}/${stat.downloaded + failed} 张，首条：${firstError}`)
  }
  return record(stat, 'done', firstError)
}

/** 清空立绘缓存（测试用） */
export function resetAvatars (): void {
  lastFill = null
  try {
    fs.rmSync(avatarDir, { recursive: true, force: true })
  } catch { /* 目录不存在时忽略 */ }
}
