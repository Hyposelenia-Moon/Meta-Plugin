/**
 * queryArgs — 命令参数解析（合并自 `Mhydps-Plugin/modules/queryArgs.js`，行为逐字等价）
 *
 * 两种写法都支持，方便群友随手打：
 *   显式键值：`#DPS 角色:胡桃 金:12 标签:宏 页:2 绿玩 主C`
 *   位置简写：`#DPS 胡桃 12金 宏 -p2`
 * 解析只做语法层的事（哪个 token 是什么），角色名/首领名的合法性由查询层校验
 * （唯一例外：位置简写里要靠 `findCharacter` / `findBoss` 判断"这个 token 像不像角色/首领"）。
 */
import { findBoss, findCharacter } from '../model/CharacterIndex.js'

/** 页码：第2页 / 2页 / 页2 / p2 / -p2（`页2` 是帮助与命令文案里的写法，2026-10-27 补齐） */
const PAGE_RE = /^(?:第)?(\d+)页$|^页(\d+)$|^[pP](\d+)$|^-p(\d+)$/
/** 金数上限：金≤12 / ≤12 / 金12 / 12金 */
const COST_MAX_RE = /^(?:金|成本)?\s*[≤<=]\s*(\d+)$|^(?:金|成本)(\d+)$|^(\d+)金$/
/** 金数下限：金≥8 / ≥8 */
const COST_MIN_RE = /^(?:金|成本)?\s*[≥>=]\s*(\d+)$/
/** 金数区间：8-12金 / 金8-12 */
const COST_RANGE_RE = /^(?:金|成本)?(\d+)\s*[-~到]\s*(\d+)\s*金?$/
/** 显式键值 */
const KV_RE = /^(角色|名称|name|金|成本|cost|标签|tag|页|page|版本|ver|首领|boss)[:：](.+)$/i

/** 通用 token 解析结果（命中哪个字段就带哪个） */
export interface CommonArgs {
  page?: number
  costMin?: number
  costMax?: number
  cleanOnly?: boolean
  mainOnly?: boolean
}

/** DPS参数 */
export interface RankArgs {
  char: string
  /** 总榜模式（`总榜`）：不按金档分组，直接按伤害平铺（2026-10-27） */
  all: boolean
  costMin: number | null
  costMax: number | null
  /** **显式** `标签:X` 的值（原样筛选，不放宽） */
  tag: string
  /** 标签是不是**显式**写的（`标签:X`）；裸词才与数据集核对，见 `rankQuery.resolveTags()` */
  tagExplicit?: boolean
  /** 角色名之后的**裸词**（与 `tag` 分开存） */
  tagBare?: string
  cleanOnly: boolean
  mainOnly: boolean
  page: number
  unknown: string[]
}

/** 危战榜参数（多出 版本 / 首领 / 档位） */
export interface RaidArgs {
  char: string
  ver: string
  boss: string
  /** 危战档位（用户 2026-10-15 定：`#危战 矮灵 n6` / `n7`；不写则 app 层提示选档） */
  tier: 'n6' | 'n7' | null
  costMin: number | null
  costMax: number | null
  page: number
  unknown: string[]
}

/** 取三个分组里第一个有值的数字 */
function pickNum (m: RegExpMatchArray, ...groups: number[]): number {
  for (const g of groups) {
    if (m[g] !== undefined) return Number(m[g])
  }
  return NaN
}

/**
 * 位置简写里“角色名 + 金数”贴在一起：`薇斯纳4金` / `胡桃8-12金` / `胡桃金12`
 *
 * 只在前缀确实能解析成正式角色名时才拆；否则原样留给后面的裸词/标签逻辑，
 * 避免把 `总榜4金` 之类的普通词误当角色。
 */
