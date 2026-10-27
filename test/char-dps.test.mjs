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
const { queryCharDps, PER_TIER_LOW, PER_TIER_MID, PER_TIER_HIGH, COST_STEP, MERGED_TIER_MIN, MERGED_TIER_MAX, costBucketOf, costRangeOf, perTierOf, DEFAULT_MAX_TIERS } = await import(pathToFileURL(path.join(libDir, 'modules', 'charDpsQuery.js')).href)

// ---------- 0. 分档口径（2026-10-17 实测后定稿：低金每 4 金一档 + 29-48 合并档） ----------
{
  push('步长常量仍是 4 金', COST_STEP, 4)
  push('合并档边界 = 29-48 金', [MERGED_TIER_MIN, MERGED_TIER_MAX], [29, 48])
  push('每档条数：≤16 金 6 条、17-20 金 5 条、21 金以上 4 条',
    [PER_TIER_LOW, PER_TIER_MID, PER_TIER_HIGH], [6, 5, 4])
  push('档序号：≤4 → 0、5-8 → 1、9-12 → 2（含 0 金也归第一档）',
    [0, 1, 4, 5, 8, 9, 12, 13].map(c => costBucketOf(c)), [0, 0, 0, 1, 1, 2, 2, 3])
  push('16/17 与 20/21 的档界', [16, 17, 20, 21].map(c => costBucketOf(c)), [3, 4, 4, 5])
  push('29-31 并入合并档（实测全库仅 4 条、且从不单独出现）',
    [28, 29, 30, 31, 32, 48, 60].map(c => costBucketOf(c)), [6, 7, 7, 7, 7, 7, 7])
  push('区间标题：≤4 / a-b 金 / 29-48',
    [0, 1, 2, 3, 4, 5, 6, 7].map(b => costRangeOf(b).label),
    ['≤ 4 金', '5-8 金', '9-12 金', '13-16 金', '17-20 金', '21-24 金', '25-28 金', '29-48 金'])
  push('区间上下界与档序号自洽',
    [0, 1, 6, 7].map(b => `${costRangeOf(b).min}-${costRangeOf(b).max}`), ['0-4', '5-8', '25-28', '29-48'])
  push('档序号越界（练度页往后取档）不越出合并档', costRangeOf(99).label, '29-48 金')
  push('每档条数按档位取：0…3 → 6、4 → 5、5…7 → 4',
    [0, 1, 2, 3, 4, 5, 6, 7].map(b => perTierOf(b)), [6, 6, 6, 6, 5, 4, 4, 4])
  push('档数上限覆盖全部 8 档', DEFAULT_MAX_TIERS, 8)
  push('最坏行数（各档都满）= 41 行，比旧口径 44 行更矮', [0, 1, 2, 3, 4, 5, 6, 7].reduce((s, b) => s + perTierOf(b), 0), 41)
}

// ---------- 1. 路由（2026-10-15 合并：`#DPS榜 胡桃` 即角色档位视图） ----------
{
  ok('`#DPS榜 胡桃` 命中榜单入口（app 内分派到角色档位视图）', C.matchCommand('#DPS榜 胡桃')?.key === 'rank')
  ok('`#DPS榜 胡桃 12金` 参数进捕获组', C.matchCommand('#DPS榜 胡桃 12金')?.match[1] === '胡桃 12金')
  ok('`#DPS 胡桃`（榜字可省）同样命中', C.matchCommand('#DPS 胡桃')?.match[1] === '胡桃')
  ok('`#DPS榜 12金`（不带角色名）仍是总榜', C.matchCommand('#DPS榜 12金')?.key === 'rank')
  push('旧 `#胡桃dps` 形态不再命中任何入口', ['#胡桃dps', '#胡桃 dps 12金'].filter(t => C.matchCommand(t) !== null), [])
  push('攻略类命令两边都不命中', ['#胡桃攻略', '#攻略 胡桃'].filter(t => C.matchCommand(t)), [])
}

