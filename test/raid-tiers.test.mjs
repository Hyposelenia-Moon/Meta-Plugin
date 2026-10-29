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
const { queryRaidTiers, N7_SECONDS_LIMIT, RAID_SPEED_CAP, DEFAULT_TIER_ROWS } = await import(pathToFileURL(path.join(libDir, 'modules', 'raidTiersQuery.js')).href)
const { resetStore } = await import(pathToFileURL(path.join(libDir, 'model', 'TeamStore.js')).href)
const { resolveBossName, resetBossAlias, bossAliasFile } = await import(pathToFileURL(path.join(libDir, 'modules', 'bossAlias.js')).href)

// ---------- 1. 路由（2026-10-15：危战改为**必带档位**，裸 `#危战` 留给 miao） ----------
{
  ok('`#危战 矮灵 n7` 命中危战分档', C.matchCommand('#危战 矮灵 n7')?.key === 'raidTiers')
  ok('档位从第 2 组拿、筛选词从第 1 组拿',
    (() => { const m = C.matchCommand('#危战 矮灵雕刻师 n7')?.match; return m?.[1] === '矮灵雕刻师' && m?.[2] === '7' })())
  ok('`#危战 7.1 n6` 版本进第 1 组', C.matchCommand('#危战 7.1 n6')?.match[1] === '7.1')
  ok('`#危战 n7`（只给档位）也认', C.matchCommand('#危战 n7')?.key === 'raidTiers')
  ok('档位也接受「6档」写法', C.matchCommand('#危战 胡桃 6档')?.key === 'raidTiers')
  ok('写了筛选但没档位 → 提示选档', C.matchCommand('#危战 矮灵')?.key === 'raidTiersPrompt')

  // 与 miao-plugin 的边界（裸 `#危战` / `#危战数据` / `#危战排名` 都是它的，且它 priority: 1 先跑）
  const miaoForms = ['#危战', '#危战数据', '#危战排名', '#危战单人', '#幽境危战']
  push('miao 的危战形态一个都不认领', miaoForms.filter(t => C.matchCommand(t) !== null), [])

  // 其它命令不被危战规则吞掉
  const others = ['#危战视频 3', '#DPS', '#meta状态', '#练度查询 胡桃']
  push('其它命令不被危战规则吞掉',
    others.filter(t => ['raidTiers', 'raidTiersPrompt'].includes(String(C.matchCommand(t)?.key))), [])
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
    ok('单档默认最多列 10 条（2026-10-15 用户定）', DEFAULT_TIER_ROWS === 10)
    ok('n7 收录 69s 与 70s（各档计数正确）', n7.count === 2 && n7.rows.map(x => x.speed).sort().join(',') === '69,70')
    ok('n7 按金数优先（s69 是 4 金、s70 是 8 金 → 69s 在前）', n7.rows[0].speed === 69 && n7.rows[1].speed === 70)
    ok('n6 收录 71s 与 120s', n6.count === 2)
    ok('n6 按金数优先（s120 是 0 金、s71 是 12 金 → 120s 在前）', n6.rows[0].speed === RAID_SPEED_CAP && n6.rows[1].speed === 71)
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
    ok('两档都按「金数升序 → 同金数耗时升序」',
      [n7, n6].every(t => t.rows.every((x, i) => i === 0 || (t.rows[i - 1].cost < x.cost) ||
        (t.rows[i - 1].cost === x.cost && t.rows[i - 1].speed <= x.speed))))
    ok('行上保留了视频与首领名', n7.rows.every(x => typeof x.video === 'string' && 'bossName' in x))

    const v = await queryRaidTiers({ ver: '7.1' }, { downloadAvatars: false })
    ok('版本筛选生效', v.ok === true && v.total > 0 && v.total < r.total)
    const byChar = await queryRaidTiers({ char: '胡桃' }, { downloadAvatars: false })
    ok('角色筛选复用现有语义（含即算）', byChar.ok === true && byChar.total <= r.total)
    const bad = await queryRaidTiers({ ver: '1.0' }, { downloadAvatars: false })
    ok('不存在的版本给出失败与候选', bad.ok === false && (bad.suggestions || []).length > 0)

    // ---------- 3c. 档位剥离（2026-10-15）：指定档位时只回该档 ----------
    ok('不指定档位时 tier=null 且两档都在', r.tier === null && r.tiers.length === 2)
    ok('counts 与两档计数一致', r.counts.n7 === n7.count && r.counts.n6 === n6.count)

    const only7 = await queryRaidTiers({}, { downloadAvatars: false, tier: 'n7' })
    ok('指定 n7 只回一档', only7.ok === true && only7.tier === 'n7' && only7.tiers.length === 1 && only7.tiers[0].key === 'n7')
    ok('单档页仍报两档条数（提示选档要用）', only7.counts.n7 === r.counts.n7 && only7.counts.n6 === r.counts.n6)
    ok('单档副标题写明档位口径', /n7 档（≤ 70s 速通档）/.test(only7.subtitle))

    const only6 = await queryRaidTiers({}, { downloadAvatars: false, tier: 'n6' })
    ok('指定 n6 只回一档', only6.ok === true && only6.tiers.length === 1 && only6.tiers[0].key === 'n6')
    ok('单档副标题写明险胜档', /n6 档（> 70s 险胜档）/.test(only6.subtitle))

    const both = await queryRaidTiers({ tier: 'n7' }, { downloadAvatars: false })
    ok('档位不是筛选条件：传进 q 也不改变命中数', both.ok === true && both.total === r.total)
  }
}

