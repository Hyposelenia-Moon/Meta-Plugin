/**
 * 导出 → 回导的表达一致性（2026-10-15 审核 P2 #13）
 *
 * 审核点：导出标题是 `原神·角色攻略`，解析器只跳过带空格的 `原神 ·`；空模块导出成 `（暂无数据）`，
 * 解析器也不认识 → 按脚本支持的 OOXML 打包再 parse --dry 会得到 132 个角色块 + 20 条未识别行、退出码 1。
 *
 * 这里做**跨文件一致性**测试：用**导出侧自己写的字面量**去跑**解析侧自己导出的判定谓词**，
 * 比只读源码更硬 —— 任何一侧改了表达而另一侧没跟上，这里立刻红。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { ok, report } = createChecks('导出回导表达一致性')

const M = await import(pathToFileURL(path.join(pluginRoot, 'scripts', 'parse-docx.mjs')).href)
const exportSrc = readText(path.join(pluginRoot, 'scripts', 'build-doc.mjs'))

// ---------- 1. 取导出侧的真实字面量 ----------
const titleMatch = exportSrc.match(/const GUIDE_TITLE = '([^']+)'/)
const emptyMatch = exportSrc.match(/lines\.push\('([^']*暂无数据[^']*)'\)/)
ok('能从导出侧取到大标题字面量', !!titleMatch, String(titleMatch && titleMatch[1]))
ok('能从导出侧取到空模块占位字面量', !!emptyMatch, String(emptyMatch && emptyMatch[1]))

const title = titleMatch ? titleMatch[1] : ''
const placeholder = emptyMatch ? emptyMatch[1] : ''

// ---------- 2. 解析侧谓词必须认识导出侧的表达 ----------
ok('解析侧认识导出的大标题（原样）', M.isExportHeaderLine(title) === true, title)
ok('解析侧认识导出的大标题（带角色数后缀）', M.isExportHeaderLine(title + ' 共 129 名角色') === true)
ok('解析侧认识导出的大标题（旧的有空格写法也仍认）', M.isExportHeaderLine('原神 · 角色攻略') === true)
ok('解析侧认识导出的空模块占位', M.isEmptyModulePlaceholder(placeholder) === true, placeholder)
ok('空模块占位不算识别错（半角括号也认）', M.isEmptyModulePlaceholder('(暂无数据)') === true)
ok('普通内容不会被误判为占位', M.isEmptyModulePlaceholder('第一档：') === false && M.isEmptyModulePlaceholder('胡桃') === false)
ok('普通正文不会被误判为抬头', M.isExportHeaderLine('胡桃') === false && M.isExportHeaderLine('') === false)

// ---------- 3. 结构层：解析主流程用上了这两个谓词 ----------
const parseSrc = readText(path.join(pluginRoot, 'scripts', 'parse-docx.mjs'))
ok('抬头跳过改用统一谓词', /isExportHeaderLine\(parsed\.name\)/.test(parseSrc) && !/parsed\.name\.startsWith\('原神 ·'\)/.test(parseSrc))
ok('行过滤丢掉空模块占位', /block\.filter\(x => x !== '' && !isEmptyModulePlaceholder\(x\)\)/.test(parseSrc))
ok('两个谓词都在模块顶层导出（测试可直接调用）', /^export function isExportHeaderLine/m.test(parseSrc) && /^export function isEmptyModulePlaceholder/m.test(parseSrc))

const bad = report()
process.exit(bad ? 1 : 0)