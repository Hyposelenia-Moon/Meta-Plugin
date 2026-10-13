/**
 * 等价性套件（阶段 1.3b）：我们的视图模型 vs Atlas 的 codex 解析输出
 *
 * 依据：Atlas 的 `model/codexIndex/display.js` 与维护者区 `scripts/lib/guide-display.mjs`
 * 是"逐字节同规则"的镜像（数据仓库 `scripts/check-display-sync.mjs` 校验），
 * 且 Atlas 的 `buildV2Sections()` 同样调 `normalizeGuideSections(...)`，
 * 所以两边**应该产出同构同值的六模块**。本套件把这件事变成断言。
 *
 * 前置：需要 Atlas 仓库在场（开发工作区里有 `..\Atlas-Plugin`；bot 部署副本里没有 → **跳过并 exit 0**）。
 * 路径可用 `META_ATLAS_DIR` 覆盖。
 *
 * 对照方式：把两边都投影成同一组字段（title/kind/empty/rows[label,labelClass,items]/teams），
 * 忽略 Atlas 特有的 `badge`、`iconRef`、`image` 等展示附属字段，只比"信息"。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, dataDir, libDir, pluginRoot, readJson } from './_helper.mjs'

const { push, ok, report } = createChecks('等价性（vs Atlas codex 解析）')

const atlasDir = process.env.META_ATLAS_DIR || path.resolve(pluginRoot, '..', 'Atlas-Plugin')
const parseFile = path.join(atlasDir, 'model', 'codexIndex', 'parse.js')

if (!fs.existsSync(parseFile)) {
  console.log(`跳过：未找到 Atlas-Plugin（${atlasDir}）；bot 部署副本里没有它属正常，开发工作区里可以设 META_ATLAS_DIR`)
  process.exit(0)
}

const { parseGuideJson } = await import(pathToFileURL(parseFile).href)
const { buildCodexView } = await import(pathToFileURL(path.join(libDir, 'modules', 'subViews.js')).href)
const { CodexStore } = await import(pathToFileURL(path.join(libDir, 'model', 'CodexStore.js')).href)

const store = new CodexStore()
const giDir = path.join(dataDir, 'gi')

/** 投影成可比字段 */
function project (sections) {
  return (sections ?? []).map(section => ({
    title: section.title ?? '',
    kind: section.kind ?? null,
    empty: !!section.empty,
    rows: (section.rows ?? []).map(row => ({
      label: row.label ?? '',
      labelClass: row.labelClass ?? '',
      items: (row.items ?? []).map(item => ({
        text: item.text ?? '',
        note: item.note ?? '',
        ref: item.ref ?? '',
        sepAfter: item.sepAfter ?? '',
        sig: !!item.sig,
        sigAlt: !!item.sigAlt
      }))
    })),
    teams: (section.teams ?? []).map(team => ({
      tag: team.tag ?? '',
      tagClass: team.tagClass ?? '',
      text: team.text ?? '',
      members: (team.members ?? []).map(member => ({ name: member.name ?? '', note: member.note ?? '' }))
    }))
  }))
}

/** 找出两份投影的第一处差异（给可读定位） */
function firstDiff (a, b, trail = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${trail}: 长度 ${a.length} vs ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${trail}[${i}]`)
      if (d) return d
    }
    return `${trail}: 数组不同`
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], `${trail}.${k}`)
      if (d) return d
    }
    return `${trail}: 对象不同`
  }
  return `${trail}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
}

const sampled = store.listCharacters().slice(0, 20)
ok('抽样角色数 ≥ 10', sampled.length >= 10)

const diffs = []
let compared = 0
for (const name of sampled) {
  const data = readJson(path.join(giDir, `${name}.json`))
  const ours = project(buildCodexView(data, {
    signature: store.getSignature(name),
    weaponTags: store.getWeaponTags()
  }).sections)
  const theirsCard = parseGuideJson(data, { fileDir: giDir, fileName: name })
  if (!theirsCard) {
    diffs.push(`${name}: Atlas 判定为非攻略 JSON`)
    continue
  }
  compared++
  const theirs = project(theirsCard.sections)
  const diff = firstDiff(ours, theirs, name)
  if (diff) diffs.push(diff)
}

ok(`已对照角色数 = 抽样数（${compared}）`, compared === sampled.length)

if (diffs.length) {
  console.log(`✗ 与 Atlas 不一致 ${diffs.length}/${compared} 个角色；前 5 条：`)
  for (const d of diffs.slice(0, 5)) console.log(`   - ${d}`)
}
push('六模块投影逐字段一致', diffs, [])

const bad = report()
process.exit(bad ? 1 : 0)
