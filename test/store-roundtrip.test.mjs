/**
 * 榜单缓存的磁盘往返（2026-10-15 审核 P2 #8）
 *
 * 审核点：刷新写入的是归一化字段 `video`，启动加载再归一化时却只读 `video_url`
 * → 重启后视频链接变空串（DPS 榜与危战榜都受影响）。
 *
 * 这里用仓库里两份真实 fixture 做**二次归一化往返**：API 形状 → 归一化（写盘形状）
 * → 再归一化（启动加载）→ 逐字段比较完整业务记录（视频、成员、伤害、耗时…）。
 * 这直接复现"加载时又归一化一次"的路径，比只看单条字段更严。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot } from './_helper.mjs'

const { ok, report } = createChecks('榜单缓存磁盘往返')

const TS = await import(pathToFileURL(path.join(libDir, 'model', 'TeamStore.js')).href)
const read = (f) => JSON.parse(fs.readFileSync(path.join(pluginRoot, 'test', 'fixtures', f), 'utf8'))

/** 逐条比较（顺序敏感：缓存顺序即展示顺序） */
const diffOf = (a, b) => {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = JSON.stringify(a[i]); const y = JSON.stringify(b[i])
    if (x !== y) out.push(`#${i}: ${x} ≠ ${y}`)
  }
  return out
}

// ---------- DPS 榜 ----------
{
  const api = read('dps-cache-teams.json')
  const first = TS.normalizeTeams(api)                 // 刷新：API 形状 → 写盘形状
  const second = TS.normalizeTeams(first)              // 启动加载：写盘形状 → 再归一化
  ok('DPS 榜：两次归一化记录数一致', first.length === second.length && first.length > 100, `${first.length} / ${second.length}`)
  const d = diffOf(first, second)
  ok('DPS 榜：完整记录往返一致（含视频与成员）', d.length === 0, d.slice(0, 2).join(' | '))
  const withVideo = first.filter(t => t.video)
  ok('DPS 榜：往返后视频链接不丢', withVideo.length > 0 && withVideo.every(t => second.find(s => s.id === t.id)?.video === t.video), `${withVideo.length} 条带视频`)
  // 用聚合计数比较（fixture 里 id 可能重复，逐条 find 不可靠）；完整性已由上面的全字段比较覆盖
  const sumMembers = (list) => list.reduce((n, t) => n + (Array.isArray(t.members) ? t.members.length : 0), 0)
  const m1 = sumMembers(first); const m2 = sumMembers(second)
  ok('DPS 榜：成员字段往返不丢（聚合计数一致且非零）', m1 > 0 && m1 === m2, `${m1} / ${m2}`)}

// ---------- 危战榜 ----------
{
  const api = read('dps-cache-teams2.json')
  const first = TS.normalizeTeams2(api)
  const second = TS.normalizeTeams2(first)
  ok('危战榜：两次归一化记录数一致', first.length === second.length && first.length > 50, `${first.length} / ${second.length}`)
  const d = diffOf(first, second)
  ok('危战榜：完整记录往返一致（含视频与成员）', d.length === 0, d.slice(0, 2).join(' | '))
  const withVideo = first.filter(t => t.video)
  ok('危战榜：往返后视频链接不丢', withVideo.length > 0 && withVideo.every(t => second.find(s => s.id === t.id)?.video === t.video), `${withVideo.length} 条带视频`)
}

// ---------- 结构层：归一化必须同时认两种字段名 ----------
{
  const src = fs.readFileSync(path.join(pluginRoot, 'src', 'model', 'TeamStore.ts'), 'utf8')
  const both = (src.match(/video: String\(t\.video_url \|\| t\.video \|\| ''\)/g) || []).length
  ok('两处归一化都同时认 video_url 与 video', both === 2, `${both} 处`)
  ok('不再只读 video_url', !/video: String\(t\.video_url \|\| ''\)/.test(src))
}

const bad = report()
process.exit(bad ? 1 : 0)