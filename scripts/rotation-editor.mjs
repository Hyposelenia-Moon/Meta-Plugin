/**
 * 轴编辑器 —— 手写/拼装 `data/team-sim/rotations/*.json` 的本地小工具（零依赖，只用 node: 内置模块）。
 *
 * 为什么单独一个进程：主插件跑在 Yunzai 里，没有给「写文件」开 HTTP 口子；
 * 这个脚本只在维护者本机跑，读 `data/team-sim/` 下的名录/动作包，保存前用**同一套**
 * `TeamSimStore.toRotation()` 校验，避免编辑器写出一份内核不认的轴。
 *
 * 用法：
 *   node scripts/rotation-editor.mjs [--port 8791] [--no-open]
 *   node scripts/rotation-editor.mjs --check      # 不开服务，跑一遍自检（CI/本地都能用）
 *
 * API（全部 JSON）：
 *   GET  /api/roster                 → 角色名录（能用的角色 + 动作数）
 *   GET  /api/actions?key=bennett    → 该角色动作包里的动作列表
 *   GET  /api/rotations              → 已入库的轴文件列表
 *   GET  /api/rotation?id=xxx        → 单份轴文件
 *   PUT  /api/rotation               → { file } 先校验再写 data/team-sim/rotations/<id>.json
 *   POST /api/validate               → { file } 只校验不写
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DATA = path.join(ROOT, 'data', 'team-sim')
const ROTATIONS = path.join(DATA, 'rotations')
const PACKS = path.join(DATA, 'packs')
const ROSTER = path.join(DATA, 'roster.json')
export const PAGE_DIR = path.join(ROOT, 'resources', 'editor-rotation')

const libUrl = (rel) => pathToFileURL(path.join(ROOT, 'lib', rel)).href
const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0))

export function loadRoster (file = ROSTER) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return (raw.characters || []).filter(entry => Array.isArray(entry.keys) && entry.keys.length)
}

export function loadPack (key, packsDir = PACKS) {
  return JSON.parse(fs.readFileSync(path.join(packsDir, `${key}.json`), 'utf8'))
}

/** 该角色能做哪些动作（给下拉框用；只列动作 id 与类型，不展开 hits）。 */
export function actionsOf (key, packsDir = PACKS) {
  const pack = loadPack(key, packsDir)
  return Object.keys(pack.actions ?? {}).map(id => {
    const action = pack.actions[id]
    const frames = action?.timing?.type === 'frames' ? action.timing.frames : null
    return {
      id,
      kind: String(action?.kind ?? ''),
      frames,
      hits: Array.isArray(action?.hits) ? action.hits.length : 0,
      energyCost: Number(action?.energyCost ?? 0) || 0,
      cooldownFrames: Number(action?.cooldownFrames ?? 0) || 0
    }
  })
}

/** 合并若干角色的动作包（与命令侧同一份 combineDataPacks）。 */
export async function composePack (keys) {
  const K = await import(libUrl('modules/teamSimulation/index.js'))
  const packs = keys.map(key => loadPack(key))
  return K.combineDataPacks(packs)
}

/**
 * 校验一份轴文件：用内核同一套 `toRotation`，返回可读的问题列表。
 * 成功时附带固化成固定轴后的步骤数，方便界面上显示「能排出来」。
 */
export async function validateFile (file) {
  const team = Array.isArray(file?.team) ? file.team : []
  const roster = loadRoster()
  const keys = team.map(id => roster.find(entry => entry.charId === id)?.keys?.[0])
  if (keys.some(key => !key)) {
    return { ok: false, issues: [{ code: 'invalid', path: 'team', message: '队伍里有角色不在名录（或没有可用动作包）' }] }
  }
  const merged = await composePack(keys)
  if (merged.status !== 'ok') {
    return { ok: false, issues: merged.issues ?? [{ code: 'unsupported', path: 'pack', message: '数据包合成失败' }] }
  }
  const S = await import(libUrl('model/TeamSimStore.js'))
  const converted = S.toRotation(file, merged.pack)
  if (converted.status !== 'ok') return { ok: false, issues: converted.issues }
  return {
    ok: true,
    issues: [],
    steps: converted.rotation.steps.length,
    actions: converted.rotation.steps.filter(step => step.kind === 'action').length,
    endFrame: Math.max(...converted.rotation.steps.map(step => step.atFrame ?? 0))
  }
}

