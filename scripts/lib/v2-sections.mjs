/**
 * v2 → 显示层可用的 sections（**忠实的行构造器**）
 *
 * ## 来源与理由
 * 本文件移植自 `Atlas-Plugin` 的 `model/codexIndex/parse.js`（作者 AxiuCN；经作者同意在本插件内
 * 复用其内部模块，见设计文档 §3.2 / §10）。**必须移植**的原因是维护者区原有的
 * `guide-model.mjs` 的 `v2ToSections` 只是 `display-selftest` / `display-audit` 用的
 * **简化测试模型**：它拍平 v2 时会丢掉 `kind` / `sets` / `talentLevel` / `crown` 等元信息，
 * 实测与 Atlas 输出**全库 131/131 角色不一致**（天赋等级丢失成 `level:1`、圣遗物 2+2 组合被拆开）。
 *
 * ## 职责边界
 * 本文件只做**结构搬运**（v2 字段 → 行对象），显示级归一全部交给 `guide-display.mjs` 的
 * `normalizeGuideSections`（档位词、`＞`、2+2 整体保留、皇冠并入天赋、命座「命之座X」、
 * 空模块「暂无」…）。因此插件成图与网页版 / Word 文档天然同源。
 *
 * ## 与 Atlas 原实现的两处差异（仅为适配本仓）
 *   1. `signature` / `weaponTags` 由调用方传入（Atlas 自己按 `fileDir` 读 `_signature.json` 等）；
 *   2. **不做旧版文本行兜底**（`data.sections` / `data.unparsed` 路径）：本仓数据实测
 *      「无 `unparsed`、无缺 `v2` 的角色」，插件侧也不需要图文兜底，故不移植那部分
 *      （`toSection` / `linesToRows` / `linesToTeams` 等）。将来若真需要，另起一步补。
 */
import {
  ARTIFACT_KIND_LABEL,
  DISPLAY_SECTIONS,
  displayItemText,
  displayLabel,
  normalizeGuideSections,
  resolveSetItems
} from './guide-display.mjs'

/* ============================================================
 *  纯文本 / HTML 小工具（与 Atlas 同名同义，保持输出形状一致）
 * ============================================================ */

/** 已废弃的旧版引用标记（`[[weapon:西风剑]]`），v2 数据一般不用，混写时兜底 */
const REF_MARK_RE = /\[\[[a-z][:：]([^[\]]+?)\]\]/g

/** `plainText` 需要解码的 HTML 实体（数据里偶尔混写 `&amp;` 这类写法） */
const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  hellip: '…'
}

function escapeAttr (text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 纯文本转义（JSON 数据是纯文本，标签由本模块生成） */
function escapeHtml (text) {
  return escapeAttr(text)
}

/** 行内强调约定 → HTML（`**着重**` / `==高亮==`） */
function inlineHtml (text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<span class="must">$1</span>')
    .replace(/==([^=]+)==/g, '<span class="highlight">$1</span>')
}

/** 内容里的 `>` 换成视觉分隔符（转义后再替换，避免误伤标签） */
function decorateValue (text) {
  return inlineHtml(text).replace(/ &gt; /g, ' <span class="sep">&gt;</span> ')
}

/** 去掉旧版引用标记只留名称 */
function stripMarks (text) {
  return String(text ?? '').replace(REF_MARK_RE, '$1')
}

/** v2 取值文本（去标记 + 行内强调 + 档位分隔符） */
function inlineText (text) {
  return decorateValue(stripMarks(text))
}

/** v2 标签 / 名称文本（去标记 + 行内强调） */
function inlineLabel (text) {
  return inlineHtml(stripMarks(text))
}

/** 皇冠等级里的「必须」用红色小标签（`.must`），其余按普通备注 */
function levelHtml (level) {
  const text = String(level ?? '').trim()
  if (!text) return ''
  return /必须/.test(text) ? `<span class="must">${escapeHtml(text)}</span>` : inlineLabel(text)
}

/** 解码常见 HTML 实体（仅名称 / 标签 / 空值判定用） */
function decodeEntities (text) {
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (raw, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X'
      const num = parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(num) || num <= 0 || num > 0x10ffff) return raw
      try {
        return String.fromCodePoint(num)
      } catch {
        return raw
      }
    }
    const key = code.toLowerCase()
    return key in ENTITY_MAP ? ENTITY_MAP[key] : raw
  })
}

