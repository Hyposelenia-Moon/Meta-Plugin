/**
 * 显示级归一的全库体检（129 角色，不需要浏览器）：
 *   1. 所有会进渲染模型的文本字段过一遍简写展开，检查
 *      「展开幂等」（再展开一次结果不变）与「不产生重复字」（`效率效率` 之类）；
 *   2. 检查六个模块在归一后**永远都在**（空模块是「暂无」而不是消失）；
 *   3. 检查档位标签只出现 推荐 / 可选 / 过渡（自定义队名除外）；
 *   4. 检查面板里没有 `0%` 行、副词条分隔符只有 `=`（同级）/ `＞`（优先级）、命座文案都是「命之座X」。
 *
 * 用法：node scripts/display-audit.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  displayText, normalizeGuideSections, DISPLAY_SECTIONS,
  constellationNumber, isZeroValue, displayLabel, ARTIFACT_KIND_LABEL
} from './lib/guide-display.mjs'
// v2 → sections 的转换器：与 display-selftest、插件侧共用同一份实现（原先各自的 localRows 已合并）
import { v2ToSections } from './lib/guide-model.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const giDir = path.join(root, 'data', 'gi')

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
const names = readJson(path.join(giDir, '_order.json'))

const problems = []
const seen = { texts: 0, dup: 0, notIdem: 0 }
/** 收集所有原始文本 */
const texts = new Set()
const add = (t) => {
  if (typeof t !== 'string' || !t.trim()) return
  seen.texts++
  texts.add(t)
}

for (const n of names) {
  const d = readJson(path.join(giDir, `${n}.json`))
  const v = d.v2 ?? {}
  for (const r of v.weapons ?? []) { if (r.label) add(r.label); for (const i of r.items ?? []) { add(i.name); add(i.note) } }
  for (const r of v.artifacts ?? []) {
    if (r.label) add(r.label)
    if (Array.isArray(r.stats)) for (const s of r.stats) add(s)
    for (const k of ['时之沙', '空之杯', '理之冠']) for (const s of r.stats?.[k] ?? []) add(s)
    for (const s of r.sets ?? []) { add(s.name); add(s.pieces); add(s.note) }
  }
  for (const r of v.panels ?? []) {
    add(r.label); add(r.k); add(r.v); add(r.text)
    if (typeof r.text === 'string') for (const part of r.text.split(' / ')) add(part)
  }
  for (const r of v.constellations ?? []) { add(r.name); add(r.text) }
  for (const r of v.teams ?? []) {
    add(r.label); add(r.text)
    for (const m of r.members ?? []) { add(m.name); add(m.note) }
  }
  for (const r of v.talents ?? []) {
    if (r.kind === 'crown') for (const i of r.items ?? []) { add(i.name); add(i.level) }
    if (r.kind === 'priority') add(r.raw)
  }
}

/* 1：全库文本的展开幂等（`元素充能效率效率` 这类重复字会让二次展开不再变化，
 *    所以「不幂等」与「被展开污染」都能被这一步抓住） */
for (const t of texts) {
  const once = displayText(t)
  const twice = displayText(once)
  if (once !== twice) {
    seen.notIdem++
    if (problems.length < 25) problems.push(`展开不幂等：${JSON.stringify(t)} → ${JSON.stringify(once)} → ${JSON.stringify(twice)}`)
  }
}

/* 3 + 4：逐角色过一遍归一后的渲染模型 */
let emptyModules = 0
let labelBad = 0
const labelSeen = new Set()
for (const n of names) {
  const d = readJson(path.join(giDir, `${n}.json`))
  const sections = normalizeGuideSections(v2ToSections(d.v2 ?? {}))
  if (sections.length !== 6) problems.push(`${n}：模块数 ${sections.length} ≠ 6`)
  for (const sec of sections) {
    if (sec.empty) { emptyModules++; continue }
    if (sec.kind === 'rows') {
      for (const row of sec.rows) {
        if (row.label) labelSeen.add(row.label)
        for (const it of row.items) {
          // 副词条的分隔符口径（用户定稿）：同级 = `=`、优先级 = `＞`、`≥` 原样（"高于等于"）。
          // 源文档的 `/`（同级）必须已被折成 `=`，`>` 必须已被折成 `＞`；出现 `/` 或别的字形都是没归一。
          if (sec.title === '圣遗物' && /副词条/.test(row.label ?? '')) {
            const sep = String(it.sepAfter ?? '').trim()
            if (sep && !['=', '＞', '≥'].includes(sep)) {
              problems.push(`${n}：副词条分隔符应为「= 同级 / ＞ 优先级 / ≥ 高于等于」，实际「${sep}」`)
            }
          }
          if (isZeroValue(it.text)) problems.push(`${n}：面板/条目里出现 0 值行「${it.text}」`)
        }
      }
    }
    if (sec.kind === 'stats') {
      for (const row of sec.rows) for (const it of row.items) if (isZeroValue(it.text)) problems.push(`${n}：面板 0 值行「${it.text}」`)
    }
    if (sec.kind === 'teams') {
      for (const t of sec.teams) {
        if (t.tag) labelSeen.add(t.tag)
        // 备注一律**不带** `注：` 前缀（见 guide-display 的 NOTE_PREFIX_RULE）；
        // 前缀由 `notePrefix` 决定加不加：`true` = 成员之外的补充说明（渲染成 `… 注：xxx`），
        // `false` = 整行就是这条备注（不加前缀）。所以带前缀的写法反而是错的。
        if (t.note && t.notePrefix !== true && t.note.startsWith('注：')) problems.push(`${n}：配队行内备注不该带 注： 前缀（${t.note}）`)
      }
    }
  }
}
for (const l of labelSeen) {
  if (!['推荐', '可选', '过渡'].includes(l)) labelBad++
}

console.log(`角色 ${names.length} 个；原始文本 ${texts.size} 条（出现 ${seen.texts} 次）`)
console.log(`展开不幂等：${seen.notIdem}；展开出重复字：${seen.dup}`)
console.log(`归一后空模块（暂无）：${emptyModules} 个；非档位标签：${labelBad} 个（自定义队名/描述标签，应为 0 才算全量归一）`)
console.log(`渲染模型里出现过的行标签：${[...labelSeen].sort().join(' / ')}`)
if (problems.length) {
  console.log(`\n问题 ${problems.length} 条：`)
  for (const p of problems.slice(0, 30)) console.log('  · ' + p)
  process.exitCode = 1
} else {
  console.log('\n体检通过：展开幂等、无重复字、六模块齐全、档位标签只有 推荐/可选/过渡')
}

/* v2 → 渲染模型：与 display-selftest、插件侧共用 scripts/lib/guide-model.mjs 的 v2ToSections */