// ---------- 2. 金档分组 ----------
const hu = await queryCharDps('胡桃', {}, { downloadAvatars: false })
ok('查到了胡桃的记录', hu.ok === true)
if (hu.ok) {
  const raw = fixture.filter(t => (t.members || []).some(m => m.charId === '胡桃' || m.charId === '胡桃'))
  ok('命中条数与夹具里含胡桃的记录数一致', hu.total === raw.length, `${hu.total} vs ${raw.length}`)
  ok('每个金档只出现一次且按区间升序',
    hu.tiers.length > 0 && new Set(hu.tiers.map(t => `${t.min}-${t.max}`)).size === hu.tiers.length &&
    hu.tiers.every((t, i) => i === 0 || hu.tiers[i - 1].max < t.min))
  ok('每档区间都与新口径一致（标题与上下界对得上，含 29-31 与 32-48）',
    hu.tiers.every(t => {
      const want = costRangeOf(costBucketOf(t.min || t.max))
      return t.min === want.min && t.max === want.max && t.label === want.label
    }))
  ok('每档计数 = 命中记录里金数落在该区间的条数（区间不重不漏）',
    hu.tiers.every(t => raw.filter(x => { const c = Number(x.cost) || 0; return c >= t.min && c <= t.max }).length === t.count) &&
    hu.tiers.reduce((s, t) => s + t.count, 0) === raw.length)
  ok('每档条数不超过该档上限（32 金以下 5 条、32-48 合并档 4 条）',
    hu.tiers.every(t => t.rows.length <= perTierOf(costBucketOf(t.min || t.max))),
    hu.tiers.map(t => `${t.label}:${t.rows.length}`).join(' '))
  ok('各档记录数之和等于命中条数', hu.tiers.reduce((s, t) => s + t.count, 0) === hu.total)
  ok('档内按伤害降序',
    hu.tiers.every(t => t.rows.every((r, i) => i === 0 || (t.rows[i - 1].damage || 0) >= (r.damage || 0))))
  ok('副标题写明分档口径（含合并档与条数）与来源',
    /每 4 金一档的最高伤害队伍/.test(hu.subtitle) &&
    /29 金以上合并为 29-48 金一档/.test(hu.subtitle) &&
    /mhydps\.cn/.test(hu.subtitle),
    hu.subtitle.slice(0, 120))
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

// ---------- 3c. 后缀式视频名次（`#DPS榜 胡桃 48金视频1`） ----------
{
  const { takeVideoToken } = await import(pathToFileURL(path.join(libDir, 'modules', 'queryArgs.js')).href)
  const { findRankEntry } = await import(pathToFileURL(path.join(libDir, 'modules', 'rankQuery.js')).href)

  push('摘出 `视频N`：贴在前一个词后面也认', takeVideoToken('胡桃 48金视频1'), { videoNo: 1, rest: '胡桃 48金' })
  push('摘出 `视频N`：独立成词也认', takeVideoToken('胡桃 12金 视频3'), { videoNo: 3, rest: '胡桃 12金' })
  push('没有视频名次时原样返回', takeVideoToken('胡桃 12金'), { videoNo: 0, rest: '胡桃 12金' })

  /*
   * 用户 2026-10-15 澄清：**序号 = 在"限定金数"之后按伤害排名的第 N 名**。
   * 金数沿用榜单口径（`48金` = ≤48 金，要"正好 48 金"用区间写法 `48-48金`）。
   */
  const huRecords = fixture.filter(t => (t.members || []).some(m => m.charId === '胡桃'))
  const damages = huRecords.map(t => Number(t.damage) || 0).sort((a, b) => b - a)
  const first = await findRankEntry({ char: '胡桃' }, 1, { downloadAvatars: false })
  const second = await findRankEntry({ char: '胡桃' }, 2, { downloadAvatars: false })
  ok('视频名次 = 当前筛选内按伤害排名的第 N 名（第 1 名伤害最高、第 2 名次之）',
    first.ok === true && second.ok === true &&
    Number(first.row.damage) === damages[0] && Number(second.row.damage) === damages[1],
    `${first.ok ? first.row.damage : first.error} / ${second.ok ? second.row.damage : second.error}`)
  ok('筛选叠加后名次重新从 1 起（不是全局榜序号）',
    first.ok === true && first.total === huRecords.length && first.rank === 1)

  /*
   * 2026-10-15 用户反馈（第一次）：`#dps 七七 48金 视频1` 里的 `视频1` 被当成**隐式标签**筛掉了全部记录。
   * 隐式标签现在先与数据集核对：一个都不存在就整段忽略；显式 `标签:X` 仍按原样筛（匹配不到给 0）。
   */
  const strayImplicit = await queryCharDps('胡桃', { tag: '视频1' }, { downloadAvatars: false })
  const noTag = await queryCharDps('胡桃', {}, { downloadAvatars: false })
  ok('隐式标签里全是垃圾词 → 整段忽略（结果为不带标签的查询）',
    strayImplicit.ok === true && noTag.ok === true && strayImplicit.total === noTag.total)
  /*
   * 审核意见 Q5："已忽略"必须能看见，但不能被当成筛选条件 ——
   * 摘要里允许出现被忽略词的说明，**不允许**出现在「筛选：标签「…」」里。
   */
  ok('垃圾词不进入筛选条件（只出现在"已忽略"说明里）',
    strayImplicit.ok === true && !/筛选：[^\n]*标签「[^\n]*视频1/.test(strayImplicit.subtitle))
  ok('被忽略的词在副标题里如实说明', strayImplicit.ok === true && strayImplicit.subtitle.includes('已忽略无法核实的词'))

  const strayExplicit = await queryCharDps('胡桃', { tag: '视频1', tagExplicit: true }, { downloadAvatars: false })
  ok('显式 `标签:视频1` 仍按原样筛 → 命中 0', strayExplicit.ok === true && strayExplicit.total === 0)
  ok('显式标签命中 0 时副标题写明标签',
    strayExplicit.ok === true && strayExplicit.subtitle.includes('标签「视频1」'))

  /*
   * 2026-10-15 第二次反馈的现场：**引用机器人上一条回复**时，那段文字跟着进了 e.msg，
   * 被当成隐式标签 → 命中 0、回复与命令完全无关。
   */
  const pollutedTag = '满级 视频https://www.bilibili.com/video/BV14baT6EE7i 数据:原神DPS数据库 · 抓取于 2026-10-15 22:26'
  const polluted = await queryCharDps('胡桃', { tag: pollutedTag }, { downloadAvatars: false })
  ok('引用回复带进来的整段垃圾不再把结果筛成 0',
    polluted.ok === true && polluted.total === noTag.total, String(polluted.ok ? polluted.total : polluted.error))
  ok('整段垃圾不进入筛选条件（审核 Q5：只作"已忽略"说明）',
    polluted.ok === true && !/筛选：[^\n]*视频https/.test(polluted.subtitle) &&
    polluted.subtitle.includes('已忽略无法核实的词'))

  // 真实存在过的标签仍然照常筛（隐式裸词）
  const realTag = fixture.flatMap(t => t.tags || [])[0]
  if (realTag) {
    const byTag = await queryCharDps('胡桃', { tag: realTag }, { downloadAvatars: false })
    ok(`隐式标签「${realTag}」是真实标签 → 照常参与筛选`,
      byTag.ok === true && byTag.subtitle.includes(`标签「${realTag}」`))
  }
}


{
  const huo = await queryCharDps('火神', {}, { downloadAvatars: false })
  ok('别名「火神」解析为玛薇卡', huo.ok === true && huo.charName === '玛薇卡')
  const low = await queryCharDps('胡桃', { costMax: 12 }, { downloadAvatars: false })
  ok('金数上限筛选生效（所有档上界 ≤ 12）', low.ok === true && low.tiers.every(t => t.max <= 12))
  const none = await queryCharDps('不存在的角色', {}, { downloadAvatars: false })
  ok('角色不存在时返回可用的失败结果', none.ok === false && !!none.error)
}

// ---------- 4b. 全库金档视图（`#DPS榜` 不带参数，2026-10-27 用户定） ----------
{
  const { queryCostTiers } = await import(pathToFileURL(path.join(libDir, 'modules', 'charDpsQuery.js')).href)
  const all = await queryCostTiers({}, { downloadAvatars: false })
  ok('全库金档视图可用', all.ok === true)
  if (all.ok) {
    const rawCosts = fixture.map(t => Number(t.cost) || 0)
    ok('命中条数 = 夹具全部记录', all.total === rawCosts.length, `${all.total} vs ${rawCosts.length}`)
    ok('档数 = 夹具覆盖的金档数',
      all.tiers.length === new Set(rawCosts.map(costBucketOf)).size,
      `${all.tiers.length} vs ${new Set(rawCosts.map(costBucketOf)).size}`)
    ok('全库视图每档条数不超过该档上限',
      all.tiers.every(t => t.rows.length <= perTierOf(costBucketOf(t.min || t.max))),
      all.tiers.map(t => `${t.label}:${t.rows.length}`).join(' '))
    ok('全库视图档内按伤害降序',
      all.tiers.every(t => t.rows.every((r, i) => i === 0 || (t.rows[i - 1].damage || 0) >= (r.damage || 0))))
    ok('全库视图副标题写明分档口径与来源（且不写角色名）',
      /每 4 金一档的最高伤害队伍/.test(all.subtitle) && /mhydps\.cn/.test(all.subtitle) && !/#胡桃/.test(all.subtitle))
  }
  const low = await queryCostTiers({ costMax: 12 }, { downloadAvatars: false })
  ok('全库视图支持金数筛选（所有档上界 ≤ 12）', low.ok === true && low.tiers.every(t => t.max <= 12))
}

// ---------- 5. 接线（2026-10-15 合并：角色档位视图并入 `#DPS榜`） ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'rank.ts'))
  ok('榜单 app 用 RULES.rank 注册规则', src.includes('reg: RULES.rank'))
  ok('榜单 app 元数据取自 COMMANDS', src.includes('COMMANDS.find(') && src.includes('META.priorityOffset'))
  ok('榜单 app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
  ok('模板 char-dps.html 已就位', fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'char-dps.html')))
  ok('带角色名时走角色档位视图（原 charDps app 已并入）',
    src.includes('replyCharTiers') && src.includes('queryCharDps') && src.includes("respond(e, 'char-dps'"))
  // 2026-10-27：不带参数 → 全库金档视图；带金数 / 总榜 → 平铺榜单（金数视图硬上限 10 条）
  ok('不带参数走全库金档视图', src.includes('replyCostTiers') && src.includes('queryCostTiers'))
  ok('金数 / 总榜走平铺榜单且金数视图最多 10 条',
    src.includes('FLAT_MAX_ROWS') && src.includes('Math.min(FLAT_MAX_ROWS, getPageSize())') && src.includes('replyRankPage'))
  ok('COMMANDS 里不再有 charDps 条目、规则也随合并移除',
    !C.COMMANDS.some(c => c.rules.includes('charDps')) && C.RULES.charDps === undefined)
  ok('原 app 文件已删除', !fs.existsSync(path.join(pluginRoot, 'src', 'apps', 'charDps.ts')))
}

const bad = report()
process.exit(bad ? 1 : 0)
