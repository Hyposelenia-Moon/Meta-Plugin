/**
 * `respond` — 统一的「出图，失败回退文本」回复（合并自 `Mhydps-Plugin/modules/respond.js`）
 *
 * 出图链路（框架 puppeteer 后端）在没装浏览器、渲染超时等情况下会失败；
 * 把 try/catch 与回退收敛到一处，apps 层只管准备数据。
 *
 * 与攻略页的回退是同一套语义（`apps/codex.ts` 里 `renderPage` 返回 false 就发文本），
 * 这里保持 Mhydps 的**返回值约定**：恒为 `true`（消息已被消费），便于 app 直接 `return await respond(...)`。
 */
import { renderDps } from '../components/render.js'

/** 文本回退：允许传函数以延迟求值（数据准备失败时挺有用） */
export type FallbackText = string | (() => string)

/**
 * 结果是不是"一条都没命中"
 *
 * 只看**列表型数据**（`rows` / `tiers`），不看 `total` —— 练度页的 `total` 是分数（0 分也算有效页面）。
 * 判定顺序：`rows` 优先（榜单页），否则看 `tiers`（档位页：无档位，或每档都没行）。
 */
export function isEmptyResult (data: Record<string, unknown>): boolean {
  const rows = (data as { rows?: unknown }).rows
  if (Array.isArray(rows)) return rows.length === 0
  const tiers = (data as { tiers?: unknown }).tiers
  if (Array.isArray(tiers)) {
    if (!tiers.length) return true
    return tiers.every(t => {
      const r = (t as { rows?: unknown })?.rows
      return Array.isArray(r) && r.length === 0
    })
  }
  return false
}

/**
 * 渲染并回复；**0 命中直接走文本**，渲染失败也发文本
 *
 * 为什么 0 命中不出图（2026-10-15 用户反馈）：空图只有一句"没有查询到…"，
 * 看不出是**筛选**把结果筛没了（当时 `#dps 七七 48金 视频1` 里的 `视频1` 被当成"标签"筛选 →
 * 命中 0 → 弹出一张莫名其妙的空图）。文本回退里带着筛选条件与命中数，信息更全。
 *
 * @param e 消息事件
 * @param tpl 模板名（`resources/dps/<tpl>.html`）
 * @param data 模板数据
 * @param fallback 文本回退内容
 * @returns 恒为 `true`（已消费消息）
 */
export async function respond (
  e: YunzaiEvent,
  tpl: string,
  data: Record<string, unknown> = {},
  fallback: FallbackText = ''
): Promise<boolean> {
  const text = (): string => (typeof fallback === 'function' ? fallback() : String(fallback ?? ''))

  if (isEmptyResult(data)) {
    logger?.mark?.(`[Meta] 模板 ${tpl} 命中 0 条，改用文本回退`)
    await e.reply(text())
    return true
  }

  try {
    const img = await renderDps(tpl, data)
    if (img) {
      await e.reply(img)
      return true
    }
    logger?.warn?.(`[Meta] 模板 ${tpl} 渲染结果为空，改用文本回退`)
  } catch (err) {
    logger?.error?.(`[Meta] 模板 ${tpl} 渲染失败：${(err as Error)?.message || String(err)}`)
  }

  await e.reply(text())
  return true
}

/**
 * 候选提示行（角色 / 首领没找到时给出相近项）
 *
 * @param suggestions 相近项
 * @returns 形如 `\n你是不是想找：胡桃、行秋`；没有候选时返回空串
 */
export function suggestLine (suggestions?: string[]): string {
  if (!Array.isArray(suggestions) || !suggestions.length) return ''
  return `\n你是不是想找：${suggestions.join('、')}`
}