/** 剥除全部标签并解码实体（标题 / 标签 / 空值判定用） */
function plainText (html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, '')).trim()
}

/** 纯文本是否为空（含 `___` 占位、只有标签没有值等情况） */
function isBlankText (html) {
  const text = plainText(html)
  if (!text) return true
  if (text.includes('___')) return true
  const rest = text.replace(/^[^：:—]{1,8}[：:—]+/, '').trim()
  if (!rest) return true
  return /^[_\-—·、/：:（）()]+$/.test(rest)
}

/** 按顶层分隔符切分（括号内的分隔符不算，如 `迪奥娜 / 阿罗夏` 这类括注） */
function splitTop (text, sep) {
  const out = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if ('(（[【'.includes(ch)) depth += 1
    else if (')）]】'.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0 && text.startsWith(sep, i)) {
      out.push(buf)
      buf = ''
      i += sep.length - 1
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out.map(part => part.trim()).filter(Boolean)
}

/* ============================================================
 *  行构造
 * ============================================================ */

/** 档位序号 → 中文数字 */
const CN_TIER = ['', '一', '二', '三', '四', '五', '六', '七', '八']

/** 圣遗物主词条三槽（顺序固定） */
const MAIN_SLOTS = ['时之沙', '空之杯', '理之冠']

/** 档位条目（结构化与文本行共用形状；note 为备注 / 皇冠等级，ref 供图标解析） */
function rankItem (item, sepAfter = '', ref = '') {
  if (item === null || item === undefined) return { text: '', note: '', ref: String(ref || ''), sepAfter }
  if (typeof item !== 'object') {
    return { text: displayItemText(decorateValue(stripMarks(item))), note: '', ref: String(ref || ''), sepAfter }
  }
  const name = inlineLabel(item.name ?? item.text ?? '')
  const note = String(item.note ?? '').trim()
    ? inlineLabel(item.note)
    : String(item.level ?? '').trim() ? levelHtml(item.level) : ''
  const lv = Number(item.talentLevel)
  const out = { text: name, note, ref: String(item.ref || ref || ''), sepAfter }
  if (Number.isInteger(lv) && lv >= 1 && lv <= 10) out.talentLevel = lv
  if (item.crown === true || lv === 10) out.crown = true
  if (item.slot) out.slot = String(item.slot)
  return out
}

/** 一行是否有实际内容（档位条目全部为空则整行不画） */
function rowHasContent (row) {
  return (row?.items || []).some(item => !isBlankText(item.text))
}

/**
 * 档位分隔符数组
 *
 * v2 的 `sep` 是「逐档分隔符」按空白拼接的结果（`'/ +'` = 三件套之间先用 `/` 再用 `+`），
 * 只写一个符号时按同一符号重复。token 不够时重复**最后一个**——重复第一个会把
 * 「组合符号」与「候选分隔符」错位，导致 2+2 组合（`A / B + C`）被拆成 `A / B / C`。
 */
function gapSeps (sep, count, fallback) {
  if (count <= 0) return []
  const tokens = String(sep ?? '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return new Array(count).fill(fallback)
  const out = []
  for (let i = 0; i < count; i++) out.push(tokens[i] ?? tokens[tokens.length - 1])
  return out
}

/** 段落图标引用：取第一个带 ref 的行 */
function firstRef (rows) {
  const hit = (rows || []).find(row => row?.ref)
  return hit ? String(hit.ref) : ''
}

/** 套装行的默认档位名：取共享显示层的来源写法再交给 displayLabel 归一（避免两端漂移） */
function artifactHead (kind) {
  const src = ARTIFACT_KIND_LABEL[kind]
  return src ? displayLabel(src) : ''
}

/** v2.weapons[] → 档位行（武器图标按 ref 的 `weapon:` 前缀解析） */
function v2WeaponRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const items = (Array.isArray(row?.items) ? row.items : [])
      .filter(item => item && String(item.name ?? item).trim())
    if (!items.length) continue
    const tier = Number(row?.tier)
    const label = String(row?.label ?? '').trim() || (tier > 0 ? `第${CN_TIER[tier] ?? tier}档` : '')
    const seps = gapSeps(row?.sep, items.length - 1, '>')
    out.push({
      label: inlineLabel(label),
      ref: String(items[0]?.ref || ''),
      items: items.map((item, i) => rankItem(item, i < items.length - 1 ? escapeHtml(seps[i] || '>') : ''))
    })
  }
  return out
}

