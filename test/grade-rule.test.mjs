/**
 * 练度评分 · 规则直接跟随 miao 面板（2026-10-27）
 *
 * 覆盖：
 *   1. miao 规则（`charWeight`）→ 输出向占比 → 预设分档
 *   2. 规则选取优先级（逐角色覆盖 → 全局强制 → miao → 定位兜底）
 *   3. 四个分量的独立计分（词条 / 套装 / 主词条 / 面板）
 *   4. 规则对「面板行是否计分」「建议文案」的影响
 *
 * 攻略目标用真实 `data/gi/<角色>.json`；miao 规则权重用合成输入（离线可重复）。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { push, ok, report } = createChecks('练度评分 · 规则跟随 miao')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const G = await load('modules/grade.js')
const SV = await load('modules/subViews.js')
const { CodexStore } = await load('model/CodexStore.js')

const store = new CodexStore()

// ---------- 1. miao 规则 → 分档 ----------
// 与 miao `usefulAttr` 同形状：输出向 atk/cpct/cdmg/dmg/phy，功能向 hp/def/mastery/recharge/heal
const W_HUTAO = { hp: 80, atk: 50, cpct: 100, cdmg: 100, mastery: 75, dmg: 100 }
const W_ZHONGLI = { hp: 100, recharge: 55 }
const W_YELAN = { hp: 80, cpct: 100, cdmg: 100, dmg: 100, recharge: 100 }

ok('输出向占比高（胡桃 69%）→ dps', (() => {
  const d = G.deriveRuleFromCharWeight(W_HUTAO)
  return d && d.name === 'dps' && Math.abs(d.share - 0.6931) < 0.01
})())
ok('输出向占比中等（夜兰 62%）→ subdps', (() => {
  const d = G.deriveRuleFromCharWeight(W_YELAN)
  return d && d.name === 'subdps'
})())
ok('功能性权重为主（钟离 0%）→ support', (() => {
  const d = G.deriveRuleFromCharWeight(W_ZHONGLI)
  return d && d.name === 'support' && d.share === 0
})())
ok('拿不到权重 → null（调用方回落定位）',
  G.deriveRuleFromCharWeight(null) === null && G.deriveRuleFromCharWeight({}) === null)
ok('阈值常量可读（dps 0.65 / subdps 0.5）',
  G.MIAO_RULE_DPS_SHARE === 0.65 && G.MIAO_RULE_SUBDPS_SHARE === 0.5)

// ---------- 2. 归一与选取 ----------
ok('预设名可归一（support：套装 40 / 主词条 30 / 面板 30）', (() => {
  const r = G.normalizeGradeRule('support')
  return r && r.weights.set === 40 && r.weights.main === 30 && r.weights.panel === 30 && r.requireMark === false
})())
ok('只接受预设名（内联对象已随数据表移除）',
  G.normalizeGradeRule({ weights: { set: 50, panel: 50 } }) === null && G.normalizeGradeRule('nope') === null)

ok('逐角色覆盖优先于全局与 miao', (() => {
  const r = G.resolveGradeRule({ charName: '胡桃', role: 'dps', charWeight: W_ZHONGLI, globalRule: 'support', overrides: { 胡桃: 'subdps' } })
  return r.source === 'override' && r.name === 'subdps' && r.rule.weights.mark === 45
})())
ok('全局强制优先于 miao 规则（回退用）', (() => {
  const r = G.resolveGradeRule({ charName: '钟离', role: 'support', charWeight: W_ZHONGLI, globalRule: 'dps' })
  return r.source === 'global' && r.name === 'dps'
})())
ok('miao 规则优先于定位兜底', (() => {
  // 定位是 support，但 miao 规则是输出向 → 按 miao 走 dps
  const r = G.resolveGradeRule({ charName: '行秋', role: 'support', charWeight: W_HUTAO })
  return r.source === 'miao' && r.name === 'dps' && Math.abs(Number(r.share) - 0.6931) < 0.01
})())
ok('拿不到 miao 规则 → 定位兜底', (() => {
  const r = G.resolveGradeRule({ charName: '某人', role: 'support', charWeight: null })
  return r.source === 'auto' && r.name === 'auto' && r.rule.weights.set === 40
})())

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
// 钟离的 miao 规则是纯功能向（hp/recharge）→ 自动落到 support
ok('钟离：miao 规则 → support 口径',
  G.resolveGradeRule({ charName: '钟离', role: zhongli.gradeRole, charWeight: W_ZHONGLI }).name === 'support')

const zr = G.gradeBuild(zhongli, zhongliBuild, { rule: zhongliRule, ruleName: 'support', ruleSource: 'miao' })
const zcomp = zr.dims.find(d => d.key === 'comprehensive')
ok('辅助缺 miao 评分仍可评（综合不是 null）', zcomp.ratio !== null, JSON.stringify(zcomp))
ok('辅助按三件事达标（套装 + 主词条 + 面板）', zcomp.state === 'met', `${zcomp.state}/${zcomp.detail}`)
ok('综合 detail 逐个分量写（套装 / 主词条 / 面板）',
  /套装：/.test(zcomp.detail) && /主词条：/.test(zcomp.detail) && /面板：/.test(zcomp.detail), zcomp.detail)
ok('结果带规则名与来源', zr.ruleName === 'support' && zr.ruleSource === 'miao')
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
