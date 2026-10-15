/**
 * AkashaBoard — 阿卡莎角色榜取数（v3 P5）
 *
 * 为什么走浏览器：站点在 Cloudflare 后面，**纯 HTTP 一律 403**，且**在页面里自己 `fetch` 也会 403** ——
 * 只有"页面自身发出的请求"才放行，所以复用 `AkashaBrowser.akashaBrowserTransport`
 * （导航到指定页面 → 捕获匹配路径的 XHR）。
 *
 * 角色 → 榜单 id 的换算（实测吻合）：阿卡莎的 `characterId` 就是官方角色 id
 * （我们 `resources/data/characters.json` 的 `character_id`，如 神里绫华 10000002、法尔伽 10000128），
 * 榜单默认 `calculationId = characterId × 100`（10000128 → 1000012800 ✓）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, pluginRoot } from '../dir.js'
import { getAkashaProxy, getAkashaTimeoutMs, isQueryNetworkEnabled, QUERY_NETWORK_OFF_HINT } from '../components/config.js'
import { akashaBrowserTransport } from './AkashaBrowser.js'
import { normalizeBoard, type BoardEntry, type Textmap } from '../modules/akashaBoard.js'

/** 官方角色 id 表（`name` / `alias` → `character_id`），首次使用时读一次 */
let charIndexCache: Map<string, number> | null = null

function charIndex (): Map<string, number> {
  if (charIndexCache) return charIndexCache
  const map = new Map<string, number>()
  for (const file of [path.join(dataDir, 'characters.json'), path.join(pluginRoot, 'resources', 'data', 'characters.json')]) {
    try {
      if (!fs.existsSync(file)) continue
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      const list = Array.isArray(raw) ? raw : (raw.data || raw.characters || [])
      for (const c of list as Array<Record<string, unknown>>) {
        const id = Number(c.character_id ?? c.characterId ?? c.id)
        if (!Number.isFinite(id)) continue
        for (const key of [c.name, ...(Array.isArray(c.alias) ? c.alias : [])]) {
          const k = String(key || '').trim().toLowerCase()
          if (k) map.set(k, id)
        }
      }
      break
    } catch { /* 换下一个候选路径 */ }
  }
  charIndexCache = map
  return map
}

/** 角色名（或官方 id）→ 官方角色 id；找不到返回 0 */
export function officialIdOf (charNameOrId: string | number): number {
  const direct = Number(charNameOrId)
  if (Number.isFinite(direct) && direct > 10000000) return direct
  const key = String(charNameOrId || '').trim().toLowerCase()
  return charIndex().get(key) || 0
}

/** 官方角色 id → 默认榜单 id（`characterId × 100`） */
export function calculationIdOf (officialId: number | string, variantDigit = ''): string {
  const id = Number(officialId)
  if (!Number.isFinite(id) || id <= 0) return ''
  const suffix = String(variantDigit || '').replace(/\D/g, '')
  return String(id) + '00' + suffix
}

/** 榜单条目接口 URL（页面自身就是这么调的） */
export function boardApiUrl (calculationId: string, size = 20): string {
  return `https://akasha.cv/api/leaderboards?sort=calculation.result&order=-1&size=${size}&page=1` +
    `&filter=&uids=&p=&fromId=&li=&calculationId=${calculationId}`
}

/** 榜单页面 URL（页面加载时会自己请求上面的接口） */
export function boardPageUrl (calculationId: string): string {
  return `https://akasha.cv/leaderboards/${calculationId}/`
}

/** 把要翻译的词拼成 textmap 请求（键是英文小写） */
export function textmapUrl (words: string[]): string {
  const uniq = [...new Set(words.map(w => String(w || '').trim().toLowerCase()).filter(Boolean))].slice(0, 60)
  // ⚠ 重复参数必须都叫 `words[]`：原实现拼成 `?words[]=a&?words[]=b`，第二个起参数名变成 `?words[]`，
  //   标准解析器只能取到第一个词，批量中文化会缺词（2026-10-15 四项目复核 P2）
  const query = uniq.map(w => `words[]=${encodeURIComponent(w)}`).join('&')
  return `https://akasha.cv/api/textmap/zh-CN${query ? `?${query}` : ''}`
}

export interface BoardFetchOk {
  ok: true
  calculationId: string
  entries: BoardEntry[]
  total: number
  textmap: Textmap | null
  attempts: number
}

export interface BoardFetchFail {
  ok: false
  /** 给用户看的中文原因 */
  error: string
  /** 是不是 CF 拦截（可以稍后重试） */
  blocked?: boolean
}

const isJson = (text: string): boolean => !!text && !/^\s*</.test(text)

/**
 * 取某角色的角色榜条目
 *
 * @param charNameOrId 角色名（本插件索引 / 本地 id 表）或官方角色 id
 * @param opts.rank     需要第几名（只用于后续 `pickByRank`，这里总是取前 size 条）
 */
export async function fetchBoard (
  charNameOrId: string | number,
  opts: { size?: number, attempts?: number } = {}
): Promise<BoardFetchOk | BoardFetchFail> {
  if (!isQueryNetworkEnabled()) {
    return { ok: false, error: `${QUERY_NETWORK_OFF_HINT}；阿卡莎榜单需要浏览器会话` }
  }
  const official = officialIdOf(charNameOrId)
  if (!official) return { ok: false, error: `取不到「${charNameOrId}」的角色 id（本地 id 表里没有）` }

  const calculationId = calculationIdOf(official)
  const proxy = getAkashaProxy()
  const url = boardApiUrl(calculationId, Math.max(1, Number(opts.size) || 20))
  const pageUrl = boardPageUrl(calculationId)
  const maxAttempts = Math.max(1, Number(opts.attempts) || 2)

  let lastText = ''
  let attempts = 0
  for (let i = 0; i < maxAttempts; i++) {
    attempts++
    try {
      const res = await akashaBrowserTransport(url, { pageUrl, proxy, timeoutMs: getAkashaTimeoutMs() })
      lastText = res.text || ''
      if (res.status === 200 && isJson(lastText)) {
        const payload = JSON.parse(lastText)
        const { entries, total } = normalizeBoard(payload, null)
        if (!total) return { ok: false, error: '这个角色榜暂时没有条目（可能该角色榜为空）' }

        // textmap：把我们需要的英文词交给站点同款接口翻译（翻不到就回落英文）
        let textmap: Textmap | null = null
        try {
          const words = entries.flatMap(e => [e.charName, e.weapon?.name || '', ...e.sets.map(s => s.name)]).filter(Boolean)
          const tm = await akashaBrowserTransport(textmapUrl(words), { pageUrl, proxy, timeoutMs: getAkashaTimeoutMs() })
          if (tm.status === 200 && isJson(tm.text)) textmap = JSON.parse(tm.text)
        } catch { /* 翻译失败不影响主流程 */ }

        const withCn = normalizeBoard(payload, textmap)
        return { ok: true, calculationId, entries: withCn.entries, total: withCn.total, textmap, attempts }
      }
    } catch (err) {
      lastText = String((err as Error)?.message || err)
    }
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 1500))
  }

  const blocked = /Just a moment|cf-|403|Attention Required/i.test(lastText) || !lastText
  return {
    ok: false,
    blocked,
    error: blocked
      ? '阿卡莎这次把人机验证挡住了（Cloudflare）：稍后再试，或先在浏览器里打开一次该角色的榜单页再回来'
      : `取阿卡莎榜单失败：${lastText.slice(0, 120) || '未知原因'}`
  }
}
