/**
 * `#危战` 套件（v3 P1）—— 幽境危战 n6 / n7 两档
 *
 * 数据两段：
 *   1. 合成记录（精确钉住 70s 边界与两侧排序口径，不依赖真实数据分布）
 *   2. `test/fixtures/dps-cache-teams2.json`（真实缓存抽样，验证筛选复用与整体不变量）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('#危战 n6/n7（v3 P1）')

// ⚠ nsureTmp() 忽略参数、所有套件共用 	est/.test-tmp —— 数据与配置都必须放进自己的子目录，
//    否则会污染其它套件（P1 实测：写在共享根的 config.yaml 把 dps-query 的用例带红了）。
const base = path.join(ensureTmp(), 'raid-tiers')
const dataDir = path.join(base, 'data')
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(path.join(dataDir, 'avatar'), { recursive: true })

/** 合成记录：正好覆盖边界 69 / 70 / 71 / 120 与两个金数 */
const synthetic = [
  { id: 's69', speed: 69, ver: '7.1', boss: 0, cost: 4, limitcost: 4, normalcost: 0, clean: true, lvl: true, confirm: true, video: 'https://example.com/69', members: [{ charId: '胡桃', constellation: 1 }] },
  { id: 's70', speed: 70, ver: '7.1', boss: 0, cost: 8, limitcost: 8, normalcost: 0, clean: true, lvl: true, confirm: true, video: 'https://example.com/70', members: [{ charId: '胡桃', constellation: 6 }] },
  { id: 's71', speed: 71, ver: '7.1', boss: 0, cost: 12, limitcost: 12, normalcost: 0, clean: false, lvl: false, confirm: true, video: 'https://example.com/71', members: [{ charId: '行秋', constellation: 6 }] },
  { id: 's120', speed: 120, ver: '7.1', boss: 0, cost: 0, limitcost: 0, normalcost: 0, clean: false, lvl: false, confirm: true, video: 'https://example.com/120', members: [{ charId: '行秋', constellation: 0 }] }
]
const fixture = JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', 'dps-cache-teams2.json')))

fs.writeFileSync(path.join(dataDir, 'teams.json'), '[]', 'utf8')
fs.writeFileSync(path.join(dataDir, 'teams2.json'), JSON.stringify(synthetic), 'utf8')
fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify({ fetchedAt: 1791309335194, teams: 0, teams2: synthetic.length }), 'utf8')

process.env.META_DATA_DIR = dataDir
process.env.META_CONFIG_FILE = path.join(base, 'config.yaml')
fs.writeFileSync(process.env.META_CONFIG_FILE, [
  'networkEnabled: false',
  'dpsCacheTtlMinutes: 999999',
  'dpsAvatarEnabled: false',
  'dpsPageSize: 10'
].join('\n') + '\n', 'utf8')

const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)
const { queryRaidTiers, N7_SECONDS_LIMIT, RAID_SPEED_CAP } = await import(pathToFileURL(path.join(libDir, 'modules', 'raidTiersQuery.js')).href)
const { resetStore } = await import(pathToFileURL(path.join(libDir, 'model', 'TeamStore.js')).href)

// ---------- 1. 路由 ----------
{
  ok('`#危战` 命中新入口', C.matchEntryCommand('#危战')?.key === 'raidTiers')
  ok('`#危战 7.1` 参数进捕获组', C.matchEntryCommand('#危战 7.1')?.match[1] === '7.1')
  ok('`#危战 矮灵雕刻师` 参数进捕获组', C.matchEntryCommand('#危战 矮灵雕刻师')?.match[1] === '矮灵雕刻师')
  const legacy = ['#DPS危战榜', '#DPS危战榜 7.1', '#DPS危战视频 3', '#DPS榜', '#DPS状态']
  push('旧 `#DPS…` 命令不被新入口吞掉', legacy.filter(t => C.matchEntryCommand(t)), [])
  push('旧 `#DPS…` 命令仍由旧规则命中', legacy.filter(t => !C.matchDpsCommand(t)), [])
  ok('`#危战` 不会被旧规则当危战榜', C.matchDpsCommand('#危战') === null)
}

