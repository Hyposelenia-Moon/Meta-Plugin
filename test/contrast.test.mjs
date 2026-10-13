/**
 * 对比度（WCAG 2.1 AA）+ 字号可读性：离线回归
 *
 * 主题结构（深色插画风）：插画铺满整页 → --scrim 压暗 → 所有文字落在 --card 深色内容条上。
 * 因此文字的最坏背景是「最亮插画（纯白）经 --scrim、再经 --card」得到的等效底，
 * 这里完全按令牌现算（不读图片），任何一次调色把某处文字压到阈值以下都会直接报红。
 *   - 正文（<24px 或 <18.66px 粗体）要求 ≥ 4.5:1
 *   - 大字（≥24px，或 ≥18.66px 粗体）要求 ≥ 3:1
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, pluginRoot } from './_helper.mjs'

const { check, finish } = checker()

const css = fs.readFileSync(path.join(pluginRoot, 'resources', 'common', 'base.css'), 'utf8')

/** 取一个令牌的字面值 */
function token (name) {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))
  if (!m) throw new Error(`令牌 --${name} 不存在`)
  return m[1].trim()
}

/** #rrggbb / rgba(r, g, b, a) → [r,g,b,a] */
function parseColor (value) {
  const text = String(value).trim()
  const hex = text.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
  }
  const rgba = text.match(/rgba?\(([^)]+)\)/i)
  if (rgba) {
    const parts = rgba[1].split(',').map(s => Number(s.trim()))
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
  }
  throw new Error(`无法解析颜色：${value}`)
}

/** 半透明色叠在不透明底上 */
function over (fg, bg) {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}

function srgb (c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function relLum ([r, g, b]) {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}

function contrast (fg, bg) {
  const l1 = relLum(fg)
  const l2 = relLum(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const byToken = (name) => parseColor(token(name))

// 最坏链路：纯白插画（最亮）→ scrim → card → (可选 chip / card-2)
const WHITE = [255, 255, 255, 1]
const scrim = byToken('scrim')
const cardBg = over(byToken('card'), over(scrim, WHITE))
const chipBg = over(byToken('chip'), cardBg)
const innerBg = over(byToken('card-2'), cardBg)
// 直接落在插画上的容器自带 --card 垫底时，半透明「色味」层叠在 cardBg 上就是它的实际底
const softOnCardBg = over(byToken('accent-soft'), cardBg)

check('内容条底色足够暗（浅色小字才压得住）', relLum(cardBg) < 0.08, `L=${relLum(cardBg).toFixed(3)}`)

/** 规格：标签 / 前景色 / 背景色 / 字号 / 是否粗体 */
const specs = [
  ['正文主色 --text', byToken('text'), cardBg, 20, false],
  ['次级文字 --text-2', byToken('text-2'), cardBg, 15, false],
  ['弱化文字 --muted', byToken('muted'), cardBg, 17, false],
  ['更弱文字 --muted-2', byToken('muted-2'), cardBg, 18, false],
  ['弱化文字 on 内嵌底', byToken('muted'), innerBg, 16, false],
  ['半透明强调底上的 --text', byToken('text'), softOnCardBg, 26, true],
  ['强调蓝 --accent', byToken('accent'), cardBg, 18, true],
  ['强调紫 --accent-2', byToken('accent-2'), cardBg, 16, false],
  ['金色 --gold', byToken('gold'), cardBg, 19, true],
  ['绿色 --green', byToken('green'), cardBg, 16, false],
  ['红色 --red', byToken('red'), cardBg, 15, false],
  ['标签：蓝 chip', byToken('accent'), chipBg, 18, false],
  ['标签：绿玩 chip', byToken('green'), chipBg, 18, false],
  ['标签：满级 chip', byToken('gold'), chipBg, 18, false],
  ['标签：版本 chip', byToken('accent-2'), chipBg, 18, false],
  ['名次 1 文字 on 金渐起', byToken('rank-1-text'), byToken('rank-1-from'), 26, true],
  ['名次 1 文字 on 金渐止', byToken('rank-1-text'), byToken('rank-1-to'), 26, true],
  ['名次 2 文字 on 紫渐起', byToken('rank-2-text'), byToken('rank-2-from'), 26, true],
  ['名次 2 文字 on 紫渐止', byToken('rank-2-text'), byToken('rank-2-to'), 26, true],
  ['名次 3 文字 on 蓝渐起', byToken('rank-3-text'), byToken('rank-3-from'), 26, true],
  ['名次 3 文字 on 蓝渐止', byToken('rank-3-text'), byToken('rank-3-to'), 26, true],
  ['元素 火 on 内容条', byToken('elem-pyro'), cardBg, 14, false],
  ['元素 水 on 内容条', byToken('elem-hydro'), cardBg, 14, false],
  ['元素 风 on 内容条', byToken('elem-anemo'), cardBg, 14, false],
  ['元素 雷 on 内容条', byToken('elem-electro'), cardBg, 14, false],
  ['元素 草 on 内容条', byToken('elem-dendro'), cardBg, 14, false],
  ['元素 冰 on 内容条', byToken('elem-cryo'), cardBg, 14, false],
  ['元素 岩 on 内容条', byToken('elem-geo'), cardBg, 14, false]
]

let worst = { name: '', ratio: Infinity }
for (const [name, fg, bg, size, bold] of specs) {
  const ratio = contrast(fg, bg)
  const isLarge = size >= 24 || (bold && size >= 18.66)
  const need = isLarge ? 3.0 : 4.5
  if (ratio < worst.ratio) worst = { name, ratio }
  check(`${name}（${size}px${bold ? ' 粗' : ''}）≥ ${need}`, ratio >= need, `${ratio.toFixed(2)}:1`)
}

// 直接落在插画上的容器必须自带垫底：半透明底在亮部插画上必然不达标。
// 练度面板已整页交给 miao-plugin 渲染（不在本插件的样式里），这里只剩共享组件这一处。
const SURFACES = [
  ['common/components.css', '.empty-hint', /var\(--card\)/]
]
for (const [file, selector, want] of SURFACES) {
  const text = fs.readFileSync(path.join(pluginRoot, 'resources', file), 'utf8')
  const rule = text.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))
  check(`${file} ${selector} 自带足够暗的垫底`, Boolean(rule) && want.test(rule[1]), rule ? rule[1].trim().slice(0, 60) : '未找到规则')
}

// 字号可读性：正文不小于 14px（渲染时再乘 renderScale，实际像素更大）
// 练度面板不在列表里：那一页由 miao-plugin 的模板渲染，字号归 miao 管（见 README 的取舍说明）
for (const [dir, file] of [
  ['common', 'components.css'],
  ['common', 'base.css'],
  ['dps', 'rank.html'],
  ['dps', 'raid.html'],
  ['dps', 'status.html'],
  ['dps', 'help.html']
]) {
  const text = fs.readFileSync(path.join(pluginRoot, 'resources', dir, file), 'utf8')
  const found = [...text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]))
  if (!found.length) continue
  const min = Math.min(...found)
  check(`${file} 最小字号 ≥ 14px`, min >= 14, `最小 ${min}px`)
}

console.log(`\n最低对比度项：${worst.name} → ${worst.ratio.toFixed(2)}:1`)

finish()
