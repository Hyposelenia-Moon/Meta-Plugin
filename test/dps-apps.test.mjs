/**
 * `#DPS…` 各 app 套件（阶段 4.5）
 *
 * app 文件**不能**在开发工作区 import（它们静态 import 框架的 `plugin`，没有 bot 就加载失败），
 * 所以这里做两层断言：
 *   1. **结构**：类继承框架 plugin、`name`/`dsc`/`permission`/优先级偏移**全部取自 `COMMANDS`**、
 *      规则用 `RULES.*`、handler 名与规则里的 `fnc` 对得上、框架 import 是 4 级且带 `@ts-expect-error`；
 *   2. **一致性与等价性**：5 个 app 覆盖的规则键与 `COMMANDS` 对齐（`help` 归阶段 5）；
 *      用户可见文案仍是合并前的 `[Mhydps]` 前缀（阶段 4 的逐字等价要求，改名留阶段 6）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('#DPS apps（阶段 4.5）')

const tmpRoot = ensureTmp('dps-apps')
process.env.META_DATA_DIR = path.join(tmpRoot, 'data')
process.env.META_CONFIG_FILE = path.join(tmpRoot, 'config.yaml')
fs.mkdirSync(process.env.META_DATA_DIR, { recursive: true })
// 用一份显式配置驱动优先级公式的断言：priority = 8000 + 偏移
fs.writeFileSync(process.env.META_CONFIG_FILE, 'priority: 9000\nnetworkEnabled: false\nproxy: http://127.0.0.1:7890\n', 'utf8')

const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)
const CFG = await import(pathToFileURL(path.join(libDir, 'components', 'config.js')).href)
const PV = await import(pathToFileURL(path.join(libDir, 'components', 'pluginVersion.js')).href)

/**
 * 本组 app（2026-10-15 命令面重构后）：
 * `rank`（榜单，已吸收原 `charDps`，后缀式 `视频N` 也在它里面）/ `raidTiers`（危战分档，旧 `raid` 危战榜已废除）/
 * `status` / `admin`（榜单刷新）
 *
 * ⚠ `video` app 已删除（用户 2026-10-15 定：视频名次改成后缀式、原前缀式废除）。
 */
const APPS = ['rank', 'raidTiers', 'status', 'admin']