/** 套装行条目：直接复用显示层的 `resolveSetItems`（与网页版同一份规则；2+2 整体保留） */
function resolveArtifactSetItems (sets, seps) {
  try {
    return resolveSetItems(sets, seps, { sep: '' })
  } catch {
    return sets.map((item, i) => ({
      name: String(item?.name ?? item ?? '').trim(),
      sepAfter: i < sets.length - 1 ? '/' : '',
      item
    }))
  }
}

/** v2.artifacts[] → 套装行 / 主词条三槽 / 副词条 */
function v2ArtifactRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const kind = String(row?.kind || '').trim()

    if (kind === 'main') {
      const stats = row?.stats && typeof row.stats === 'object' ? row.stats : {}
      const slots = MAIN_SLOTS.filter(slot => Array.isArray(stats[slot]) && stats[slot].some(v => String(v ?? '').trim()))
      if (slots.length) {
        // 面板 / 长图不写字面 `｜`：三槽靠排版分隔（模板把每槽渲染成独立 chip）
        out.push({
          label: '主词条',
          ref: '',
          kind: 'mainSlots',
          items: slots.map((slot, i) => {
            const values = stats[slot].map(v => String(v ?? '').trim()).filter(Boolean)
            const note = String(row?.note ?? '').trim()
            const noteSlot = String(row?.noteSlot ?? '').trim()
            const hit = !!note && (noteSlot ? noteSlot === slot : i === slots.length - 1) &&
              !values.some(v => /[（(]/.test(v))
            return {
              slot,
              text: `${escapeHtml(slot)}：${inlineText(values.join(' / '))}`,
              note: hit ? inlineLabel(note) : '',
              ref: '',
              sepAfter: ''
            }
          })
        })
      }
      continue
    }

    if (kind === 'sub') {
      const stats = (Array.isArray(row?.stats) ? row.stats : []).map(v => String(v ?? '').trim()).filter(Boolean)
      if (stats.length) {
        const seps = gapSeps(row?.sep, stats.length - 1, '>')
        out.push({
          label: '副词条',
          ref: '',
          items: stats.map((stat, i) => ({
            text: inlineText(stat),
            note: '',
            ref: '',
            sepAfter: i < stats.length - 1 ? escapeHtml(seps[i] || '>') : ''
          }))
        })
      }
      continue
    }

    if (kind === 'text') {
      const text = String(row?.text ?? '').trim()
      if (!text) continue
      out.push({ label: inlineLabel(row.label || ''), ref: '', items: [rankItem(text)] })
      continue
    }

    // preferred / transition / optional（以及未标 kind 的套装行）
    const sets = (Array.isArray(row?.sets) ? row.sets : [])
      .filter(set => set && String(set.name ?? set).trim())
    if (!sets.length) {
      const text = String(row?.text ?? '').trim()
      if (text) out.push({ label: inlineLabel(row.label || ''), ref: '', items: [rankItem(text)] })
      continue
    }
    const seps = gapSeps(row?.sep, sets.length - 1, '/')
    out.push({
      label: inlineLabel(String(row?.label ?? '').trim() || artifactHead(kind)),
      ref: String(sets[0]?.ref || ''),
      items: resolveArtifactSetItems(sets, seps).map(entry => ({
        text: inlineLabel(entry.name),
        note: String(entry.item?.note ?? '').trim() ? inlineLabel(entry.item.note) : '',
        ref: String(entry.item?.ref || ''),
        // 同级（源文档 `/`）→ 字面 `/`；优先级（`>`/`≥`）→ `＞`
        sepAfter: entry.sepAfter === '/' ? '/' : (entry.sepAfter ? '＞' : '')
      }))
    })
  }
  return out
}

