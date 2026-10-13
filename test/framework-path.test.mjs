/**
 * 门禁 T1：`lib/` 产物里对框架模块的 import 层数必须正确
 *
 * 背景：本插件是 TS 工程，运行时刻代码位于 `<插件根>/lib/…`，比 JS 插件**多一层**；
 * 而框架模块（`lib/plugins/plugin.js`、`lib/puppeteer/puppeteer.js`、`lib/common/common.js`）
 * 在 bot 根。因此相对路径的 `../` 层数 = 3 + `lib/` 下的子目录层数。
 * tsc 不重写 import 路径，写错只能在真机上炸 —— 这条套件把它挡在本地。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createChecks, libDir, pluginRoot, readText, walkFiles } from './_helper.mjs'

const { push, ok, report } = createChecks('框架 import 层数（T1）')

if (!fs.existsSync(libDir)) {
  console.log('✗ lib/ 不存在：先跑 `pnpm build`')
  process.exit(1)
}

const specRe = /from\s+['"]((?:\.\.\/)+lib\/(?:plugins|puppeteer|common)\/[^'"]+)['"]/g
const problems = []
let found = 0

for (const file of walkFiles(libDir, f => f.endsWith('.js'))) {
  const text = readText(file)
  for (const m of text.matchAll(specRe)) {
    found++
    const spec = m[1]
    // 产物文件相对插件根的目录，如 ['lib', 'components']
    const relDir = path.relative(pluginRoot, path.dirname(file)).split(path.sep)
    const subDepth = Math.max(0, relDir.slice(1).length)
    const expectedUps = 3 + subDepth
    const ups = (spec.match(/\.\.\//g) || []).length
    const tail = spec.replace(/^(?:\.\.\/)+/, '')
    if (ups !== expectedUps || !/^lib\/(?:plugins|puppeteer|common)\//.test(tail)) {
      problems.push(`${path.relative(pluginRoot, file)} → ${spec}（期望 ${expectedUps} 层 ../ 再 lib/…）`)
    }
  }
}

ok('至少发现一处框架 import', found > 0)
push('框架 import 层数全部正确', problems, [])

const bad = report()
process.exit(bad ? 1 : 0)
