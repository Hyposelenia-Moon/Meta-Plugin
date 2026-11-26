/**
 * teamView — 榜单记录 → 模板视图行（合并自 `Mhydps-Plugin/modules/teamView.js`，行为逐字等价）
 *
 * DPS与危战榜共用的展示口径：成员头像/命座、金数三元组（总/限定/常驻）。
 * 头像只在本地已缓存时才给路径（模板据此决定渲染图片还是文字占位，避免裂图）。
 *
 * ⚠ 两级头像来源：`avatar` 是站点立绘（`out/avatar/<id>.webp`，需要联网下载）；
 *   站点图还没缓存时用 `faceSrc`（miao 本地头像 → Atlas 图标，绝对 `file://` 地址），
 *   两者都没有才落到模板的文字占位。`faceSrc` 只在 `avatar` 为空时才填，保证来源单选。
 */
import { findCharacter } from '../model/CharacterIndex.js'
import { hasAvatar } from '../model/AvatarStore.js'
import { characterFace } from '../model/IconResolver.js'
import { miaoFileUrl } from '../model/MiaoRes.js'
import type { TeamMember } from '../model/TeamStore.js'

/** 成员视图（`avatar` / `faceSrc` 都为空串表示本地没有任何头像） */
export interface MemberView {
  name: string
  constellation: number
  cText: string
  /** 站点立绘 id（`out/avatar/<id>.webp`） */
  avatar: string
  /** 本地兜底头像的绝对 `file://` 地址（站点立绘缺失时用） */
  faceSrc: string
  rarity: number
}

/**
 * 本地兜底头像：miao `imgs/face.webp` → Atlas 图标 → 空串
 *
 * miao 的 `rel` 相对 miao resources，要过 `miaoFileUrl()` 换成绝对地址；
 * Atlas 的 `rel` 本身就已经是 `file://`（`AtlasRes.icon()` 用 `pathToFileURL`）。
 */
export function localFaceUrl (name: string): string {
  const key = String(name ?? '').trim()
  if (!key) return ''
  try {
    const hit = characterFace(key)
    if (!hit) return ''
    return hit.source === 'atlas' ? hit.rel : (miaoFileUrl(hit.rel) || '')
  } catch {
    return ''
  }
}

/** 金数视图 */
export interface CostView {
  cost: number
  limitcost: number
  normalcost: number
  costText: string
}

/**
 * 成员列表 → 视图数组
 */
export function memberViews (members: TeamMember[] | undefined): MemberView[] {
  return (members || []).map(m => {
    const record = findCharacter(m.charId)
    const id = record?.character_id ? String(record.character_id) : ''
    const constellation = Number(m.constellation) || 0
    const avatar = id && hasAvatar(id) ? id : ''
    return {
      name: m.charId,
      constellation,
      cText: constellation > 0 ? `C${constellation}` : '',
      avatar,
      faceSrc: avatar ? '' : localFaceUrl(m.charId),
      rarity: record?.rarity || 4
    }
  })
}

/**
 * 金数三元组视图（站点口径：`cost = limitcost + normalcost`，实测全量成立）
 */
export function costView (team: { cost: number, limitcost: number, normalcost: number }): CostView {
  return {
    cost: team.cost,
    limitcost: team.limitcost,
    normalcost: team.normalcost,
    costText: `${team.cost}金`
  }
}

/**
 * 收集一批记录里出现过的角色立绘 id（用于渲染前批量补图）
 */
export function avatarIdsOf (teams: Array<{ members?: TeamMember[] }> | undefined): string[] {
  const ids = new Set<string>()
  for (const team of teams || []) {
    for (const m of team.members || []) {
      const record = findCharacter(m.charId)
      if (record?.character_id) ids.add(String(record.character_id))
    }
  }
  return [...ids]
}

/**
 * 标签视图：站点原始标签 + 未审核标记
 *
 * 绿玩 / 满级不在这里拼：模板按 `clean` / `lvl` 字段渲染成带配色的徽章，
 * 拼进来会与模板那份重复（同一行出现两个「满级」）。
 */
export function tagViews (team: { tags?: string[], confirm?: boolean }): string[] {
  const tags = [...(team.tags || [])]
  if (team.confirm === false) tags.unshift('未审核')
  return tags
}