// ---------- 2. 70s 边界（合成数据，精确） ----------
{
  resetStore() // 上面的夹具只是写盘；这里换成合成记录，必须让 TeamStore 重新读盘
  const r = await queryRaidTiers({}, { downloadAvatars: false, perTier: 10 })
  ok('查询成功', r.ok === true)
  if (r.ok) {
    const n7 = r.tiers.find(t => t.key === 'n7')
    const n6 = r.tiers.find(t => t.key === 'n6')
    ok('n7 上限常量是 70s（65s + 最多 5s 浮动）', N7_SECONDS_LIMIT === 70)
    ok('n7 收录 69s 与 70s（各档计数正确）', n7.count === 2 && n7.rows.map(x => x.speed).join(',') === '69,70')
    ok('n6 收录 71s 与 120s', n6.count === 2)
    ok('n6 按耗时降序（越接近上限越前）', n6.rows[0].speed === RAID_SPEED_CAP && n6.rows[1].speed === 71)
    ok('两档计数之和 = 命中总数', n7.count + n6.count === r.total)
    ok('副标题写明两档条数', /n7 2 \/ n6 2/.test(r.subtitle))
    ok('行的 rank 在档内从 1 连续', n7.rows.every((x, i) => x.rank === i + 1) && n6.rows.every((x, i) => x.rank === i + 1))
  }
}

// ---------- 3. 真实缓存：筛选复用与不变量 ----------
{
  fs.writeFileSync(path.join(dataDir, 'teams2.json'), JSON.stringify(fixture), 'utf8')
  resetStore() // 换回真实缓存抽样，同样要重读
  const r = await queryRaidTiers({}, { downloadAvatars: false, perTier: 100 })
  ok('真实数据查询成功', r.ok === true)
  if (r.ok) {
    const n7 = r.tiers.find(t => t.key === 'n7')
    const n6 = r.tiers.find(t => t.key === 'n6')
    ok('n7 全部 ≤ 70s', n7.rows.every(x => x.speed <= N7_SECONDS_LIMIT))
    ok('n6 全部 > 70s', n6.rows.every(x => x.speed > N7_SECONDS_LIMIT))
    ok('两档覆盖全部记录', n7.count + n6.count === r.total && r.total === fixture.length)
    ok('n7 升序 / n6 降序',
      n7.rows.every((x, i) => i === 0 || n7.rows[i - 1].speed <= x.speed) &&
      n6.rows.every((x, i) => i === 0 || n6.rows[i - 1].speed >= x.speed))
    ok('行上保留了视频与首领名', n7.rows.every(x => typeof x.video === 'string' && 'bossName' in x))

    const v = await queryRaidTiers({ ver: '7.1' }, { downloadAvatars: false })
    ok('版本筛选生效', v.ok === true && v.total > 0 && v.total < r.total)
    const byChar = await queryRaidTiers({ char: '胡桃' }, { downloadAvatars: false })
    ok('角色筛选复用现有语义（含即算）', byChar.ok === true && byChar.total <= r.total)
    const bad = await queryRaidTiers({ ver: '1.0' }, { downloadAvatars: false })
    ok('不存在的版本给出失败与候选', bad.ok === false && (bad.suggestions || []).length > 0)
  }
}

// ---------- 4. app 与模板接线 ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'raidTiers.ts'))
  ok('app 用 ENTRY_RULES 注册规则', src.includes('reg: ENTRY_RULES.raidTiers'))
  ok('app 元数据取自 ENTRY_COMMANDS', src.includes('ENTRY_COMMANDS.find(') && src.includes('META.priorityOffset'))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
  ok('模板 tiers.html 已就位', fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'tiers.html')))
  ok('ENTRY_COMMANDS 里登记了 raidTiers', C.ENTRY_COMMANDS.some(c => c.rules.includes('raidTiers')))
}

const bad = report()
process.exit(bad ? 1 : 0)
