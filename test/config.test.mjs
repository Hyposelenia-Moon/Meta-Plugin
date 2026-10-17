/**
 * 配置三层自检（阶段 0.4）
 *
 * 覆盖：`defSet/config.yaml`（锅巴模板）→ `config/config.yaml.example`（参考默认值）→ `config/config.yaml`（运行时）。
 * 关键不变量：
 *   1. 示例文件解析结果与 `src/components/config.ts` 的 `defaultConfig` **逐字段一致**（两处不会漂移）；
 *   2. defSet 模板的 `${meta_*}` 占位符与 `defaultConfig` 的键**一一对应**；
 *   3. 锅巴保存走「模板替换」而非 `YAML.stringify`：写入后**无残留占位符**、**注释仍在**、键集合不变；
 *   4. 缺文件 → 全默认；部分键 → 深合并；坏 YAML → 回落默认且不抛错；缺文件时 `ensureConfigFile` 从示例复制。
 *
 * 全程用 `META_CONFIG_FILE` 把读写指向 `test/.test-tmp/`，不碰仓库里的 `config/config.yaml`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('配置三层（defSet / example / 运行时）')

const cfgFile = path.join(libDir, 'components', 'config.js')
const guobaFile = path.join(libDir, 'guoba', 'index.js')
ok('lib/components/config.js 存在', fs.existsSync(cfgFile))
ok('lib/guoba/index.js 存在', fs.existsSync(guobaFile))
if (!fs.existsSync(cfgFile) || !fs.existsSync(guobaFile)) {
  report()
  process.exit(1)
}

const C = await import(pathToFileURL(cfgFile).href)
const G = await import(pathToFileURL(guobaFile).href)

const defaults = C.defaultConfig
const keys = Object.keys(defaults).sort()

// ---------- 1. 示例文件与代码默认值同源 ----------
const examplePath = path.join(pluginRoot, 'config', 'config.yaml.example')
ok('config/config.yaml.example 存在', fs.existsSync(examplePath))
const example = YAML.parse(readText(examplePath))
push('示例文件解析结果 == defaultConfig', example, defaults)
push('示例文件键集合 == defaultConfig 键集合', Object.keys(example).sort(), keys)

// ---------- 2. defSet 模板占位符与配置键一一对应 ----------
// `modules` 是**嵌套对象**：模板与锅巴表单按模块逐项展开（`meta_module_<key>` / 字段 `module_<key>`），
// 所以这里比较的是"标量键 + 9 个模块键"的并集（2026-10-15 起：`charDps` / `raid` 随命令合并移除；
// 2026-10-17：阿卡莎全部功能（`build` / `akashaBuild` 与六个 akasha 配置键）整体移除）
const moduleKeys = [...C.MODULE_KEYS].sort()
const scalarKeys = keys.filter(k => k !== 'modules')
const expectedVars = [...scalarKeys.map(k => `meta_${k}`), ...moduleKeys.map(k => `meta_module_${k}`)].sort()
const expectedFields = [...scalarKeys, ...moduleKeys.map(k => `module_${k}`)].sort()
const flatDefaults = { ...defaults, ...Object.fromEntries(moduleKeys.map(k => [`module_${k}`, defaults.modules[k]])) }
delete flatDefaults.modules

ok('模块开关默认值：teamDamage 关闭', C.defaultModules.teamDamage === false)
ok('模块开关默认值：其余全部开启',
  moduleKeys.filter(k => k !== 'teamDamage').every(k => C.defaultModules[k] === true))
push('模块键数量 == 9', moduleKeys.length, 9)

const defsetPath = path.join(pluginRoot, 'defSet', 'config.yaml')
ok('defSet/config.yaml 存在', fs.existsSync(defsetPath))
const defset = readText(defsetPath)
const vars = [...defset.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]).sort()
push('defSet 占位符 == meta_<配置键>（模块逐项展开）', vars, expectedVars)

// ---------- 3. 锅巴：结构 / 读回 / 保存往返 ----------
// 先清掉本套件自己的临时目录：否则上一轮写入的 config.yaml 会让"读回默认值"这类断言假失败
const tmp = ensureTmp()
const roundtripDir = path.join(tmp, 'guoba-roundtrip')
fs.rmSync(roundtripDir, { recursive: true, force: true })
const target = path.join(roundtripDir, 'config.yaml')
process.env.META_CONFIG_FILE = target

const guoba = G.supportGuoba()
const configInfo = guoba?.configInfo
ok('supportGuoba 返回 configInfo', !!configInfo)
ok('configInfo.schemas 是数组', Array.isArray(configInfo?.schemas))

const schemaFields = (configInfo?.schemas || []).filter(s => s.field).map(s => s.field).sort()
push('schemas 覆盖全部配置键（模块逐项展开）', schemaFields, expectedFields)

const got = configInfo.getConfigData()
push('getConfigData 覆盖全部配置键（模块逐项展开）', Object.keys(got).sort(), expectedFields)
push('getConfigData 回落默认值（modules 摊平）', got, flatDefaults)

const Result = {
  ok: (_data, message) => ({ ok: true, message }),
  error: (message) => ({ ok: false, message })
}
const res = await configInfo.setConfigData({ priority: 123, networkEnabled: true }, { Result })
ok('setConfigData 返回成功', res?.ok === true)
ok('运行时配置文件已写入', fs.existsSync(target))

if (fs.existsSync(target)) {
  const written = readText(target)
  push('写入后无残留占位符', [...written.matchAll(/\$\{[A-Za-z0-9_]+\}/g)].map(m => m[0]), [])
  ok('模板注释保留（未 YAML.stringify 重写）',
    written.includes('# Meta-Plugin 配置模板') && written.includes('数据源 · mhydps.cn'))

  const wrote = YAML.parse(written)
  push('写入值 priority', wrote.priority, 123)
  push('写入值 networkEnabled', wrote.networkEnabled, true)
  push('兜底值 dpsPageSize', wrote.dpsPageSize, defaults.dpsPageSize)
  push('写入后键集合不变', Object.keys(wrote).sort(), keys)
  push('写入后 modules 键集合不变', Object.keys(wrote.modules || {}).sort(), moduleKeys)
  push('未提交的模块开关回落默认（teamDamage 仍关闭）', (wrote.modules || {}).teamDamage, false)

  const loaded = C.loadConfig()
  push('loadConfig 读回 priority', loaded.priority, 123)
  push('loadConfig 读回 networkEnabled', loaded.networkEnabled, true)
  push('loadConfig 读回兜底字段', loaded.dpsPageSize, defaults.dpsPageSize)
}

// ---------- 4. 缺文件 / 部分键 / 坏 YAML ----------
process.env.META_CONFIG_FILE = path.join(tmp, 'not-exists', 'config.yaml')
push('缺文件 → 全默认值', C.loadConfig(), defaults)

const partialPath = path.join(tmp, 'partial', 'config.yaml')
fs.mkdirSync(path.dirname(partialPath), { recursive: true })
fs.writeFileSync(partialPath, 'priority: 4321\n', 'utf8')
process.env.META_CONFIG_FILE = partialPath
push('部分键 → 指定键生效', C.loadConfig().priority, 4321)
push('部分键 → 其余走默认', C.loadConfig(), { ...defaults, priority: 4321 })

const brokenPath = path.join(tmp, 'broken', 'config.yaml')
fs.mkdirSync(path.dirname(brokenPath), { recursive: true })
fs.writeFileSync(brokenPath, 'priority: [unclosed\n', 'utf8')
process.env.META_CONFIG_FILE = brokenPath
let threw = false
let broken = null
try {
  broken = C.loadConfig()
} catch {
  threw = true
}
ok('坏 YAML 不抛错', !threw)
push('坏 YAML → 回落默认值', broken, defaults)

// ---------- 5. ensureConfigFile：缺文件时从示例复制 ----------
const freshPath = path.join(tmp, 'ensure', 'config.yaml')
fs.rmSync(path.dirname(freshPath), { recursive: true, force: true })
process.env.META_CONFIG_FILE = freshPath
C.ensureConfigFile()
ok('ensureConfigFile 复制出运行时配置', fs.existsSync(freshPath))
if (fs.existsSync(freshPath)) {
  push('复制内容 == defaultConfig', YAML.parse(readText(freshPath)), defaults)
}

// ---------- 6. 根 guoba.support.js 转交 ----------
const support = path.join(pluginRoot, 'guoba.support.js')
ok('根 guoba.support.js 存在', fs.existsSync(support))
if (fs.existsSync(support)) {
  ok('guoba.support.js 转交 lib/guoba/index.js', readText(support).includes("'./lib/guoba/index.js'"))
}

delete process.env.META_CONFIG_FILE

const bad = report()
process.exit(bad ? 1 : 0)