// ---------- 3d. 档位必须取自隔离后的自身文本（2026-10-18 复审 R4） ----------
{
  const QG = await import(pathToFileURL(path.join(libDir, 'modules', 'quoteGuard.js')).href)
  const own = { message: [{ type: 'text', text: '#危战 矮灵 n7' }], msg: '#危战 矮灵 n7\n请用 n6', reply_id: 'q1', getReply: async () => ({ message: [{ type: 'text', text: '请用 n6' }] }) }
  ok('own 文本能取出档位 n7（而不是引用里的 n6）', (own.message[0].text.match(C.RULES.raidTiers)[2] || '') === '7')
  ok('resolveCommandArgs 解析到筛选词 矮灵', (await QG.resolveCommandArgs(own, C.RULES.raidTiers)).text === '矮灵')
}

// ---------- 3e. 裸档冲突必须由真实 handler 提示重发（2026-10-29 复审） ----------
{
  const appFile = path.join(libDir, 'apps', 'raidTiers.js')
  let src = readText(appFile)
  src = src.replace(/import plugin from ['"][^'"]+['"];?/, 'const plugin = class { constructor () {} };')
  src = src.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,
    (_all, before, rel, after) => before + pathToFileURL(path.resolve(path.dirname(appFile), rel)).href + after)
  const { MetaRaidTiers } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
  const app = new MetaRaidTiers()
  for (const [msg, quoted] of [
    ['#危战 矮灵 n7 请用 6', '请用 6'],
    ['#危战 矮灵 7 请用 n6', '请用 n6'],
    ['#危战 矮灵 7 请用 6', '请用 6']
  ]) {
    const replies = []
    const handled = await app.handleRaidTiers({
      msg, reply_id: 'q-bare-tier', getReply: async () => ({ message: [{ type: 'text', text: quoted }] }),
      reply: async text => { replies.push(String(text)); return true }
    })
    ok(`裸档冲突 handler 提示重发：${msg}`, handled === true && /请重新发送 #危战/.test(replies.join('\n')), replies.join('|'))
  }
}

// ---------- 3b. 首领简写表（手动维护） ----------
{
  const fsMod = await import('node:fs')
  const tmpAlias = path.join(ensureTmp(), 'boss-alias.test.json')
  try { fsMod.rmSync(tmpAlias, { force: true }) } catch { /* 忽略 */ }
  process.env.META_BOSS_ALIAS_FILE = tmpAlias
  resetBossAlias()
  ok('没有简写表时原样透传', resolveBossName('矮灵雕刻师') === '矮灵雕刻师' && resolveBossName('矮灵') === '矮灵')
  fsMod.writeFileSync(tmpAlias, JSON.stringify({ '矮灵雕刻师': ['矮灵', '雕刻师'], '_note': '测试用' }), 'utf8')
  resetBossAlias()
  ok('简写表生效（简写 → 全名）', resolveBossName('矮灵') === '矮灵雕刻师' && resolveBossName('雕刻师') === '矮灵雕刻师')
  ok('全名仍原样返回', resolveBossName('矮灵雕刻师') === '矮灵雕刻师')
  ok('表里没有的照旧透传', resolveBossName('不存在的首领') === '不存在的首领')
  ok('简写表支持环境变量覆盖', bossAliasFile() === tmpAlias)
}

// ---------- 4. app 与模板接线 ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'raidTiers.ts'))
  ok('app 用 RULES 注册规则', src.includes('reg: RULES.raidTiers'))
  ok('app 元数据取自 COMMANDS', src.includes('COMMANDS.find(') && src.includes('META.priorityOffset'))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
  ok('模板 tiers.html 已就位', fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'tiers.html')))
  ok('COMMANDS 里登记了 raidTiers', C.COMMANDS.some(c => c.rules.includes('raidTiers')))
}

const bad = report()
process.exit(bad ? 1 : 0)