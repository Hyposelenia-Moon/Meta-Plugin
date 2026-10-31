import fs from "node:fs"
import path from "node:path"

/**
 * 生成角色名录 `data/team-sim/roster.json`：charId ↔ 中文名 ↔ gcsim 英文键 ↔ gcsim 目录。
 *
 * 两个来源都必须是版本化文件，不联网、不做拼音或模糊匹配：
 *   1. miao-plugin `resources/meta-gs/character/<中文名>/data.json`：charId、名字、元素、武器、星级；
 *   2. gcsim 本地源码：`ui/packages/localization/src/locales/names.dm.json` 的
 *      `Chinese.character_names`（全键 → 中文官方名）与 `pkg/shortcut/character.dm.go`
 *      （别名 → 枚举名，枚举名小写即全键）。
 * 中文名对不上的一律写 no-gcsim，不猜。
 */

const MIAO_ROOT = process.env.MIAO_ROOT ?? "D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs/character"
const GCSIM_ROOT = process.env.GCSIM_ROOT ?? "out/gcsim"
const OUT_ROSTER = "data/team-sim/roster.json"
const OUT_DRAFT = "out/roster-map.draft.json"

const GAME_VERSION = "7.1"
const GCSIM_COMMIT = "fcc117b31ce45010ded40e48e6adcc2676306015"
const SOURCE = "miao-plugin meta-gs 角色表 + gcsim names.dm.json（Chinese.character_names）+ pkg/shortcut/character.dm.go"

const namesPath = path.join(GCSIM_ROOT, "ui/packages/localization/src/locales/names.dm.json")
const overridePath = path.join(GCSIM_ROOT, "ui/packages/localization/src/locales/names.override.json")
const shortcutPath = path.join(GCSIM_ROOT, "pkg/shortcut/character.dm.go")
const charsRoot = path.join(GCSIM_ROOT, "internal/characters")

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))

// 全键 → 中文名。names.dm.json 与 names.override.json 都取 Chinese.character_names，后者覆盖前者。
const keyToCn = new Map()
for (const p of [namesPath, overridePath]) {
  const j = readJson(p)
  for (const [key, cn] of Object.entries(j?.Chinese?.character_names ?? {})) keyToCn.set(key, cn)
}
const cnToKey = new Map()
for (const [key, cn] of keyToCn) if (!cnToKey.has(cn)) cnToKey.set(cn, key)

// 别名 → 枚举名；枚举名小写即全键（gcsim 的本地化键就是枚举名小写）。
const shortcut = fs.readFileSync(shortcutPath, "utf8")
const enumToKey = new Map()
const aliasToEnum = new Map()
for (const m of shortcut.matchAll(/"([a-z0-9_]+)":\s*keys\.([A-Za-z0-9]+)/g)) {
  const alias = m[1]
  const enumName = m[2]
  if (!aliasToEnum.has(alias)) aliasToEnum.set(alias, enumName)
  if (!enumToKey.has(enumName)) enumToKey.set(enumName, enumName.toLowerCase())
}
const dirToKey = new Map()
for (const [alias, enumName] of aliasToEnum) dirToKey.set(alias, enumToKey.get(enumName))

// gcsim 目录 → 全键；全键 → 目录。traveler 没有别名，由 names.override.json 的 aether*/lumine* 键组成。
const gcsimDirs = fs.readdirSync(charsRoot).filter((n) => fs.statSync(path.join(charsRoot, n)).isDirectory()).sort()
const keyToDir = new Map()
for (const dir of gcsimDirs) {
  const key = dirToKey.get(dir)
  if (key) keyToDir.set(key, dir)
}
const travelerKeys = [...keyToCn.keys()].filter((k) => /^(aether|lumine)/.test(k)).sort()
const aetherKeys = travelerKeys.filter((k) => k.startsWith("aether"))
const lumineKeys = travelerKeys.filter((k) => k.startsWith("lumine"))

// 旅行者按 charId 裁决：miao 的空（10000005）/荧（10000007）各自展开成七个元素键；
// 「旅行者」（20000000）只是别名，不再占用键；奇偶·男性（10000117）/奇偶·女性（10000118）
// 是 miao 本地条目，gcsim 没有同名角色，按 no-gcsim 记。
const TRAVELER_BY_ID = new Map([
  ["10000005", { keys: aetherKeys, dir: "traveler", elementMode: "aether" }],
  ["10000007", { keys: lumineKeys, dir: "traveler", elementMode: "lumine" }],
])
const ALIAS_OF = new Map([["20000000", "10000005 / 10000007"]])

