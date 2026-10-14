/**
 * `#xx dps` 套件（v3 P1）—— 角色各金档最高伤害队伍
 *
 * 数据用 `test/fixtures/dps-cache-teams.json`（从旧插件真实缓存抽的样本，含胡桃等角色），
 * 完全离线、不依赖 Mhydps 仓库。
 *
 * 其中一条是**回归门禁**：`normalizeTeams` 曾只认 API 字段 `video_url`，而磁盘缓存里存的是
 * 归一化后的 `video` —— 于是"重启后从缓存重载"会丢掉全部视频链接（P1 实测踩到）。这里钉住它。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('#xx dps（v3 P1）')

// ⚠ nsureTmp() 忽略参数、所有套件共用 	est/.test-tmp —— 数据与配置都必须放进自己的子目录，
//    否则会污染其它套件（P1 实测：写在共享根的 config.yaml 把 dps-query 的用例带红了）。
const base = path.join(ensureTmp(), 'char-dps')
const dataDir = path.join(base, 'data')
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(path.join(dataDir, 'avatar'), { recursive: true })
const fixture = JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', 'dps-cache-teams.json')))
fs.writeFileSync(path.join(dataDir, 'teams.json'), JSON.stringify(fixture), 'utf8')
fs.writeFileSync(path.join(dataDir, 'teams2.json'), '[]', 'utf8')
fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify({ fetchedAt: 1791309335194, teams: fixture.length, teams2: 0 }), 'utf8')

process.env.META_DATA_DIR = dataDir
process.env.META_CONFIG_FILE = path.join(base, 'config.yaml')
fs.writeFileSync(process.env.META_CONFIG_FILE, [
  'networkEnabled: false',
  'dpsCacheTtlMinutes: 999999',
  'dpsAvatarEnabled: false',
  'dpsPageSize: 10'
].join('\n') + '\n', 'utf8')

const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)
const { queryCharDps, DEFAULT_PER_TIER } = await import(pathToFileURL(path.join(libDir, 'modules', 'charDpsQuery.js')).href)

// ---------- 1. 路由：新入口命中，旧命令不受影响 ----------
{
  ok('`#胡桃dps` 命中新入口', C.matchEntryCommand('#胡桃dps')?.key === 'charDps')
  ok('`#胡桃dps 12金` 命中新入口（参数在捕获组 2）', C.matchEntryCommand('#胡桃dps 12金')?.match[2] === '12金')
  ok('`#胡桃 dps 金≤12` 允许空格', C.matchEntryCommand('#胡桃 dps 金≤12')?.match[2] === '金≤12')
  const legacy = ['#DPS榜', '#DPS', '#DPS状态', '#DPS危战榜 7.1', '#DPS练度查询 胡桃', '#DPS视频 3']
  push('旧 `#DPS…` 命令**不会**被新入口吞掉', legacy.filter(t => C.matchEntryCommand(t)), [])
  push('旧 `#DPS…` 命令仍由旧规则命中（未被改动）',
    legacy.filter(t => !C.matchDpsCommand(t)), [])
  push('攻略类命令两边都不命中', ['#胡桃攻略', '#攻略 胡桃'].filter(t => C.matchEntryCommand(t) || C.matchDpsCommand(t)), [])
}

// ---------- 2. 金档分组 ----------
const hu = await queryCharDps('胡桃', {}, { downloadAvatars: false })
ok('查到了胡桃的记录', hu.ok === true)
if (hu.ok) {
  const raw = fixture.filter(t => (t.members || []).some(m => m.charId === '胡桃' || m.charId === '胡桃'))
  ok('命中条数与夹具里含胡桃的记录数一致', hu.total === raw.length, `${hu.total} vs ${raw.length}`)
  ok('每个金档只出现一次且按金数升序',
    hu.tiers.length > 0 && new Set(hu.tiers.map(t => t.cost)).size === hu.tiers.length &&
    hu.tiers.every((t, i) => i === 0 || hu.tiers[i - 1].cost < t.cost))
  ok('每档条数不超过每档上限', hu.tiers.every(t => t.rows.length <= DEFAULT_PER_TIER), String(DEFAULT_PER_TIER))
  ok('各档记录数之和等于命中条数', hu.tiers.reduce((s, t) => s + t.count, 0) === hu.total)
  ok('档内按伤害降序',
    hu.tiers.every(t => t.rows.every((r, i) => i === 0 || (t.rows[i - 1].damage || 0) >= (r.damage || 0))))
  ok('副标题写明了口径与来源', /各金档/.test(hu.subtitle) && /mhydps\.cn/.test(hu.subtitle))
  ok('每档的 rank 从 1 开始连续', hu.tiers.every(t => t.rows.every((r, i) => r.rank === i + 1)))
}

// ---------- 3. 视频链接回归（缓存重载后不能丢） ----------
{
  const rows = hu.ok ? hu.tiers.flatMap(t => t.rows) : []
  // 夹具里 368/368 条都带 video → 取到的行也必须都带（这条曾因 normalizeTeams 只认 video_url 而全丢）
  ok('取到了行用于视频回归', rows.length > 0)
  ok('行上的 video 全部保留（normalizeTeams 同时认 video_url 与 video）',
    rows.length > 0 && rows.every(r => typeof r.video === 'string' && r.video.startsWith('http')),
    rows.filter(r => !r.video).length + ' 行为空')
}

// ---------- 4. 别名与筛选复用 ----------
{
  const huo = await queryCharDps('火神', {}, { downloadAvatars: false })
  ok('别名「火神」解析为玛薇卡', huo.ok === true && huo.charName === '玛薇卡')
  const low = await queryCharDps('胡桃', { costMax: 12 }, { downloadAvatars: false })
  ok('金数上限筛选生效（所有档 ≤ 12）', low.ok === true && low.tiers.every(t => t.cost <= 12))
  const none = await queryCharDps('不存在的角色', {}, { downloadAvatars: false })
  ok('角色不存在时返回可用的失败结果', none.ok === false && !!none.error)
}

// ---------- 5. app 与模板接线 ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'charDps.ts'))
  ok('app 用 ENTRY_RULES 注册规则', src.includes('reg: ENTRY_RULES.charDps'))
  ok('app 元数据取自 ENTRY_COMMANDS', src.includes('ENTRY_COMMANDS.find(') && src.includes('META.priorityOffset'))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
  ok('模板 char-dps.html 已就位', fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'char-dps.html')))
  ok('ENTRY_COMMANDS 里登记了 charDps', C.ENTRY_COMMANDS.some(c => c.rules.includes('charDps')))
}

const bad = report()
process.exit(bad ? 1 : 0)
