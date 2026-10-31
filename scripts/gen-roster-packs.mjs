import fs from "node:fs"
import path from "node:path"

/**
 * 由「角色名录 + gcsim 帧 + miao 倍率」生成每人一份数据包：data/team-sim/packs/<key>.json。
 *
 * 只产出普通攻击（scaling=atk、命中元素取自 gcsim attack.go），一段一式：
 *   - 倍率取 miao talentData 的天赋 10 级（索引 9），与 docs/队伍模拟-P1数据包格式.md §16 一致；
 *   - 天赋行与 gcsim 命中段数量不等就不绑，记 missing，不凑数；
 *   - 战技/爆发/重击的 scaling（atk/hp/def）无法离线判定，v1 不落包，只在报告里列出待确认项；
 *   - 帧数是 gcsim 的 60fps 口径，跨档位怎么折算另议，包内不自作换算。
 */

const MIAO_ROOT = process.env.MIAO_ROOT ?? "D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs/character"
const ROSTER = "data/team-sim/roster.json"
const FRAMES_DIR = "out/frames"
const OUT_DIR = "data/team-sim/packs"
const OUT_REPORT = "out/roster-packs-report.json"
/** 人工核对过的动作覆盖（战技/爆发/重击），与自动生成的普攻合并成同一份包。 */
const CURATED_DIR = "data/team-sim/curated"

const GAME_VERSION = "7.1"
const GCSIM_COMMIT = "fcc117b31ce45010ded40e48e6adcc2676306015"
const SOURCE = `miao-plugin ${GAME_VERSION} 天赋 10 级倍率 + gcsim ${GCSIM_COMMIT.slice(0, 7)} 命中帧与收尾帧（60fps 口径）`

const TALENT_INDEX = 9 // 1 级起算的第 10 项
const NUMERALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const round4 = (value) => Math.round(value * 10000) / 10000

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))

/** 天赋里的「N 段伤害」行：只接受「一段伤害」这种纯名称；段数与 gcsim 命中段对不上就不绑。 */
function normalRows(talentData) {
  const table = talentData && typeof talentData === "object" ? talentData.a : undefined
  if (!table || typeof table !== "object") return []
  const rows = []
  for (const [key, values] of Object.entries(table)) {
    const m = /^([一二三四五六七八九十]+)段伤害$/.exec(key)
    if (!m || !Array.isArray(values)) continue
    rows.push({ key, index: NUMERALS[m[1]], values })
  }
  return rows.sort((a, b) => a.index - b.index)
}

/**
 * 同一段在 gcsim 里可能拆成多个命中帧（香菱第 4 段 4 帧、第 3 段 2 帧）。
 * 此时天赋的「N段伤害」是整段合计，逐帧倍率在 miao 的「N段伤害2」里：多数是逐帧展开
 * （[51.51, 51.51]），等值的写成 [27.88, 4]（倍率 + 重复次数）。两者都按命中帧数还原，
 * 合计与整段对不上就不认，退回「整段均分」并记录。
 */
function splitRows(talentData) {
  const table = talentData && typeof talentData === "object" ? talentData.a : undefined
  const rows = new Map()
  if (!table || typeof table !== "object") return rows
  for (const [key, values] of Object.entries(table)) {
    const m = /^([一二三四五六七八九十]+)段伤害2$/.exec(key)
    if (!m || !Array.isArray(values)) continue
    rows.set(NUMERALS[m[1]], values)
  }
  return rows
}

const nearTotal = (sum, total) => Math.abs(sum - total) <= Math.max(0.02, Math.abs(total) * 0.005)

/** 把「N段伤害2」的 10 级项还原成 k 个逐帧倍率（百分比）；对不上返回 null。 */
function perHitValues(raw, hitCount, totalPercent) {
  if (!Array.isArray(raw)) return null
  const nums = raw.filter((v) => Number.isFinite(v))
  if (nums.length === hitCount && nearTotal(nums.reduce((a, b) => a + b, 0), totalPercent)) return nums
  if (nums.length === 2 && Number.isInteger(nums[1]) && nums[1] === hitCount && nearTotal(nums[0] * hitCount, totalPercent)) 
    return Array.from({ length: hitCount }, () => nums[0])
  return null
}