/** 文件名只允许安全字符，避免写到 rotations 目录外。 */
export function safeId (id) {
  const text = String(id ?? '').trim()
  return /^[A-Za-z0-9._-]{1,64}$/.test(text) ? text : ''
}

const MIAO_META = process.env.MIAO_ROOT || 'D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs'

/** 圣遗物套装清单（id/名称）给面板下拉用。 */
export function artifactSets () {
  const raw = JSON.parse(fs.readFileSync(path.join(MIAO_META, 'artifact', 'data.json'), 'utf8'))
  return Object.entries(raw).map(([id, set]) => ({ id, name: String(set?.name ?? id) })).sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 武器清单（id/名称/星级/类型）。 */
export function weaponCatalog () {
  const base = path.join(MIAO_META, 'weapon')
  const out = []
  for (const type of fs.readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const dir = path.join(base, type.name)
    for (const sub of fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, sub.name, 'data.json'), 'utf8'))
        out.push({ id: String(data.id), name: String(data.name ?? sub.name), star: Number(data.star) || 4, type: type.name })
      } catch { /* 坏文件跳过 */ }
    }
  }
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'zh'))
}
/** 从面板输入拼 CharacterBuild（只构造，不算面板）。 */
async function buildMember (input) {
  const roster = loadRoster()
  const entry = roster.find(item => item.charId === String(input?.characterId ?? ''))
  if (!entry) return { ok: false, issues: [{ path: 'characterId', message: '名录里没有这个角色' }] }
  const weaponId = String(input?.weaponId ?? '')
  if (!weaponId) return { ok: false, issues: [{ path: 'weaponId', message: `${entry.cn} 还没选武器` }] }
  const refinement = Math.min(5, Math.max(1, Number(input?.refinement) || 1))
  const BUILT = await import(libUrl('modules/teamSimulation/build.js'))
  const PS = await import(libUrl('model/PermanentSource.js'))
  const runtime = PS.buildRuntimePermanent({ characterId: entry.charId, name: entry.cn, weaponId, refinement })
  if (!runtime.ok) return { ok: false, issues: [{ path: 'weaponId', message: runtime.error }] }
  const artifacts = (Array.isArray(input?.artifacts) ? input.artifacts : []).map(artifact => ({
    slot: String(artifact?.slot ?? ''),
    name: String(artifact?.setId ?? artifact?.slot ?? ''),
    setId: String(artifact?.setId ?? ''),
    rarity: 5,
    level: Number(artifact?.level) || 20,
    main: { key: String(artifact?.main?.key ?? ''), value: Number(artifact?.main?.value) || 0 },
    sub: (Array.isArray(artifact?.sub) ? artifact.sub : []).map(stat => ({ key: String(stat?.key ?? ''), value: Number(stat?.value) || 0 }))
  }))
  const build = {
    schemaVersion: 1,
    actorId: entry.keys[0],
    characterId: entry.charId,
    name: entry.cn,
    element: entry.element,
    level: Number(input?.level) || 90,
    ascension: 6,
    constellation: Number(input?.constellation) || 0,
    talents: { normal: 10, skill: 10, burst: 10, ...(input?.talents ?? {}) },
    weapon: { id: weaponId, name: weaponId, level: 90, ascension: 6, refinement },
    artifacts,
    requiredEffects: [],
    provenance: { provider: 'rotation-editor', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = BUILT.requiredEffectSources(build)
  return { ok: true, entry, build, runtime, BUILT }
}

/**
 * 面板试算（2026-11-02）：把 UI 的「角色 + 武器 + 圣遗物」拼成 CharacterBuild，
 * 走内核同一套 `buildPermanentStats` 算最终面板；失败时把 issues 原样返回给界面。
 */
export async function computePanel (input) {
  const member = await buildMember(input)
  if (!member.ok) return member
  const { build, runtime, BUILT } = member
  const expected = { gameVersion: runtime.data.gameVersion, bundleId: runtime.data.bundleId, source: runtime.data.source }
  const result = BUILT.buildPermanentStats(build, runtime.data, expected)
  if (result.status !== 'permanent-ready') return { ok: false, status: result.status, issues: result.issues ?? [] }
  return { ok: true, status: result.status, stats: result.stats, unmodeled: result.unmodeled ?? [], issues: result.issues ?? [] }
}

/** 用当前面板 + 当前轴真跑一次 DPS 标准（固定 110 级小宝）。 */
export async function simulatePanel (input) {
  const S = await import(libUrl('model/TeamSimStore.js'))
  const K = await import(libUrl('modules/teamSimulation/index.js'))
  const rotation = input?.rotation
  if (!rotation) return { ok: false, issues: [{ path: 'rotation', message: '先在「拼一条轴」里拼一条轴' }] }
  const panels = Array.isArray(input?.panels) ? input.panels : []
  if (!panels.length) return { ok: false, issues: [{ path: 'panels', message: '面板里还没有角色' }] }
  const members = []
  for (const panel of panels) {
    const member = await buildMember(panel)
    if (!member.ok) return member
    const permanent = S.loadPermanentData(member.build)
    if (!permanent?.data) return { ok: false, issues: [{ path: `panels.${panel.characterId}`, message: `取不到 ${member.entry.cn} 的永久数据` }] }
    members.push({ build: member.build, permanentData: permanent.data })
  }
  const keys = members.map(member => member.build.actorId)
  const merged = await composePack(keys)
  if (merged.status !== 'ok') return { ok: false, issues: merged.issues ?? [] }
  const converted = S.toRotation(rotation, merged.pack)
  if (converted.status !== 'ok') return { ok: false, issues: converted.issues, stage: 'rotation' }
  const first = members[0].permanentData
  const expected = { gameVersion: first.gameVersion, bundleId: first.bundleId, source: first.source }
  const crit = input?.crit === 'critical' || input?.crit === 'non-critical' ? input.crit : 'expected'
  const run = K.simulateTeam({
    mode: 'dps-standard',
    pack: merged.pack,
    rotation: converted.rotation,
    members,
    expected,
    targetPresetId: 'ruin-guard-lv110',
    crit,
    // 常驻减益内核还没建模（会直接判 unsupported），这里固定为 0，等机制窗口支持后再开放
    debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
  })
  if (run.status !== 'calculated') return { ok: false, status: run.status, issues: run.issues ?? [], stage: 'simulate' }
  const report = K.buildTeamRunReport(run)
  return {
    ok: true,
    status: run.status,
    dps: report.dps?.value ?? null,
    hits: report.hits ?? null,
    energy: report.energy ?? [],
    actions: report.perAction ?? [],
    crit,
    detail: {
      target: report.target,
      mode: report.mode,
      versions: report.versions,
      stages: report.stages,
      resources: report.resources,
      triggers: report.triggers,
      effectUsage: report.effectUsage,
      reactions: report.reactions,
      problems: report.problems
    }
  }
}

/**
 * 录制归一化（2026-11-02）：录制器按默认键位表写出 `normal-1 / skill / burst / charged / switch:N`，
 * 而轴文件要求键位表的键是**绝对键**（`bennett.skill`、`to_albedo`）。
 * 这里把相对键展开成绝对键，并顺手生成键位表；切人后的动作算到当时的前台角色上。
 */
export async function normalizeRecording (recording) {
  const rec = recording
  if (!rec || rec.schemaVersion !== 1 || !Array.isArray(rec.events) || !rec.start) {
    return { ok: false, issues: [{ path: 'recording', message: '这不是录制器输出的格式（缺 schemaVersion / events / start）' }] }
  }
  const roster = loadRoster()
  const byKey = new Map(roster.map(entry => [entry.keys[0], entry]))
  const issues = []
  const actors = (Array.isArray(rec.start.actors) ? rec.start.actors : []).map(actor => {
    const actorId = typeof actor === 'string' ? actor : actor?.actorId
    let energyMax = Number(actor?.energyMax) || 0
    if (!energyMax && actorId) {
      try {
        const pack = loadPack(actorId)
        energyMax = Number(pack.actions?.[`${actorId}.burst`]?.energyCost) || 0
      } catch { /* 没有包就回落到 60 */ }
    }
    return { actorId, energy: Number(actor?.energy) || 0, energyMax: energyMax || 60 }
  })
  actors.forEach((actor, index) => {
    if (!actor?.actorId) issues.push({ path: `recording.start.actors.${index}`, message: '录制里有一个角色没有 actorId' })
    else if (!byKey.has(actor.actorId)) issues.push({ path: `recording.start.actors.${index}`, message: `名录里没有 ${actor.actorId}，这条录制可能来自别的数据集` })
  })
  let current = String(rec.start.activeActorId ?? '')
  if (!current) issues.push({ path: 'recording.start.activeActorId', message: '录制没有记起手角色' })

  const bindings = {}
  const events = []
  let switches = 0
  for (const [index, event] of rec.events.entries()) {
    if (event?.phase !== 'down') continue
    const key = String(event.key ?? '')
    let normalized = ''
    const switchMatch = key.match(/^switch:(\d+)$/)
    if (switchMatch) {
      const actor = actors[Number(switchMatch[1]) - 1]?.actorId
      if (!actor) { issues.push({ path: `recording.events.${index}.key`, message: `按键 ${key} 对应第 ${switchMatch[1]} 个角色，但录制里没有这个位置` }); continue }
      normalized = `to_${actor}`
      bindings[normalized] = { actorId: actor, switch: true }
      current = actor
      switches += 1
    } else if (/^(normal-\d+|skill|burst|charged)$/.test(key)) {
      if (!current) { issues.push({ path: `recording.events.${index}.key`, message: `还没确定前台角色就出现了 ${key}` }); continue }
      normalized = `${current}.${key}`
      bindings[normalized] = { actorId: current, actionId: normalized }
    } else if (/^[^.]+\./.test(key)) {
      const actor = key.split('.')[0]
      normalized = key
      bindings[normalized] = { actorId: actor, actionId: key }
    } else {
      issues.push({ path: `recording.events.${index}.key`, message: `看不懂这个按键：${key}（默认键位表只认 normal-1 / charged / skill / burst / switch:1-4）` })
      continue
    }
    events.push({ ...event, key: normalized })
  }
  if (!events.length) issues.push({ path: 'recording.events', message: '没有可识别的按下事件' })
  if (issues.length) return { ok: false, issues }

  const K = await import(libUrl('modules/teamSimulation/index.js'))
  const tier = K.FRAME_TIERS[rec.frameTierId]
  if (!tier) return { ok: false, issues: [{ path: 'recording.frameTierId', message: `未知帧率档位 ${rec.frameTierId}` }] }
  const lastFrame = Math.max(0, ...events.map(event => Math.round(Number(event.atMs) / (1000 / tier.fps))))
  const window = Math.max(7243, lastFrame + 600)
  const team = [...new Set(actors.map(actor => byKey.get(actor.actorId)?.charId).filter(Boolean))]
  const keymap = { version: String(rec.keymapVersion ?? ''), bindings }
  return {
    ok: true,
    issues: [],
    keymap,
    recording: { ...rec, start: { ...rec.start, actors }, events },
    team,
    window,
    lastFrame,
    summary: { actions: events.filter(event => !event.key.startsWith('to_')).length, switches, lastFrame, window, actors: team.length }
  }
}

export function listRotations (dir = ROTATIONS) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => {
    let ok = true
    let error = ''
    let id = name.replace(/\.json$/, '')
    let team = []
    try {
      const file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      id = file.id ?? id
      team = Array.isArray(file.team) ? file.team : []
    } catch (err) {
      ok = false
      error = String(err?.message ?? err)
    }
    return { id, name, team, ok, error }
  })
}

