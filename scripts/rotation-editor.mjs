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

