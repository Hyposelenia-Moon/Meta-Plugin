/**
 * 练度评分器套件（v3 P2）
 *
 * 两头都用真东西：
 *   - **攻略目标**：用真实 `data/gi/胡桃.json` 走 `buildCodexView` → `extractTargets`（不造假数据）
 *   - **玩家配装**：合成 `BuildSnapshot`（离线可重复；真实面板由 `model/MiaoProfile.ts` 在 bot 里提供）
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('练度评分（v3 P2）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const G = await load('modules/grade.js')
const SV = await load('modules/subViews.js')
const { CodexStore } = await load('model/CodexStore.js')

// ---------- 1. 攻略目标抽取（真实数据） ----------
const store = new CodexStore()
const guide = store.getGuide('胡桃')
ok('拿到真实攻略（胡桃）', !!guide)
const view = SV.buildCodexView(guide, { signature: store.getSignature('胡桃'), weaponTags: store.getWeaponTags() })
const targets = G.extractTargets(view, '胡桃')

ok('抽到面板目标（暴击率/暴击伤害/元素精通/生命值）', targets.panel.length >= 3 &&
  ['暴击率', '暴击伤害'].every(n => targets.panel.some(t => t.name === n)))
ok('面板目标解析出区间（暴击率 70-80）', (() => {
  const cpct = targets.panel.find(t => t.name === '暴击率')
  return cpct && cpct.attrKey === 'cpct' && cpct.min === 70 && cpct.max === 80
})())
ok('单值型目标（元素精通 150）min=max', (() => {
  const m = targets.panel.find(t => t.name === '元素精通')
  return m && m.min === 150 && m.max === 150 && m.attrKey === 'mastery'
})())
ok('抽到武器分档（推荐/可选/过渡至少两档）', targets.weapon.recommend.length > 0)
ok('抽到圣遗物推荐套装', targets.artifact.recommend.length > 0)
ok('抽到主词条部位与可接受集', targets.mainStats.length > 0 && targets.mainStats.every(m => m.slot && m.options.length > 0))
ok('抽到天赋目标（含皇冠标记）', targets.talent.length === 3 && targets.talent.some(t => t.crown))
ok('抽到建议等级（门槛）', Number.isFinite(targets.levelMin) && targets.levelMin >= 80)
ok('抽到关键命座（只提示）', targets.consKeys.length >= 1)
ok('parseTargetRange 容错（全角/波浪号/无数字）',
  G.parseTargetRange('70~80%')?.max === 80 && G.parseTargetRange('81-90级')?.min === 81 && G.parseTargetRange('没有数字') === null)

// ---------- 2. 合成配装：满分与短板 ----------
const goodArtis = [
  { slot: '生之花', set: targets.artifact.recommend[0], mainName: '生命值', level: 20 },
  { slot: '死之羽', set: targets.artifact.recommend[0], mainName: '攻击力', level: 20 },
  { slot: '时之沙', set: targets.artifact.recommend[0], mainName: '生命值', level: 20 },
  { slot: '空之杯', set: targets.artifact.recommend[0], mainName: '火元素伤害加成', level: 20 },
  { slot: '理之冠', set: targets.artifact.recommend[0], mainName: '暴击率', level: 20 }
]
const good = {
  charName: '胡桃',
  level: 90,
  cons: 1,
  weapon: { name: targets.weapon.recommend[0], affix: 1 },
  talent: { A: 10, E: 8, Q: 1 },
  artis: goodArtis,
  artiMark: { total: 58, markClass: 'ACE' },
  // 面板要给到目标区间上沿，才是"平均达成 100% → 大毕业"
  attrs: { cpct: 80, cdmg: 220, mastery: 160, hp: 33000, atk: 1200, recharge: 120 }
}
// 天赋按攻略目标给满，其余保持"达标"
good.talent = { A: targets.talent.find(t => t.key === 'A').target, E: targets.talent.find(t => t.key === 'E').target, Q: targets.talent.find(t => t.key === 'Q').target }

const rGood = G.gradeBuild(targets, good)
ok('满分配装总分很高（≥90）', rGood.total >= 90, String(rGood.total))
ok('满分配装档位在 ACE 及以上', ['MAX', 'ACE'].includes(rGood.rank), rGood.rank)
ok('满分配装毕业档为「大毕业」（2026-10-15 起按综合/词条分判定）', rGood.panelTier === '大毕业', rGood.panelTier)
ok('三个维度都参评且权重之和为 1（面板已并入综合、不再单列）',
  rGood.dims.length === 3 && rGood.dims.every(d => d.ratio !== null) &&
  !rGood.dims.some(d => d.key === 'panel' || d.key === 'artifact') &&
  Math.abs(rGood.dims.reduce((s, d) => s + d.weight, 0) - 1) < 1e-6)
ok('满分时给一条正向建议（不再留空）', rGood.suggestions.length === 1 && /均已达标/.test(rGood.suggestions[0]), rGood.suggestions.join('｜'))

const bad = {
  charName: '胡桃',
  level: 80,
  cons: 0,
  weapon: { name: '铁尖枪', affix: 1 },
  talent: { A: 6, E: 6, Q: 1 },
  artis: [
    { slot: '生之花', set: '战狂', mainName: '生命值', level: 16 },
    { slot: '死之羽', set: '战狂', mainName: '攻击力', level: 16 },
    { slot: '时之沙', set: '战狂', mainName: '攻击力', level: 16 },
    { slot: '空之杯', set: '战狂', mainName: '攻击力', level: 16 },
    { slot: '理之冠', set: '战狂', mainName: '攻击力', level: 16 }
  ],
  artiMark: { total: 8, markClass: 'D' },
  attrs: { cpct: 40, cdmg: 120, mastery: 30, hp: 22000 }
}
const rBad = G.gradeBuild(targets, bad)
ok('短板配装总分明显更低（< 60）', rBad.total < 60, String(rBad.total))
ok('短板配装档位靠后', ['C', 'D', 'B'].includes(rBad.rank), rBad.rank)
ok('词条极差（miao D 档 + 套装不符）时为「未毕业」', rBad.panelTier === '未毕业', rBad.panelTier)
{
  // 门槛用例：综合（词条）达标但等级不够 → 从「大毕业」压到「小毕业」并写明原因
  const capped = G.gradeBuild(targets, { ...good, level: 80 })
  ok('综合达标但等级不足 → 档位被压到「小毕业」', capped.panelTier === '小毕业', capped.panelTier)
  ok('门槛写进了 notes', capped.notes.some(n => n.includes('建议等级')), capped.notes.join('｜'))
}
ok('建议里含天赋与主词条（按投入产出排序）',
  rBad.suggestions.some(s => s.startsWith('天赋：')) && rBad.suggestions.some(s => s.startsWith('主词条：')),
  rBad.suggestions.join('｜'))
ok('建议不超过 4 条', rBad.suggestions.length <= 4)

// ---------- 3. 对比表口径（2026-10-15：面板与圣遗物合并为「综合」，面板行降级为参考） ----------
{
  ok('对比表含武器/综合/主词条/天赋/命座/参考各行',
    ['武器', '综合', '主词条', '天赋', '命座', '参考'].every(g => rBad.rows.some(r => r.group === g)),
    [...new Set(rBad.rows.map(r => r.group))].join(','))
  ok('主词条只列沙/杯/冠这类部位（不含副词条名）',
    rBad.rows.filter(r => r.group === '主词条').every(r => targets.mainStats.some(m => m.slot === r.name)))
  ok('命座行只作提示（verdict=info）', rBad.rows.filter(r => r.group === '命座').every(r => r.verdict === 'info'))
  ok('面板行只作参考（verdict=info，不判未达标）',
    rBad.rows.filter(r => r.group === '参考').every(r => r.verdict === 'info'))
  ok('词条评分走 miao 规则并进了对比表',
    rBad.rows.some(r => r.name === '词条评分' && /D/.test(r.actual) && r.verdict === 'warn'))
}

// ---------- 4. 缺项不计入分母 ----------
{
  const thin = G.extractTargets({ metaRows: [], sections: [{ title: '武器', rows: [{ label: '推荐', items: [{ text: '护摩之杖' }] }] }] }, '测试角色')
  // 没有圣遗物数据时「综合」也无从评分 → 只剩武器一个可评维度
  const r = G.gradeBuild(thin, { ...good, weapon: { name: '护摩之杖', affix: 1 }, artis: [], artiMark: null })
  ok('攻略只有武器（且无圣遗物数据）时，其它维度标为不计分', r.dims.filter(d => d.ratio === null).length === 2)
  ok('可评维度权重被归一为 1', Math.abs(r.dims.find(d => d.key === 'weapon').weight - 1) < 1e-6)
  ok('只按武器算：命中推荐档 → 100 分', Math.abs(r.total - 100) < 1e-6, String(r.total))
  ok('缺项写进 notes', r.notes.some(n => n.includes('不计入总分')))
}

// ---------- 4b. 玩家没穿/没读到圣遗物 → 数据缺失，不给 100 分（2026-10-17 复审 #1） ----------
{
  const r = G.gradeBuild(targets, { ...good, artis: [], artiMark: null })
  const comp = r.dims.find(d => d.key === 'comprehensive')
  ok('没圣遗物时「综合」是数据缺失（unknown），不是「攻略缺项」', comp.state === 'unknown' && comp.reason === 'data-missing')
  ok('数据缺失时总分标为待评（assessable=false）', r.assessable === false)
  ok('不再给出「各维度均已达标」', !r.suggestions.some(s => s.includes('均已达标')), JSON.stringify(r.suggestions))
  ok('改为提示补数据', r.suggestions.some(s => s.includes('数据不全')), JSON.stringify(r.suggestions))

  // 2026-10-18 核对：#1 残留分支 —— 穿着推荐套装但缺 miao 评分，不得再算成 100 分/MAX
  {
    const r3 = G.gradeBuild(targets, { ...good, artiMark: null })
    const comp3 = r3.dims.find(d => d.key === 'comprehensive')
    ok('有推荐套装但缺词条评分 → 综合不计分（ratio=null）', comp3.ratio === null, JSON.stringify(comp3))
    ok('缺评分时标为数据缺失而非达标', comp3.state === 'unknown' && comp3.reason === 'data-missing')
    ok('缺评分时总分待评（assessable=false）', r3.assessable === false)
    // 内部 total 仍按可评维度归一（旧口径不变），但页面/文本按 assessable=false 显示「无法评估」
    ok('缺评分时不说「各维度均已达标」', !r3.suggestions.some(s => s.includes('均已达标')), JSON.stringify(r3.suggestions))
  }

  // 对照：有圣遗物 + 有评分时，normal 路径仍是 met/below
  const r2 = G.gradeBuild(targets, good)
  ok('有数据时「综合」回到 met/below', ['met', 'below'].includes(String(r2.dims.find(d => d.key === 'comprehensive').state)))
}

// ---------- 4g. 效果型套装（2精通+2精通 / 2生命+2生命，2026-10-18 复审 R1 后半） ----------
{
  const miteGuide = JSON.parse(readText(path.join(pluginRoot, "data", "gi", "米提亚.json")))
  const miteView = SV.buildCodexView(miteGuide, {})
  const miteTargets = G.extractTargets(miteView, "米提亚", miteGuide)
  ok("米提亚推荐里含效果型条目 2精通+2精通", miteTargets.artifact.recommend.some(s => s.includes("2精通")), JSON.stringify(miteTargets.artifact.recommend))

  // 注入效果解析（真实实现来自 model/artiEffect，会读 miao；这里用等价映射，保证套件不依赖 miao）
  const effectSets = eff => (eff === "精通" ? ["流浪大地的乐团", "饰金之梦", "乐园遗落之花"] : [])
  const masteryArtis = [
    { slot: "生之花", set: "流浪大地的乐团", mainName: "生命值", level: 20 },
    { slot: "死之羽", set: "流浪大地的乐团", mainName: "攻击力", level: 20 },
    { slot: "时之沙", set: "饰金之梦", mainName: "元素精通", level: 20 },
    { slot: "空之杯", set: "饰金之梦", mainName: "元素精通", level: 20 },
    { slot: "理之冠", set: "战狂", mainName: "暴击率", level: 20 }
  ]
  const rm = G.gradeBuild(miteTargets, { ...good, artis: masteryArtis, artiMark: { total: 250, markClass: "ACE" } }, { effectSets })
  const cm = rm.dims.find(d => d.key === "comprehensive")
  ok("两套精通 2 件套 → 命中推荐组合，综合 96% 达标", cm.state === "met" && Math.abs(cm.ratio - 0.96) < 0.01, `${cm.state}/${cm.ratio}`)
  ok("详情写明推荐 2+2", /推荐 2\+2/.test(cm.detail), cm.detail)

  // 不注入解析器时保持旧行为（不得凭空命中）
  const rm2 = G.gradeBuild(miteTargets, { ...good, artis: masteryArtis, artiMark: { total: 250, markClass: "ACE" } })
  const cm2 = rm2.dims.find(d => d.key === "comprehensive")
  ok("未注入效果解析 → 效果型条目不命中（综合 90%）", Math.abs(cm2.ratio - 0.9) < 0.01, `${cm2.state}/${cm2.ratio}`)
}

// ---------- 4f. 生产链路（第三参传原始 guide）也要保留 2+2 组合（2026-10-18 复审 R1） ----------
{
  const lisaGuide = JSON.parse(readText(path.join(pluginRoot, "data", "gi", "丽莎.json")))
  const lisaView2 = SV.buildCodexView(lisaGuide, {})
  const withGuide = G.extractTargets(lisaView2, "丽莎", lisaGuide)
  ok("生产链路：丽莎推荐是一条 2+2 组合（不是两个四件套）",
    withGuide.artifact.recommend.length === 1 && /\+/.test(withGuide.artifact.recommend[0]),
    JSON.stringify(withGuide.artifact.recommend))
  const pairArtis2 = [
    { slot: "生之花", set: "如雷的盛怒", mainName: "生命值", level: 20 },
    { slot: "死之羽", set: "如雷的盛怒", mainName: "攻击力", level: 20 },
    { slot: "时之沙", set: "昔日宗室之仪", mainName: "元素充能效率", level: 20 },
    { slot: "空之杯", set: "昔日宗室之仪", mainName: "雷元素伤害加成", level: 20 },
    { slot: "理之冠", set: "战狂", mainName: "暴击率", level: 20 }
  ]
  const r6 = G.gradeBuild(withGuide, { ...good, artis: pairArtis2, artiMark: { total: 250, markClass: "ACE" } })
  const c6 = r6.dims.find(d => d.key === "comprehensive")
  ok("生产链路：按推荐 2+2 + ACE → 综合达标 96%", c6.state === "met" && Math.abs(c6.ratio - 0.96) < 0.01, `${c6.state}/${c6.ratio}`)
}

// ---------- 4e. 2+2 也是合法推荐（2026-10-18 用户定：按攻略实际写法评） ----------
{
  // 解析：`2如雷 + 2宗室` → 配对 spec；普通名字 → 4 件套 spec
  push("parseSetSpecs：2+2 配对", G.parseSetSpecs(["2如雷 + 2宗室"]).map(s => `${s.kind}:${s.sets.join("+")}`), ["pair:如雷+宗室"])
  push("parseSetSpecs：4 件套", G.parseSetSpecs(["炽烈的炎之魔女"]).map(s => `${s.kind}:${s.sets.join("+")}`), ["pc4:炽烈的炎之魔女"])

  // 攻略推荐就是 2+2（丽莎：2如雷 + 2宗室），穿对就该按推荐档给分
  const lisa = { metaRows: [], sections: [{ title: "圣遗物推荐", lines: ["推荐：2如雷 + 2宗室", "可选：教官"] }] }
  // 用真实攻略数据（丽莎的推荐本身就是 2如雷 + 2宗室）——extractTargets 吃的是 buildCodexView 的产物
  const lisaView = SV.buildCodexView(JSON.parse(readText(path.join(pluginRoot, "data", "gi", "丽莎.json"))), {})
  const lisaTargets = G.extractTargets(lisaView, "丽莎")
  ok("丽莎的推荐被解析成 2+2 条目", lisaTargets.artifact.recommend.some(s => /2/.test(s) && /\+/.test(s)), JSON.stringify(lisaTargets.artifact.recommend))
  const pairArtis = [
    { slot: "生之花", set: "如雷的盛怒", mainName: "生命值", level: 20 },
    { slot: "死之羽", set: "如雷的盛怒", mainName: "攻击力", level: 20 },
    { slot: "时之沙", set: "昔日宗室之仪", mainName: "元素充能效率", level: 20 },
    { slot: "空之杯", set: "昔日宗室之仪", mainName: "雷元素伤害加成", level: 20 },
    { slot: "理之冠", set: "战狂", mainName: "暴击率", level: 20 }
  ]
  const r2 = G.gradeBuild(lisaTargets, { ...good, artis: pairArtis, artiMark: { total: 250, markClass: "ACE" } })
  const c2 = r2.dims.find(d => d.key === "comprehensive")
  ok("推荐 2+2 穿对 + ACE → 综合判达标（套装按推荐档 1.0）", c2.state === "met" && c2.ratio >= 0.95, `${c2.state}/${c2.ratio}`)
  ok("详情写明是推荐 2+2", /推荐 2\+2/.test(c2.detail), c2.detail)

  // 非推荐的 2+2 仍按 0.7 算（不能被上面放宽）
  const offArtis = pairArtis.map(a => ({ ...a, set: a.set === "如雷的盛怒" ? "追忆之注连" : "沙上楼阁史话" }))
  const r3 = G.gradeBuild(lisaTargets, { ...good, artis: offArtis, artiMark: { total: 250, markClass: "ACE" } })
  const c3 = r3.dims.find(d => d.key === "comprehensive")
  ok("非推荐 2+2 仍按兜底档（0.90）", Math.abs(c3.ratio - 0.9) < 0.02, `${c3.state}/${c3.ratio}`)
}

// ---------- 4d. 达标线 = miao ACE 档（2026-10-18 用户反馈：40 多词条仍被要求继续提升） ----------
{
  const ace = G.gradeBuild(targets, { ...good, artis: goodArtis, artiMark: { total: 246.4, markClass: 'ACE' } })
  const comp = ace.dims.find(d => d.key === 'comprehensive')
  ok('ACE 词条 + 推荐套装 → 综合判达标（0.96 ≥ 0.95）', comp.state === 'met' && comp.ratio >= 0.95, `${comp.state}/${comp.ratio}`)
  ok('ACE 达标时不再给「继续提升词条」类建议', !ace.suggestions.some(s => s.includes('提升有效词条')), JSON.stringify(ace.suggestions))

  const sOnly = G.gradeBuild(targets, { ...good, artis: goodArtis, artiMark: { total: 200, markClass: 'S' } })
  const comp2 = sOnly.dims.find(d => d.key === 'comprehensive')
  ok('S 档（0.7+0.2×套装）仍判未达标', comp2.state === 'below', `${comp2.state}/${comp2.ratio}`)
}

// ---------- 4c. 同名不同方向（2026-10-18 核对 #10 残留） ----------
{
  const v = G.extractTargets({
    metaRows: [],
    sections: [{ title: '面板', kind: 'stats', rows: [
      { label: '辅助', items: [{ text: '暴击率：70%' }, { text: '元素充能效率：240%' }] },
      { label: '输出', items: [{ text: '暴击率：90%' }, { text: '暴击伤害：220%' }] }
    ] }]
  }, '测试角色')
  const rows = G.buildCompareRows(v, { ...good, attrs: { cpct: 70, recharge: 240, cdmg: 180 } })
    .filter(r => r.verdict === 'info')
  const cpct = rows.filter(r => r.name === '暴击率')
  ok('同名属性按方向各成一行（不被合并）', cpct.length === 2, JSON.stringify(rows.map(r => `${r.group}:${r.name}`)))
  ok('参考项带上方向（辅助 / 输出）', cpct.map(r => r.group).sort().join(',') === '辅助,输出', JSON.stringify(cpct.map(r => r.group)))
  ok('参考项都是 info（不进未达标）', rows.every(r => r.verdict === 'info'))
}

// ---------- 5. 档位与阈值 ----------
{
  ok('毕业档三档边界（按综合分）', G.panelTierOf(0.9, good, targets).tier === '大毕业' &&
    G.panelTierOf(0.6, good, targets).tier === '毕业' &&
    G.panelTierOf(0.3, good, targets).tier === '小毕业' &&
    G.panelTierOf(0.29, good, targets).tier === '未毕业')
  ok('rankOf 阈值（含 D 兜底）', G.rankOf(95) === 'MAX' && G.rankOf(88) === 'ACE' && G.rankOf(64) === 'S' && G.rankOf(29) === 'D')
  ok('parseSpec 解析权重写法', JSON.stringify(G.parseSpec('comprehensive:65,weapon:20,talent:15', ['comprehensive', 'weapon', 'talent'])) ===
    JSON.stringify({ comprehensive: 65, weapon: 20, talent: 15 }))
  ok('parseSpec 忽略非法项', Object.keys(G.parseSpec('comprehensive:abc,unknown:5', ['comprehensive'])).length === 0)
  ok('parseRankThresholds 失败回落默认', G.parseRankThresholds('乱写').length === G.DEFAULT_RANK_THRESHOLDS.length)
  ok('miao 档位映射覆盖 MAX…D', ['MAX', 'ACE', 'SSS', 'SS', 'S', 'A', 'B', 'C', 'D'].every(k => Number.isFinite(G.MIAO_MARK_SCORE[k])))
}

// ---------- 6. 权重可覆盖 ----------
{
  const heavy = G.gradeBuild(targets, bad, { weights: { comprehensive: 100, weapon: 0, talent: 0 } })
  ok('自定义权重生效（只看综合时分数≈综合分）',
    Math.abs(heavy.total - Math.round(heavy.dims.find(d => d.key === 'comprehensive').ratio * 1000) / 10) < 0.6,
    `${heavy.total} vs ${heavy.dims.find(d => d.key === 'comprehensive').ratio}`)
  const src = readText(path.join(pluginRoot, 'src', 'modules', 'grade.ts'))
  ok('评分器不引 miao / 不发网络（纯函数）', !/from '\.\.\/model\/MiaoProfile|http/.test(src))
}

const bad2 = report()
process.exit(bad2 ? 1 : 0)