export async function readRotation (id, dir = ROTATIONS) {
  const safe = safeId(id)
  if (!safe) throw new Error('非法的轴 id')
  return JSON.parse(fs.readFileSync(path.join(dir, `${safe}.json`), 'utf8'))
}

/** 校验通过才写文件；写入前保证目录存在。 */
export async function saveRotation (file, dir = ROTATIONS) {
  const id = safeId(file?.id)
  if (!id) return { ok: false, issues: [{ code: 'invalid', path: 'id', message: '轴 id 只能用字母数字、点、下划线、短横线' }] }
  const checked = await validateFile(file)
  if (!checked.ok) return checked
  fs.mkdirSync(dir, { recursive: true })
  // 与仓库里其他轴一致：两空格缩进 + 末尾换行。
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  return { ...checked, path: path.join(dir, `${id}.json`) }
}

const PROFILES = path.join(DATA, 'profiles')

export function listProfiles (dir = PROFILES) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      return { id: data.id ?? name.replace(/\.json$/, ''), team: Array.isArray(data.panels) ? data.panels.length : 0 }
    } catch { return { id: name.replace(/\.json$/, ''), team: 0, error: true } }
  })
}

export function readProfile (id, dir = PROFILES) {
  const safe = safeId(id)
  if (!safe) throw new Error('非法的面板 id')
  return JSON.parse(fs.readFileSync(path.join(dir, `${safe}.json`), 'utf8'))
}

