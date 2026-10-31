import fs from "node:fs"
import path from "node:path"

/**
 * 从 gcsim 本地源码抽通用动作数据：命中帧（Hitmarks/Releases）、动作时长（frames 包）、命中元素。
 *
 * 只读声明，不追调用图：
 *   - `xxxHitmarks = []int{...}` / `[][]int{{...}}`，或 `attackReleases` 这类同义声明；
 *   - `xxxFrames[i] = frames.InitNormalCancelSlice(..., ANIM)`：第 i 段收尾 ANIM 帧；
 *   - `xxxFrames = frames.InitAbilSlice(ANIM)`：整段动作 ANIM 帧；
 *   - `Element: attributes.Xxx`：命中元素。
 * 命中帧与收尾帧里出现 `11 + windup`、`118-32-17` 这类常量算式时按包内 const 求值；求不出来就留空，
 * 不猜数字。全部按 gcsim 的 60fps 口径记录，换档折算由消费方负责。
 */

const GCSIM_ROOT = process.env.GCSIM_ROOT ?? "out/gcsim"
const CHARS_ROOT = path.join(GCSIM_ROOT, "internal/characters")
const OUT_DIR = "out/frames"
const OUT_REPORT = "out/frames-report.json"

/** 从 openIndex（指向 '{'）开始做括号配对，返回花括号内的文本。 */
function balanced(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}") {
      depth--
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  return null
}

/** 按顶层逗号切分：花括号内的逗号不切。 */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{" || ch === "(" || ch === "[") depth++
    else if (ch === "}" || ch === ")" || ch === "]") depth--
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((s) => s.trim()).filter(Boolean)
}

/** 常量算式求值：只认整数、+、- 与包内 const，其它一律返回 null。 */
function evalExpr(expr, constants) {
  const tokens = String(expr).replace(/\s+/g, "")
  if (!tokens) return null
  const parts = tokens.split(/([+-])/)
  let total = 0
  let sign = 1
  for (const part of parts) {
    if (part === "+") { sign = 1; continue }
    if (part === "-") { sign = -1; continue }
    if (!part) continue
    let value
    if (/^\d+$/.test(part)) value = Number(part)
    else if (constants.has(part)) value = constants.get(part)
    else return null
    total += sign * value
  }
  return Number.isInteger(total) ? total : null
}

/** 包内整型常量：`const windup = 2`、`const ( normalHitNum = 3 ... )`、以及 `var x = 3`。 */
function collectConstants(files) {
  const constants = new Map()
  for (const text of files) {
    for (const m of text.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*(?:int\s*)?=\s*(-?\d+)\b/g)) constants.set(m[1], Number(m[2]))
    for (const m of text.matchAll(/\bvar\s+([A-Za-z_]\w*)\s*(?:int\s*)?=\s*(-?\d+)\b/g)) if (!constants.has(m[1])) constants.set(m[1], Number(m[2]))
    for (const block of text.matchAll(/\bconst\s*\(([\s\S]*?)\)/g)) {
      for (const line of block[1].split("\n")) {
        const m = /^\s*([A-Za-z_]\w*)\s*(?:int\s*)?=\s*(-?\d+)\s*$/.exec(line)
        if (m) constants.set(m[1], Number(m[2]))
      }
    }
  }
  return constants
}

const ELEMENT_MAP = {
  Physical: "physical",
  Anemo: "anemo",
  Geo: "geo",
  Electro: "electro",
  Dendro: "dendro",
  Hydro: "hydro",
  Pyro: "pyro",
  Cryo: "cryo",
}

/** 解析 `{11}, {9, 31}` 这类二维字面量；表达式求不出来整段放弃。 */
function parseGroups(text, constants) {
  const groups = []
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const frames = splitTopLevel(m[1]).map((expr) => evalExpr(expr, constants))
    if (frames.some((frame) => frame === null)) return null
    groups.push(frames)
  }
  return groups.length ? groups : null
}

