import fs from "node:fs"
import path from "node:path"
const root = "D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs/character"
const outDir = "out/roster"
fs.mkdirSync(outDir, { recursive: true })
const num = (s) => { const m = String(s).match(/-?\d+(\.\d+)?%?/); if (!m) return null; const v = parseFloat(m[0].replace("%", "")); return Number.isFinite(v) ? v / 100 : null }
const slots = { a: ["一段伤害","二段伤害","三段伤害","四段伤害","五段伤害"], e: ["技能伤害","持续伤害","领域伤害"], q: ["技能伤害","持续伤害","爆发伤害"] }
const report = { characters: 0, drafts: 0, hits: 0, noFrames: 0, byAction: { a: 0, e: 0, q: 0 } }
for (const dir of fs.readdirSync(root)) {
  const p = path.join(root, dir, "data.json")
  if (!fs.existsSync(p)) continue
  let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")) } catch { continue }
  report.characters++
  const pack = { id: `roster:${dir}`, gameVersion: null, source: "miao data.json（倍率）+ 帧数缺失", actions: {}, missing: ["frames", "hitlag", "aura"] }
  for (const key of ["a", "e", "q"]) {
    const tables = j.talent?.[key]?.tables ?? []
    const hits = []
    for (const t of tables) {
      if (!Array.isArray(t.values)) continue
      const v = num(t.values[9] ?? t.values[0])
      if (v === null) continue
      if (!/伤害|倍率/.test(t.name)) continue
      hits.push({ name: t.name, motionValue: v })
    }
    if (!hits.length) continue
    pack.actions[`${dir}.${key}`] = { id: `${dir}.${key}`, timing: null, hits: hits.map((h) => ({ motionValue: h.motionValue, scaling: key === "a" ? "atk" : "atk", element: "physical", canCrit: true, atFrame: null })) }
    report.hits += hits.length
    report.byAction[key]++
  }
  if (Object.keys(pack.actions).length) { report.drafts++; fs.writeFileSync(path.join(outDir, `${dir}.json`), JSON.stringify(pack, null, 2) + "\n", "utf8") }
}
fs.writeFileSync("out/roster-report.json", JSON.stringify(report, null, 2) + "\n", "utf8")
console.log(JSON.stringify(report))
