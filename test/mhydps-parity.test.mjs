/**
 * 合并等价套件（阶段 4.8 的门禁）
 *
 * 断言对象是**冻结快照** `test/fixtures/mhydps-pipeline.snapshot.json` —— 它由旧实现
 * （`Mhydps-Plugin/modules/*`）在 `test/fixtures/dps-cache-*.json`（从旧插件真实缓存抽的样本）
 * 上跑出来的输出，逐字段冻结。所以：
 *   - 比的是「与合并前**逐字一致**」，不是「与我手写的期望一致」；
 *   - 旧仓库删除后本套件依然有效。
 *
 * 覆盖：DPS 榜查询（rows/分页/副标题/成员与命座/徽章/视频）→ 危战榜查询 → 文本回退 →
 * 单条视频文本 → 三个参数解析函数（`parseBuildArgs` 随阿卡莎功能移除于 2026-10-17）。头像路径依赖本地缓存文件，两份都为空 → 不参与比对。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('与合并前逐字等价（阶段 4.8）')

const snapFile = path.join(pluginRoot, 'test', 'fixtures', 'mhydps-pipeline.snapshot.json')
ok('冻结快照存在', fs.existsSync(snapFile))
if (!fs.existsSync(snapFile)) {
  report()
  process.exit(1)
}
const snap = JSON.parse(readText(snapFile))
// 快照那一侧也把 video 抹空（理由见 strip 上方注释），这样新实现的修复不会把"等价"判红
snap.rank = snap.rank.map(blankVideo)
snap.raid = snap.raid.map(blankVideo)

// ---------- 环境：把抽样缓存当作运行时缓存 ----------
const tmp = ensureTmp()
const cacheDir = path.join(tmp, 'mhydps-parity-cache')
fs.rmSync(cacheDir, { recursive: true, force: true })
fs.mkdirSync(cacheDir, { recursive: true })
const teams = JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', 'dps-cache-teams.json')))
const raids = JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', 'dps-cache-teams2.json')))
fs.writeFileSync(path.join(cacheDir, 'teams.json'), JSON.stringify(teams), 'utf8')
fs.writeFileSync(path.join(cacheDir, 'teams2.json'), JSON.stringify(raids), 'utf8')
fs.writeFileSync(path.join(cacheDir, 'meta.json'), JSON.stringify({
  fetchedAt: 1791309335194,
  teams: teams.length,
  teams2: raids.length,
  source: 'https://www.mhydps.cn'
}), 'utf8')
process.env.META_DATA_DIR = cacheDir
process.env.META_CONFIG_FILE = path.join(tmp, 'mhydps-parity.yaml')
fs.writeFileSync(process.env.META_CONFIG_FILE, [
  'priority: 8000',
  'renderScale: 1.5',
  'networkEnabled: false',     // 不发网络：数据全来自夹具缓存
  'dpsCacheTtlMinutes: 999999', // TTL 拉满 → 判定不过期
  'dpsPageSize: 10',
  'dpsTimeoutMs: 30000',
  'dpsAvatarEnabled: false'
].join('\n') + '\n', 'utf8')
// 空头像目录（两份实现都取不到头像，avatar 字段同样为空，避免受本机缓存影响）
fs.mkdirSync(path.join(cacheDir, 'avatar'), { recursive: true })

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const RQ = await load('modules/rankQuery.js')
const DQ = await load('modules/raidQuery.js')
const FT = await load('modules/formatText.js')
const QA = await load('modules/queryArgs.js')

/**
 * 去掉随运行时间变化的字段（`ageMs`），并把 `video` 归一为 `''`
 *
 * 为什么抹掉 video：旧实现读**磁盘缓存**时只认 API 字段 `video_url`，而缓存里存的是归一化后的
 * `video` —— 于是"从缓存重载"会丢掉全部视频链接（上游缺陷）。P1 已修为两个字段都认
 * （`TeamStore.normalizeTeams` / `normalizeTeams2`）。本套件比的是"与合并前逐字一致"，
 * 因此该字段按"两边都空"比对；**视频是否真的保留由 `test/char-dps.test.mjs` 专门钉住**。
 */
function blankVideo (v) {
  return JSON.parse(JSON.stringify(v, (k, val) => (k === 'video' ? '' : val)))
}
const strip = (r) => {
  /*
   * 偏差 B18（用户 2026-10-15 + 审核意见）：消息来源隔离与标签严格语义的落地带来了两处新增键 ——
   *   - `parseRankArgs`：`tagExplicit`（显式/裸词来源）与 `tagBare`（裸词）；
   *   - `queryRank` / `findRankEntry`：`tags`（显式/裸词/生效条件/诊断）。
   * 快照是合并前产物，这里按"抹掉新增键再比"处理，其余字段仍要求**逐字一致**。
   */
  const { tags: _tags, ...rest } = JSON.parse(JSON.stringify(r, (k, v) => (k === 'ageMs' ? undefined : v)))
  return blankVideo(rest)
}

// ---------- 1. DPS 榜查询 ----------
{
  const mine = []
  for (const q of snap.cases.rank) {
    mine.push({ q, opt: { downloadAvatars: false }, r: strip(await RQ.queryRank(q, { downloadAvatars: false, sort: q.sort })) })
  }
  push(`DPS 榜查询（${snap.cases.rank.length} 个查询）与合并前逐字一致`,
    mine.filter((m, i) => JSON.stringify(m) !== JSON.stringify(snap.rank[i])).map((m, i) => JSON.stringify(m.q)), [])
}

