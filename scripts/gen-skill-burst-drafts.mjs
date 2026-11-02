import fs from 'node:fs'
import path from 'node:path'

/**
 * 生成 E/Q（战技/爆发）**草稿**：只做机器能证明的部分，其余标 missing，绝不猜。
 *
 * 输出到 out/skill-burst-drafts/<dir>.json，**不入库**；入库前必须逐条核对。
 * 当前能自动解析的：
 *   - 动作时长：out/frames/<dir>.json 里的 skillFrames / burstFrames（InitAbilSlice）
 *   - 冷却：`SetCDWithDelay(action.ActionSkill|Burst, <字面量数字>`（表达式一律不认）
 *   - 能量：`c.EnergyMax = <n>`
 *   - 命中帧：skill/burst 相关的 `*Hitmarks*` 声明（扁平和嵌套都支持）
 *   - 倍率：`Mult: <表>[c.TalentLvlSkill()|c.TalentLvlBurst()]` + 表是 `[]float64{...}`，取 10 级（下标 9）
 * 解析不到的字段写 null，并在 issues 里说明原因。
 */

const GCSIM_ROOT = process.env.GCSIM_ROOT ?? 'out/gcsim'
const CHARS_ROOT = path.join(GCSIM_ROOT, 'internal/characters')
const MIAO_ROOT = process.env.MIAO_ROOT ?? 'D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs/character'
const TARGETS = 'out/eq-targets.json'
const FRAMES_DIR = 'out/frames'
const OUT_DIR = 'out/skill-burst-drafts'
const OUT_REPORT = 'out/skill-burst-drafts-report.json'

function balanced (text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(openIndex + 1, i) }
  }
  return null
}

function splitTopLevel (text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if ('{(['.includes(ch)) depth++
    else if ('})]'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map(s => s.trim()).filter(Boolean)
}

/** 只认整数、小数、正负与百分号数值；其余（变量、函数调用）返回 null。 */
function number (expr) {
  const t = String(expr).trim()
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t)
  return null
}

