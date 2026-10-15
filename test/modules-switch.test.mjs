/**
 * 模块开关（功能层，2026-10-15）—— **行为层**
 *
 * 结构（三层正交，见 `AGENTS.md` 硬约束 8）：
 *   - `modules.<key>`（本套件）：功能是否可用 —— 关闭时命令不响应
 *   - `networkEnabled`：业务查询是否允许远程访问/刷新（阿修定义的那层）
 *   - `akashaEnabled`：是否允许走阿卡莎通道
 *
 * 关闭行为（用户 2026-10-15 定）：
 *   - 非接管类：回一条统一文本并消费消息（命名空间稳定）
 *   - 接管类（攻略 / 帮助）：`accept` 不认领 + handler 返回 `false`（框架语义 = 放行给后续规则）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { ok, report } = createChecks('模块开关（功能层）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const C = await load('components/config.js')
const { moduleGateReply, moduleOff } = await load('modules/moduleGate.js')

// ---------- ① 键表与默认值 ----------
{
  ok('模块键 11 个且含全部命令模块',
    C.MODULE_KEYS.length === 11 &&
    ['codex', 'help', 'rank', 'raidTiers', 'build', 'grade', 'akashaBuild', 'teamDamage', 'video', 'status', 'admin']
      .every(k => C.MODULE_KEYS.includes(k)))
  ok('默认：队伍伤害关闭、其余全部开启',
    C.defaultModules.teamDamage === false &&
    C.MODULE_KEYS.filter(k => k !== 'teamDamage').every(k => C.defaultModules[k] === true))
  ok('每个模块都有中文名', C.MODULE_KEYS.every(k => typeof C.MODULE_LABELS[k] === 'string' && C.MODULE_LABELS[k].length > 0))
  ok('关闭提示里带配置键（可自助开启）',
    C.moduleOffText('teamDamage').includes('modules.teamDamage') && C.moduleOffText('teamDamage').includes(C.MODULE_LABELS.teamDamage))
}

// ---------- ② 关闭判定来自配置文件（含部分覆盖） ----------
{
  const tmp = path.join(pluginRoot, 'test', '.test-tmp', 'module-switch')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const file = path.join(tmp, 'config.yaml')
  const old = process.env.META_CONFIG_FILE
  process.env.META_CONFIG_FILE = file

  try {
    fs.writeFileSync(file, 'modules:\n  grade: false\n', 'utf8')
    ok('② 只写一个模块也能生效（深合并）', C.isModuleEnabled('grade') === false)
    ok('② 未写的模块仍走默认（rank 开启）', C.isModuleEnabled('rank') === true)
    ok('② 未写 teamDamage 时仍按默认关闭', C.isModuleEnabled('teamDamage') === false)

    fs.writeFileSync(file, 'modules:\n  teamDamage: true\n  video: false\n', 'utf8')
    ok('② 显式开启 teamDamage 生效', C.isModuleEnabled('teamDamage') === true)
    ok('② 显式关闭 video 生效', C.isModuleEnabled('video') === false)
    ok('② disabledModules 列出被关闭的模块', C.disabledModules().join(',') === 'video')
    ok('② 歧义值按"未显式 false 即开启"处理', (() => {
      fs.writeFileSync(file, 'modules:\n  admin: null\n', 'utf8')
      return C.isModuleEnabled('admin') === true
    })())
  } finally {
    if (old === undefined) delete process.env.META_CONFIG_FILE
    else process.env.META_CONFIG_FILE = old
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- ③ 查询联网层与功能层正交 ----------
{
  const tmp = path.join(pluginRoot, 'test', '.test-tmp', 'module-switch-net')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const file = path.join(tmp, 'config.yaml')
  const old = process.env.META_CONFIG_FILE
  process.env.META_CONFIG_FILE = file
  try {
    fs.writeFileSync(file, 'modules:\n  rank: false\nnetworkEnabled: false\n', 'utf8')
    ok('③ 模块关 + 联网关：两个判定互不影响',
      C.isModuleEnabled('rank') === false && C.isQueryNetworkEnabled() === false && C.isModuleEnabled('raidTiers') === true)
    fs.writeFileSync(file, 'modules:\n  rank: true\nnetworkEnabled: true\n', 'utf8')
    ok('③ 模块开 + 联网开', C.isModuleEnabled('rank') === true && C.isQueryNetworkEnabled() === true)
    ok('③ 联网关闭的文案写明"只管辖查询类远程访问"',
      C.QUERY_NETWORK_OFF_HINT.includes('networkEnabled=false') && C.QUERY_NETWORK_OFF_HINT.includes('只管辖查询类远程访问'))
    ok('③ akashaEnabled 是独立的数据通道开关', typeof C.getAkashaEnabled() === 'boolean')
  } finally {
    if (old === undefined) delete process.env.META_CONFIG_FILE
    else process.env.META_CONFIG_FILE = old
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- ④ 非接管类闸门真的会回文本并消费消息 ----------
{
  const tmp = path.join(pluginRoot, 'test', '.test-tmp', 'module-switch-gate')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const file = path.join(tmp, 'config.yaml')
  const old = process.env.META_CONFIG_FILE
  process.env.META_CONFIG_FILE = file
  try {
    const replies = []
    const e = { reply: async (msg) => { replies.push(String(msg)); return true } }

    fs.writeFileSync(file, 'modules:\n  teamDamage: false\n', 'utf8')
    ok('④ teamDamage 默认关闭 → 闸门拦截', (await moduleGateReply('teamDamage', e)) === true)
    ok('④ 回了一条带模块名的提示', replies.length === 1 && replies[0].includes('队伍伤害') && replies[0].includes('modules.teamDamage'))

    replies.length = 0
    fs.writeFileSync(file, 'modules:\n  grade: true\n', 'utf8')
    ok('④ 模块开启 → 闸门放行（不回复）', (await moduleGateReply('grade', e)) === false && replies.length === 0)

    ok('④ 接管类用纯判定 moduleOff()', moduleOff('codex') === false && moduleOff('teamDamage') === true)
  } finally {
    if (old === undefined) delete process.env.META_CONFIG_FILE
    else process.env.META_CONFIG_FILE = old
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- ⑤ 接线：13 个 app 都接上了；接管类 accept 也认开关 ----------
{
  const files = fs.readdirSync(path.join(pluginRoot, 'src', 'apps')).filter(f => f.endsWith('.ts'))
  const gateCallers = files.filter(f => readText(path.join(pluginRoot, 'src', 'apps', f)).includes('moduleGateReply('))
  ok('⑤ 非接管类 9 个 app 都接了闸门', gateCallers.length === 9, gateCallers.join(','))
  ok('⑤ video 的两个 handler 都接了',
    (readText(path.join(pluginRoot, 'src', 'apps', 'video.ts')).match(/moduleGateReply\('video'/g) || []).length === 2)

  const codex = readText(path.join(pluginRoot, 'src', 'apps', 'codex.ts'))
  const help = readText(path.join(pluginRoot, 'src', 'apps', 'help.ts'))
  ok('⑤ 攻略 accept 认开关', /accept[\s\S]{0,200}moduleOff\('codex'\)/.test(codex))
  ok('⑤ 攻略两个 handler 都放行', (codex.match(/moduleOff\('codex'\)/g) || []).length === 3)
  ok('⑤ 帮助 accept + handler 放行', (help.match(/moduleOff\('help'\)/g) || []).length === 2)
}

const bad = report()
process.exit(bad ? 1 : 0)
