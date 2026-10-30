/**
 * 清理独立预设里重复的方向标签（2026-10-30 用户定）
 *
 * 背景：预设有自己的名字/角色（`输出` / `辅助`），武器、圣遗物、面板行再写
 * `输出` / `辅助` / `输出向` / `主c` 这类标签只是重复，页面上还会被当成方向短标签。
 *
 * 口径：
 *   - 只清理**与 preset.role 同义**的标签；`循环` / `满拐` / `月绽放` / `宗室` 这类
 *     流派/构筑标签保留（它们不是预设方向）。
 *   - 武器行：去掉方向标签，没有档位时补 `tier: 1`（显示为「推荐」，文档仍可往返）。
 *   - 圣遗物行：方向标签改为该 kind 的标准档位名（`推荐` / `可选` / `过渡`）。
 *   - 面板行：方向标签去掉；`属性：数值` 形态转成 `{k, v}`，文档往返不丢信息。
 *
 * 用法：
 *   node scripts/clean-preset-role-labels.mjs            # 只报告，不写盘
 *   node scripts/clean-preset-role-labels.mjs --write    # 写回 data/gi/*.json
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const write = process.argv.includes('--write')
const dataDir = path.join(root, 'data', 'gi')
const reportFile = path.join(root, 'out', 'preset-role-labels.json')

const ROLE_LABEL = {
  dps: /^(?:输出|输出向|主[cC]|主[cC]向|站场|站场输出|速切)$/,
  support: /^(?:辅助|辅助向|纯辅|治疗|奶妈|盾辅|护盾|增伤|充能辅)$/
}
const ARTIFACT_HEAD = { preferred: '推荐', optional: '可选', transition: '过渡' }

const details = []
let changedFiles = 0
let changedRows = 0

function roleOf (preset) {
  return preset?.role === 'support' ? 'support' : 'dps'
}

function cleanWeapon (row) {
  if (!row || typeof row !== 'object') return false
  const label = String(row.label ?? '').trim()
  if (!label || !ROLE_LABEL[roleOf(currentPreset)].test(label)) return false
  details.push({ file: currentFile, preset: currentPreset.name, module: 'weapons', from: label, to: '推荐' })
  row.label = null
  if (!Number(row.tier)) row.tier = 1
  return true
}

function cleanArtifact (row) {
  if (!row || typeof row !== 'object') return false
  const label = String(row.label ?? '').trim()
  if (!label || !ROLE_LABEL[roleOf(currentPreset)].test(label)) return false
  const kind = String(row.kind ?? '').trim()
  const head = ARTIFACT_HEAD[kind]
  if (!head) return false
  details.push({ file: currentFile, preset: currentPreset.name, module: 'artifacts', from: label, to: head })
  row.label = head
  return true
}

function cleanPanel (row) {
  if (!row || typeof row !== 'object') return false
  const label = String(row.label ?? '').trim()
  if (!label || !ROLE_LABEL[roleOf(currentPreset)].test(label)) return false
  const text = String(row.text ?? '').trim()
  const kv = text.match(/^([^：:]{1,12})[：:]\s*(.+)$/)
  if (!kv) return false
  const k = kv[1].trim()
  const v = kv[2].trim()
  if (!k || !v) return false
  details.push({ file: currentFile, preset: currentPreset.name, module: 'panels', from: label, to: `${k}：${v}` })
  delete row.text
  row.label = null
  row.k = k
  row.v = v
  return true
}

let currentFile = ''
let currentPreset = null
for (const file of fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort()) {
  const full = path.join(dataDir, file)
  const raw = fs.readFileSync(full, 'utf8')
  const doc = JSON.parse(raw)
  if (!Array.isArray(doc.presets)) continue
  let touched = 0
  currentFile = file.replace(/\.json$/, '')
  for (const preset of doc.presets) {
    currentPreset = preset
    for (const row of preset.v2?.weapons ?? []) if (cleanWeapon(row)) touched++
    for (const row of preset.v2?.artifacts ?? []) if (cleanArtifact(row)) touched++
    for (const row of preset.v2?.panels ?? []) if (cleanPanel(row)) touched++
  }
  if (touched) {
    changedFiles++
    changedRows += touched
    if (write) fs.writeFileSync(full, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  }
}

const report = { write, changedFiles, changedRows, details }
if (write) {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true })
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8')
}
console.log(JSON.stringify({ write, changedFiles, changedRows }, null, 2))
for (const item of details) console.log(`${item.file} / ${item.preset} / ${item.module}: ${item.from} → ${item.to}`)
if (!write) console.log('\n（dry-run；加 --write 写回 data/gi）')
