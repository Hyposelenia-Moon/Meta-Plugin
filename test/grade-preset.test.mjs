/** 可选攻略预设评分（2026-11-02 毕业标准重构后的口径）：纯合成数据行为测试，不读写攻略、不联网。 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { ok, report } = createChecks('练度 · 独立预设四维评分')
const root = process.env.META_GRADE_TEST_LIB || libDir
const G = await import(pathToFileURL(path.join(root, 'modules/grade.js')).href)
const preset = (role = 'dps') => ({ id: role, name: role, role, meta: {}, v2: {} })
const panel = (attrKey, min) => ({ raw: `${attrKey}:${min}`, name: attrKey, attrKey, min, max: min, groups: ['输出向'], percent: true })
const target = (patch = {}) => ({
  charName: '测试角色', gradeRole: 'dps', levelMin: 80, levelText: '80',
  artifact: { recommend: ['推荐套'], optional: ['可选套'], special: [] },
  mainStats: [{ slot: '时之沙', options: ['攻击力'], optionViews: [{ name: '攻击力', mark: '' }] }],
  panel: [panel('cpct', 80), panel('recharge', 200)],
  weapon: { recommend: ['推荐剑'], optional: ['可选剑'], transition: ['过渡剑'], special: [] },
  talent: [{ key: 'E', target: 10, crown: true }],
  ...patch
})
const build = (patch = {}) => ({
  charName: '测试角色', level: 90, cons: 0,
  weapon: { name: '推荐剑', affix: 1, level: 90 },
  talent: { E: 10 }, talentOriginal: { E: 10 },
  artis: ['生之花', '死之羽', '时之沙', '空之杯', '理之冠'].map(slot => ({ slot, set: '推荐套', mainName: '攻击力', level: 20 })),
  artiMark: { total: 250, markClass: 'MAX' }, attrs: { cpct: 80, recharge: 200 },
  ...patch
})
const run = (t = target(), b = build(), p = preset()) => G.gradeBuild(t, b, { preset: p })
const dim = (r, key) => r.dims.find(d => d.key === key)
const near = (a, b) => Math.abs(a - b) < 1e-9

{
  const r = run()
  ok('输出预设维度 = 圣遗物/面板/武器/天赋', r.dims.map(d => d.key).join(',') === 'artifact,panel,weapon,talent')
  ok('输出权重 圣遗物45 武器25 天赋25（面板0）', near(dim(r, 'artifact').weight, 0.45) && near(dim(r, 'weapon').weight, 0.25) && near(dim(r, 'talent').weight, 0.25))
  ok('面板权重 0 → 不计分', dim(r, 'panel').ratio === null && dim(r, 'panel').state === 'unscored')
  ok('满分（套装齐 + 250 分 + 90 级推荐武器 + 天赋满）→ 100 MAX', r.total === 100 && r.rank === 'MAX')
}

{
  const r = run(target(), build({ artiMark: { total: 240, markClass: 'ACE' } }))
  ok('套装齐 + 240 分 → 圣遗物 95% 达标（240 即达标）', near(dim(r, 'artifact').ratio, 0.95) && dim(r, 'artifact').state === 'met')
  const r235 = run(target(), build({ artiMark: { total: 235, markClass: 'ACE' } }))
  ok('235 分 → 30% + 60.625% = 90.6%，未达标', near(dim(r235, 'artifact').ratio, 0.90625) && dim(r235, 'artifact').state === 'below')
  const r250 = run(target(), build({ artiMark: { total: 250, markClass: 'MAX' } }))
  ok('250 分 → 70% + 套装 30% = 100%（封顶）', near(dim(r250, 'artifact').ratio, 1))
  const r200 = run(target(), build({ artiMark: { total: 200, markClass: 'S' } }))
  ok('200 分 → 30% + 套装 30% = 60%', near(dim(r200, 'artifact').ratio, 0.6) && dim(r200, 'artifact').state === 'below')
  const r100 = run(target(), build({ artiMark: { total: 100, markClass: 'D' } }))
  ok('100 分 → 15% + 套装 30% = 45%（每分 0.15%）', near(dim(r100, 'artifact').ratio, 0.45))
  ok('词条分不足 → 建议绑定词条证据', r100.suggestionRows.some(s => s.evidenceIds.includes('artifact:mark')))
}

{
  const b = build({ artis: build().artis.map(a => ({ ...a, set: '冒险家' })) })
  const r = run(target(), b)
  ok('套装不符只有评分分（250 分 → 70%）', near(dim(r, 'artifact').ratio, 0.7) && dim(r, 'artifact').state === 'below')
  ok('套装不符有独立证据与建议', r.suggestionRows.some(s => s.evidenceIds.includes('artifact:set')))
  const special = run(target({ artifact: { recommend: ['推荐套'], optional: [], special: ['幽境套'] } }),
    build({ artis: build().artis.map(a => ({ ...a, set: '幽境套' })) }))
  ok('幽境危战专用套装 → 直接 +30%', near(dim(special, 'artifact').ratio, 1))
}

{
  ok('武器 90 级推荐 = 100%', near(dim(run(), 'weapon').ratio, 1) && dim(run(), 'weapon').state === 'met')
  ok('武器 45 级推荐 = 30%×0.5 + 70% = 85%（未达 90% 线）', near(dim(run(target(), build({ weapon: { name: '推荐剑', affix: 1, level: 45 } })), 'weapon').ratio, 0.85))
  ok('可选武器 + 90 级 = 90% 达标', (() => { const r = run(target(), build({ weapon: { name: '可选剑', affix: 1, level: 90 } })); return near(dim(r, 'weapon').ratio, 0.9) && dim(r, 'weapon').state === 'met' })())
  ok('过渡武器 + 90 级 = 80% 未达标', (() => { const r = run(target(), build({ weapon: { name: '过渡剑', affix: 1, level: 90 } })); return near(dim(r, 'weapon').ratio, 0.8) && dim(r, 'weapon').state === 'below' })())
  ok('缺「可选」档时过渡按 60% → 90% 达标', (() => {
    const t = target({ weapon: { recommend: ['推荐剑'], optional: [], transition: ['过渡剑'], special: [] } })
    const r = run(t, build({ weapon: { name: '过渡剑', affix: 1, level: 90 } }))
    return near(dim(r, 'weapon').ratio, 0.9) && dim(r, 'weapon').state === 'met'
  })())
  ok('幽境危战专用武器 = 70% + 等级 30%', (() => {
    const t = target({ weapon: { recommend: [], optional: [], transition: [], special: ['专用剑'] } })
    const r = run(t, build({ weapon: { name: '专用剑', affix: 1, level: 90 } }))
    return near(dim(r, 'weapon').ratio, 1)
  })())
  // 2026-11-02 用户反馈：武器已在推荐档内，不能再提示「换到推荐档」
  const lowLevel = run(target(), build({ weapon: { name: '推荐剑', affix: 1, level: 45 } }))
  ok('推荐武器但等级不足 → 建议提升等级', lowLevel.suggestions.some(s => s.includes('提升等级')) &&
    !lowLevel.suggestions.some(s => s.includes('换到推荐档')))
  const offList = run(target(), build({ weapon: { name: '路人剑', affix: 1, level: 90 } }))
  ok('不在任何档的武器 → 建议换到推荐档', offList.suggestions.some(s => s.includes('换到推荐档')))
}

{
  const t = target({ talent: [{ key: 'A', target: 10, crown: true }, { key: 'E', target: 10, crown: true }, { key: 'Q', target: 1, crown: false }] })
  const r = run(t, build({ talent: { A: 10, E: 8, Q: 1 }, talentOriginal: { A: 10, E: 8, Q: 1 } }))
  ok('2 皇冠各 50%，E 8/10 → 天赋 90% 未达标', near(dim(r, 'talent').ratio, 0.9) && dim(r, 'talent').state === 'below')
  // 2026-11-02 用户反馈：天赋未达标却没进提升建议（命座 +3 让对比行误判达标）
  ok('天赋未达标写进提升建议', r.suggestions.some(s => s.startsWith('天赋：')))
  ok('天赋对比行取原始等级（命座不计）', r.rows.find(x => x.id === 'talent:E').state === 'below')
  const consBoost = run(t, build({ talent: { A: 10, E: 11, Q: 1 }, talentOriginal: { A: 10, E: 8, Q: 1 } }))
  ok('命座 +3 不把 E 判成达标', consBoost.rows.find(x => x.id === 'talent:E').state === 'below' &&
    consBoost.suggestions.some(s => s.startsWith('天赋：')))
  const easy = run(target({ talent: [{ key: 'E', target: 6, crown: false }] }), build({ talent: { E: 1 }, talentOriginal: { E: 1 } }))
  ok('无皇冠、无高等级 → 直接 100%（不看实际等级）', near(dim(easy, 'talent').ratio, 1) && dim(easy, 'talent').state === 'met')
  const high = run(target({ talent: [{ key: 'E', target: 9, crown: false }] }), build({ talent: { E: 9 }, talentOriginal: { E: 9 } }))
  ok('无皇冠有高等级（9 级）→ 高等级当皇冠，100%', near(dim(high, 'talent').ratio, 1))
}

{
  const t = target({ levelMin: 90 })
  ok('角色等级达标 → 100%（权重 5% 计入总分）', run(t).total === 100)
  const low = run(t, build({ level: 70 }))
  ok('角色等级不达标 → 0%，总分少 5 分', near(low.total, 95))
  ok('等级不足写进建议', low.suggestionRows.some(s => s.text.includes('角色等级')))
  ok('攻略没写建议等级 → 等级维不参与，其余权重重归一', (() => { const r = run(target({ levelMin: null })); return near(dim(r, 'artifact').weight, 45 / 95) })())
}

{
  const wrongMain = run(target(), build({ artis: build().artis.map(a => a.slot === '时之沙' ? { ...a, mainName: '防御力' } : a) }))
  ok('主词条不计分：换错主词条不影响总分', wrongMain.total === 100)
  ok('但主词条仍出现在对比表', wrongMain.rows.some(r => r.id?.startsWith('artifact:main:')))
}

{
  const sp = run(target(), build(), preset('support'))
  ok('辅助预设维度不含圣遗物，面板权重 45%', sp.dims.map(d => d.key).join(',') === 'panel,weapon,talent' && near(dim(sp, 'panel').weight, 0.45))
  ok('辅助满分 → 100 MAX', sp.total === 100 && sp.rank === 'MAX')
}

{
  ok('档位阈值写死：100 MAX / 90 ACE / 80 SSS / 60 S / 20 D',
    G.rankOf(100) === 'MAX' && G.rankOf(90) === 'ACE' && G.rankOf(80) === 'SSS' && G.rankOf(60) === 'S' && G.rankOf(20) === 'D')
  ok('不传 preset 仍是旧三维路径', G.gradeBuild(target(), build()).dims.map(d => d.key).join(',') === 'comprehensive,weapon,talent')
  ok('对比表不再有命座行', !run().rows.some(r => r.id === 'cons:key' || r.group === '命座'))
}

report()
