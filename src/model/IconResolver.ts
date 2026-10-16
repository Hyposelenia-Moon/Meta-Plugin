/**
 * 图标解析：**miao（必需依赖）→ Atlas（可选补充）→ 无图占位**
 *
 * 调用方（模板数据组装）只需要 `iconForRef()` / 各 `*Icon()`：拿到的是一段
 * **相对 miao resources 的路径**（模板用 `{{_miao_path}}<rel>` 拼），拿不到就返回 `null`，
 * 由模板渲染成纯文字（不出现破图）。
 *
 * 为什么按 `ref` 解析：攻略数据 v2 的每个条目都带 `ref`（`weapon:护摩之杖` /
 * `artifact:炽烈的炎之魔女` / `character:行秋` / `constellation:2` / `talent:A`），
 * 比"猜这一行的名字是武器还是圣遗物"可靠得多——Atlas 的 icons.js 也是这个思路。
 */
import { atlasRes } from './AtlasRes.js'
import { miaoFileUrl, miaoRes } from './MiaoRes.js'

export type IconSource = 'miao' | 'atlas'

export interface ResolvedIcon {
  /** 相对 miao resources 的路径（`source === 'atlas'` 时为 Atlas 给出的路径） */
  rel: string
  source: IconSource
}

function fromMiao (rel: string | null): ResolvedIcon | null {
  return rel ? { rel, source: 'miao' } : null
}

/** 先 miao，再 Atlas（Atlas 未提供导出时自动跳过），都没有 → null */
function resolveWith (miaoGetter: () => string | null, atlasKind: string, name: string): ResolvedIcon | null {
  try {
    const hit = fromMiao(miaoGetter())
    if (hit) return hit
  } catch (err) {
    logger?.warn?.(`[Meta] miao 图标解析异常：${(err as Error)?.message || err}`)
  }
  try {
    const alt = atlasRes.icon(atlasKind, name)
    if (alt) return { rel: alt.rel, source: 'atlas' }
  } catch (err) {
    logger?.warn?.(`[Meta] Atlas 图标解析异常：${(err as Error)?.message || err}`)
  }
  return null
}

/** 角色立绘（攻略页页头用；默认 `splash`） */
export function characterSplash (name: string, image: 'splash' | 'splash2' | 'card' = 'splash'): ResolvedIcon | null {
  return resolveWith(() => miaoRes.characterImage(name, image), 'character', name)
}

/** 角色头像（配队成员用 `face`） */
export function characterFace (name: string): ResolvedIcon | null {
  return resolveWith(() => miaoRes.characterImage(name, 'face'), 'character', name)
}

/** 武器图标 */
export function weaponIcon (name: string): ResolvedIcon | null {
  return resolveWith(() => miaoRes.weaponIcon(name), 'weapon', name)
}

/** 圣遗物套装图 */
export function artifactIcon (name: string, piece = 4): ResolvedIcon | null {
  return resolveWith(() => miaoRes.artifactIcon(name, piece), 'artifact', name)
}

/** 命座图标（需要角色名做上下文） */
export function consIcon (character: string, index: number): ResolvedIcon | null {
  return resolveWith(() => miaoRes.consIcon(character, index), 'constellation', `${character}:${index}`)
}

/**
 * 天赋图标（`A` / `E` / `Q`；需要角色名做上下文）
 *
 * miao 只有 18/128 的角色带 `icons/talent-*.webp`，其余靠 `data.json.talentCons`
 * 回落到命座图标（胡桃的 E/Q 就是这样）——回落逻辑在 `MiaoRes.talentIcon()` 里。
 */
export function talentIcon (character: string, letter: string): ResolvedIcon | null {
  return resolveWith(() => miaoRes.talentIcon(character, letter), 'talent', `${character}:${letter}`)
}

/** 角色天赋被动图标 */
export function passiveIcon (character: string, index: number): ResolvedIcon | null {
  return resolveWith(() => miaoRes.passiveIcon(character, index), 'passive', `${character}:${index}`)
}

/**
 * 按条目的 `ref` 解析图标
 *
 * 支持的 ref 前缀（v2 数据实测形态）：
 *   `weapon:<名>`        → 武器图标
 *   `artifact:<名>`      → 圣遗物套装图
 *   `character:<名>`     → 角色头像（`face`）
 *   `constellation:<n>`  → 命座图标（需 `ctx.character`）
 *   `talent:A|E|Q`       → 暂不解析（miao 目录里没有对应文件），返回 null
 *
 * @param ref 条目引用（`weapon:护摩之杖`）
 * @param ctx 上下文（命座需要 `character`）
 */
export function iconForRef (ref: string, ctx: { character?: string } = {}): ResolvedIcon | null {
  const text = String(ref ?? '').trim()
  if (!text) return null

  const m = text.match(/^([a-zA-Z]+)\s*[:：]\s*(.+)$/)
  if (!m) return null
  const kind = m[1].toLowerCase()
  const name = m[2].trim()
  if (!name) return null

  switch (kind) {
    case 'weapon':
      return weaponIcon(name)
    case 'artifact':
      return artifactIcon(name)
    case 'character':
      return characterFace(name)
    case 'constellation': {
      const character = String(ctx.character ?? '').trim()
      if (!character) return null
      const n = Number(name)
      return Number.isInteger(n) ? consIcon(character, n) : null
    }
    case 'talent': {
      const character = String(ctx.character ?? '').trim()
      if (!character) return null
      return /^[aeqAEQ]$/.test(name) ? talentIcon(character, name) : null
    }
    default:
      return null
  }
}
/**
 * 普攻（A）槽的**通用武器图标**
 *
 * 面板里 A 槽按角色武器类型取 `common/item/atk-{sword|claymore|polearm|bow|catalyst}.webp`：
 * `data.json.talentCons.a` 为 0 的角色没有命座图标可回落，`icons/talent-a.webp` 又几乎不存在。
 */
export function attackIcon (character: string): ResolvedIcon | null {
  const data = miaoRes.characterData(character) as { weapon?: unknown } | null
  const type = String(data?.weapon ?? '').trim()
  if (!/^(sword|claymore|polearm|bow|catalyst)$/.test(type)) return null
  const rel = `common/item/atk-${type}.webp`
  return resolveWith(() => (miaoFileUrl(rel) ? rel : null), 'weapon', type)
}