/** v2.talents[] → 固定三格 A → E → Q（等级来自 priority.order[].level，皇冠由 crown/level===10 决定） */
function v2TalentRows (rows, opts = {}) {
  const out = []
  const talents = Array.isArray(rows) ? rows : []
  // 「该模块无需填写」且本来没有天赋行时不画 111 兜底，交给显示层 applyFreeHints 显示「无需加点」
  if (opts.free === true && !talents.length) return out

  const byName = new Map()
  for (const row of talents) {
    if (String(row?.kind || '').trim() !== 'priority') continue
    for (const item of Array.isArray(row?.order) ? row.order : []) {
      const name = String(item?.name ?? item ?? '').trim().toUpperCase()
      if (!/^[AEQ]$/.test(name)) continue
      const lv = Number(item?.level)
      const level = Number.isInteger(lv) && lv >= 1 && lv <= 10 ? lv : 1
      byName.set(name, {
        name,
        level,
        crown: item?.crown === true || level === 10,
        talentLevel: level,
        ref: String(item?.ref || `talent:${name}`)
      })
    }
  }
  if (byName.size) {
    out.push({
      label: '',
      kind: 'talents',
      ref: String((byName.get('A') || byName.values().next().value || {}).ref || ''),
      items: ['A', 'E', 'Q'].map(name => {
        const hit = byName.get(name) || { name, level: 1, crown: false, talentLevel: 1, ref: `talent:${name}` }
        return rankItem(hit, '')
      })
    })
  } else {
    // 没填天赋也照画三格（111），与网页版 defaultTalentRow 同一口径
    out.push({
      label: '',
      kind: 'talents',
      ref: '',
      items: ['A', 'E', 'Q'].map(name =>
        rankItem({ name, level: 1, crown: false, talentLevel: 1, ref: `talent:${name}` }, ''))
    })
  }
  for (const row of talents) {
    const kind = String(row?.kind || '').trim()
    if (kind === 'priority' || kind === 'crown') continue
    const text = String(row?.text ?? '').trim()
    if (text) out.push({ label: inlineLabel(row.label || ''), ref: '', items: [rankItem(text)] })
  }
  return out
}

/** v2.panels[] → 毕业面板行（键值对把 `k：v` 放进 item，让显示层合并同组；说明行按 `/` 拆条） */
function v2PanelRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.k ?? '').trim()
    if (key) {
      const value = String(row?.v ?? '').trim()
      if (value) out.push({ label: '', ref: '', items: [rankItem(`${key}：${value}`)] })
      continue
    }
    const text = String(row?.text ?? '').trim()
    if (!text) continue
    out.push({
      label: inlineLabel(row.label || ''),
      ref: '',
      items: splitTop(text, ' / ').map(part => rankItem(part, ''))
    })
  }
  return out
}

/** v2.constellations[] → 命座行（index 供图标解析；`top` 来自顶层 topConstellations） */
function v2ConstellationRows (rows, opts = {}) {
  const topIndexes = new Set((Array.isArray(opts.top) ? opts.top : []).map(Number))
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name ?? '').trim()
    const text = String(row?.text ?? '').trim()
    if (!name && !text) continue
    const index = Number(row?.index)
    const ref = Number.isInteger(index) && index > 0 ? `constellation:${index}` : ''
    const top = topIndexes.has(index) ? { top: true } : {}
    if (text) out.push({ label: inlineLabel(name), ref, ...top, items: [rankItem(text, '', ref)] })
    else out.push({ label: '', ref, ...top, items: [rankItem(name, '', ref)] })
  }
  return out
}

