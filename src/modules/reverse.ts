/**
 * 反查：谁推荐了这把武器 / 哪些角色用了这组队友
 *
 * 实现要点：
 *   1. **先扫原始 `v2`**（纯字符串比对，131 个角色很快），只在命中时才做归一取档位词，
 *      避免"为了反查把全库都归一一遍"；
 *   2. 武器档位词用显示层的 `displayLabel`（自定义档位词优先，与出图同一口径）；
 *   3. 一切失败降级为空结果（调用方回「没查到」），不抛错。
 *
 * v1 范围：武器 / 配队（设计文档 §13.1 B11：圣遗物 / 专武 / 活动武器放 v2）。
 */
import type { CodexStore, Guide } from '../model/CodexStore.js'
import { displayLabel } from '../model/markup.js'

/** 某角色推荐了某武器的一条命中 */
export interface WeaponHit {
  character: string
  /** 档位显示词（推荐 / 可选 / 过渡 / 自定义词） */
  tier: string
  /** 行内同级的第几档（从 0 起） */
  rowIndex: number
}

/** 某角色的配队包含给定成员 */
export interface TeamHit {
  character: string
  /** 队伍标签（`推荐` / 自定义队名） */
  tag: string
  /** 队伍成员名 */
  members: string[]
}

/** 取出 v2 里某段的行数组（失败返回空数组） */
function rowsOf (guide: Guide | null, key: 'weapons' | 'artifacts' | 'teams'): Array<Record<string, unknown>> {
  const rows = guide?.v2?.[key]
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []
}

/** 条目的名字（v2 里是对象 `{name}`，兼容纯字符串写法） */
function itemName (item: unknown): string {
  if (item === null || item === undefined) return ''
  if (typeof item === 'object') return String((item as { name?: unknown }).name ?? '').trim()
  return String(item).trim()
}

/**
 * 查「谁推荐了这把武器」
 *
 * @param store 数据仓库
 * @param weapon 武器名（精确匹配；调用方若要用别名请先解析）
 * @returns 命中的角色列表（保持 `_order.json` 顺序）
 */
export function findWeaponRecommenders (store: CodexStore, weapon: string): WeaponHit[] {
  const target = String(weapon ?? '').trim()
  if (!target) return []

  const out: WeaponHit[] = []
  for (const character of store.listCharacters()) {
    const guide = store.getGuide(character)
    if (!guide) continue
    const rows = rowsOf(guide, 'weapons')
    for (const [rowIndex, row] of rows.entries()) {
      const items = Array.isArray(row.items) ? row.items : []
      const hit = items.some(item => itemName(item) === target)
      if (!hit) continue
      out.push({
        character,
        tier: displayLabel(row.label ?? '', row.tier) || String(row.label ?? ''),
        rowIndex
      })
    }
  }
  return out
}

/**
 * 查「哪些角色的配队同时包含这些成员」
 *
 * @param members 成员名（需已解析为标准名；空数组返回空结果）
 * @returns 命中的角色与队伍
 */
export function findTeamContainers (store: CodexStore, members: string[]): TeamHit[] {
  const wanted = (members ?? []).map(m => String(m ?? '').trim()).filter(Boolean)
  if (!wanted.length) return []

  const out: TeamHit[] = []
  for (const character of store.listCharacters()) {
    const guide = store.getGuide(character)
    if (!guide) continue
    for (const row of rowsOf(guide, 'teams')) {
      const list = Array.isArray(row.members) ? row.members : []
      const names = list.map(itemName).filter(Boolean)
      if (!names.length) continue
      if (!wanted.every(w => names.includes(w))) continue
      out.push({
        character,
        tag: displayLabel(row.label ?? '') || String(row.label ?? '').trim(),
        members: names
      })
    }
  }
  return out
}
