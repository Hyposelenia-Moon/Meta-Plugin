/**
 * 命令参数解析与视图收窄
 *
 * 覆盖三种入口形态（设计文档 §5.4）：
 *   1. 后缀式：`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`
 *   2. 前缀式：`#攻略 <角色> [模块|档位]`
 *   3. 反查式：`#攻略 武器 <武器名>` / `#攻略 配队 <角色…>`（v1 只做这两个，§13.1 B11）
 *
 * 歧义怎么定：`武器`/`圣遗物`/`配队` 既是**模块名**又是**反查头部**，所以先拿头词去解析角色——
 * 能解析成角色（`#攻略 胡桃 武器`）就是"角色 + 模块"；解析不了（`#攻略 武器 护摩之杖`）才当反查。
 */
import {
  CODEX_ARG_RULE,
  CODEX_GUIDE_RULE,
  CODEX_SUFFIX_RULE,
  TIER_WORDS,
  type TierWord
} from '../components/constants.js'
import { SUB_VIEW_TITLES, type CodexView, type SubViewTitle } from './subViews.js'

/** 反查头部关键词（v1 只实现这两个） */
export const REVERSE_HEADS = ['武器', '配队'] as const

export interface SuffixQuery {
  /** 原始写法（未解析成标准名） */
  character: string
  /** `#胡桃攻略2` 里的套数；`1`/缺省为 null（我们只有一套，页面会注明「仅一套」） */
  setIndex: number | null
}

/**
 * 解析后缀式
 *
 * `#胡桃攻略` / `#胡桃攻略2` / `#更新胡桃攻略` / `#胡桃指南` / `#更新胡桃指南`
 * @returns 解析不出（或只有「攻略」二字）时返回 null
 */
export function parseSuffixQuery (msg: string): SuffixQuery | null {
  const text = String(msg ?? '').trim()
  if (!text.startsWith('#')) return null

  if (CODEX_GUIDE_RULE.test(text)) {
    const name = text.slice(1).replace(/^更新/, '').replace(/指南$/, '').trim()
    return name ? { character: name, setIndex: null } : null
  }

  if (!CODEX_SUFFIX_RULE.test(text)) return null
  const body = text.slice(1).replace(/^更新/, '')
  const hit = body.match(/^(.*?)攻略(\d)?$/)
  if (!hit) return null
  const name = hit[1].trim()
  if (!name) return null
  const setIndex = hit[2] ? Number(hit[2]) : null
  return { character: name, setIndex }
}

export type ArgKind = 'character' | 'reverseWeapon' | 'reverseTeam' | 'list' | 'status' | 'unknown'

export interface ArgQuery {
  kind: ArgKind
  /** 头部词（原样） */
  head: string
  /** 头部之后的所有词 */
  rest: string[]
  /** `kind === 'character'`：解析后的标准角色名 */
  character?: string
  /** `kind === 'character'`：模块（武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队） */
  module?: SubViewTitle
  /** `kind === 'character'`：档位（推荐 / 可选 / 过渡） */
  tier?: TierWord
  /** `kind === 'reverseWeapon'`：武器名（可含空格） */
  weapon?: string
  /** `kind === 'reverseTeam'`：成员名（已尽力解析成标准名） */
  members?: string[]
  /** 未能解析成角色的词（调用方据此提示） */
  unresolved?: string[]
}

/**
 * 解析前缀式 `#攻略 …`
 *
 * @param msg 原始消息
 * @param resolve 角色名解析器（通常传 `resolveCharacter(store, …)`）
 */
export function parseArgQuery (msg: string, resolve: (keyword: string) => string | null): ArgQuery {
  const hit = String(msg ?? '').trim().match(CODEX_ARG_RULE)
  const tokens = (hit?.[1] ?? '').trim().split(/\s+/).filter(Boolean)
  const head = tokens[0] ?? ''
  const rest = tokens.slice(1)

  if (head === '列表') return { kind: 'list', head, rest }
  if (head === '状态') return { kind: 'status', head, rest }

  const asCharacter = resolve(head)
  if (asCharacter) {
    const query: ArgQuery = { kind: 'character', head, rest, character: asCharacter }
    for (const token of rest) {
      if (!query.module && (SUB_VIEW_TITLES as readonly string[]).includes(token)) {
        query.module = token as SubViewTitle
      } else if (!query.tier && (TIER_WORDS as readonly string[]).includes(token)) {
        query.tier = token as TierWord
      }
    }
    return query
  }

  if (head === '武器') {
    return { kind: 'reverseWeapon', head, rest, weapon: rest.join('').trim() }
  }

  if (head === '配队') {
    const members: string[] = []
    const unresolved: string[] = []
    for (const token of rest) {
      const name = resolve(token)
      if (name) members.push(name)
      else {
        members.push(token)
        unresolved.push(token)
      }
    }
    return { kind: 'reverseTeam', head, rest, members, unresolved }
  }

  return { kind: 'unknown', head, rest }
}

/** 视图收窄：按模块与档位过滤（`#攻略 胡桃 武器` / `#攻略 胡桃 过渡`） */
export function filterView (view: CodexView, opts: { module?: SubViewTitle, tier?: TierWord }): CodexView {
  let sections = view.sections

  if (opts.module) sections = sections.filter(section => section.title === opts.module)

  if (opts.tier) {
    const tier = opts.tier
    sections = sections
      .map(section => {
        // 配队的档位挂在队伍标签（tag）上，与行的 label 对称处理
        if (section.kind === 'teams') {
          const teams = (section.teams ?? []).filter(team => String(team.tag ?? '').trim() === tier)
          return { ...section, teams, empty: teams.length === 0 }
        }
        const rows = (section.rows ?? []).filter(row => String(row.label ?? '').trim() === tier)
        return { ...section, rows, empty: rows.length === 0 }
      })
      .filter(section => (section.kind === 'teams')
        ? (section.teams?.length ?? 0) > 0
        : (section.rows?.length ?? 0) > 0)
  }

  return { ...view, sections }
}

/** 收窄后是否已无内容（调用方据此回「该档位暂无」而不是出空图） */
export function isViewEmpty (view: CodexView): boolean {
  return view.sections.length === 0 ||
    view.sections.every(section => (section.kind === 'teams')
      ? !(section.teams ?? []).some(team => (team.members ?? []).length || team.text)
      : (section.rows ?? []).every(row => !(row.items ?? []).some(item => String(item.text ?? '').trim())))
}
