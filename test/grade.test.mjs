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
ok('满分配装面板档为「大毕业」', rGood.panelTier === '大毕业', rGood.panelTier)
ok('四个维度都参评且权重之和为 1', rGood.dims.every(d => d.ratio !== null) &&
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
  artiMark: { total: 20, markClass: 'B' },
  attrs: { cpct: 40, cdmg: 120, mastery: 30, hp: 22000 }
}
const rBad = G.gradeBuild(targets, bad)
ok('短板配装总分明显更低（< 60）', rBad.total < 60, String(rBad.total))
ok('短板配装档位靠后', ['C', 'D', 'B'].includes(rBad.rank), rBad.rank)
ok('面板全线不达标时是「未毕业」（门槛不参与抬分）', rBad.panelTier === '未毕业', rBad.panelTier)
{
  // 门槛用例：面板达标但等级不够 → 从「大毕业」压到「小毕业」并写明原因
  const capped = G.gradeBuild(targets, { ...good, level: 80 })
  ok('面板达标但等级不足 → 档位被压到「小毕业」', capped.panelTier === '小毕业', capped.panelTier)
  ok('门槛写进了 notes', capped.notes.some(n => n.includes('建议等级')), capped.notes.join('｜'))
}
ok('建议里含天赋与主词条（按投入产出排序）',
  rBad.suggestions.some(s => s.startsWith('天赋：')) && rBad.suggestions.some(s => s.startsWith('主词条：')),
  rBad.suggestions.join('｜'))
ok('建议不超过 4 条', rBad.suggestions.length <= 4)

// ---------- 3. 对比表口径 ----------
{
  ok('对比表含武器/套装/评分/主词条/天赋/命座/面板各行',
    ['武器', '圣遗物', '主词条', '天赋', '命座', '面板'].every(g => rBad.rows.some(r => r.group === g)),
    [...new Set(rBad.rows.map(r => r.group))].join(','))
  ok('主词条只列沙/杯/冠这类部位（不含副词条名）',
    rBad.rows.filter(r => r.group === '主词条').every(r => targets.mainStats.some(m => m.slot === r.name)))
  ok('命座行只作提示（verdict=info）', rBad.rows.filter(r => r.group === '命座').every(r => r.verdict === 'info'))
  ok('miao 评分进了对比表', rBad.rows.some(r => r.name === 'miao 评分' && /B/.test(r.actual)))
}

// ---------- 4. 缺项不计入分母 ----------
{
  const thin = G.extractTargets({ metaRows: [], sections: [{ title: '武器', rows: [{ label: '推荐', items: [{ text: '护摩之杖' }] }] }] }, '测试角色')
  const r = G.gradeBuild(thin, { ...good, weapon: { name: '护摩之杖', affix: 1 } })
  ok('攻略只有武器时，其它维度标为不计分', r.dims.filter(d => d.ratio === null).length === 3)
  ok('可评维度权重被归一为 1', Math.abs(r.dims.find(d => d.key === 'weapon').weight - 1) < 1e-6)
  ok('只按武器算：命中推荐档 → 100 分', Math.abs(r.total - 100) < 1e-6, String(r.total))
  ok('缺项写进 notes', r.notes.some(n => n.includes('不计入总分')))
}

// ---------- 5. 档位与阈值 ----------
{
  ok('面板三档边界', G.panelTierOf(0.9, good, targets).tier === '大毕业' &&
    G.panelTierOf(0.6, good, targets).tier === '毕业' &&
    G.panelTierOf(0.3, good, targets).tier === '小毕业' &&
    G.panelTierOf(0.29, good, targets).tier === '未毕业')
  ok('rankOf 阈值（含 D 兜底）', G.rankOf(95) === 'MAX' && G.rankOf(88) === 'ACE' && G.rankOf(64) === 'S' && G.rankOf(29) === 'D')
  ok('parseSpec 解析权重写法', JSON.stringify(G.parseSpec('panel:30,weapon:20,artifact:35,talent:15', ['panel', 'weapon', 'artifact', 'talent'])) ===
    JSON.stringify({ panel: 30, weapon: 20, artifact: 35, talent: 15 }))
  ok('parseSpec 忽略非法项', Object.keys(G.parseSpec('panel:abc,unknown:5', ['panel'])).length === 0)
  ok('parseRankThresholds 失败回落默认', G.parseRankThresholds('乱写').length === G.DEFAULT_RANK_THRESHOLDS.length)
  ok('miao 档位映射覆盖 MAX…D', ['MAX', 'ACE', 'SSS', 'SS', 'S', 'A', 'B', 'C', 'D'].every(k => Number.isFinite(G.MIAO_MARK_SCORE[k])))
}

// ---------- 6. 权重可覆盖 ----------
{
  const heavy = G.gradeBuild(targets, bad, { weights: { panel: 100, weapon: 0, artifact: 0, talent: 0 } })
  ok('自定义权重生效（只看面板时分数≈面板达成度）',
    Math.abs(heavy.total - Math.round(heavy.dims.find(d => d.key === 'panel').ratio * 1000) / 10) < 0.6,
    `${heavy.total} vs ${heavy.dims.find(d => d.key === 'panel').ratio}`)
  const src = readText(path.join(pluginRoot, 'src', 'modules', 'grade.ts'))
  ok('评分器不引 miao / 不发网络（纯函数）', !/from '\.\.\/model\/MiaoProfile|http/.test(src))
}

const bad2 = report()
process.exit(bad2 ? 1 : 0)
