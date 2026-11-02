import fs from 'node:fs'
import path from 'node:path'

/**
 * 把 out/eq-drafts/<batch>.json 合并进 data/team-sim/curated/<key>.json。
 *
 * 约定：
 *   - roster 的 `keys[0]` 才是动作包键（gcsim 目录名可能不同，如 kazuha → kaedeharakazuha）；
 *   - 动作 id / actorId 一律重写成 `<key>.<kind>` / `<key>`，避免目录名混入；
 *   - action 内的 notes 提升到文件根级 notes（内核只认 ActionSpec 字段）；
 *   - 写出前校验 charId 与 roster 一致、动作 id 不重复。
 *
 * 用法：node scripts/merge-eq-drafts.mjs out/eq-drafts/batch2.json
 */

const batchPath = process.argv[2]
if (!batchPath) {
  console.error('用法：node scripts/merge-eq-drafts.mjs <batch.json>')
  process.exit(1)
}

const roster = JSON.parse(fs.readFileSync('data/team-sim/roster.json', 'utf8'))
const rosterEntries = roster.entries ?? roster.characters ?? []
const byCn = new Map(rosterEntries.map(e => [e.cn, e]))
const byKey = (key) => rosterEntries.find(e => (e.keys ?? []).includes(key))
const OUT_DIR = 'data/team-sim/curated'

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'))
const report = { written: [], skipped: [] }

// 两种草稿形态都收：{ entries: [...] }（多人一批）与单角色 { key, actions: [...] }
const draftEntries = Array.isArray(batch.entries) && batch.entries.length
  ? batch.entries
  : batch.key && batch.actions
    ? [{ ...batch, cn: batch.cn ?? byKey(batch.key)?.cn }]
    : []

for (const entry of draftEntries) {
  const rosterEntry = entry.cn ? byCn.get(entry.cn) : byKey(entry.key)
  if (!rosterEntry) { report.skipped.push(`${entry.cn ?? entry.key}：名录里没有这个角色`); continue }
  const key = rosterEntry.keys?.[0]
  if (!key) { report.skipped.push(`${entry.cn}：名录没有 keys[0]`); continue }
  if (entry.charId && String(entry.charId) !== String(rosterEntry.charId)) {
    report.skipped.push(`${entry.cn}：charId ${entry.charId} 与名录 ${rosterEntry.charId} 不一致`)
    continue
  }

  const notes = [...(entry.notes ?? [])]
  const actions = {}
  // 草稿里的 actions 可能是数组（多人批次/单角色数组形态），也可能是以动作为键的对象
  const rawActions = Array.isArray(entry.actions) ? entry.actions : Object.values(entry.actions ?? {})
  for (const action of rawActions) {
    const { notes: actionNotes, ...rest } = action
    if (Array.isArray(actionNotes)) for (const n of actionNotes) notes.push(`${rest.kind ?? 'action'}：${n}`)
    const kind = String(rest.kind ?? '').trim()
    if (!kind) { report.skipped.push(`${entry.cn}：动作缺 kind`); continue }
    const id = `${key}.${kind}`
    if (actions[id]) { report.skipped.push(`${entry.cn}：动作 ${id} 重复`); continue }
    actions[id] = { ...rest, id, actorId: key }
  }
  if (!Object.keys(actions).length) { report.skipped.push(`${entry.cn}：没有可用动作`); continue }

  const evidence = (entry.evidence ?? []).slice(0, 6).map(x => `${x.where}（${x.what}）`).join('；')
  const file = {
    key,
    gameVersion: batch.gameVersion ?? '7.1',
    source: `${batch.source ?? 'gcsim 源码 + miao 天赋10级'}。证据：${evidence}`,
    notes,
    actions
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), JSON.stringify(file, null, 2) + '\n', 'utf8')
  report.written.push(`${key}（${Object.keys(actions).length} 个动作，${notes.length} 条 notes）`)
}

console.log(JSON.stringify(report, null, 2))
if (report.skipped.length) process.exitCode = 2