export function saveProfile (profile, dir = PROFILES) {
  const id = safeId(profile?.id)
  if (!id) return { ok: false, issues: [{ path: 'id', message: '面板 id 只能用字母数字、点、下划线、短横线' }] }
  const panels = Array.isArray(profile?.panels) ? profile.panels : []
  if (!panels.length) return { ok: false, issues: [{ path: 'panels', message: '面板里还没有角色' }] }
  fs.mkdirSync(dir, { recursive: true })
  const file = { schemaVersion: 1, id, panels, savedAt: new Date().toISOString().slice(0, 10) }
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  return { ok: true, id, panels: panels.length, path: path.join(dir, `${id}.json`) }
}
/* ------------------------------------------------------------------ *
 * HTTP 服务
 * ------------------------------------------------------------------ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

function sendJson (res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > 1_000_000) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

export function createServer () {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'GET' && url.pathname === '/api/roster') {
        const roster = loadRoster()
        const items = roster.map(entry => {
          const key = entry.keys[0]
          let count = 0
          try { count = actionsOf(key).length } catch { /* 缺包就按 0 显示 */ }
          return { charId: entry.charId, cn: entry.cn, key, element: entry.element, actions: count }
        })
        return sendJson(res, 200, { items })
      }
      if (req.method === 'GET' && url.pathname === '/api/sets') {
        try { return sendJson(res, 200, { items: artifactSets() }) } catch (err) { return sendJson(res, 500, { error: String(err?.message ?? err) }) }
      }
      if (req.method === 'GET' && url.pathname === '/api/weapons') {
        try { return sendJson(res, 200, { items: weaponCatalog() }) } catch (err) { return sendJson(res, 500, { error: String(err?.message ?? err) }) }
      }
      if (req.method === 'GET' && url.pathname === '/api/stat-tables') {
        const file = path.join(DATA, 'stat-tables.json')
        if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'stat-tables.json 还没生成，先跑 node scripts/gen-stat-tables.mjs' })
        return sendJson(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')))
      }
      if (req.method === 'POST' && url.pathname === '/api/panel') {
        const body = await readBody(req)
        return sendJson(res, 200, await computePanel(body?.build ?? body))
      }
      if (req.method === 'GET' && url.pathname === '/api/profiles') {
        return sendJson(res, 200, { items: listProfiles() })
      }
      if (req.method === 'GET' && url.pathname === '/api/profile') {
        try { return sendJson(res, 200, { profile: readProfile(String(url.searchParams.get('id') ?? '')) }) } catch (err) { return sendJson(res, 404, { error: String(err?.message ?? err) }) }
      }
      if (req.method === 'PUT' && url.pathname === '/api/profile') {
        const body = await readBody(req)
        return sendJson(res, 200, saveProfile(body?.profile))
      }
      if (req.method === 'POST' && url.pathname === '/api/simulate') {
        const body = await readBody(req)
        try { return sendJson(res, 200, await simulatePanel(body)) } catch (err) { return sendJson(res, 500, { ok: false, issues: [{ path: 'server', message: String(err?.message ?? err) }] }) }
      }
      if (req.method === 'GET' && url.pathname === '/api/actions') {
        const key = String(url.searchParams.get('key') ?? '')
        if (!/^[A-Za-z0-9_-]+$/.test(key)) return sendJson(res, 400, { error: '缺少 key' })
        try { return sendJson(res, 200, { items: actionsOf(key) }) } catch (err) { return sendJson(res, 404, { error: String(err?.message ?? err) }) }
      }
      if (req.method === 'GET' && url.pathname === '/api/rotations') {
        return sendJson(res, 200, { items: listRotations() })
      }
      if (req.method === 'GET' && url.pathname === '/api/rotation') {
        try { return sendJson(res, 200, { file: await readRotation(String(url.searchParams.get('id') ?? '')) }) } catch (err) { return sendJson(res, 404, { error: String(err?.message ?? err) }) }
      }
      if (req.method === 'PUT' && url.pathname === '/api/rotation') {
        const body = await readBody(req)
        return sendJson(res, 200, await saveRotation(body?.file))
      }
      if (req.method === 'POST' && url.pathname === '/api/validate') {
        const body = await readBody(req)
        return sendJson(res, 200, await validateFile(body?.file))
      }
      if (req.method === 'POST' && url.pathname === '/api/import-recording') {
        const body = await readBody(req)
        const normalized = await normalizeRecording(body?.recording)
        if (!normalized.ok) return sendJson(res, 200, normalized)
        const file = {
          schemaVersion: 1,
          id: safeId(body?.id) || 'recording',
          ...(normalized.team.length ? { team: normalized.team } : {}),
          measurementEndFrame: normalized.window,
          frameTierId: normalized.recording.frameTierId,
          keymap: normalized.keymap,
          recording: normalized.recording
        }
        const checked = await validateFile(file)
        return sendJson(res, 200, { ok: checked.ok, issues: checked.issues, file, summary: normalized.summary })
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = fs.readFileSync(path.join(PAGE_DIR, 'index.html'))
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
        return res.end(html)
      }
      if (req.method === 'GET') {
        const name = path.basename(url.pathname)
        const file = path.join(PAGE_DIR, name)
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'content-type': MIME[path.extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
          return res.end(fs.readFileSync(file))
        }
      }
      sendJson(res, 404, { error: 'not found' })
    } catch (err) {
      sendJson(res, 500, { error: String(err?.message ?? err) })
    }
  })
}

