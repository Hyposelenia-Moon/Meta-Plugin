/**
 * akasha 指定角色查询不得被展示上限截断（2026-10-15 审核 P2 #9）
 *
 * 审核点：视图先取默认前 N 个角色，app 再按用户指定角色过滤 →
 * 目标排在第 N+1 位时，即使账号有记录也会显示"akasha 没有该角色"。
 *
 * 覆盖：
 *  1. 行为层 —— 用 13 条合成记录复现"先截断后筛选"与"先筛选后截断"的差异；
 *  2. 结构层 —— 断言 app 现在的调用顺序（全量筛 → 再应用上限）。
 */
import path from 'node:path'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { ok, report } = createChecks('akasha 角色筛选与展示上限')

// ---------- 1. 行为层：截断与筛选的先后 ----------
const MAX = 12
const chars = Array.from({ length: 13 }, (_, i) => ({ name: `角色${i + 1}`, rank: i + 1 }))
const target = chars[12]                     // 目标排在第 13 位
const isTarget = (c) => c.name === target.name

const wrongOrder = chars.slice(0, MAX).filter(isTarget)     // 旧实现：先截断再筛选
const rightOrder = chars.filter(isTarget).slice(0, MAX)     // 新实现：先筛选再截断
ok('复现：先截断后筛选会漏掉第 13 位的目标', wrongOrder.length === 0, `命中 ${wrongOrder.length}`)
ok('修复：先筛选后截断能命中目标', rightOrder.length === 1 && rightOrder[0].name === target.name, JSON.stringify(rightOrder))
ok('修复后仍受展示上限约束（不会全量回吐）', chars.filter(() => true).slice(0, MAX).length === MAX)

// ---------- 2. 结构层：app 的调用顺序 ----------
const src = readText(path.join(pluginRoot, 'src', 'apps', 'build.ts'))
ok('指定角色时视图不截断（max 设为极大）', /buildAkashaView\(profile, \{ translations, max: records\.length \? Number\.MAX_SAFE_INTEGER : undefined \}\)/.test(src))
ok('筛选之后才应用展示上限', /filterAkashaChars\(chars, records\)\.slice\(0, getAkashaMaxChars\(\)\)/.test(src))
ok('未指定角色时仍走默认上限（性能不受影响）', /records\.length \? Number\.MAX_SAFE_INTEGER : undefined/.test(src))
ok('"没有该角色"的提示基于全量总数（view.total）', /akasha 上没有 \$\{args\.names\.join\('、'\)\} 的记录（该号收录 \$\{view\.total\} 个角色）/.test(src))
ok('导入了展示上限配置', /getAkashaMaxChars/.test(src) && /import \{ getAkashaEnabled, getAkashaMaxChars, getPluginConfig \}/.test(src))

const bad = report()
process.exit(bad ? 1 : 0)