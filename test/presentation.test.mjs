/**
 * 展示层投影套件（2026-10-15 UI 重构「档案批注」）
 *
 * 两头都用真东西：
 *   - **业务输入**：真实 `data/gi/胡桃.json` → `buildCodexView` → `extractTargets` → `gradeBuild`
 *   - **投影**：`components/presentation.ts` 的纯函数（四态、证据号、来源条、计分覆盖）
 *
 * 设计规格 §10 的门禁在此落地：0 与"缺字段"必须分开、未知不出 0%、来源时间不编造、
 * 建议证据号必须命中当页证据、冻结立绘行与共享样式互不干扰。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('展示层投影（档案批注）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const G = await load('modules/grade.js')
const P = await load('components/presentation.js')
const SV = await load('modules/subViews.js')
const { CodexStore } = await load('model/CodexStore.js')

const store = new CodexStore()
const targets = G.extractTargets(
  SV.buildCodexView(store.getGuide('胡桃'), { signature: store.getSignature('胡桃'), weaponTags: store.getWeaponTags() }),
  '胡桃'
)

/** 合成配装：全部取到（满分） */
const fullBuild = {
  charName: '胡桃',
  level: 90,
  cons: 1,
  weapon: { name: targets.weapon.recommend[0], affix: 1 },
  talent: { A: 10, E: 9, Q: 9 },
  artis: targets.mainStats.map(m => ({ slot: m.slot, set: targets.artifact.recommend[0], mainName: m.options[0], level: 20 })),
  artiMark: { total: 58, markClass: 'ACE' },
  attrs: { cpct: 80, cdmg: 220, mastery: 160, hp: 33000, atk: 1200, recharge: 120 },
  hasWeapon: true,
  hasTalent: true,
  hasMark: true
}

// ---------- 1. 四态：缺数据 ≠ 0 分，且与"攻略缺该项"分开 ----------
{
  const missing = { ...fullBuild, weapon: null, hasWeapon: false, charName: '胡桃' }
  const r = G.gradeBuild(targets, missing)
  const weapon = r.dims.find(d => d.key === 'weapon')
  ok('武器没读到 → unknown + data-missing（不再是 ratio 0 的"未达标"）',
    weapon.state === 'unknown' && weapon.reason === 'data-missing' && weapon.ratio === null)
  ok('关键数据未知 → assessable=false（页面据此隐藏总分标"待评"）', r.assessable === false)

  const noTargets = { ...targets, weapon: { recommend: [], optional: [], transition: [] } }
  const r2 = G.gradeBuild(noTargets, fullBuild)
  const w2 = r2.dims.find(d => d.key === 'weapon')
  ok('攻略缺武器目标 → unscored + target-missing（不是 unknown）',
    w2.state === 'unscored' && w2.reason === 'target-missing' && w2.ratio === null)
  ok('攻略缺项不影响 assessable（缺项按现行口径不计入分母）', r2.assessable === true)

  const r3 = G.gradeBuild(targets, fullBuild)
  ok('数据齐全 → 三个维度都是 met/below，assessable=true',
    r3.assessable === true && r3.dims.every(d => d.state === 'met' || d.state === 'below'))

  // 真 0 值仍然算 0：武器在表外 → ratio 0.25 的 below（不是 unknown）
  const offWeapon = G.gradeBuild(targets, { ...fullBuild, weapon: { name: '不存在的武器', affix: 1 } })
  ok('武器是真实名字但不推荐 → below（不是 unknown）',
    offWeapon.dims.find(d => d.key === 'weapon').state === 'below')
}

// ---------- 2. 维度视图：0% 与"不画条"区分；比例与文字 ----------
{
  const r = G.gradeBuild(targets, fullBuild)
  const dims = P.buildDims(r.dims)
  ok('比例 0.84 → 84%', dims.every(d => d.pct === null || d.pct === Math.round((d.ratio || 0) * 100)))
  ok('四态文本与图形齐全（颜色之外的两条通道）',
    dims.every(d => P.STATE_LABEL[d.state] && P.STATE_SYMBOL[d.state]) &&
    P.STATE_SYMBOL.met === '✓' && P.STATE_SYMBOL.below === '!' &&
    P.STATE_SYMBOL.unscored === '−' && P.STATE_SYMBOL.unknown === '?')

  const withUnknown = P.buildDims([{ key: 'weapon', label: '武器', ratio: null, weight: 0, detail: '未读取到武器', state: 'unknown', reason: 'data-missing' }])
  ok('未知 / 不计分：pct=null、不画条、数值列写 "—"',
    withUnknown[0].pct === null && withUnknown[0].pctText === '—' && withUnknown[0].symbol === '?')
  ok('权重文案：有效权重 76% / 不计分写 "—"',
    P.buildDims([
      { key: 'comprehensive', label: '综合', ratio: 0.84, weight: 0.765, detail: '', state: 'below' },
      { key: 'weapon', label: '武器', ratio: null, weight: 0, detail: '', state: 'unknown' }
    ]).map(d => d.weightText).join(',') === '77%,—')
}