// ---------- 1. 每个 app 的结构与元数据 ----------
for (const name of APPS) {
  const srcFile = path.join(pluginRoot, 'src', 'apps', `${name}.ts`)
  const libFile = path.join(libDir, 'apps', `${name}.js`)
  ok(`${name}: 源码与产物都在`, fs.existsSync(srcFile) && fs.existsSync(libFile))
  const src = readText(srcFile)

  ok(`${name}: 继承框架 plugin`, /class\s+\w+\s+extends\s+plugin/.test(src))
  ok(`${name}: 框架 import 是 4 级（T1）`, src.includes("import('../../../../lib/plugins/plugin.js')") || src.includes('from \'../../../../lib/plugins/plugin.js\''))
  ok(`${name}: 框架 import 带 @ts-expect-error`, /@ts-expect-error[^\n]*\nimport plugin from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/plugins\/plugin\.js'/.test(src))
  ok(`${name}: 元数据取自 COMMANDS`, src.includes('COMMANDS.find(') && src.includes('META.priorityOffset'))
  ok(`${name}: 优先级 = 配置值 + 偏移`, src.includes('Number(getPluginConfig().priority) + META.priorityOffset'))
  ok(`${name}: 规则用 RULES（正则只有一处定义）`, src.includes('reg: RULES.'))
  // 加载器取「模块首个导出」当插件类 → 首个导出必须是插件类（允许之后再导出辅助函数）
  ok(`${name}: 首个导出是插件类`, /^export class \w+ extends plugin/m.test(src))

  // 规则里的 fnc 必须在类里有同名方法
  const fncs = [...src.matchAll(/fnc:\s*'(\w+)'/g)].map(m => m[1])
  push(`${name}: 规则声明的 handler 都已实现`, fncs.filter(f => !new RegExp(`async\\s+${f}\\s*\\(`).test(src)), [])
}

// ---------- 2. 与 COMMANDS 对齐 ----------
{
  // 覆盖的规则键按"实际 reg 用到哪些"统计（raidTiers 一个 app 认领 raidTiers + raidTiersPrompt）
  const covered = APPS.flatMap(name => {
    const src = readText(path.join(pluginRoot, 'src', 'apps', `${name}.ts`))
    return [...src.matchAll(/reg:\s*RULES\.(\w+)/g)].map(m => m[1])
  })
  ok('本组 4 个 app 共认领 5 条规则（raidTiers 认领 raidTiers + raidTiersPrompt）', covered.length === 5)
  push('覆盖的规则键不重复', covered.filter((k, i) => covered.indexOf(k) !== i), [])
  // 其余规则各有归属：grade/teamDamage 在 v3 app 里、help 在帮助页、raidTiers 在危战 app
  // （2026-10-17：阿卡莎全部功能移除，`build` 与 `akashaBuild` 两条规则都已摘除）
  const otherApps = ['raidTiers', 'grade', 'teamDamage']
  const otherCovered = otherApps.flatMap(name =>
    [...readText(path.join(pluginRoot, 'src', 'apps', `${name}.ts`)).matchAll(/reg:\s*RULES\.(\w+)/g)].map(m => m[1]))
  const allRules = Object.keys(C.RULES)
  push('所有规则都有 app 认领',
    allRules.filter(k => k !== 'help' && !covered.includes(k) && !otherCovered.includes(k)), [])
}

// ---------- 3. 阶段 6 改名门禁：用户可见文案统一用 Meta ----------
{
  const sign = C.PLUGIN_SIGN
  ok('PLUGIN_SIGN 已改为 Meta-Plugin（阶段 6 收尾改名）', sign === 'Meta-Plugin')
  ok('页脚版权行由它拼出',
    C.DPS_COPYRIGHT === `Data from mhydps.cn · Created By TRSS-yunzai & ${sign}`)
  const prefixed = APPS.filter(name => readText(path.join(pluginRoot, 'src', 'apps', `${name}.ts`)).includes('[Meta]'))
  ok('各 app 的回复前缀统一为 [Meta]', prefixed.length === APPS.length)
  const stale = APPS.filter(name => readText(path.join(pluginRoot, 'src', 'apps', `${name}.ts`)).includes('[Mhydps]'))
  push('已无任何 app 残留 [Mhydps] 前缀', stale, [])
}

// ---------- 4. pluginVersion / 配置取值 ----------
{
  ok('pluginVersion 取自插件 package.json', /^\d+\.\d+\.\d+/.test(PV.pluginVersion))
  ok('开发工作区读不到框架版本 → unknown', PV.yunzaiVersion === 'unknown')
  ok('versionText 形如合并前的页脚', PV.versionText === `Created By Yz-Bot ${PV.yunzaiVersion} & ${C.PLUGIN_SIGN} ${PV.pluginVersion}`)

  ok('getProxy 读配置', CFG.getProxy() === 'http://127.0.0.1:7890')
  ok('getPageSize 读配置且为数字', Number.isFinite(CFG.getPageSize()))
  ok('getPluginConfig 返回完整配置', CFG.getPluginConfig().priority === 9000)
  ok('priority 配置被 apps 采用（不是写死 8000）', CFG.getPluginConfig().priority === 9000)
}

// ---------- 5. 攻略侧 app 未被本轮改动破坏 ----------
{
  for (const name of ['codex', 'help']) {
    const src = readText(path.join(pluginRoot, 'src', 'apps', `${name}.ts`))
    ok(`${name}: 首个导出仍是插件类（可另有辅助导出）`, /^export class \w+ extends plugin/m.test(src))
  }
  ok('codex 的抢占优先级未被 #DPS app 影响（常量未变）', C.PREEMPT_PRIORITY === -100000)
}

const bad = report()
process.exit(bad ? 1 : 0)