function parseDir(dir) {
  const dirPath = path.join(CHARS_ROOT, dir)
  const fileNames = fs.readdirSync(dirPath).filter((f) => f.endsWith(".go"))
  const texts = fileNames.map((f) => fs.readFileSync(path.join(dirPath, f), "utf8"))
  const constants = collectConstants(texts)
  const hitmarks = {}
  const frames = {}
  const elements = new Set()
  const unresolved = []

  fileNames.forEach((file, fileIndex) => {
    const text = texts[fileIndex]

    // 嵌套形态：[][]int{{11 + windup}, {7}, {8, 8 + 14}}
    for (const m of text.matchAll(/(\w+)\s*=\s*\[\]\[\]int\{/g)) {
      const name = m[1]
      const body = balanced(text, m.index + m[0].length - 1)
      if (body === null || hitmarks[name]) continue
      const groups = parseGroups(body, constants)
      if (groups) hitmarks[name] = groups
      else unresolved.push(`${file}:${name}`)
    }
    // 扁平形态：[]int{15, 72}
    for (const m of text.matchAll(/(\w+)\s*=\s*\[\]int\{([^{}]*)\}/g)) {
      const name = m[1]
      if (hitmarks[name]) continue
      const framesList = splitTopLevel(m[2]).map((expr) => evalExpr(expr, constants))
      if (framesList.length && !framesList.some((frame) => frame === null)) hitmarks[name] = framesList.map((frame) => [frame])
      else unresolved.push(`${file}:${name}`)
    }

    // 逐段收尾：xxxFrames[[状态]][段] = frames.InitNormalCancelSlice(hitmarks[k], ANIM)
    // 名字可能是 attackFrames / attackFramesNormal / attackSkillFrames，统一按含 Frames 的标识符认。
    for (const m of text.matchAll(/(\w*Frames\w*)((?:\[[^\]]*\])+)\s*=\s*frames\.InitNormalCancelSlice\(\s*[^,]+?,\s*([^)]+?)\s*\)/g)) {
      const name = m[1]
      const indices = [...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]))
      const index = indices.length ? indices[indices.length - 1] : 0
      const anim = evalExpr(m[3], constants)
      if (anim === null) { unresolved.push(`${file}:${name}[${index}]`); continue }
      const entry = (frames[name] ??= { byIndex: new Map(), simple: null })
      if (!entry.byIndex.has(index)) entry.byIndex.set(index, anim)
    }
    // 整段动作：xxxFrames = frames.InitAbilSlice(ANIM)
    for (const m of text.matchAll(/(\w*Frames\w*)\s*[:=]\s*frames\.InitAbilSlice\(\s*([^)]+?)\s*\)/g)) {
      const name = m[1]
      const anim = evalExpr(m[2], constants)
      if (anim === null) { unresolved.push(`${file}:${name}`); continue }
      const entry = frames[name]
      if (!entry) frames[name] = { byIndex: new Map(), simple: anim }
      else if (entry.simple === null) entry.simple = anim
    }

    if (/attack\.go$/i.test(file)) {
      for (const m of text.matchAll(/Element:\s*attributes\.([A-Za-z]+)/g)) elements.add(ELEMENT_MAP[m[1]] ?? m[1].toLowerCase())
    }
  })

  const out = { dir, hitmarks, frames: {}, elements: [...elements].sort(), unresolved }
  for (const [name, entry] of Object.entries(frames)) {
    if (entry.simple !== null) { out.frames[name] = [entry.simple]; continue }
    const last = Math.max(...entry.byIndex.keys())
    out.frames[name] = Array.from({ length: last + 1 }, (_, i) => (entry.byIndex.has(i) ? entry.byIndex.get(i) : null))
  }
  return out
}

const dirs = fs.readdirSync(CHARS_ROOT).filter((n) => fs.statSync(path.join(CHARS_ROOT, n)).isDirectory()).sort()
fs.mkdirSync(OUT_DIR, { recursive: true })
const report = { dirs: dirs.length, parsed: 0, withHitmarks: 0, withNormalFrames: 0, withElements: 0, skipped: [], unresolved: [] }
for (const dir of dirs) {
  let data
  try {
    data = parseDir(dir)
  } catch (error) {
    report.skipped.push(`${dir}：${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  report.parsed++
  if (Object.keys(data.hitmarks).length) report.withHitmarks++
  if (Object.keys(data.frames).length) report.withNormalFrames++
  if (data.elements.length) report.withElements++
  if (data.unresolved.length) report.unresolved.push({ dir, items: data.unresolved })
  fs.writeFileSync(path.join(OUT_DIR, `${dir}.json`), JSON.stringify(data, null, 2) + "\n", "utf8")
}
fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2) + "\n", "utf8")
console.log(JSON.stringify({ dirs: report.dirs, withHitmarks: report.withHitmarks, withElements: report.withElements, unresolved: report.unresolved.length }))
