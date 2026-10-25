/**
 * 练度评分 · 每个角色一套规则（2026-10-25）
 *
 * 覆盖：
 *   1. `data/gi/_grade-rules.json` 的形状与覆盖（每个有内容的角色都有条目）
 *   2. 规则归一与选取优先级（逐角色覆盖 → 全局强制 → 数据表 → 定位兜底）
 *   3. 四个分量的独立计分（词条 / 套装 / 主词条 / 面板）
 *   4. 规则对「面板行是否计分」「建议文案」的影响
 *
 * 攻略目标用真实 `data/gi/<角色>.json`；玩家配装是合成快照（离线可重复）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('练度评分 · 每角色一套规则')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const G = await load('modules/grade.js')
const SV = await load('modules/subViews.js')
const { CodexStore } = await load('model/CodexStore.js')

const store = new CodexStore()
const tableFile = path.join(pluginRoot, 'data', 'gi', '_grade-rules.json')

// ---------- 1. 规则表 ----------
ok('规则表存在（data/gi/_grade-rules.json）', fs.existsSync(tableFile))
const raw = JSON.parse(readText(tableFile))
const chars = (raw && typeof raw.characters === 'object' && raw.characters) || {}
const filled = store.listCharacters()
const missing = filled.filter(name => chars[name] === undefined)
push('每个有攻略内容的角色都有规则条目', missing, [])
ok('规则表的角色名都在数据里', Object.keys(chars).every(name => store.listAll().includes(name)))
ok('每个条目都能归一成规则（无非法写法）',
  Object.values(chars).every(value => G.normalizeGradeRule(value) !== null),
  Object.entries(chars).filter(([, v]) => G.normalizeGradeRule(v) === null).map(([k]) => k).join('、'))

const counts = { dps: 0, subdps: 0, support: 0, inline: 0 }
for (const value of Object.values(chars)) {
  if (typeof value === 'string') counts[value] = (counts[value] || 0) + 1
  else counts.inline++
}
push('初始分配 54 / 13 / 64', [counts.dps, counts.subdps, counts.support], [54, 13, 64])
ok('规则表统计可读（configured = 有内容角色数）',
  store.gradeRuleStats().configured === filled.length && store.gradeRuleStats().warnings === 0,
  JSON.stringify(store.gradeRuleStats()))

// ---------- 2. 归一与选取 ----------
ok('预设名可归一（support：套装 40 / 主词条 30 / 面板 30）', (() => {
  const r = G.normalizeGradeRule('support')
  return r && r.weights.set === 40 && r.weights.main === 30 && r.weights.panel === 30 && r.requireMark === false
})())
ok('内联对象可归一（可只写要覆盖的字段）', (() => {
  const r = G.normalizeGradeRule({ weights: { set: 50, panel: 50 }, floors: { panel: 0.8 } })
  return r && r.weights.set === 50 && r.floors.panel === 0.8 && r.minParts === 2
})())
ok('非法规则返回 null（未知预设 / 空权重）',
  G.normalizeGradeRule('nope') === null && G.normalizeGradeRule({ weights: {} }) === null)

ok('逐角色覆盖优先于全局与数据表', (() => {
  const r = G.resolveGradeRule({ charName: '胡桃', role: 'dps', table: chars, globalRule: 'support', overrides: { 胡桃: 'subdps' } })
  return r.source === 'override' && r.name === 'subdps' && r.rule.weights.mark === 45
})())
ok('全局强制优先于数据表（回退用）', (() => {
  const r = G.resolveGradeRule({ charName: '钟离', role: 'support', table: chars, globalRule: 'dps' })
  return r.source === 'global' && r.name === 'dps'
})())
ok('数据表优先于定位兜底', (() => {
  const r = G.resolveGradeRule({ charName: '行秋', role: 'support', table: chars })
  return r.source === 'data' && r.name === 'subdps'
})())
ok('表里没有该角色 → 定位兜底（不报错）', (() => {
  const r = G.resolveGradeRule({ charName: '不存在的人', role: 'support', table: chars })
  return r.source === 'auto' && r.name === 'auto' && r.rule.weights.set === 40
})())
ok('行秋在表里是 subdps（副C 不靠定位推断）', chars['行秋'] === 'subdps')

// ---------- 3. 真实攻略目标 + 合成配装 ----------
const targetsOf = (name) => {
  const guide = store.getGuide(name)
  const view = SV.buildCodexView(guide, { signature: store.getSignature(name), weaponTags: store.getWeaponTags() })
  return G.extractTargets(view, name, guide)
}

/** 按攻略「推荐」的第一条 spec 造五件圣遗物（4 件套 = 同套；2+2 = 2+3 件） */
const artisFor = (targets) => {
  const spec = G.parseSetSpecs(targets.artifact.recommend)[0]
  const pair = spec && spec.kind === 'pair'
  const setA = spec ? spec.sets[0] : '战狂'
  const setB = spec ? spec.sets[1] : '战狂'
  const slots = ['生之花', '死之羽', '时之沙', '空之杯', '理之冠']
  return slots.map((slot, i) => {
    const target = (targets.mainStats || []).find(m => m.slot === slot)
    const mainName = target ? (target.optionViews[0]?.name || target.options[0]) : (slot === '生之花' ? '生命值' : '攻击力')
    const set = pair ? (i < 2 ? setA : setB) : setA
    return { slot, set, mainName, level: 20 }
  })
}

