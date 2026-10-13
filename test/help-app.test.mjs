/**
 * 帮助 app 自检（阶段 0.3）
 *
 * 分两层：
 *  1. **行为层**：`lib/components/constants.js` 是纯判定模块（不依赖框架），直接 import 做正则与优先级断言；
 *  2. **结构层**：app 本体不能 import（它 `extends` 框架的 plugin，而开发工作区没有 bot 的 `lib/`），
 *     改为对源码做静态断言 + 检查编译产物存在。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('帮助 app（#攻略帮助）')

// ---------- 1. 行为层：纯判定模块 ----------
const constFile = path.join(libDir, 'components', 'constants.js')
const hasConst = fs.existsSync(constFile)
ok('lib/components/constants.js 存在（先跑 pnpm build）', hasConst)

if (hasConst) {
  const C = await import(pathToFileURL(constFile).href)

  push('PREEMPT_PRIORITY', C.PREEMPT_PRIORITY, -100000)
  ok('抢占优先级早于 Atlas 快捷入口（-99999）', C.PREEMPT_PRIORITY < -99999)
  ok('抢占优先级早于 genshin「米游社攻略」（50）', C.PREEMPT_PRIORITY < 50)

  const yes = ['#攻略', '#攻略帮助', '#攻略说明', '攻略', '攻略帮助', '攻略说明']
  const no = [
    '#胡桃攻略', '#胡桃攻略2', '#攻略 胡桃', '#攻略列表', '#攻略状态',
    '#设置默认攻略2', '#图鉴', '#dps帮助', ''
  ]
  push('认领：三个全局词（含省略 #）', yes.filter(m => C.isHelpCommand(m)), yes)
  push('放行：非帮助入口', no.filter(m => C.isHelpCommand(m)), [])
  ok('COPYRIGHT 非空', typeof C.COPYRIGHT === 'string' && C.COPYRIGHT.length > 0)
}

// ---------- 2. 结构层：app 源码与产物 ----------
const srcFile = path.join(pluginRoot, 'src', 'apps', 'help.ts')
ok('src/apps/help.ts 存在', fs.existsSync(srcFile))
if (fs.existsSync(srcFile)) {
  const src = readText(srcFile)
  ok('继承框架 plugin', /class\s+MetaHelp\s+extends\s+plugin/.test(src))
  ok('规则用 HELP_RULE', src.includes('reg: HELP_RULE'))
  ok('规则指向 handleHelp', src.includes("fnc: 'handleHelp'"))
  ok('优先级取 PREEMPT_PRIORITY（写死）', src.includes('priority: PREEMPT_PRIORITY'))
  ok('实现 accept()', /async\s+accept\s*\(/.test(src))
  ok('accept 只做纯判定 isHelpCommand(e.msg)', src.includes('isHelpCommand(e.msg)'))
  ok('帮助配置动态 import 且带时间戳（热重载）', /import\(`\$\{pathToFileURL\(file\)\.href\}\?t=\$\{Date\.now\(\)\}`\)/.test(src))
  ok('出图走 render(help, …, codex)', src.includes("render('help'"))
  ok('渲染失败回落文本', src.includes('await e.reply(textOf(view))'))
  ok('框架 import 写四层 ../（lib 下多一层）', src.includes("'../../../../lib/plugins/plugin.js'"))
  ok('只导出插件类（加载器取首个导出）', !/\nexport\s+(?:function|const|interface|type|default)/.test(src))
}

// 编译产物
ok('lib/apps/help.js 已生成', fs.existsSync(path.join(libDir, 'apps', 'help.js')))
ok('lib/components/constants.js 已生成', hasConst)

const bad = report()
process.exit(bad ? 1 : 0)