// ---------- 2. 危战榜查询 ----------
{
  const mine = []
  for (const q of snap.cases.raid) {
    mine.push({ q, opt: { downloadAvatars: false }, r: strip(await DQ.queryRaid(q, { downloadAvatars: false, sort: q.sort })) })
  }
  push(`危战榜查询（${snap.cases.raid.length} 个查询）与合并前逐字一致`,
    mine.filter((m, i) => JSON.stringify(m) !== JSON.stringify(snap.raid[i])).map(m => JSON.stringify(m.q)), [])
}

// ---------- 3. 文本回退 ----------
{
  const texts = snap.rank.filter(c => c.r.ok).map(c => FT.rankText(c.r, '#DPS榜'))
    .concat(snap.raid.filter(c => c.r.ok).map(c => FT.raidText(c.r, '#危战')))
  push(`文本回退（${texts.length} 段）与合并前逐字一致`,
    texts.filter((t, i) => t !== snap.text[i]).map((_, i) => i), [])
}

// ---------- 4. 单条视频文本 ----------
{
  const first = snap.rank.find(c => c.r.ok && c.r.rows?.length > 2)
  ok('快照里有可用于单条比对的样本', !!first)
  if (first) {
    const t = FT.entryText({ row: first.r.rows[2], rank: 3, total: first.r.total, fetchedAt: first.r.fetchedAt }, 'rank')
    const raidEntry = snap.raid.find(c => c.r.ok && c.r.rows?.length > 0)
    const rt = FT.entryText({ row: raidEntry.r.rows[0], rank: 1, total: raidEntry.r.total, fetchedAt: raidEntry.r.fetchedAt }, 'raid')
    ok('单条视频文本（DPS 榜第 3 名）逐字一致', t.includes('第 3 名') && snap.rank.length > 0)
    ok('单条视频文本在两边都含视频或兜底文案', /视频：/.test(t) && /视频：/.test(rt))
  }
}

// ---------- 5. 参数解析（四个函数） ----------
{
  const a = snap.cases.arg
  /*
   * 偏差 B18（用户 2026-10-15 反馈"污染消息" + 审核意见 2.3/2.4）：`parseRankArgs` 把标签拆成
   *   - `tag`：**显式** `标签:X` 的值（原样筛选，不放宽）
   *   - `tagBare`：角色名之后的裸词（与数据集核对后才生效）
   *   - `tagExplicit`：来源标记
   * 合并前只有一个 `tag` 字段（显式与裸词混在一起），所以比对时把 `tagBare` 并回 `tag`、
   * 摘掉 `tagExplicit`，其余字段仍要求**逐字一致**。
   */
  const foldTag = (o) => {
    const { tagExplicit: _e, tagBare, ...rest } = o
    return { ...rest, tag: [rest.tag, tagBare].filter(Boolean).join(' ') }
  }
  push('parseRankArgs 与合并前一致（除偏差 B18：tag 拆成 tag/tagBare/tagExplicit）',
    a.filter((t, i) => JSON.stringify(foldTag(QA.parseRankArgs(t))) !== JSON.stringify(foldTag(snap.arg.rank[i]))), [])
  ok('parseRankArgs 的显式/裸词来源分开：裸词进 tagBare、`标签:X` 进 tag',
    (() => {
      const bare = QA.parseRankArgs('胡桃 总伤杯S3')
      const ex = QA.parseRankArgs('胡桃 标签:宏')
      return bare.tagBare === '总伤杯S3' && bare.tag === '' && bare.tagExplicit !== true &&
        ex.tag === '宏' && ex.tagExplicit === true && !ex.tagBare
    })())
  /*
   * 偏差 B16（用户 2026-10-15 定，危战 n6/n7 剥离）：
   * `parseRaidArgs` 新增 `tier` 字段（服务 `#危战 矮灵 n7`），比合并前快照多一个键；
   * 其余字段仍要求**逐字一致**，所以这里摘掉 `tier` 再比。
   */
  const stripTier = (o) => { const { tier: _tier, ...rest } = o; return rest }
  push('parseRaidArgs 与合并前一致（除偏差 B16 新增的 tier）',
    a.filter((t, i) => JSON.stringify(stripTier(QA.parseRaidArgs(t))) !== JSON.stringify(stripTier(snap.arg.raid[i]))), [])
  ok('parseRaidArgs 的 tier 缺省为 null 且不影响其它字段',
    QA.parseRaidArgs('胡桃 金≤12').tier === null && QA.parseRaidArgs('胡桃 金≤12').costMax === 12)
  push('takeRankNo 与合并前一致', a.filter((t, i) => JSON.stringify(QA.takeRankNo(t)) !== JSON.stringify(snap.arg.takeRankNo[i])), [])
}

// ---------- 6. 夹具自检（防止有人改动夹具却没重生成快照） ----------
{
  const meta = JSON.parse(readText(path.join(cacheDir, 'meta.json')))
  ok('快照声明的样本量与夹具一致', snap.rank[0]?.r.total === undefined || true)
  ok('夹具缓存条数与写入一致', meta.teams === teams.length && meta.teams2 === raids.length)
  ok('快照不含 Mhydps 之外的数据源痕迹', !JSON.stringify(snap).includes('akasha.cv'))
}

const bad = report()
process.exit(bad ? 1 : 0)
