/** 可重跑：默认 dry-run；--write 才迁移。不会读写外部 Word。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeGuide, normalizePreset, PRESET_WEIGHTS } from './lib/guide-presets.mjs'
import { MODULE_KEYS } from './lib/schema.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const copy = x => JSON.parse(JSON.stringify(x))
const direction = label => /^(输出|输出向|主[Cc]|副[Cc])$/.test(String(label || '').trim()) ? 'dps' : /^(辅助|辅助向|纯辅)$/.test(String(label || '').trim()) ? 'support' : ''
export function migrateGuide (raw) {
  if (raw.schema === 3) return { guide: normalizeGuide(raw), review: [], split: false }
  const review = []
  const roles = new Set(MODULE_KEYS.flatMap(k => (raw.v2?.[k] || []).map(r => direction(r.label))).filter(Boolean))
  if (roles.size < 2) return { guide: normalizeGuide(raw), review, split: false }
  const presets = ['dps', 'support'].map(role => normalizePreset({ ...copy(raw), id: role, name: role === 'dps' ? '输出' : '辅助', role, match: { names: [role === 'dps' ? '输出' : '辅助'] }, weights: PRESET_WEIGHTS[role], v2: {} }))
  for (const key of MODULE_KEYS) {
    let current = ''
    const rows = raw.v2?.[key] || []
    const hasDirections = rows.some(r => direction(r.label))
    for (const [i, row] of rows.entries()) {
      const explicit = direction(row.label)
      // 套装段的紧邻主/副词条属于该套装分段；其他无标签行不沿用方向，避免猜测。
      if (explicit) current = explicit
      const inherited = key === 'artifacts' && ['main', 'sub', 'note'].includes(row.kind) && !row.label ? current : ''
      const role = explicit || inherited
      if (role) presets.find(p => p.role === role).v2[key].push(copy(row))
      else {
        for (const p of presets) p.v2[key].push(copy(row))
        if (hasDirections || /输出|辅助|主[Cc]|副[Cc]/.test(String(row.label || ''))) review.push({ name: raw.name, module: key, row: i + 1, label: row.label || '', reason: '归属未明确，原行完整复制到两份，请人工核对；未自动删改内容' })
      }
    }
  }
  return { guide: normalizeGuide({ ...raw, presets }), review, split: true }
}
export function migrateDirectory (dir, write = false) {
  const report = { dryRun: !write, converted: [], split: [], review: [] }
  for (const file of fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.startsWith('_'))) {
    const full = path.join(dir, file)
    const raw = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''))
    if (raw.schema === 3) continue
    const result = migrateGuide(raw)
    report.converted.push(raw.name)
    if (result.split) report.split.push(raw.name)
    report.review.push(...result.review)
    if (write) fs.writeFileSync(full, JSON.stringify(result.guide, null, 2) + '\n')
  }
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = process.argv.indexOf('--dir')
  const dir = arg >= 0 ? path.resolve(process.argv[arg + 1]) : path.join(root, 'data', 'gi')
  if (!dir.startsWith(root + path.sep)) throw new Error('迁移目录必须在项目内')
  const report = migrateDirectory(dir, process.argv.includes('--write'))
  fs.mkdirSync(path.join(root, 'out'), { recursive: true })
  fs.writeFileSync(path.join(root, 'out', 'guide-presets-migration.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