const zhongli = targetsOf('钟离')
const zhongliRule = G.normalizeGradeRule('support')
const zhongliBuild = {
  charName: '钟离',
  level: 90,
  cons: 0,
  weapon: { name: '黑缨枪', affix: 1 },
  talent: { A: 1, E: 9, Q: 9 },
  artis: artisFor(zhongli),
  // ⚠ 故意不给 miao 评分：辅助口径不看词条，仍应可评（这是本次改动的核心诉求之一）
  artiMark: null,
  attrs: { hp: 60000, recharge: 200 }
}
ok('钟离走 support 规则（数据表）', G.resolveGradeRule({ charName: '钟离', role: zhongli.gradeRole, table: chars }).name === 'support')

const zr = G.gradeBuild(zhongli, zhongliBuild, { rule: zhongliRule, ruleName: 'support', ruleSource: 'data' })
const zcomp = zr.dims.find(d => d.key === 'comprehensive')
ok('辅助缺 miao 评分仍可评（综合不是 null）', zcomp.ratio !== null, JSON.stringify(zcomp))
ok('辅助按三件事达标（套装 + 主词条 + 面板）', zcomp.state === 'met', `${zcomp.state}/${zcomp.detail}`)
ok('综合 detail 逐个分量写（套装 / 主词条 / 面板）',
  /套装：/.test(zcomp.detail) && /主词条：/.test(zcomp.detail) && /面板：/.test(zcomp.detail), zcomp.detail)
ok('结果带规则名与来源', zr.ruleName === 'support' && zr.ruleSource === 'data')
ok('规则要求词条时缺评分才提示；辅助不出该提示',
  !zr.notes.some(n => n.includes('规则要求词条')), JSON.stringify(zr.notes))

// 面板行：support 规则下计分（这里生命值 60000 ≥ 55000 → ok）
const zPanelRows = zr.rows.filter(r => String(r.id || '').startsWith('panel:'))
ok('辅助的面板行计分（不再全是 info）', zPanelRows.length > 0 && zPanelRows.every(r => r.verdict === 'ok'), JSON.stringify(zPanelRows.map(r => r.verdict)))

// 主词条错一件 → 未达标，且建议指向主词条、不出现「提升有效词条」
{
  const wrong = zhongliBuild.artis.map((a, i) => (i === 2 ? { ...a, mainName: '' } : a))
  const r = G.gradeBuild(zhongli, { ...zhongliBuild, artis: wrong }, { rule: zhongliRule, ruleName: 'support' })
  const comp = r.dims.find(d => d.key === 'comprehensive')
  ok('主词条错一件 → 综合未达标', comp.state === 'below', `${comp.state}/${comp.detail}`)
  ok('未达标证据含主词条行', r.rows.some(x => String(x.id || '').startsWith('artifact:main:') && x.verdict === 'warn'))
  ok('辅助建议不提「提升有效词条」', !r.suggestions.some(s => s.includes('提升有效词条')), JSON.stringify(r.suggestions))
  ok('辅助建议指向主词条', r.suggestions.some(s => s.includes('主词条')), JSON.stringify(r.suggestions))
}