const characters = []
const duplicates = []
for (const dir of fs.readdirSync(MIAO_ROOT).sort()) {
  if (dir === "common") continue
  const dataPath = path.join(MIAO_ROOT, dir, "data.json")
  if (!fs.existsSync(dataPath)) continue
  let j
  try {
    j = readJson(dataPath)
  } catch {
    continue
  }
  const charId = String(j.id ?? "")
  const cn = String(j.name ?? dir)
  if (!charId) continue
  const base = {
    charId,
    cn,
    element: j.elem ?? null,
    weapon: j.weapon ?? null,
    star: j.star ?? null,
  }
  const traveler = TRAVELER_BY_ID.get(charId)
  if (traveler) {
    characters.push({ ...base, keys: traveler.keys, dir: traveler.dir, status: "traveler", note: "按元素展开为七个 gcsim 键" })
    continue
  }
  const aliasOf = ALIAS_OF.get(charId)
  if (aliasOf) {
    characters.push({ ...base, keys: [], dir: null, status: "alias", note: `与 ${aliasOf} 同源，不单独占用键` })
    continue
  }
  const key = cnToKey.get(cn)
  const gcsimDir = key ? keyToDir.get(key) : undefined
  if (key && gcsimDir) {
    characters.push({ ...base, keys: [key], dir: gcsimDir, status: "mapped" })
  } else {
    const reason = key && !gcsimDir ? `中文名 ${cn} 命中 ${key}，但 gcsim 没有该角色的目录` : `gcsim 本地化表里没有中文名 ${cn}`
    characters.push({ ...base, keys: [], dir: null, status: "no-gcsim", note: reason })
  }
}

// 一个 charId 只允许一条记录；一个键只允许一个 charId（旅行者的七个元素键除外，它们是同一人的七种形态）。
const seenIds = new Set()
const keyOwner = new Map()
for (const c of characters) {
  if (seenIds.has(c.charId)) duplicates.push(`charId 重复：${c.charId}`)
  seenIds.add(c.charId)
  for (const k of c.keys) {
    if (keyOwner.has(k)) duplicates.push(`键 ${k} 同时属于 ${keyOwner.get(k)} 与 ${c.charId}`)
    else keyOwner.set(k, c.charId)
  }
}
if (duplicates.length) {
  console.error("映射冲突，未写文件：\n" + duplicates.join("\n"))
  process.exit(1)
}

const count = (status) => characters.filter((c) => c.status === status).length
const roster = {
  schemaVersion: 1,
  gameVersion: GAME_VERSION,
  gcsimCommit: GCSIM_COMMIT,
  source: SOURCE,
  counts: {
    characters: characters.length,
    mapped: count("mapped"),
    traveler: count("traveler"),
    alias: count("alias"),
    "no-gcsim": count("no-gcsim"),
  },
  characters,
}

fs.mkdirSync(path.dirname(OUT_ROSTER), { recursive: true })
fs.writeFileSync(OUT_ROSTER, JSON.stringify(roster, null, 2) + "\n", "utf8")

// 草稿给人工核对：按状态分组列出，便于一眼看差集。
const draft = {
  counts: roster.counts,
  "no-gcsim": characters.filter((c) => c.status === "no-gcsim").map((c) => `${c.cn}（${c.charId}）：${c.note}`),
  traveler: characters.filter((c) => c.status !== "mapped").filter((c) => c.status !== "no-gcsim").map((c) => `${c.cn}（${c.charId}，${c.status}）`),
  gcsimOnly: [...keyToCn.entries()].filter(([, cn]) => !characters.some((c) => c.cn === cn)).map(([key, cn]) => `${key}：${cn}`),
}
fs.mkdirSync(path.dirname(OUT_DRAFT), { recursive: true })
fs.writeFileSync(OUT_DRAFT, JSON.stringify(draft, null, 2) + "\n", "utf8")
console.log(JSON.stringify(roster.counts))
