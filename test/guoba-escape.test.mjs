/**
 * 锅巴保存时的字面量替换（2026-10-15 审核 P2 #11）
 *
 * `String.replace(pattern, replacement)` 的第二参是**替换字符串**：用户值里的 `$&`、`$1`、`$'`
 * 会被当成替换语法解释 —— 实测合法密码 `pass$&word` 保存后读回成 `pass${meta_proxy}word`。
 * 修法是改用回调（`() => String(value)`），回调的返回值按字面量插入。
 *
 * 锅巴模块 import 框架，开发工作区不能直接跑，因此这里做源码级断言 + 用等价逻辑做行为验证。
 */
import path from 'node:path'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('锅巴替换字面量')

const src = readText(path.join(pluginRoot, 'src', 'guoba', 'index.ts'))

ok('模板替换使用回调（不是替换字符串）', /\.replace\(new RegExp\([^)]*\), \(\) => String\(value\)\)/.test(src))
push('没有把 String(value) 直接当替换字符串', src.match(/\.replace\(new RegExp\([^)]*\), String\(value\)\)/g) || [], [])

// 行为等价验证：同一输入在两种写法下的差异
const applied = (value, useCallback) => 'x=${meta_proxy}'.replace(/\$\{meta_proxy\}/g, useCallback ? (() => String(value)) : String(value))
const dirty = 'pass$&word'
ok('旧写法会把 $& 展开成匹配文本（问题复现）', applied(dirty, false) !== 'x=' + dirty, applied(dirty, false))
ok('新写法原样写入（修复生效）', applied(dirty, true) === 'x=' + dirty, applied(dirty, true))

const bad = report()
process.exit(bad ? 1 : 0)