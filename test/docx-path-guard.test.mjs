/**
 * DOCX 导入的路径越界防护（2026-10-15 审核 P1）
 *
 * 审核点：文档首段得到的名称直接参与路径拼接 → 含路径分隔符/相对路径片段的异常 DOCX
 * 能把目标 JSON 写到 `data/gi` 之外（隔离副本实测覆写了目录外哨兵文件），且导入仍报成功。
 *
 * 覆盖：
 *  1. 行为层 —— 直接 import 脚本（有入口守卫，import 不会解析或写盘）调用两个校验函数；
 *  2. 结构层 —— 断言解析循环里读取/备份/写入共用同一份校验后的路径，且异常会带出非零退出码。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('DOCX 导入路径越界防护')

const M = await import(pathToFileURL(path.join(pluginRoot, 'scripts', 'parse-docx.mjs')).href)

// ---------- 1. 名称校验 ----------
ok('合法角色名通过（含间隔号）', M.assertSafeName('胡桃') === '胡桃' && M.assertSafeName(' 神里绫华 ') === '神里绫华')
for (const bad of ['../evil', 'a/b', 'a\\b', '..', '.', '/abs', 'C:/x', 'a<b', 'a:b', 'a|b', 'a?b', 'a*b', '', '   ']) {
  let thrown = ''
  try { M.assertSafeName(bad) } catch (err) { thrown = String(err?.message || err) }
  ok(`拒绝异常名称 ${JSON.stringify(bad)}`, thrown.length > 0, thrown)
}
ok('拒绝超长名称', (() => { try { M.assertSafeName('角'.repeat(61)); return false } catch { return true } })())

// ---------- 2. 目录包含校验 ----------
const gi = path.join(pluginRoot, 'data', 'gi')
ok('目录内路径通过', M.insideDir(gi, path.join(gi, '胡桃.json')) === path.resolve(gi, '胡桃.json'))
for (const bad of [path.join(gi, '..', 'evil.json'), path.join(gi, '..', '..', 'x.json'), path.resolve(gi, '..', 'sibling')]) {
  let thrown = ''
  try { M.insideDir(gi, bad) } catch (err) { thrown = String(err?.message || err) }
  ok(`拒绝越界路径 ${path.relative(pluginRoot, bad)}`, thrown.length > 0, thrown)
}
ok('前缀相同但不同目录也要拒绝（data/gi2）', (() => { try { M.insideDir(gi, gi + '2/x.json'); return false } catch { return true } })())

// ---------- 3. 结构层 ----------
const src = readText(path.join(pluginRoot, 'scripts', 'parse-docx.mjs'))
ok('解析循环先做名称校验', /const safeName = assertSafeName\(parsed\.name\)/.test(src))
ok('路径经目录包含校验后才使用', /const prevFile = insideDir\(giDir, path\.join\(giDir, `\$\{safeName\}\.json`\)\)/.test(src))
ok('读取/备份/写入共用同一份路径（items[].prevFile）', /items\.push\(\{ name: safeName, prevFile, data, stray: parsed\.stray \}\)/.test(src) && /backupBeforeWrite\(items, docFile\)/.test(src) && /atomicWriteJson\(it\.prevFile, it\.data\)/.test(src))
ok('报告与产物都用校验后的名称', !/name: parsed\.name,/.test(src) && /name: safeName,/.test(src))
ok('校验函数在模块顶层导出（可被套件 import）', /^export function assertSafeName/m.test(src) && /^export function insideDir/m.test(src))
push('守卫不再有重复定义', src.match(/^export function assertSafeName/g) || [], [])
ok('异常会带出非零退出码（不被吞掉）', /catch[\s\S]{0,120}process\.exitCode = 1/.test(src.slice(-1200)) || /main\(\)\.catch/.test(src.slice(-1200)), src.slice(-200))

const bad = report()
process.exit(bad ? 1 : 0)