function splitAttachedCost (token: string): { char: string, costMin?: number, costMax?: number } | null {
  const range = token.match(/^(.+?)(\d+)\s*[-~到]\s*(\d+)\s*金$/)
  if (range) {
    const char = range[1].trim()
    if (char && findCharacter(char)) return { char, costMin: Number(range[2]), costMax: Number(range[3]) }
  }
  const max = token.match(/^(.+?)(\d+)\s*金$/)
  if (max) {
    const char = max[1].trim()
    if (char && findCharacter(char)) return { char, costMax: Number(max[2]) }
  }
  const maxWithPrefix = token.match(/^(.+?)(?:金|成本)(\d+)$/)
  if (maxWithPrefix) {
    const char = maxWithPrefix[1].trim()
    if (char && findCharacter(char)) return { char, costMax: Number(maxWithPrefix[2]) }
  }
  return null
}

/** 解析通用 token（页码 / 金数 / 绿玩 / 主C），命中返回结果对象，未命中返回 null */
export function parseCommon (token: string): CommonArgs | null {
  let m: RegExpMatchArray | null
  if ((m = token.match(PAGE_RE))) {
    const page = Number(m[1] ?? m[2] ?? m[3] ?? m[4])
    return Number.isFinite(page) ? { page } : null
  }
  if ((m = token.match(COST_RANGE_RE))) {
    return { costMin: Number(m[1]), costMax: Number(m[2]) }
  }
  if ((m = token.match(COST_MAX_RE))) {
    return { costMax: pickNum(m, 1, 2, 3) }
  }
  if ((m = token.match(COST_MIN_RE))) {
    return { costMin: Number(m[1]) }
  }
  if (/^(绿玩|纯净)$/.test(token)) return { cleanOnly: true }
  if (/^(主C|主c|主C位|只搜主C)$/.test(token)) return { mainOnly: true }
  return null
}

/** 归一化 token：全角冒号/空格、中英文逗号顿号、大小写 */
function tokenize (text: unknown): string[] {
  return String(text || '')
    .replace(/：/g, ':')
    .split(/[\s,，、]+/)
    .map(t => t.trim())
    .filter(Boolean)
}

/**
 * 解析 DPS参数
 *
 * @param text 去掉命令前缀后的参数部分
 */
export function parseRankArgs (text: unknown): RankArgs {
  const args: RankArgs = {
    char: '',
    all: false,
    costMin: null,
    costMax: null,
    tag: '',
    tagBare: '',
    cleanOnly: false,
    mainOnly: false,
    page: 1,
    unknown: []
  }

  for (const token of tokenize(text)) {
    const kv = token.match(KV_RE)
    if (kv) {
      const key = kv[1].toLowerCase()
      const value = kv[2].trim()
      if (['角色', '名称', 'name'].includes(key)) args.char = value
      else if (['金', '成本', 'cost'].includes(key)) args.costMax = Number(value.replace(/[^\d]/g, '')) || null
      else if (['标签', 'tag'].includes(key)) { args.tag = value; args.tagExplicit = true }
      else if (['页', 'page'].includes(key)) args.page = Number(value.replace(/[^\d]/g, '')) || 1
      continue
    }

    const common = parseCommon(token)
    if (common) {
      Object.assign(args, common)
      continue
    }

    // `薇斯纳4金`：角色名和金数贴在一起时也要拆开（2026-10-30 现场）
    const attached = splitAttachedCost(token)
    if (attached && !args.char) {
      args.char = attached.char
      if (attached.costMin !== undefined) args.costMin = attached.costMin
      if (attached.costMax !== undefined) args.costMax = attached.costMax
      continue
    }

    // 总榜模式（2026-10-27）：`#DPS 总榜` / `#DPS 总榜 12金` / `#DPS 总榜 胡桃`
    if (/^(?:总榜|全部榜单)$/.test(token)) {
      args.all = true
      continue
    }

    /*
     * 剩余 token：第一个当角色名，其余当**裸词**（常含点号/字母，如 总伤杯S3.N）
     *
     * ⚠ 裸词与显式 `标签:X` **分开存**（2026-10-15 审核意见 2.3/2.4）：引号 / 粘贴机器人上一条回复时，
     *    那段文字会跟着进 `e.msg`；两类来源的可信度不同 —— 显式条件原样筛选（不放宽），
     *    裸词先与数据集核对（不可核实时不参与筛选）。最终由 `rankQuery.resolveTags()` 统一解析。
     */
    if (!args.char && findCharacter(token)) args.char = token
    else if (!args.char) args.unknown.push(token)
    else args.tagBare = args.tagBare ? `${args.tagBare} ${token}` : token
  }

  return args
}