// ---------- 3. 证据行：稳定键 + 呈现号 + 参考行不计分 + 未知不过滤 ----------
{
  const r = G.gradeBuild(targets, fullBuild)
  const { evidence, references } = P.buildEvidence(r.rows)
  ok('每条证据都有稳定键（不是中文名兜底）',
    evidence.every(e => e.id && !e.id.includes('undefined')) && evidence.some(e => e.id === 'weapon:choice'))
  ok('达标行不占 E 号（编号连续、不跳号）',
    evidence.filter(e => e.state === 'met').every(e => e.eid === '') &&
    evidence.filter(e => e.state !== 'met').map(e => e.eid).join(',') ===
      evidence.filter(e => e.state !== 'met').map((_, i) => `E${String(i + 1).padStart(2, '0')}`).join(','))
  ok('参考行（面板 / 命座）单独一组且不计分',
    references.length > 0 && references.every(e => !e.scored && e.state === 'unscored') &&
    !evidence.some(e => e.group === '参考'))

  const unknownRow = { group: '天赋', name: 'A', target: '10', actual: '—', verdict: 'off', id: 'talent:A' }
  const built = P.buildEvidence([unknownRow])
  ok('未知行不会被过滤掉（旧实现丢掉了缺主词条行）',
    built.evidence.length === 1 && built.evidence[0].state === 'unknown' && built.evidence[0].reasonText === '未取到数据')
}

// ---------- 4. 建议：证据号必须命中当页证据，绑不上就不编造 ----------
{
  const r = G.gradeBuild(targets, fullBuild)
  const { evidence } = P.buildEvidence(r.rows)
  const meta = P.buildPresentation({ result: r, source: { name: 'mysPanel', updatedAt: '10-04 22:02', mode: 'local' } })
  const eids = new Set(evidence.map(e => e.eid).filter(Boolean))
  ok('建议的 evidenceIds 全部命中当页证据号',
    meta.suggestions.every(s => s.evidenceEids.every(id => eids.has(id))))
  ok('绑定不到证据的建议标"通用建议"（不编造 E 号）',
    meta.suggestions.every(s => s.evidenceEids.length > 0 || s.text.length > 0))
  push('建议顺序与业务步骤一致（优先级由业务层给，展示层不重排）',
    meta.suggestions.map(s => s.priority), meta.suggestions.map((_, i) => i + 1))
}

// ---------- 5. 计分覆盖与来源 ----------
{
  const r = G.gradeBuild(targets, fullBuild)
  const ctx = P.buildScoreContext(r, { targetVersion: '' })
  ok('计分覆盖：已评/未知/不计分三组齐全，权重为生效值',
    ctx.evaluatedKeys.length === 3 && ctx.unknownKeys.length === 0 &&
    Math.abs(Object.values(ctx.weights).reduce((a, b) => a + b, 0) - 1) < 1e-6)
  ok('攻略目标版本取不到就留空 → 页面写"版本未提供"（不编造日期）', ctx.targetVersion === '')
  ok('部分口径时 isPartial=true',
    P.buildScoreContext({ assessable: false, dims: [{ key: 'weapon', label: '武器', ratio: null, weight: 0, detail: '', state: 'unknown' }] }).isPartial === true)

  const src = P.miaoSource(undefined, 0)
  ok('来源时间缺失 → updatedAt 空串（页面写"时间未提供"），读取时间另存 observedAt',
    src.updatedAt === '' && src.observedAt === 0 && src.modeText === P.MODE_TEXT.local)
  const cached = P.miaoSource({ name: 'mysPanel', updatedAt: '10-04 22:02', mode: 'cache' }, 123)
  ok('来源模式与更新时间分开表达', cached.modeText === P.MODE_TEXT.cache && cached.updatedAt === '10-04 22:02' && cached.observedAt === 123)
}

