/** 可选攻略预设评分：纯合成数据行为测试，不读写攻略、不联网。 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { ok, report } = createChecks('练度 · 独立预设四维评分')
// 临时编译验证可显式指向 test/.test-tmp 中的产物；正常套件仍使用 lib。
const root = process.env.META_GRADE_TEST_LIB || libDir
const G = await import(pathToFileURL(path.join(root, 'modules/grade.js')).href)
const preset = (role = 'dps', weights) => ({ id: role, name: role, role, weights, meta: {}, v2: {} })
const panel = (attrKey, min, groups = ['输出向'], cond) => ({ raw: `${attrKey}:${min}`, name: attrKey, attrKey, min, max: min, groups, percent: true, cond })
const target = () => ({
  charName: '测试角色', gradeRole: 'dps', levelMin: 80, levelText: '80',
  artifact: { recommend: ['推荐套'], optional: ['可选套'] },
  mainStats: [{ slot: '时之沙', options: ['攻击力'], optionViews: [{ name: '攻击力', mark: '' }] }],
  panel: [panel('cpct', 80), panel('recharge', 200)],
  weapon: { recommend: ['推荐剑'], optional: ['可选剑'], transition: ['过渡剑'] },
  talent: [{ key: 'E', target: 10, crown: false }], consKeys: []
})
const build = () => ({
  charName: '测试角色', level: 90, cons: 0,
  weapon: { name: '推荐剑', affix: 1 }, talent: { E: 10 },
  artis: ['生之花', '死之羽', '时之沙', '空之杯', '理之冠'].map(slot => ({ slot, set: '推荐套', mainName: '攻击力', level: 20 })),
  artiMark: { total: 240, markClass: 'ACE' }, attrs: { cpct: 80, recharge: 200 }
})
const run = (t = target(), b = build(), p = preset()) => G.gradeBuild(t, b, { preset: p })
const dim = (r, key) => r.dims.find(d => d.key === key)
const row = (r, id) => r.rows.find(d => d.id === id)
const near = (a, b) => Math.abs(a - b) < 1e-9

{
  const r = run()
  ok('输出预设真实四维且无 comprehensive', r.dims.map(d => d.key).join(',') === 'artifact,panel,weapon,talent')
  ok('输出默认外层权重 30/30/20/20', r.dims.map(d => d.weight).join(',') === '0.3,0.3,0.2,0.2')
  ok('artifact 按 60/25/15 组合', near(dim(r, 'artifact').ratio, 0.97))
  ok('ACE 词条计分/证据/建议一致达标', dim(r, 'artifact').state === 'met' && row(r, 'artifact:mark').state === 'met' && !r.suggestions.some(s => s.includes('提升有效词条')))
  ok('总分使用真实四维', r.total === 99.1 && r.assessable)
  ok('不传 preset 仍是旧三维', G.gradeBuild(target(), build()).dims.map(d => d.key).join(',') === 'comprehensive,weapon,talent')
}
{
  const b = build(); b.artiMark.markClass = 'SS'
  const r = run(target(), b)
  ok('SS .8 不得以旧阈值误判词条达标', dim(r, 'artifact').state === 'below' && row(r, 'artifact:mark').state === 'below')
  ok('词条低于 .95 提建议并绑定真实证据', r.suggestionRows.some(s => s.evidenceIds.includes('artifact:mark')))
  const legacy = G.gradeBuild(target(), b)
  ok('旧路径 mark 证据同样修复至 .95', row(legacy, 'artifact:mark').state === 'below')
  b.artiMark.markClass = 'SSS'
  ok('SSS .9 仍未达 ACE 线', row(run(target(), b), 'artifact:mark').state === 'below')
}
{
  const b = build(); b.artis.forEach(a => { a.set = '可选套' })
  let r = run(target(), b)
  ok('可选套 .8 计分证据均达标', dim(r, 'artifact').state === 'met' && row(r, 'artifact:set').state === 'met')
  b.artis.forEach(a => { a.set = '冒险家' })
  r = run(target(), b)
  ok('不推荐套有独立未达标证据与建议', dim(r, 'artifact').state === 'below' && row(r, 'artifact:set').state === 'below' && r.suggestionRows.some(s => s.evidenceIds.includes('artifact:set')))
  b.artis[2].mainName = '防御力'
  r = run(target(), b)
  ok('错误主词条独立证据与建议', row(r, 'artifact:main:时之沙').state === 'below' && r.suggestionRows.some(s => s.evidenceIds.includes('artifact:main:时之沙')))
}
{
  const t = target(); t.artifact = { recommend: [], optional: [] }; t.mainStats = []
  const r = run(t)
  ok('artifact 缺攻略分量按可评分量重归一', near(dim(r, 'artifact').ratio, .95))
  t.panel = []; t.weapon = { recommend: [], optional: [], transition: [] }; t.talent = []
  const only = run(t)
  ok('缺目标 unscored 不扣分，外层可评权重重归一', dim(only, 'panel').state === 'unscored' && dim(only, 'weapon').state === 'unscored' && dim(only, 'talent').state === 'unscored' && dim(only, 'artifact').weight === 1 && only.total === 95)
}
for (const [name, mutate, key] of [
  ['miao 评分缺失', b => { b.artiMark = null }, 'artifact'],
  ['主词条部位缺失', b => { b.artis = b.artis.filter(a => a.slot !== '时之沙') }, 'artifact'],
  ['主词条名称缺失', b => { b.artis[2].mainName = '' }, 'artifact'],
  ['面板部分缺失', b => { delete b.attrs.recharge }, 'panel'],
  ['面板全部缺失', b => { b.attrs = {} }, 'panel'],
  ['武器缺失', b => { b.weapon = null }, 'weapon'],
  ['天赋部分缺失', b => { b.talent = {} }, 'talent'],
  ['天赋标记缺失', b => { b.hasTalent = false }, 'talent'],
  ['武器标记缺失', b => { b.hasWeapon = false }, 'weapon'],
  ['评分标记缺失', b => { b.hasMark = false }, 'artifact']
]) {
  const b = build(); mutate(b)
  const r = run(target(), b)
  ok(`${name}：unknown 且必需未知待评`, dim(r, key).state === 'unknown' && dim(r, key).ratio === null && !r.assessable)
  ok(`${name}：不得谎称均达标`, !r.suggestions.some(s => s.includes('均已达标')))
}
{
  const b = build(); b.attrs = { cpct: 80, recharge: 0 }
  const t = target(); t.panel[1].groups = ['辅助向']
  const r = run(t, b)
  ok('预设面板不跨方向择优，真实 0 是 below 非 unknown', near(dim(r, 'panel').ratio, .5) && dim(r, 'panel').state === 'below' && row(r, 'panel:辅助向:recharge').state === 'below' && r.assessable)
  ok('面板未满目标时计分/证据/建议一致', r.suggestionRows.some(s => s.evidenceIds.includes('panel:辅助向:recharge')))
  b.attrs.recharge = 199
  const close = run(t, b)
  ok('面板 99.75% 不因旧 .9 线达标', dim(close, 'panel').state === 'below' && row(close, 'panel:辅助向:recharge').state === 'below' && close.suggestionRows.some(s => s.id === 'panel'))
  t.panel = [panel('recharge', 200, ['辅助向'], { name: '', mark: '（满命）', consMin: 6 })]
  delete b.attrs.recharge
  const conditional = run(t, b)
  ok('不适用命座目标 unscored 而非数据缺失', dim(conditional, 'panel').state === 'unscored' && conditional.assessable && row(conditional, 'panel:辅助向:recharge').state === 'unscored')
}
{
  const b = build(); b.artiMark = null; b.artis = []
  const r = run(target(), b, preset('support'))
  ok('辅助真实三维且无需 artifact 数据', r.dims.map(d => d.key).join(',') === 'panel,weapon,talent' && r.assessable)
  ok('辅助默认 50/25/25', r.dims.map(d => d.weight).join(',') === '0.5,0.25,0.25')
  ok('辅助圣遗物证据仅参考，不产生改善建议', r.rows.filter(r => r.id.startsWith('artifact:')).every(r => !r.scored && r.state === 'unscored') && !r.suggestions.some(s => /圣遗物|主词条/.test(s)))
}
{
  const b = build(); b.artiMark = null; b.attrs = {}; b.weapon = null; b.talent = {}
  const p = preset('dps', { artifact: 0, panel: 0, weapon: 0, talent: 0 })
  const r = run(target(), b, p)
  ok('全零权重不计分不制造未知或未达标', !r.assessable && r.total === 0 && r.dims.every(d => d.weight === 0 && d.ratio === null && d.state === 'unscored') && r.rows.every(r => !r.scored))
  ok('全零权重建议不能催改善', r.suggestionRows.every(s => !s.evidenceIds.length) && !r.suggestions.some(s => /提升|换|补齐|均已达标/.test(s)))
  const mixed = run(target(), b, preset('dps', { artifact: 0, panel: 0, weapon: 0, talent: 20 }))
  ok('只对正权重未知判断待评', !mixed.assessable && dim(mixed, 'talent').state === 'unknown' && dim(mixed, 'panel').state === 'unscored')
}
{
  const b = build(); b.weapon.name = '可选剑'
  const optional = run(target(), b)
  ok('可选武器 .75 但达标，不给换武器建议', dim(optional, 'weapon').ratio === .75 && row(optional, 'weapon:choice').state === 'met' && !optional.suggestionRows.some(s => s.id === 'weapon'))
  b.weapon.name = '陌生剑'
  const other = run(target(), b)
  ok('不推荐武器为 below 非 unknown，计分证据建议一致', dim(other, 'weapon').state === 'below' && row(other, 'weapon:choice').state === 'below' && other.suggestionRows.some(s => s.id === 'weapon'))
}
{
  const input = { charName: '测试角色', ruleTitle: '西风纯辅', charWeight: { atk: 100, cpct: 100, cdmg: 100 }, role: 'dps' }
  ok('西风纯辅名称优先于暴击属性比例', G.resolveGradeRule(input).name === 'support' && G.resolveGradeRule(input).source === 'miao-title')
  ok('输出标题优先于辅助属性比例', G.resolveGradeRule({ ruleTitle: '站场输出', charWeight: { hp: 100 } }).name === 'dps')
  ok('override 高于标题及 global', G.resolveGradeRule({ ...input, globalRule: 'dps', overrides: { 测试角色: 'subdps' } }).name === 'subdps')
  ok('global 高于标题', G.resolveGradeRule({ ...input, globalRule: 'dps' }).source === 'global')
  ok('未知标题仍回退属性比例兼容', G.resolveGradeRule({ ...input, ruleTitle: '自定义规则' }).source === 'miao')
}
{
  const b = build(); b.attrs = {}; b.artiMark = null; b.artis = []; b.talent = { E: 5 }
  const r = run(target(), b, preset('dps', { artifact: 0, panel: 0, weapon: 0, talent: 100 }))
  ok('正权重天赋独评，关闭维度缺数据不影响可评', r.assessable && r.total === 50 && dim(r, 'talent').weight === 1)
  ok('关闭维度证据及建议不得成为缺口', r.rows.filter(r => !r.id.startsWith('talent:')).every(r => !r.scored) && r.suggestionRows.every(s => s.evidenceIds.every(id => id.startsWith('talent:'))))
  const t = target(); t.mainStats[0].optionViews[0].consMin = 6; t.mainStats[0].optionViews[0].mark = '（满命）'
  const c = build(); c.artis = c.artis.filter(a => a.slot !== '时之沙')
  const conditional = run(t, c)
  ok('不适用主词条无数据不影响可评，仅保留参考', conditional.assessable && row(conditional, 'artifact:main:时之沙').state === 'unscored')
  const custom = run(target(), build(), preset('dps', { artifact: 10, panel: 20, weapon: 30, talent: 40 }))
  ok('每预设自定义权重原样归一', custom.dims.map(d => d.weight).join(',') === '.1,.2,.3,.4'.split(',').map(Number).join(','))
  const customSupport = run(target(), build(), preset('support', { artifact: 10, panel: 40, weapon: 25, talent: 25 }))
  ok('辅助可显式启用圣遗物维度，权重不被模板角色吞掉', customSupport.dims.length === 4 && dim(customSupport, 'artifact').weight === .1 && customSupport.rows.some(r => r.id === 'artifact:mark' && r.scored))
}
process.exit(report() ? 1 : 0)