/**
 * 解析危战榜参数（多出 版本 / 首领 / 档位 三个维度）
 *
 * 档位写法：`#危战 矮灵 n7` / `#危战 7.1 n6`（`n6` 与 `n7` 大小写与位置都随意）
 */
export function parseRaidArgs (text: unknown): RaidArgs {
  const args: RaidArgs = {
    char: '',
    ver: '',
    boss: '',
    tier: null,
    costMin: null,
    costMax: null,
    page: 1,
    unknown: []
  }

  for (const token of tokenize(text)) {
    const kv = token.match(KV_RE)
    if (kv) {
      const key = kv[1].toLowerCase()
      const value = kv[2].trim()
      if (['角色', '名称', 'name'].includes(key)) args.char = value
      else if (['版本', 'ver'].includes(key)) args.ver = value
      else if (['首领', 'boss'].includes(key)) args.boss = value
      else if (['金', '成本', 'cost'].includes(key)) args.costMax = Number(value.replace(/[^\d]/g, '')) || null
      else if (['页', 'page'].includes(key)) args.page = Number(value.replace(/[^\d]/g, '')) || 1
      continue
    }

    const common = parseCommon(token)
    if (common) {
      Object.assign(args, common)
      continue
    }

    /*
     * 危战档位：`n6` / `n7`（也接受 `N6` / `6档` / `7档`）
     *
     * ⚠ 裸数字 `6` / `7` **不**当档位：位置简写里它更像金数或名次，误判会静默改变结果口径。
     */
    const tier = token.match(/^(?:[nN]([67])|([67])档)$/)
    if (tier) {
      if (args.tier) args.unknown.push(token)
      else args.tier = (tier[1] || tier[2]) === '7' ? 'n7' : 'n6'
      continue
    }

    // 版本号形如 7.1
    if (!args.ver && /^\d+\.\d+$/.test(token)) {
      args.ver = token
      continue
    }
    if (!args.boss && findBoss(token)) {
      args.boss = token
      continue
    }
    if (!args.char && findCharacter(token)) {
      args.char = token
      continue
    }
    args.unknown.push(token)
  }

  return args
}

/**
 * 从参数里摘出名次（第一个纯数字 token），其余原样留给 `parseRankArgs` / `parseRaidArgs`
 *
 * 用在视频查询（`#视频 3 胡桃`）：名次与榜单图编号同口径，
 * 其余筛选词与榜单命令完全一致，故这里只负责把数字拆出来。
 */
export function takeRankNo (text: unknown): { rankNo: number, rest: string } {
  let rankNo = 0
  const rest: string[] = []
  for (const token of String(text || '').split(/[\s,，]+/).filter(Boolean)) {
    if (!rankNo && /^\d+$/.test(token)) {
      rankNo = Number(token)
      continue
    }
    rest.push(token)
  }
  return { rankNo, rest: rest.join(' ') }
}

/**
 * 摘出**后缀式**视频名次（用户 2026-10-15 定）
 *
 * 写法：`#危战 矮灵 n7 视频3`、`#dps 刻晴 48金视频1` —— `视频N` 可以独立成词，
 * 也可以像 `48金视频1` 那样贴在前一个筛选词后面。序号的含义是"**在当前筛选（含金数）之内、
 * 按伤害排名**的第 N 名"，与榜单图的编号同口径（`findRankEntry` 就是在这个集合上取第 N 条）。
 *
 * `视频N` 与任何筛选词都不冲突（"视频" 只出现在视频名次里），所以直接全局摘掉，剩下的文本交给
 * `parseRankArgs` / `parseRaidArgs`。
 */
export function takeVideoToken (text: unknown): { videoNo: number, rest: string } {
  const src = String(text || '')
  const m = /视频\s*(\d+)/.exec(src)
  if (!m) return { videoNo: 0, rest: src.trim() }
  return {
    videoNo: Number(m[1]) || 0,
    rest: src.replace(/视频\s*\d+/g, ' ').replace(/\s+/g, ' ').trim()
  }
}