// ---------- 4. dps 规则：词条与套装各自独立判 ----------
const hutao = targetsOf('胡桃')
const dpsRule = G.normalizeGradeRule('dps')
const hutaoBuild = {
  charName: '胡桃',
  level: 90,
  cons: 1,
  weapon: { name: hutao.weapon.recommend[0], affix: 1 },
  talent: { A: 10, E: 8, Q: 1 },
  artis: artisFor(hutao),
  artiMark: { total: 300, markClass: 'MAX' },
  attrs: { cpct: 80, cdmg: 200, hp: 30000, mastery: 200 }
}
{
  const r = G.gradeBuild(hutao, hutaoBuild, { rule: dpsRule, ruleName: 'dps' })
  const comp = r.dims.find(d => d.key === 'comprehensive')
  ok('dps：MAX 词条 + 推荐套装 → 达标', comp.state === 'met', `${comp.state}/${comp.ratio}`)
  ok('dps：面板行仍是参考（info）',
    r.rows.filter(x => String(x.id || '').startsWith('panel:')).every(x => x.verdict === 'info'))
}
{
  // 同词条、套装全错 → 词条满分也不该算达标（词条与套装拆开后各自过闸）
  // ⚠ 用「冒险家」而不是「战狂」：战狂在胡桃的可选套装里，穿它按 0.8 过闸属正确行为
  const badArtis = hutaoBuild.artis.map(a => ({ ...a, set: '冒险家' }))
  const r = G.gradeBuild(hutao, { ...hutaoBuild, artis: badArtis }, { rule: dpsRule, ruleName: 'dps' })
  const comp = r.dims.find(d => d.key === 'comprehensive')
  ok('dps：词条满分但套装不符 → 未达标', comp.state === 'below', `${comp.state}/${comp.ratio}`)
  ok('dps：套装是独立证据行', r.rows.some(x => x.id === 'artifact:set' && x.verdict === 'warn'))
  ok('dps：套装不符的建议是「凑套装」', r.suggestions.some(s => s.includes('凑')), JSON.stringify(r.suggestions))
}

// 词条不达标 → 建议提升词条
{
  const r = G.gradeBuild(hutao, { ...hutaoBuild, artiMark: { total: 200, markClass: 'S' } }, { rule: dpsRule })
  ok('dps：词条 S 档 → 未达标', r.dims.find(d => d.key === 'comprehensive').state === 'below')
  ok('dps：建议提升有效词条', r.suggestions.some(s => s.includes('提升有效词条')), JSON.stringify(r.suggestions))
}

// ---------- 5. subdps 规则：面板参与计分 ----------
const xingqiu = targetsOf('行秋')
const subRule = G.normalizeGradeRule('subdps')
{
  const build = {
    charName: '行秋',
    level: 90,
    cons: 0,
    weapon: { name: xingqiu.weapon.recommend[0], affix: 1 },
    talent: { A: 1, E: 1, Q: 10 },
    artis: artisFor(xingqiu),
    artiMark: { total: 220, markClass: 'SS' },
    attrs: { cpct: 70, cdmg: 140, atk: 1600 }
  }
  const r = G.gradeBuild(xingqiu, build, { rule: subRule, ruleName: 'subdps' })
  const panelRows = r.rows.filter(x => String(x.id || '').startsWith('panel:'))
  ok('副C：面板行计分（不再全是 info）', panelRows.length > 0 && panelRows.every(x => x.verdict !== 'info'), JSON.stringify(panelRows.map(x => x.verdict)))
  ok('副C：综合 detail 含词条与面板', /词条：/.test(r.dims.find(d => d.key === 'comprehensive').detail))
}

console.log('')
process.exit(report() ? 1 : 0)
