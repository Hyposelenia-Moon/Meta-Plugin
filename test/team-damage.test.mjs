/**
 * `#队伍伤害` 套件（v3 P3 v1）
 *
 * 纯函数部分用 `test/fixtures/dps-cache-teams.json`（真实缓存抽样）里的**真实阵容**驱动，
 * 接线部分做源码/模板级断言；miao 桥在开发工作区（无 miao）只验证"可读失败"。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('#队伍伤害（v3 P3）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const C = await load('components/constants.js')
const TD = await load('modules/teamDamage.js')

const fixture = JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', 'dps-cache-teams.json')))

// ---------- 1. 金数估算 ----------
{
  const team = [
    { charName: '胡桃', rarity: 5, level: 90, cons: 1, weapon: { name: '护摩之杖', affix: 1, rarity: 5 } },
    { charName: '行秋', rarity: 4, level: 90, cons: 6, weapon: { name: '祭礼剑', affix: 1, rarity: 4 } },
    { charName: '夜兰', rarity: 5, level: 90, cons: 0, weapon: { name: '若水', affix: 1, rarity: 5 } },
    { charName: '钟离', rarity: 5, level: 90, cons: 2, weapon: { name: '黑缨枪', affix: 5, rarity: 3 } }
  ]
  // 胡桃 1+1+1=3｜行秋 0+6+0=6｜夜兰 1+0+1=2｜钟离 1+2+0=3 → 合计 14
  ok('金数 = 5★角色 + 命座 + 5★武器（精炼不计）', TD.estimateCost(team) === 14, String(TD.estimateCost(team)))
  ok('金数构成说明可读', /5★角色 3/.test(TD.costBreakdown(team)) && /命座 9/.test(TD.costBreakdown(team)), TD.costBreakdown(team))
  ok('空队伍为 0 金', TD.estimateCost([]) === 0)
}

// ---------- 2. 同阵容匹配（真实数据） ----------
{
  const sample = fixture[0]
  const names = (sample.members || []).map(m => m.charId)
  ok('夹具首条是四人阵容', names.length === 4, JSON.stringify(names))
  ok('同阵容（顺序无关）能匹配', TD.isSameLineup(sample, [...names].reverse()) === true)
  ok('少一人不算同阵容', TD.isSameLineup(sample, names.slice(0, 3)) === false)
  ok('换人后不算同阵容', TD.isSameLineup(sample, [names[0], names[1], names[2], '不存在角色']) === false)

  const found = TD.findLineupRefs(fixture, names, 0, 5)
  ok('能找到该阵容的记录', found.total >= 1 && found.refs.length >= 1, `total=${found.total}`)
  ok('最多返回 limit 条', found.refs.length <= 5)
  ok('按金数最接近排序（差值递增）', found.refs.every((r, i) => i === 0 || found.refs[i - 1].costDiff <= r.costDiff))
  ok('同金时按伤害降序',
    found.refs.every((r, i) => {
      if (i === 0) return true
      const prev = found.refs[i - 1]
      return prev.costDiff !== r.costDiff || prev.damage >= r.damage
    }))
  ok('参考行带金数三元组与视频字段', found.refs.every(r => Number.isFinite(r.cost) && Number.isFinite(r.limitcost) && Number.isFinite(r.normalcost) && typeof r.video === 'string'))
  ok('参考行成员带命座', found.refs.every(r => r.members.length === 4 && r.members.every(m => Number.isFinite(m.cons))))

  const none = TD.findLineupRefs(fixture, ['胡桃', '行秋', '夜兰', '不存在的第四人'], 0, 5)
  ok('没有该阵容时返回空而不是报错', none.total === 0 && none.refs.length === 0)
}

// ---------- 3. 视图与提示 ----------
{
  const members = [{ charName: '胡桃', rarity: 5, level: 90, cons: 1, weapon: null, rows: [{ title: '半血开E重击', value: 30000 }] }]
  const v = TD.buildTeamDamageView(members, fixture, 5)
  ok('视图带估算金数与构成', Number.isFinite(v.approxCost) && v.costNote.length > 0, `${v.approxCost}｜${v.costNote}`)
  ok('没有对应阵容时给出解释性提示', v.refs.length === 0 ? v.notes.some(n => n.includes('暂时没有')) : true, v.notes.join('｜'))

  // 有同阵容但没有同金 → 提示金数差异
  const sample = fixture[0]
  const names = (sample.members || []).map(m => m.charId)
  const realMembers = names.map(n => ({ charName: n, rarity: 5, level: 90, cons: 0, weapon: null, rows: [] }))
  const v2 = TD.buildTeamDamageView(realMembers, fixture, 5)
  ok('有阵容但无同金时提示按金数最接近排序', v2.refTotal > 0 && (v2.refs.some(r => r.costDiff === 0) || v2.notes.some(n => n.includes('没有正好'))), v2.notes.join('｜'))
  ok('缺伤害行时给出提示', v2.notes.some(n => n.includes('伤害行')))
}

// ---------- 4. 路由与参数 ----------
{
  const ev = C.matchCommand('#队伍伤害 胡桃 行秋 夜兰 钟离')
  ok('`#队伍伤害 …` 命中新入口', ev?.key === 'teamDamage')
  ok('参数进捕获组 2（轴序号为空）', !ev?.match[1] && ev?.match[2] === '胡桃 行秋 夜兰 钟离')

  // 2026-10-15：轴改为内置序号（`#队伍伤害2 …`）
  const ev2 = C.matchCommand('#队伍伤害2 胡桃 行秋 夜兰 钟离 暴击+20')
  ok('序号轴进捕获组 1', ev2?.match[1] === '2' && ev2?.match[2] === '胡桃 行秋 夜兰 钟离 暴击+20')
  const ev3 = C.matchCommand('#队伍伤害 123456789 胡桃 行秋 夜兰 钟离')
  ok('9 位 UID 不会被当成轴序号', !ev3?.match[1] && String(ev3?.match[2]).startsWith('123456789'))

  const p = TD.parseTeamArgs('胡桃 行秋 夜兰 钟离 暴击+20 +30爆伤 123456789')
  ok('词条免前缀即被识别（不再是角色名）',
    p.names.join(',') === '胡桃,行秋,夜兰,钟离' && p.patchTokens.join(' ') === '暴击+20 +30爆伤')
  ok('UID 仍单独取出', p.uid === '123456789')
  const pl = TD.parseTeamArgs('胡桃 行秋 夜兰 钟离 轴:重击×8 词条:暴击+20')
  ok('旧写法被识别为 legacy（给改用提示，不当角色名）', pl.legacyTokens.length === 2 && pl.names.length === 4)

  const legacy = ['#DPS', '#meta状态', '#危战 7.1', '#练度查询 胡桃', '#危战']
  push('不吞其它入口', legacy.filter(t => C.matchCommand(t)?.key === 'teamDamage'), [])
  ok('COMMANDS 登记了 teamDamage', C.COMMANDS.some(c => c.rules.includes('teamDamage')))

  const app = await load('apps/teamDamage.js').catch(() => null)
  ok('app 产物存在', fs.existsSync(path.join(libDir, 'apps', 'teamDamage.js')))
}

// ---------- 4b. 序号轴表（配置项 teamDamageAxes） ----------
{
  const AX = await load('modules/teamAxes.js')
  const def = AX.parseAxesConfig('')
  ok('配置空着也永远有轴 1（保守轴）', def.length === 1 && def[0].no === '1' && def[0].axis.manual === false)
  ok('不带序号 = 轴 1', AX.axisByNo('', '').no === '1')

  const cfg = '1:保守轴=默认,2:重击轴=重击×8@20s+元素战技×1,3=元素爆发×1+重击×4@15s'
  const axes = AX.parseAxesConfig(cfg)
  ok('解析出 3 个轴且按序号排序', axes.map(a => a.no).join(',') === '1,2,3')
  ok('轴 2 名称与窗口正确', axes[1].name === '重击轴' && axes[1].axis.window === 20 && axes[1].axis.manual === true)
  ok('轴 2 的两段关键词与次数正确',
    axes[1].axis.segments.map(s => `${s.keyword}×${s.count}`).join('+') === '重击×8+元素战技×1')
  ok('没写名称时用轴定义兜底', axes[2].name.includes('元素爆发×1'))
  ok('取轴：命中 / 未命中', AX.axisByNo('2', cfg)?.name === '重击轴' && AX.axisByNo('9', cfg) === null)
  const help = AX.axesHelpLines(cfg)
  ok('帮助清单只给序号+名称+窗口（不暴露关键词写法）',
    help.length === 3 && help[1].includes('2 = 重击轴') && !help[1].includes('×8'), help.join('｜'))
}

// ---------- 5. app 与模板接线 ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'teamDamage.ts'))
  ok('app 用 RULES.teamDamage 注册', src.includes('reg: RULES.teamDamage'))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
  ok('v1 要求四个角色名（不擅自补队）', src.includes('names.length !== 4'))
  ok('app 复用 miao 桥与纯函数模块', src.includes("from '../model/MiaoProfile.js'") && src.includes("from '../modules/teamDamage.js'"))
  ok('app 走榜单缓存取同阵容参考', src.includes('ensureFresh') && src.includes('getSnapshot'))

  const tpl = readText(path.join(pluginRoot, 'resources', 'dps', 'team-damage.html'))
  ok('模板已就位并引用公共样式', fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'team-damage.html')) &&
    tpl.includes('{{_res_path}}/common/base.css') && tpl.includes('{{renderScale}}') && tpl.includes('{{copyright}}'))
  ok('模板渲染队员伤害与参考区', tpl.includes('{{each members m}}') && tpl.includes('{{each refs r}}'))
  ok('帮助页收录 #队伍伤害（默认轴，不带序号）', /#队伍伤害 四人名/.test(readText(path.join(pluginRoot, 'resources', 'help', 'help-cfg.js'))))
}

// ---------- 6. miao 桥：无 miao 时可读失败 ----------
{
  const MP = await load('model/MiaoProfile.js')
  const r = await MP.readTeamDamage({ msg: '#队伍伤害 四人名', reply: async () => {} }, ['胡桃', '行秋', '夜兰', '钟离'])
  ok('无 miao 时返回 ok:false 而不是抛错', r.ok === false)
  ok('失败原因可读', typeof r.error === 'string' && /miao|未找到/.test(r.error), r.error)
}

const bad = report()
process.exit(bad ? 1 : 0)