/** v2.teams[] → 队伍行（成员只留 name/note/ref；成员名里的 `/` 是同一格可替换项） */
function v2TeamRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = String(row?.label ?? '').trim()
    const text = String(row?.text ?? '').trim()
    const toMember = (member) => ({
      name: inlineLabel(member?.name ?? member ?? ''),
      note: String(member?.note ?? '').trim() ? inlineLabel(member.note) : '',
      plain: '',
      ref: String(member?.ref || ''),
      icon: ''
    })
    const members = []
    for (const raw of (Array.isArray(row?.members) ? row.members : [])) {
      const name = inlineLabel(String(raw?.name ?? raw ?? '').replace(/\s*[/／]\s*/g, ' / ').trim())
      if (!name) continue
      members.push(toMember({ ...(raw && typeof raw === 'object' ? raw : {}), name }))
    }
    const kept = members.filter(m => m.name && !isBlankText(m.name))
    if (!kept.length && !text) continue
    out.push({ tag: inlineLabel(label), members: kept, options: [], text: text ? inlineLabel(text) : '' })
  }
  return out
}

/* ============================================================
 *  入口
 * ============================================================ */

/** v2 字段 → 行构造器 */
const V2_ROW_BUILDERS = {
  weapons: v2WeaponRows,
  artifacts: v2ArtifactRows,
  talents: v2TalentRows,
  panels: v2PanelRows,
  constellations: v2ConstellationRows
}

/** v2 段落 → 标题 / 类型（与旧版文本行标题同序） */
const V2_ROW_SECTIONS = [
  ['weapons', '1. 武器推荐', '武器', 'rows'],
  ['artifacts', '2. 圣遗物推荐', '圣遗物', 'rows'],
  ['talents', '3. 天赋加点', '天赋', 'rows'],
  ['panels', '4. 毕业面板参考', '面板', 'stats'],
  ['constellations', '5. 命座推荐', '命座', 'rows']
]

/** 显示顺序：**直接取共享显示层的 DISPLAY_SECTIONS**（不要硬编码——Atlas 那边的注释就写旧过） */
function displayOrderOf (keyword) {
  return DISPLAY_SECTIONS.findIndex(item => item.title === keyword)
}

/**
 * v2 → 显示级 sections（已归一）
 *
 * @param {object} data 角色攻略 JSON（需带 `v2`；可带 `freeModules` / `topConstellations`）
 * @param {{signature?: object|string|null, weaponTags?: object|null}} [opts]
 * @returns {Array<object>} `normalizeGuideSections` 之后的六个模块
 */
export function buildV2Sections (data, opts = {}) {
  const v2 = data?.v2 || {}
  const freeModules = new Set(Array.isArray(data?.freeModules) ? data.freeModules : [])
  const parts = []

  const addRows = (keyword, renderType, rows, skipFallback = false) => {
    const kept = (rows || []).filter(rowHasContent)
    if (kept.length) {
      parts.push({ keyword, parsed: { type: renderType, rows: kept, iconRef: firstRef(kept), image: '' } })
      return
    }
    parts.push({ keyword, parsed: null })
  }

  for (const [key, , keyword, type] of V2_ROW_SECTIONS) {
    const freeEmpty = freeModules.has(key) && !(Array.isArray(v2[key]) && v2[key].length)
    const builderOpts = { free: freeModules.has(key), top: key === 'constellations' ? data?.topConstellations : null }
    addRows(keyword, type, freeEmpty ? [] : V2_ROW_BUILDERS[key](v2[key], builderOpts), freeEmpty)
  }

  const teams = v2TeamRows(v2.teams)
  if (teams.some(team => (team.members || []).length || team.text)) {
    parts.push({ keyword: '配队', parsed: { type: 'teams', teams, iconRef: '', image: '' } })
  } else {
    parts.push({ keyword: '配队', parsed: null })
  }

  const out = []
  for (const part of parts) {
    const parsed = part.parsed
    const idx = displayOrderOf(part.keyword)
    const base = parsed ? { ...parsed } : { rows: [], teams: [] }
    out.push({ ...base, badge: String(idx + 1), title: part.keyword, __order: idx })
  }

  // 显示级归一：档位词、`＞`、2+2 整体保留、皇冠并入天赋、命座「命之座X」、空模块「暂无」
  const displayed = normalizeGuideSections(out, {
    free: Array.from(freeModules),
    signature: opts.signature ?? null,
    weaponTags: opts.weaponTags ?? null
  })
  displayed.sort((a, b) => (a.__order ?? 100) - (b.__order ?? 100))
  return displayed.map(({ __order, ...rest }) => rest)
}
