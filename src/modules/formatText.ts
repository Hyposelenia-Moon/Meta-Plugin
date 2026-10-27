/**
 * formatText — 渲染失败时的纯文本回退（合并自 `Mhydps-Plugin/modules/formatText.js`）
 *
 * 出图链路依赖浏览器（框架 puppeteer 后端），在没装浏览器的机器上会失败；
 * 此时用这里拼的文字版把同样的信息发出去，保证命令在降级环境下可用。
 *
 * ⚠ 文案与合并前**逐字一致**（`test/dps-query.test.mjs` 会钉住关键行）。
 */
import { DPS_COPYRIGHT, SITE_NAME, formatTime } from '../components/constants.js'
import type { MemberView } from './teamView.js'

/** 榜单记录的一行视图（`rankQuery.buildRows` / `raidQuery.buildRows` 的产物） */
export interface ViewRow {
  rank: number
  /**
   * 全榜名次（2026-10-15 用户定：`#危战视频 N` 的 N 按**全榜排序** —— 金数升序、同金比耗时）
   *
   * 档页按耗时降序排（档内序号 = `rank`），与视频名次口径不同，故每行额外标"全榜 #N"，
   * 用户看到就能直接发 `#危战视频 N`。
   */
  overallRank?: number
  cost: number
  limitcost: number
  normalcost: number
  tags: string[]
  clean?: boolean
  lvl?: boolean
  video?: string
  /**
   * 配队成员（`teamView.memberViews` 的产物，含命座与本地立绘 id）
   *
   * ⚠ 原先只写了 `{ name, cText }`，与运行时不符：模板一直用着 `avatar` / `constellation`；
   *    P1 的文本回退也要用 `constellation`，故补全为 `MemberView`。
   */
  chars: MemberView[]
  /** DPS专有：期望 DPS 原始值（展示用 `damageText`） */
  damage?: number
  damageText?: string
  /** 危战榜专有：耗时秒数（展示用 `speedText`） */
  speed?: number
  speedText?: string
  ver?: string
  bossName?: string
}

/** 榜单一页的查询结果（`queryRank` / `queryRaid` 的产物） */
export interface ViewResult {
  subtitle?: string
  total: number
  page: number
  totalPages: number
  rows: ViewRow[]
  stale?: boolean
  fetchedAt?: number
}

/** 单条记录查询结果（`findRankEntry` / `findRaidEntry` 的产物） */
export interface EntryResult {
  row: ViewRow
  rank: number
  total: number
  fetchedAt?: number
}

/** 榜单页脚（数据来源与抓取时间） */
function footer (result: ViewResult): string {
  const stale = result.stale ? '（缓存已过期，本次刷新失败，展示的是旧数据）' : ''
  return `数据：${SITE_NAME} · 抓取于 ${formatTime(result.fetchedAt)}${stale}`
}

/** 成员一行文本：名字 + 命座 */
function charLine (chars: ViewRow['chars'] | undefined): string {
  return (chars || []).map(c => `${c.name}${c.cText ? `(${c.cText})` : ''}`).join(' / ')
}

/**
 * 徽章列表：站点标签 + 绿玩/满级
 *
 * 模板里绿玩/满级是按 `clean`/`lvl` 字段渲染的带配色徽章，不在 tags 里；
 * 文本版要一并体现，所以在这里补上。
 */
function badgeList (row: ViewRow): string[] {
  const badges = [...(row.tags || [])]
  if (row.clean) badges.push('绿玩')
  if (row.lvl) badges.push('满级')
  return badges
}

/** 徽章文本（含方括号，供榜单文本用） */
function badgeLine (row: ViewRow): string {
  const badges = badgeList(row)
  return badges.length ? `　[${badges.join(' ')}]` : ''
}

/**
 * 单条记录文本（视频查询用）：名次 + 主数值 + 金数 + 阵容 + 标签 + 视频链接
 *
 * @param result `findRankEntry` / `findRaidEntry` 的返回值
 * @param kind 榜单类型
 */
export function entryText (result: EntryResult, kind: 'rank' | 'raid' = 'rank'): string {
  const row = result.row
  const title = kind === 'raid' ? '#危战' : '#DPS'
  const lines = [`${title} 第 ${result.rank} 名（当前条件下共 ${result.total} 条）`]

  if (kind === 'raid') {
    lines.push(`${row.speedText}　${row.cost}金（限${row.limitcost}/常${row.normalcost}）　${row.ver}｜${row.bossName}`)
  } else {
    lines.push(`${row.damageText}　${row.cost}金（限${row.limitcost}/常${row.normalcost}）`)
  }

  lines.push(`阵容：${charLine(row.chars)}`)

  const badges = badgeList(row)
  if (badges.length) lines.push(`标签：${badges.join(' ')}`)

  lines.push(row.video ? `视频：${row.video}` : '视频：这条记录没有留下视频链接')
  lines.push('', `数据：${SITE_NAME} · 抓取于 ${formatTime(result.fetchedAt)}`)
  return lines.join('\n')
}

/** DPS文本版 */
export function rankText (result: ViewResult, title = '#DPS'): string {
  const lines = [
    `${title}${result.subtitle ? `｜${result.subtitle}` : ''}`,
    `共 ${result.total} 条 · 第 ${result.page}/${result.totalPages} 页`,
    ''
  ]
  for (const row of result.rows) {
    lines.push(`#${row.rank}　${row.damageText}　${row.cost}金（限${row.limitcost}/常${row.normalcost}）`)
    lines.push(`　　${charLine(row.chars)}${badgeLine(row)}`)
    if (row.video) lines.push(`　　${row.video}`)
  }
  if (!result.rows.length) lines.push('没有符合条件的记录')
  lines.push('', footer(result))
  return lines.join('\n')
}

/** 危战榜文本版 */
export function raidText (result: ViewResult, title = '#危战'): string {
  const lines = [
    `${title}${result.subtitle ? `｜${result.subtitle}` : ''}`,
    `共 ${result.total} 条 · 第 ${result.page}/${result.totalPages} 页`,
    ''
  ]
  for (const row of result.rows) {
    lines.push(`#${row.rank}　${row.speedText}　${row.cost}金（限${row.limitcost}/常${row.normalcost}）　${row.ver}｜${row.bossName}`)
    lines.push(`　　${charLine(row.chars)}${badgeLine(row)}`)
    if (row.video) lines.push(`　　${row.video}`)
  }
  if (!result.rows.length) lines.push('没有符合条件的记录')
  lines.push('', footer(result))
  return lines.join('\n')
}

/** 版权行（状态页/帮助页文本回退用） */
export const copyrightLine = DPS_COPYRIGHT

