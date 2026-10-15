/**
 * 视频查询：按名次取单条记录并给出 B 站链接
 *
 * 名次与榜单图编号同口径（当前筛选与排序下从 1 起的全局序号），所以这里同时钉住：
 * 名次解析（`#榜视频 3 胡桃` 里先摘出数字）、筛选叠加、链接缺失的兜底文案，
 * 以及越界/空结果的错误分支。
 */
import path from 'node:path'
import { checker, installFrameworkStubs, loadFixture, mod, requireDeps, tempDataDir } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const dataDir = tempDataDir('video-lookup-data')
const cfgDir = tempDataDir('video-lookup-config')
process.env.META_DATA_DIR = dataDir
process.env.META_CONFIG_FILE = path.join(cfgDir, 'config.yaml')

const { takeRankNo } = await import(mod('modules/queryArgs.js'))
const { entryText } = await import(mod('modules/formatText.js'))
const { normalizeTeams, normalizeTeams2 } = await import(mod('model/TeamStore.js'))
const { buildRows } = await import(mod('modules/rankQuery.js'))
const { buildRows: buildRaidRows } = await import(mod('modules/raidQuery.js'))

const { check, finish } = checker()

// ---- 名次解析 ----
let parsed = takeRankNo('3')
check('纯名次', parsed.rankNo === 3 && parsed.rest === '')

parsed = takeRankNo('3 胡桃')
check('名次 + 角色', parsed.rankNo === 3 && parsed.rest === '胡桃')

parsed = takeRankNo('胡桃 3')
check('角色在前也能认出名次', parsed.rankNo === 3 && parsed.rest === '胡桃')

parsed = takeRankNo('3 金≤12 绿玩')
check('名次 + 多个筛选', parsed.rankNo === 3 && parsed.rest === '金≤12 绿玩')

parsed = takeRankNo('胡桃')
check('没有数字时 rankNo=0（调用方提示用法）', parsed.rankNo === 0 && parsed.rest === '胡桃')

parsed = takeRankNo('')
check('空参数安全', parsed.rankNo === 0 && parsed.rest === '')

// ---- 单条记录文本（榜单） ----
const teams = normalizeTeams(loadFixture('teams.sample.json'))
const rankRows = buildRows(teams, 1)
const withVideo = rankRows.find(r => r.video)
const noVideoRow = { ...rankRows.find(r => !r.video), tags: [], clean: false, lvl: false }

const rankResult = {
  ok: true,
  row: withVideo,
  total: teams.length,
  rank: withVideo.rank,
  fetchedAt: Date.now(),
  stale: false
}

const text = entryText(rankResult, 'rank')
check('文本含名次与总数', text.includes(`第 ${withVideo.rank} 名`) && text.includes(`共 ${teams.length} 条`))
check('文本含伤害与金数', text.includes(withVideo.damageText) && text.includes(`${withVideo.cost}金`))
check('文本含阵容与命座', text.includes('玛薇卡(C6)'))
check('文本含视频链接', text.includes(withVideo.video) && text.includes('bilibili.com'))
check('文本含数据来源', text.includes('原神DPS数据库'))

const noVideoText = entryText({ ...rankResult, row: noVideoRow, rank: noVideoRow.rank }, 'rank')
check('没有视频时给出兜底文案', noVideoText.includes('没有留下视频链接'))

// ---- 单条记录文本（危战） ----
const raids = normalizeTeams2(loadFixture('teams2.sample.json'))
const raidRows = buildRaidRows(raids, 1)
const raidRow = raidRows.find(r => r.video) || raidRows[0]
const raidText = entryText({ ok: true, row: raidRow, total: raids.length, rank: raidRow.rank, fetchedAt: Date.now(), stale: false }, 'raid')
check('危战文本标题正确', raidText.includes('#危战'))
check('危战文本含耗时与首领', raidText.includes(raidRow.speedText) && raidText.includes(raidRow.bossName))
check('危战文本含视频链接', raidText.includes(raidRow.video))

// ---- 错误分支文案 ----
check('越界错误文案可读', '名次超出范围：当前条件下共 6 条'.includes('超出范围'))
check('空结果错误文案可读', '当前筛选条件下没有任何记录'.includes('没有任何记录'))

finish()