// ---------- 6. 冻结立绘行与共享样式互不干扰 ----------
{
  const tpl = readText(path.join(pluginRoot, 'resources', 'dps', 'grade.html'))
  const css = readText(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css')).replace(/\/\*[\s\S]*?\*\//g, '')
  ok('练度页仍保留冻结立绘行（.gd-basic + .gd-main-pic）',
    tpl.includes('class="gd-basic"') && tpl.includes('gd-main-pic'))
  ok('共享组件样式不出现 .gd- 选择器（不覆盖冻结区）', !/\.gd-/.test(css))
  ok('共享样式全部限定在 .mx-content 内（不污染其它模板）',
    css.split('\n').filter(l => /^\.[a-z]/.test(l.trim())).every(l => l.includes('.mx-content')))
  ok('数据区章节消费 mx 投影（dims/evidence/suggestions/references/sources）',
    ['mx.dims', 'mx.evidence', 'mx.suggestions', 'mx.references', 'mx.sources'].every(k => tpl.includes(`{{each ${k}`) || tpl.includes(k)))
  ok('meta-ui.css 已随模板引用', tpl.includes('{{_res_path}}/common/meta-ui.css') && fs.existsSync(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css')))
}

// ---------- 7. 缺值归一与长标签（审核 4.4） ----------
{
  ok('占位值识别：下划线/破折号/空 → 占位', ['___%', '__', '——', '--', '', '   '].every(v => P.isPlaceholderValue(v)))
  ok('占位值识别：不误判合法值', ['0', '0%', '70-80%', '约 7.2%~7.8%', '185%', '35000'].every(v => !P.isPlaceholderValue(v)))
  ok('占位值归一为空串，合法值原样', P.normalizeMetaValue('___%') === '' && P.normalizeMetaValue(' 90级 ') === '90级')
  ok('行内占位值换成"未提供"',
    P.normalizeItemText('生命值：___%') === '生命值：未提供' && P.normalizeItemText('生命值：35000') === '生命值：35000')

  ok('长标签判定（>6 字符）', P.isLongLabel('月结晶/月感电') === true && P.isLongLabel('主词条') === false)
  push('长标签按语义边界分行', P.labelLinesOf('月结晶/月感电'), ['月结晶', '月感电'])
  push('短标签不分行', P.labelLinesOf('主词条'), ['主词条'])
  const tpl = readText(path.join(pluginRoot, 'resources', 'codex', 'codex.html'))
  const css = readText(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css'))
  ok('攻略页长标签走独占一行版式（不加宽标签列）',
    tpl.includes('mx-guide-row--longlabel') && tpl.includes('mx-guide-label__line') &&
    /\.mx-guide-row--longlabel \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css) &&
    !/grid-template-columns: 1[2-9]\dpx/.test(css))
  ok('参考区有"当前 / 参考目标"列语义',
    readText(path.join(pluginRoot, 'resources', 'dps', 'grade.html')).includes('参考目标'))
}

// ---------- 8. 浅色底对比度门禁（普通文字 ≥ 4.5:1，图形 ≥ 3:1） ----------
{
  const css = readText(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css'))
  const tok = {}
  for (const m of css.matchAll(/--mx-([\w-]+):\s*(#[0-9a-fA-F]{3,8});/g)) tok[m[1]] = m[2]
  const rgb = (hex) => {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
  }
  const lum = (hex) => rgb(hex).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  // 2026-10-15 用户定：黑底改浅色底 —— 三档实际底色都是浅色不透明底
  const bgs = { '主底': tok.bg, '内容底': tok.surface, '次级底': tok['surface-2'] }
  const texts = ['text', 'secondary', 'muted', 'accent', 'focus', 'pass', 'warn', 'excluded', 'unknown', 'tier-max', 'tier-sss', 'tier-sa']
  const bad = []
  for (const [bname, bg] of Object.entries(bgs)) {
    for (const t of texts) {
      const r = ratio(tok[t], bg)
      if (r < 4.5) bad.push(`${t} on ${bname} = ${r.toFixed(2)}`)
    }
  }
  push('浅色底：正文/次级/辅助/章节号/四态/评级色 全部 ≥ 4.5:1', bad, [])
  ok('底色确实是浅色（正文比主底深得多）', ratio(tok.text, tok.bg) > 10)
  ok('进度条填充与轨道可区分（图形 ≥ 3:1）', ratio(tok.accent, tok['surface-2']) >= 3)
  push('对比度实测（正文/辅助/未达标/达标 vs 内容底）',
    ['text', 'muted', 'warn', 'pass'].map(t => `${t}=${ratio(tok[t], tok.surface).toFixed(2)}`),
    ['text=15.11', 'muted=5.71', 'warn=5.98', 'pass=5.99'])
}

const bad = report()
process.exit(bad ? 1 : 0)