/** --check：不开服务，验证目录读写、动作列表、校验与拒绝路径。 */
export async function selfCheck () {
  const problems = []
  const roster = loadRoster()
  if (roster.length < 100) problems.push(`名录角色数异常：${roster.length}`)
  const bennett = roster.find(entry => entry.cn === '班尼特')
  if (!bennett) problems.push('名录里找不到班尼特')
  else if (!actionsOf(bennett.keys[0]).some(a => a.id === 'bennett.skill')) problems.push('班尼特动作包里没有 bennett.skill')
  const demo = JSON.parse(fs.readFileSync(path.join(ROTATIONS, 'demo-skill-sequence.json'), 'utf8'))
  const ok = await validateFile(demo)
  if (!ok.ok) problems.push(`示例轴校验失败：${JSON.stringify(ok.issues?.slice(0, 2))}`)
  const bad = await validateFile({ ...demo, sequence: ['bennett.not-exist'] })
  if (bad.ok) problems.push('不存在的动作没有被拒绝')
  const badId = await saveRotation({ ...demo, id: '../escape' })
  if (badId.ok) problems.push('非法 id 没有被拒绝')
  const normalized = await normalizeRecording({
    schemaVersion: 1,
    frameTierId: 'fps-60',
    keymapVersion: 'gs-default-1',
    gameVersion: '7.1',
    source: 'selftest',
    start: { activeActorId: 'bennett', actors: [{ actorId: 'bennett' }, { actorId: 'xiangling' }] },
    events: [
      { atMs: 0, key: 'skill', phase: 'down' },
      { atMs: 30, key: 'skill', phase: 'up' },
      { atMs: 100, key: 'switch:2', phase: 'down' },
      { atMs: 200, key: 'normal-1', phase: 'down' }
    ]
  })
  if (!normalized.ok) problems.push(`录制归一化失败：${JSON.stringify(normalized.issues?.slice(0, 2))}`)
  else {
    const keys = normalized.recording.events.map(event => event.key).join(',')
    if (keys !== 'bennett.skill,to_xiangling,xiangling.normal-1') problems.push(`录制归一化的键不对：${keys}`)
    if (normalized.team.length !== 2) problems.push(`录制归一化的队伍不对：${JSON.stringify(normalized.team)}`)
  }
  return { ok: problems.length === 0, problems }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const portArg = process.argv.find(arg => arg.startsWith('--port='))
  const basePort = Number(portArg?.split('=')[1] ?? (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 0)) || 8791
  if (process.argv.includes('--check')) {
    const result = await selfCheck()
    console.log(result.ok ? '轴编辑器自检通过' : `轴编辑器自检失败：\n${result.problems.join('\n')}`)
    process.exit(result.ok ? 0 : 1)
  }
  const server = createServer()
  const shouldOpen = process.argv.includes('--open')
  const openBrowser = (port) => {
    const url = `http://127.0.0.1:${port}/`
    const command = process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
      : process.platform === 'darwin'
        ? { cmd: 'open', args: [url] }
        : { cmd: 'xdg-open', args: [url] }
    try {
      const child = spawn(command.cmd, command.args, { detached: true, stdio: 'ignore' })
      child.unref()
    } catch { /* 打不开浏览器不影响服务 */ }
  }
  const listen = (port, left = 10) => server.listen(port, '127.0.0.1', () => {
    console.log(`轴编辑器：http://127.0.0.1:${port}/（数据目录 data/team-sim/）`)
    if (shouldOpen) openBrowser(port)
  }).on('error', err => {
    if (err.code === 'EADDRINUSE' && left > 0) { server.close(); listen(port + 1, left - 1); return }
    console.error(err.message)
    process.exit(1)
  })
  listen(basePort)
}