// gcsim 各角色对「普通攻击命中帧」的命名不统一：多数是 attackHitmarks，也有 attackReleases、
// 流浪者用 attackReleaseNormal（常态）/ attackReleaseE（战技态）。只认这些明确名字，不按前缀猜。
const HITMARK_CANDIDATES = ["attackHitmarks", "attackReleases", "attackReleaseNormal", "attackHitmarksNormal", "normalHitmarks"]
const FRAME_CANDIDATES = ["attackFrames", "attackFramesNormal", "normalFrames"]

const pickByName = (table, candidates) => {
  if (!table || typeof table !== "object") return null
  for (const name of candidates) if (Object.prototype.hasOwnProperty.call(table, name)) return name
  return null
}

const roster = readJson(ROSTER)
const characters = Array.isArray(roster.characters) ? roster.characters : []
const report = { characters: characters.length, packs: 0, actions: 0, hits: 0, multiHitSegments: 0, splitFromTalent: 0, curated: 0, skipped: [], partial: [] }

const targets = characters.filter((c) => c.status === "mapped")
for (const character of targets) {
  const key = character.keys?.[0]
  const dir = character.dir
  const framesPath = path.join(FRAMES_DIR, `${dir}.json`)
  const reasons = []
  if (!key) reasons.push("名录里没有英文键")
  if (!dir) reasons.push("名录里没有 gcsim 目录")
  if (!fs.existsSync(framesPath)) reasons.push(`没有帧数据 ${framesPath}`)
  const dataPath = path.join(MIAO_ROOT, character.cn, "data.json")
  if (!fs.existsSync(dataPath)) reasons.push(`没有 miao 数据 ${dataPath}`)
  if (reasons.length) {
    report.skipped.push({ key: key ?? character.cn, dir, reasons })
    continue
  }

  const frames = readJson(framesPath)
  const miao = readJson(dataPath)
  const hitmarkName = pickByName(frames.hitmarks, HITMARK_CANDIDATES)
  const framesName = pickByName(frames.frames, FRAME_CANDIDATES)
  const segments = hitmarkName ? frames.hitmarks[hitmarkName] : null
  const durations = framesName ? frames.frames[framesName] : null
  const rows = normalRows(miao.talentData)

  if (!segments) reasons.push("gcsim 里没有普通攻击命中帧声明")
  if (!durations) reasons.push("gcsim 里没有普通攻击收尾帧声明")
  if (!rows.length) reasons.push("miao 里没有「N 段伤害」行")
  if (segments && rows.length && rows.length !== segments.length) {
    reasons.push(`天赋行 ${rows.length} 条与命中段 ${segments.length} 段对不上，不绑`)
  }
  if (segments && durations && segments.length > durations.length) reasons.push("收尾帧条数少于命中段数")
  if (reasons.length) {
    report.skipped.push({ key, dir, reasons })
    continue
  }

  const values = rows.map((row) => row.values)
  if (values.some((v) => !Number.isFinite(v[TALENT_INDEX]) || v[TALENT_INDEX] <= 0)) {
    report.skipped.push({ key, dir, reasons: ["天赋 10 级倍率缺失或非正数"] })
    continue
  }

  const elements = Array.isArray(frames.elements) ? frames.elements.filter((e) => e && e !== "physical") : []
  // 只有法器角色的普攻天生带元素；单手剑/双手剑/长柄/弓在 gcsim 里写出的 Element 多是附魔态（雷神 Q、宵宫 E、
  // 重云 E、达达利亚 E…），不是常态普攻，这里一律按物理落包并记录，避免把附魔伤害当成基础伤害。
  const isCatalyst = String(character.weapon ?? "").toLowerCase() === "catalyst"
  const element = isCatalyst && elements.length === 1 ? elements[0] : "physical"

  const actions = {}
  const dropped = []
  const assumed = []
  const splits = splitRows(miao.talentData)
  segments.forEach((segment, i) => {
    const duration = durations[i]
    const id = `${key}.normal-${i + 1}`
    if (!Number.isInteger(duration) || duration <= 0) {
      dropped.push(`${id} 收尾帧不是正整数`)
      return
    }
    const hitFrames = segment.filter((frame) => Number.isInteger(frame) && frame >= 0).sort((a, b) => a - b)
    if (!hitFrames.length) {
      dropped.push(`${id} 没有命中帧`)
      return
    }
    const totalPercent = values[i][TALENT_INDEX]
    const split = hitFrames.length > 1 ? perHitValues(splits.get(i + 1)?.[TALENT_INDEX], hitFrames.length, totalPercent) : null
    if (hitFrames.length > 1 && !split) {
      assumed.push(`${id} 同段 ${hitFrames.length} 帧没有可用拆分行，按整段合计均分`)
    }
    const perHit = split ?? Array.from({ length: hitFrames.length }, () => totalPercent / hitFrames.length)
    const hits = hitFrames.map((frame, k) => ({ atFrame: frame, motionValue: round4(perHit[k] / 100), scaling: "atk", element, canCrit: true }))
    // gcsim 允许末帧命中：命中帧等于收尾帧时，内核要求命中严格早于动作结束，这里顺延一帧并记录在案。
    let framesTotal = duration
    if (hits[hits.length - 1].atFrame === duration) framesTotal = duration + 1
    else if (hits[hits.length - 1].atFrame > duration) {
      dropped.push(`${id} 命中帧 ${hits[hits.length - 1].atFrame} 超出动作时长 ${duration}`)
      return
    }
    report.hits += hits.length
    if (hits.length > 1) report.multiHitSegments += 1
    if (hits.length > 1 && split) report.splitFromTalent += 1
    actions[id] = { id, actorId: key, kind: "normal", element, hits, timing: { type: "frames", frames: framesTotal } }
  })
  if (!Object.keys(actions).length) {
    report.skipped.push({ key, dir, reasons: dropped.length ? dropped : ["没有可落包的普通攻击段"] })
    continue
  }
  if (dropped.length) report.partial.push({ key, notes: [`部分段未落包：${dropped.join("；")}`] })
  if (assumed.length) report.partial.push({ key, notes: assumed })

  const approximate = []
  if (elements.length === 1 && !isCatalyst) approximate.push(`gcsim 里命中元素是 ${elements[0]}（附魔态），常态普攻按物理处理`)
  else if (elements.length !== 1) approximate.push(elements.length === 0 ? "命中元素未在 gcsim 声明，按物理处理" : `命中元素声明不唯一（${elements.join("/")}），按物理处理`)
  approximate.push("卡肉未填：hitlag 一律留空")
  approximate.push("附着与 ICD 未接：命中只结算直伤与倍率")

  // 人工核对过的动作（战技/爆发/重击）不在自动生成范围内，放在 curated/<key>.json 里覆盖：
  // 键冲突即报错退出，不做「后写覆盖」——那会让两份数据谁生效取决于读取顺序。
  const curatedPath = path.join(CURATED_DIR, `${key}.json`)
  let curatedCount = 0
  if (fs.existsSync(curatedPath)) {
    const curated = readJson(curatedPath)
    const curatedActions = curated && typeof curated.actions === 'object' ? curated.actions : {}
    for (const [id, action] of Object.entries(curatedActions)) {
      if (actions[id]) {
        console.error(`[gen-roster-packs] ${key} 的人工动作 ${id} 与自动生成的普攻键冲突`)
        process.exit(1)
      }
      if (!action || action.actorId !== key) {
        console.error(`[gen-roster-packs] ${key} 的人工动作 ${id} 的 actorId 必须等于 ${key}`)
        process.exit(1)
      }
      actions[id] = action
      curatedCount++
    }
    if (Array.isArray(curated?.notes)) approximate.push(...curated.notes)
  }

  const pack = { schemaVersion: 1, gameVersion: GAME_VERSION, source: SOURCE, actions }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), JSON.stringify(pack, null, 2) + "\n", "utf8")
  report.packs++
  report.actions += Object.keys(actions).length
  if (curatedCount) report.curated += curatedCount
  report.partial.push({ key, notes: approximate })
}

fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true })
fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2) + "\n", "utf8")
console.log(JSON.stringify({ characters: report.characters, packs: report.packs, actions: report.actions, curated: report.curated, skipped: report.skipped.length }))