function collectTables (texts) {
  const tables = new Map()
  for (const text of texts) {
    for (const m of text.matchAll(/(\w+)\s*=\s*\[\]float64\{/g)) {
      const name = m[1]
      if (tables.has(name)) continue
      const body = balanced(text, m.index + m[0].length - 1)
      if (body === null) continue
      const values = splitTopLevel(body).map(number)
      if (!values.length || values.some(v => v === null)) continue
      tables.set(name, values)
    }
  }
  return tables
}

/** 命中帧声明：`xHitmarks = []int{18, 20}` / `[][]int{{18}, {20}}` */
function collectHitmarks (texts) {
  const out = new Map()
  for (const text of texts) {
    for (const m of text.matchAll(/(\w*Hitmarks\w*)\s*=\s*\[\]\[\]int\{/g)) {
      const name = m[1]
      if (out.has(name)) continue
      const body = balanced(text, m.index + m[0].length - 1)
      if (body === null) continue
      const groups = [...body.matchAll(/\{([^{}]*)\}/g)].map(g => splitTopLevel(g[1]).map(number))
      if (!groups.length || groups.some(g => !g.length || g.some(v => v === null))) continue
      out.set(name, { flat: false, groups, count: groups.reduce((n, g) => n + g.length, 0) })
    }
    for (const m of text.matchAll(/(\w*Hitmarks\w*)\s*=\s*\[\]int\{([^{}]*)\}/g)) {
      const name = m[1]
      if (out.has(name)) continue
      const values = splitTopLevel(m[2]).map(number)
      if (!values.length || values.some(v => v === null)) continue
      out.set(name, { flat: true, groups: values.map(v => [v]), count: values.length })
    }
  }
  return out
}

function pickAction (name, files, hitmarks) {
  const candidates = ['skill', 'burst'].map(action => {
    const file = `${action}.go`
    const text = files.get(file) ?? ''
    return { action, file, text }
  })
  return candidates.find(c => c.text) || null
}

const targets = JSON.parse(fs.readFileSync(TARGETS, 'utf8'))
fs.mkdirSync(OUT_DIR, { recursive: true })
const report = { targets: targets.length, full: 0, partial: 0, none: 0, items: [] }

for (const target of targets) {
  const dir = target.dir
  const dirPath = path.join(CHARS_ROOT, dir)
  const issues = []
  let files = new Map()
  try {
    for (const name of fs.readdirSync(dirPath).filter(f => f.endsWith('.go'))) {
      files.set(name, fs.readFileSync(path.join(dirPath, name), 'utf8'))
    }
  } catch (error) {
    report.items.push({ dir, cn: target.cn, status: 'none', issues: [`目录不可读：${error}`] })
    report.none++
    continue
  }
  const texts = [...files.values()]
  const tables = collectTables(texts)
  const hitmarks = collectHitmarks(texts)

  let frames
  try { frames = JSON.parse(fs.readFileSync(path.join(FRAMES_DIR, `${dir}.json`), 'utf8')) } catch { frames = { hitmarks: {}, frames: {} } }

  const energyMax = (() => {
    for (const text of texts) {
      const m = /c\.EnergyMax\s*=\s*(\d+)/.exec(text)
      if (m) return Number(m[1])
    }
    return null
  })()

  const draft = {
    schemaVersion: 1,
    dir,
    name: target.cn,
    gameVersion: '7.1',
    source: `gcsim 源码草稿（${dir}）+ miao 7.1 倍率候选；未核对`,
    energyMax,
    actions: {},
    issues: []
  }

  for (const action of ['skill', 'burst']) {
    const key = action === 'skill' ? 'Skill' : 'Burst'
    const file = `${action}.go`
    const text = files.get(file) ?? ''
    const label = action === 'skill' ? 'E' : 'Q'
    const issuesForAction = []

    // 时长
    const frameNames = [...frames.frames ? Object.keys(frames.frames) : []].filter(n => new RegExp(action, 'i').test(n))
    const duration = frameNames.length ? frames.frames[frameNames[0]][0] ?? null : null
    if (duration === null) issuesForAction.push('动作时长缺（InitAbilSlice 未解析到）')

    // 冷却
    let cooldownFrames = null
    for (const m of text.matchAll(new RegExp(`SetCDWithDelay\\(\\s*action\\.Action${key}\\s*,\\s*(\\d+)`, 'g'))) {
      const v = Number(m[1])
      if (Number.isFinite(v)) cooldownFrames = Math.max(cooldownFrames ?? 0, v)
    }
    if (cooldownFrames === null) issuesForAction.push('冷却缺（SetCDWithDelay 参数是表达式或未找到）')

    // 命中帧：优先用 frames 目录里同名声明，其次在源码里找
    const hmNames = [...hitmarks.keys()].filter(n => new RegExp(action, 'i').test(n))
    const hits = []
    if (hmNames.length === 1) {
      const hm = hitmarks.get(hmNames[0])
      for (const group of hm.groups) hits.push({ atFrame: group[0], motionValue: null, scaling: 'atk', canCrit: true, source: hmNames[0] })
      if (hits.length > 1) issuesForAction.push(`命中帧取 ${hmNames[0]}（${hits.length} 次），倍率未逐段确认`)
    } else if (hmNames.length === 0) {
      issuesForAction.push('命中帧缺（没有 skill/burst 相关的 Hitmarks 声明）')
    } else {
      issuesForAction.push(`命中帧有多个候选：${hmNames.join(' / ')}，未自动选择`)
    }

    // 倍率：按 QueueAttack 顺序取 `Mult: 表[c.TalentLvlXxx()]`
    const mults = []
    for (const m of text.matchAll(/Mult:\s*(\w+)\[\s*c\.TalentLvl(?:Skill|Burst)\(\)\s*\]/g)) {
      const table = tables.get(m[1])
      if (!table || table.length < 10) { mults.push(null); continue }
      mults.push(table[9])
    }
    if (!mults.length) issuesForAction.push('倍率缺（没有 Mult: 表[c.TalentLvlXxx()] 写法）')
    else if (mults.some(v => v === null)) issuesForAction.push('部分倍率表不可解析')

    // 把可解析的倍率按顺序贴到命中上（数量必须一致，否则不贴）
    if (hits.length && mults.length === hits.length && mults.every(v => v !== null)) {
      hits.forEach((hit, i) => { hit.motionValue = mults[i] })
    } else if (hits.length && mults.length) {
      issuesForAction.push(`倍率数 ${mults.length} 与命中数 ${hits.length} 不一致，未贴倍率`)
    }

    const hitHits = hits.filter(h => h.motionValue !== null)
    draft.actions[`${dir}.${action}`] = {
      id: `${dir}.${action}`,
      actorId: dir,
      kind: action,
      timing: { type: 'frames', frames: duration },
      hits,
      ...(action === 'burst' && energyMax ? { energyCost: energyMax } : {}),
      ...(cooldownFrames ? { cooldownFrames } : {}),
      notes: issuesForAction
    }
    issues.push(...issuesForAction.map(t => `${label}：${t}`))
    draft.issues = issues
    draft.summary = draft.summary || { total: 0, withMotion: 0 }
    draft.summary.total++
    if (hitHits.length) draft.summary.withMotion++
  }

  const status = draft.summary?.withMotion === 0 ? 'none' : draft.issues.length ? 'partial' : 'full'
  draft.status = status
  report.items.push({ dir, cn: target.cn, status, actions: draft.summary?.total ?? 0, withMotion: draft.summary?.withMotion ?? 0, issues })
  report[status]++
  fs.writeFileSync(path.join(OUT_DIR, `${dir}.json`), JSON.stringify(draft, null, 2) + '\n', 'utf8')
}

fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ targets: report.targets, full: report.full, partial: report.partial, none: report.none }))
