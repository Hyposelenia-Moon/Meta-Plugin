/**
 * 锅巴配置三层一致性：模板占位符 ↔ 面板字段 ↔ 默认配置
 *
 * 这三份文件必须同构，否则会出现「面板保存后某个键消失」或「面板显示的值不是运行时读到的值」，
 * 而且**不会报错**。这里从三份文件与 supportGuoba() 的返回值上做双向核对，并跑一次真实往返。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, installFrameworkStubs, mod, pluginRoot, requireDeps, tempDataDir } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const cfgDir = tempDataDir('guoba-config')
const cfgFile = path.join(cfgDir, 'config.yaml')
process.env.META_CONFIG_FILE = cfgFile

const YAML = (await import('yaml')).default
const { supportGuoba } = await import(mod('guoba/index.js'))
const { defaultConfig } = await import(mod('components/config.js'))

const { check, finish } = checker()

const { pluginInfo, configInfo } = supportGuoba()
check('pluginInfo 字段齐全', Boolean(pluginInfo.name && pluginInfo.title && pluginInfo.link && pluginInfo.description))
check('configInfo 三件套齐全', Array.isArray(configInfo.schemas) && typeof configInfo.getConfigData === 'function' && typeof configInfo.setConfigData === 'function')

const fields = configInfo.schemas.filter(s => s.field).map(s => s.field)
check('schema 含字段项', fields.length >= 7, `${fields.length} 项`)

// ---- defSet 模板占位符 ↔ schema 字段 ----
const defsetText = fs.readFileSync(path.join(pluginRoot, 'defSet', 'config.yaml'), 'utf8')
const vars = [...defsetText.matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1])
check('模板含占位符', vars.length >= 7, `${vars.length} 个`)
check('占位符无重复', new Set(vars).size === vars.length)

/** 变量名形如 meta_renderScale → 归一为 renderscale，用于与 field 名比对 */
const norm = (s) => String(s).replace(/^meta_/, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
const fieldKeys = fields.map(norm)

const orphanVars = vars.filter(v => !fieldKeys.includes(norm(v)))
check('每个占位符都有面板字段对应', orphanVars.length === 0, orphanVars.join(','))

const orphanFields = fields.filter(f => !vars.some(v => norm(v) === norm(f)))
check('每个面板字段都有占位符', orphanFields.length === 0, orphanFields.join(','))

// ---- 模板 ↔ config.yaml.example ↔ defaultConfig ----
const exampleText = fs.readFileSync(path.join(pluginRoot, 'config', 'config.yaml.example'), 'utf8')
const example = YAML.parse(exampleText)
const exampleKeys = Object.keys(example).sort()
const defaultKeys = Object.keys(defaultConfig).sort()
check('参考文件与默认配置的键一致', JSON.stringify(exampleKeys) === JSON.stringify(defaultKeys), `example=[${exampleKeys}] default=[${defaultKeys}]`)
check('参考文件值等于默认值', defaultKeys.every(k => JSON.stringify(example[k]) === JSON.stringify(defaultConfig[k])))

// ---- getConfigData 覆盖全部字段 ----
const data = configInfo.getConfigData()
const missing = fields.filter(f => data[f] === undefined)
check('getConfigData 返回全部字段', missing.length === 0, missing.join(','))
check('getConfigData 返回的是默认值（配置文件尚不存在）', data.priority === defaultConfig.priority && data.dpsPageSize === defaultConfig.dpsPageSize)

// ---- 真实往返：保存 → 读回 ----
const Result = {
  ok: (payload, msg) => ({ ok: true, payload, msg }),
  error: (msg) => ({ ok: false, msg })
}

const submitted = {
  priority: 7000,
  networkEnabled: false,
  renderScale: 2,
  proxy: 'http://proxy.example:8080',
  dpsTimeoutMs: 45000,
  dpsCacheTtlMinutes: 15,
  dpsPageSize: 20,
  dpsAvatarEnabled: false,
  // v3 P2 新增三项（评分权重与档位阈值；同为"可存可读"的普通字段）
  gradeWeights: 'panel:40,weapon:10,artifact:30,talent:20',
  gradePanelTiers: 'big:0.95,normal:0.5,small:0.2',
  gradeRankThresholds: 'MAX:90,ACE:80,SSS:70,SS:60,S:50,A:40,B:30,C:20',
  // 2026-10-25 新增：评分规则（每个角色一套）
  gradeRule: 'dps',
  gradeRuleWeights: 'mark:40,set:20,panel:40',
  gradeRuleOverrides: '胡桃:dps,钟离:support',
  gradeRuleMet: '0.85',
  // 队伍伤害序号轴（2026-10-15 新增；配置里是一条紧凑字符串，锅巴用单行 Input 编辑）
  teamDamageAxes: '1:保守轴=默认,2:重击轴=重击×8@20s',
  // 模块开关（2026-10-15 新增）：面板按模块**逐项**提交，配置文件里写成嵌套的 `modules:`
  ...Object.fromEntries(Object.entries(defaultConfig.modules).map(([key, value]) => [`module_${key}`, value]))
}

check('模块开关数量为 9', Object.keys(defaultConfig.modules).length === 9)
check('模块开关默认值：teamDamage 关闭、其余开启',
  defaultConfig.modules.teamDamage === false &&
  Object.entries(defaultConfig.modules).filter(([k]) => k !== 'teamDamage').every(([, v]) => v === true))

const saved = await configInfo.setConfigData(submitted, { Result })
check('保存返回成功', saved.ok === true, JSON.stringify(saved))

check('配置文件已写入', fs.existsSync(cfgFile))
const writtenText = fs.readFileSync(cfgFile, 'utf8')
check('写入保留注释', writtenText.includes('# Meta-Plugin 配置模板'))
check('写入不含残留占位符', !/\$\{[a-zA-Z0-9_]+\}/.test(writtenText))
check('写入可被 YAML 解析', (() => {
  try {
    YAML.parse(writtenText)
    return true
  } catch {
    return false
  }
})())

const written = YAML.parse(writtenText)
check('写入值正确', written.priority === 7000 && written.renderScale === 2 && written.dpsAvatarEnabled === false)
check('代理值正确', written.proxy === 'http://proxy.example:8080')
check('模块开关写成嵌套的 modules（9 键、teamDamage 保持默认关闭）',
  Object.keys(written.modules || {}).length === 9 && written.modules?.teamDamage === false,
  JSON.stringify(written.modules))

const roundTrip = configInfo.getConfigData()
check('读回与提交一致', fields.every(f => JSON.stringify(roundTrip[f]) === JSON.stringify(submitted[f])), JSON.stringify(roundTrip))

// ---- 空值回落默认 ----
const saved2 = await configInfo.setConfigData({ ...submitted, proxy: '', dpsPageSize: null }, { Result })
check('空值保存不报错', saved2.ok === true)
const written2 = YAML.parse(fs.readFileSync(cfgFile, 'utf8'))
check('空代理写为空串', written2.proxy === '' || written2.proxy === undefined)
check('空 pageSize 回落默认', written2.dpsPageSize === defaultConfig.dpsPageSize, String(written2.dpsPageSize))

finish()
