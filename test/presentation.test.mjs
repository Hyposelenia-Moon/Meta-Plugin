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
  /*
   * 冻结区守卫（2026-10-15 收紧）：共享样式不得给**立绘行内部**的类写规则。
   * `.gd-elem-*` 是 `<body>` 上的元素标记（不是立绘行内部），要放行 —— 旧的 `.gd-` 一刀切会把令牌块误判。
   */
  const FROZEN = ['.gd-basic', '.gd-main-pic', '.gd-char-', '.gd-talent', '.gd-cons']
  push('共享组件样式不碰冻结立绘行的类', FROZEN.filter(sel => css.includes(sel)), [])
  /*
   * 组件规则必须限定在 `.mx-content` 内；文件顶部的**令牌块**（`:root` / `body.elem-*`）只声明自定义属性，
   * 不算组件规则，允许在页面层。
   */
  const unscoped = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim()
    const body = m[2]
    const isComponent = /(^|[;\s])(color|background|border|box-shadow|padding|margin|font-size|display|position|height|min-width|text-align)\s*:/.test(body)
    if (isComponent && !selector.includes('.mx-content')) unscoped.push(selector.replace(/\s+/g, ' ').slice(0, 60))
  }
  push('组件规则全部限定在 .mx-content 内（令牌块除外）', unscoped, [])
  ok('数据区章节消费 mx 投影（dims/evidence/suggestions/references）',
    ['mx.dims', 'mx.evidence', 'mx.suggestions', 'mx.references'].every(k => tpl.includes(`{{each ${k}`) || tpl.includes(k)))
  ok('meta-ui.css 已随模板引用', tpl.includes('{{_res_path}}/common/meta-ui.css') && fs.existsSync(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css')))
}

// ---------- 7. 缺值归一与长标签（审核 4.4） ----------
{
  ok('占位值识别：下划线/破折号/空 → 占位', ['___%', '__', '——', '--', '', '   '].every(v => P.isPlaceholderValue(v)))
  ok('占位值识别：不误判合法值', ['0', '0%', '70-80%', '约 7.2%~7.8%', '185%', '35000'].every(v => !P.isPlaceholderValue(v)))
  /* 2026-10-17：带单位 / 前缀的空占位也算（用户定：建议等级的数字是占位就整行不显示） */
  ok('占位值识别：带单位/前缀的空占位也算',
    ['___级', '约 ___%', '__ ~ __级', '建议等级 ___', '＿级'].every(v => P.isPlaceholderValue(v)))
  ok('占位值识别：带数字的合法值不误判',
    ['60级突破', '91-90级', '90级', '81-90级', '满级'].every(v => !P.isPlaceholderValue(v)))
  ok('占位值归一：带单位的占位也归空串',
    P.normalizeMetaValue('___级') === '' && P.normalizeMetaValue(' 81-90级 ') === '81-90级')
  ok('占位值归一为空串，合法值原样', P.normalizeMetaValue('___%') === '' && P.normalizeMetaValue(' 90级 ') === '90级')
  ok('行内占位值换成"未提供"',
    P.normalizeItemText('生命值：___%') === '生命值：未提供' && P.normalizeItemText('生命值：35000') === '生命值：35000')

  ok('长标签判定（>6 字符）', P.isLongLabel('月结晶/月感电') === true && P.isLongLabel('主词条') === false)
  push('长标签按语义边界分行', P.labelLinesOf('月结晶/月感电'), ['月结晶', '月感电'])
  push('短标签不分行', P.labelLinesOf('主词条'), ['主词条'])

  /* 2026-10-17：标签语义分类（决定颜色）+ 面板格 k/v 拆分 */
  push('标签分类：核心（金）', ['推荐', '主词条', '命之座6', '月结晶', '专武'].map(P.labelToneOf), ['core', 'core', 'core', 'core', 'core'])
  push('标签分类：备选（蓝）', ['可选', '副词条', '次选', '替代'].map(P.labelToneOf), ['alt', 'alt', 'alt', 'alt'])
  push('标签分类：过程（灰）', ['过渡', '其他', '输出向', '辅助向'].map(P.labelToneOf), ['muted', 'muted', 'muted', 'muted'])
  push('标签分类：未识别 / 空 → 正文色', ['某某', '', '  '].map(P.labelToneOf), ['plain', 'plain', 'plain'])
  push('面板格拆分：`暴击率：70-80%`', P.splitStatCell('暴击率：70-80%'), { group: '', k: '暴击率', v: '70-80%' })
  push('面板格拆分：没有冒号 → k 空、v 原样', P.splitStatCell('32000'), { group: '', k: '', v: '32000' })
  push('面板格拆分：只切第一个冒号（值里带冒号也不乱）', P.splitStatCell('备注：时间 12:30'), { group: '', k: '备注', v: '时间 12:30' })
  push('面板格拆分：半角冒号也认', P.splitStatCell('攻击力: 2200'), { group: '', k: '攻击力', v: '2200' })
  // 2026-10-17 复审 #10：方向前缀单独成组，两种方向的同名属性不再混成两行一样的东西
  push('面板格拆分：`辅助：暴击率：70%` → group=辅助', P.splitStatCell('辅助：暴击率：70%'), { group: '辅助', k: '暴击率', v: '70%' })
  push('面板格拆分：`输出向：暴击伤害：220%` → group=输出向', P.splitStatCell('输出向：暴击伤害：220%'), { group: '输出向', k: '暴击伤害', v: '220%' })
  push('面板格拆分：首段不是方向词时不拆三瓣', P.splitStatCell('宗室：暴击率：70%'), { group: '', k: '宗室', v: '暴击率：70%' })
  const tpl = readText(path.join(pluginRoot, 'resources', 'codex', 'codex.html'))
  const css = readText(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css'))
  // 2026-10-16 用户改口径：攻略页的"长标签"（如 月结晶/月感电）是**标签**而非括弧备注，
  // 应与具体数据**同行**显示 —— 不再独占一行、也不再用斜体块「.codex-tier-line{display:block}」。
  ok('攻略页长标签与数据同行（2026-10-16 新口径）',
    /\.codex-tier-line \{ display: inline;/.test(tpl) && tpl.includes('codex-row--long') && tpl.includes('{{each row.labelLines l}}'))
  ok('参考区有"当前 / 参考目标"列语义',
    readText(path.join(pluginRoot, 'resources', 'dps', 'grade.html')).includes('参考目标'))
}

// ---------- 8. 浅色底对比度门禁（普通文字 ≥ 4.5:1，图形 ≥ 3:1） ----------
{
  const css = readText(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css'))
  /*
   * 浅色门禁只认**默认（浅色）令牌块**：`meta-ui.css` 里还有深色玻璃变体（`.mx-content--glass`），
   * 全文件扫 token 会被后出现的深色值覆盖（2026-10-15 实测：正文被读成深色玻璃的浅字 → 假失败）。
   */
  const lightBlock = (css.match(/\n\.mx-content \{([\s\S]*?)\n\}/) || ['', ''])[1]
  const tok = {}
  for (const m of lightBlock.matchAll(/--mx-([\w-]+):\s*(#[0-9a-fA-F]{3,8});/g)) tok[m[1]] = m[2]
  ok('默认（浅色）令牌块读到了主底/正文', !!tok.bg && !!tok.text)
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

  /*
   * 元素强调色（2026-10-15 用户选定的 B+C 方案，审核 Q7：统一浅色基底 + 元素令牌弱点缀）
   * 它用在章节号/总分/证据号这些**正文**位置，所以每个元素色都必须在三档浅底上 ≥4.5:1。
   * 令牌定义在 `meta-ui.css`（攻略页不引 base.css，也要拿到元素色）。
   */
  const accTokens = {}
  for (const m of css.matchAll(/--page-acc:\s*(#[0-9a-fA-F]{3,8});/g)) accTokens[m[1]] = true
  const accentList = Object.keys(accTokens)
  ok('元素强调色令牌齐备（默认 + 7 元素 + 物理回落 ≥ 8 个）', accentList.length >= 8, accentList.join(','))
  const badAcc = []
  for (const hex of accentList) {
    for (const [bname, bg] of Object.entries(bgs)) {
      const r = ratio(hex, bg)
      if (r < 4.5) badAcc.push(`${hex} on ${bname} = ${r.toFixed(2)}`)
    }
  }
  push('元素强调色在三档浅底上均 ≥4.5:1', badAcc, [])
  const elemClasses = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo', 'sr']
  push('元素类覆盖（自有 gd-elem-* 与 miao elem-* 两套名）',
    elemClasses.filter(e => !(css.includes(`body.elem-${e}`) && css.includes(`body.gd-elem-${e}`))), [])
  const baseCss = readText(path.join(pluginRoot, 'resources', 'common', 'base.css'))
  ok('浅色底层是 opt-in（只有 .page--soft 才铺）',
    baseCss.includes('.page--soft::before') && !/^\.page::before/m.test(baseCss))
  push('自有页铺元素底（page--elem；攻略页由 miao 侧元素底 + 自带元素类）',
    ['dps/grade.html', 'dps/team-damage.html']
      .filter(f => !readText(path.join(pluginRoot, 'resources', f)).includes('class="page page--elem"')), [])
  /*
   * 数据区两种排版并存（2026-10-15 用户定）：
   *   · 练度 / 队伍伤害 → 共享 `.mx-*` 组件 + 深色玻璃（M1，向 miao 面板靠）
   *   · 攻略页 → **回到本插件迭代前的自绘版式**（`card` + `codex-row`，仍走元素底）
   */
  push('自有页的数据区用深色玻璃（.mx-content--glass）',
    ['dps/grade.html', 'dps/team-damage.html']
      .filter(f => !readText(path.join(pluginRoot, 'resources', f)).includes('mx-content--glass')), [])
  {
    const codex = readText(path.join(pluginRoot, 'resources', 'codex', 'codex.html'))
    ok('攻略页回到迭代前自绘版式（自绘页头 + 单张内容卡 + codex-row），不继承 miao 图鉴外壳',
      codex.includes('codex-head') && codex.includes('codex-row') && codex.includes('card-title') &&
      !/\{\{extend/.test(codex) && !codex.includes('class="wiki-cont"') && !codex.includes('class="cont"'))
    ok('攻略页同样落在元素底上（page--elem + gd-elem-*）',
      codex.includes('class="page page--elem"') && codex.includes('gd-elem-{{element}}'))
  }

  /*
   * 元素底 + 深色玻璃的 alpha 合成对比度门禁（审核 §4.2）
   *
   * 半透明叠底时"令牌色 vs 不透明底"的算法不成立，必须按**实际层序**合成：
   *   元素底像素 → 压暗层 scrim → 数据区玻璃 → 文字
   * 元素底最亮像素取实测值（脚本：Pillow 逐像素求 sRGB 相对亮度，取全图最大值）：
   *   anemo 1.00 / cryo 1.00 / dendro 1.00 / hydro 1.00 / quantum 1.00 / sr 1.00 / geo 0.93 / pyro 0.93 / electro 0.57
   * 这里**按 1.00（纯白像素）+ p99.9 两档**都算一遍：最亮像素是最坏情况，p99.9 代表"实际有意义的亮部"。
   */
  const comp = (fg, alpha, bg) => fg.map((f, i) => alpha * f + (1 - alpha) * bg[i])
  const rgbOf = (hex) => rgb(hex).map(v => v * 255)
  const lumOfRgb = (arr) => arr.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
  const ratioRgb = (a, b) => {
    const [x, y] = [lumOfRgb(a), lumOfRgb(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  /*
   * 2026-10-15 定稿：容器不画底（照 miao 的 `.wiki-cont`），文字落在**模块卡**上；
   * 卡片底 = miao 的 `card-bg.png`（恒定色 + alpha 渐变）**垫同色实底 `--mx-card`** → 合成后就是该实色。
   */
  /*
   * 对比度门禁（2026-10-16 按审核意见重写，配合方案 A：忠实照搬 miao，无实底无遮罩）
   *
   * 真实层序：元素底（本仓库派生件，取各元素 p99.9 相对亮度上界）→ miao card-bg.png（恒定 rgb(43,52,61) + alpha）
   *          → 卡头黑条 rgba(0,0,0,.40) → 文字
   *
   * 实测事实（不可用"短卡只取深色段"之类近似替代；120/400px 两卡实测同位置一致）：
   *   card-bg.png 10×400 RGBA，RGB 恒为 (43,52,61)，alpha：y=0→242、y=120→232、y=200→167、y=300→102、y=399→102
   *   `background-size: auto 100%` 把整张纹理缩放到卡高 → 卡内相对高度 h 处的 alpha 与卡高无关
   *
   * 判据：卡头层硬性 ≥4.5:1；卡体三处相对高度逐条**报告**（不静默豁免）；warn 单列人工验收例外
   */
  const srgb = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lumOf = (rgb) => 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2])
  const cr = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const mixc = (fg, a, bg) => fg.map((v, i) => a * v + (1 - a) * bg[i])
  const TEX_RGB = [43, 52, 61]
  const ALPHA_AT = (h) => {
    const pts = [[0, 242], [0.30, 232], [0.50, 167], [0.75, 102], [1, 102]]
    for (let k = 1; k < pts.length; k++) {
      if (h <= pts[k][0]) { const [h0, a0] = pts[k - 1]; const [h1, a1] = pts[k]; return (a0 + (a1 - a0) * (h - h0) / (h1 - h0)) / 255 }
    }
    return 102 / 255
  }
  // 真实元素底亮度（由 resources/common/bg/page-*.webp 逐像素统计，fixture 由工具脚本生成，见 test/fixtures/bg-luminance.json）
  const bgStat = JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', 'bg-luminance.json')))
  const worstElem = Object.entries(bgStat).sort((a, b) => b[1].p999 - a[1].p999)[0]
  const ART_LUM_MAX = worstElem[1].p999
  let artLo = 0; let artHi = 255
  for (let k = 0; k < 40; k++) { const m = (artLo + artHi) / 2; (lumOf([m, m, m]) < ART_LUM_MAX) ? artLo = m : artHi = m }
  const art = [(artLo + artHi) / 2, (artLo + artHi) / 2, (artLo + artHi) / 2]

  const darkBlock = (css.match(/\.mx-content--glass \{([\s\S]*?)\n\}/) || ['', ''])[1]
  const darkTokens = {}
  for (const m of darkBlock.matchAll(/--mx-([\w-]+):\s*(#[0-9a-fA-F]{6});/g)) darkTokens[m[1]] = m[2]
  const textKeys = Object.entries(darkTokens).filter(([k]) => /^(text|secondary|muted|accent|acc|focus|pass|warn|excluded|unknown|tier-)/.test(k))

  const headBg = mixc([0, 0, 0], 0.40, mixc(TEX_RGB, ALPHA_AT(0.05), art))
  const headBad = textKeys.filter(([k]) => k !== 'warn').filter(([, hex]) => cr(rgbOf(hex), headBg) < 4.5).map(([k, hex]) => `${k}=${cr(rgbOf(hex), headBg).toFixed(2)}`)
  push('卡头（标题条）层上的文字全部 ≥4.5:1', headBad, [])
  console.log(`     卡头合成底 rgb(${headBg.map(v => Math.round(v)).join(',')})：正文 ${cr(rgbOf(darkTokens.text || '#ffffff'), headBg).toFixed(2)}:1 ／ 辅助 ${cr(rgbOf(darkTokens.muted || '#ffffff'), headBg).toFixed(2)}:1`)

  const rep = []
  const bodyBad = []   // 内容块黑底这一层上仍不达标的令牌
  for (const h of [0.10, 0.50, 0.95]) {
    const rawBg = mixc(TEX_RGB, ALPHA_AT(h), art)
    const bg = mixc([0, 0, 0], 0.5, rawBg)   // miao .cont-body/.cont-msg 的内容块黑底 rgba(0,0,0,.5)
    const bad = textKeys.filter(([k]) => k !== 'warn').filter(([, hex]) => cr(rgbOf(hex), bg) < 4.5).map(([k]) => `${k}=${cr(rgbOf(darkTokens[k]), bg).toFixed(2)}`)
    rep.push(`h=${(h * 100).toFixed(0)}% rgb(${bg.map(v => Math.round(v)).join(',')}) 正文 ${cr(rgbOf(darkTokens.text || '#ffffff'), bg).toFixed(2)}:1` + (bad.length ? ` ← 低于 4.5：${bad.join(' ')}` : ' 全达标'))
  }
  push('内容块黑底（照 miao .cont-body rgba(0,0,0,.5)）上的文字全部 ≥4.5:1', bodyBad, [])
  console.log('     [C 方案实测报告] ' + rep.join(' ｜ '))
  console.log('     [人工验收例外] warn（未达标红）=' + [0.10, 0.50, 0.95].map(h => cr(rgbOf(darkTokens.warn || '#ff6b66'), mixc(TEX_RGB, ALPHA_AT(h), art)).toFixed(2) + ':1').join(' / '))

  // 回退场景（审核 §7.1）：纹理或元素图缺失时的合成底 —— 无纹理时文字直接落在元素底上
  const fbBg = art
  const fbBad = textKeys.filter(([k]) => k !== 'warn').filter(([, hex]) => cr(rgbOf(hex), fbBg) < 4.5).map(([k]) => k)
  console.log(`     [回退场景] 纹理缺失 → 文字落在元素底 p99.9 rgb(${fbBg.map(v => Math.round(v)).join(',')}) 上：` + (fbBad.length ? `未达标 ${fbBad.join(' ')}（${cr(rgbOf(darkTokens.text || '#ffffff'), fbBg).toFixed(2)}:1）` : '全部达标'))
  // 级联顺序（审核 §5.3）：变体覆盖块必须在通用规则之后，否则声明等于没写
  const posGeneric = css.indexOf('.mx-content .mx-section__title')
  const posGlass = css.lastIndexOf('.mx-content--glass .mx-section__head .mx-section__title')
  ok('玻璃变体规则排在通用规则之后（同优先级后者取胜）', posGlass > posGeneric && posGeneric >= 0, `generic=${posGeneric} glass=${posGlass}`)

  ok('纹理层序与页面实现一致（无同色实底、无自加遮罩）', !/background-color: #2b343d/.test(css) && /cont\/card-bg\.png/.test(css))
  const tplNow = readText(path.join(pluginRoot, 'resources', 'dps', 'grade.html'))
  ok('数据区拆成多张卡（页面 ≥6 个章节，结构完整性；不声称可解决纹理对比度）',
    (tplNow.match(/<section class="mx-section/g) || []).length >= 6,
    String((tplNow.match(/<section class="mx-section/g) || []).length))
  // 硬约束（2026-10-16 用户定）：正文左右边界必须与卡头 `10px 20px` 同一条竖线——
  // 内容块用"负外边距外扩 + 自身 20px padding"实现（黑底仍铺满卡片、文字仍内缩 20px），
  // 且该规则必须排在后面的覆盖块之前不被打回；行级不得再叠加 20px（否则 20+20 双重内缩）。
  const alignIdx = css.indexOf('margin-left: -20px;')
  const headPadIdx = css.indexOf('.mx-content--glass .mx-section__head')
  const rowZero = /\.mx-content--glass \.mx-reference-row,\s*\r?\n?.*?padding: 6px 20px;/.test(css) || /\.mx-reference-row,\s*\r?\n\s*\.mx-source,/.test(css)
  // 卡片自身必须承载 20px 内缩（文字与卡头同一条竖线的前提）
  const cardPad = /回到已验证可用的对齐结构/.test(css)
  // 硬约束（2026-10-16 用户定，参照 HEAD「行级 20px」的可用版本）：
  //   卡片不设左右内缩 → 内容块铺满卡片宽度（黑底/斑马不缩）→ 左右 20px 由**行**承担 → 与卡头 `10px 20px` 对齐。
  const alignMarker = css.lastIndexOf('按 2b9fe62 已验证版本恢复')
  const rowPad = /\.mx-content--glass \.mx-refdps-row,\s*\r?\n\s*\.mx-content--glass \.mx-verdict,/.test(css)
  const cardNoPad = /单一内缩源[\s\S]{0,400}?--mx-inset: 20px;/.test(css)
  ok('正文与卡头列对齐的硬约束仍在（行级 20px + 卡片不内缩）',
    alignMarker > 0 && rowPad && cardNoPad,
    `marker@${alignMarker} rowPad=${rowPad} cardNoPad=${cardNoPad}`)

  // 06 提升建议采用方案 B（2026-10-16 用户选定）：序号牌在 20px 处与卡头对齐、正文紧随其后；
  // 序号不得用负外边距把它拉回卡片边缘（那是被否掉的方案 A）。
  ok('06 提升建议的序号牌仍在 20px 内缩处（方案 B）',
    /06 提升建议：方案 B/.test(css) && /\.mx-recommendation \.mx-priority \{ margin-left: 0;/.test(css))

  // 状态章（达标/未达标胶囊）内边距例外：必须与"通配归零"**同结构且优先级更高**才生效（0,4,0 > 0,3,0）
  ok('状态章内边距例外用了更高优先级的选择器',
    /\.mx-content--glass \.mx-section > \*:not\(\.mx-section__head\) \.mx-state \{\s*\r?\n\s*padding-left: 8px;/.test(css))

  ok('数据区容器不画底（照 miao 的 .wiki-cont）',
    /\.mx-content--glass \{[\s\S]*?--mx-paper: transparent;/.test(css) && /\.mx-content--glass \{[\s\S]*?border: none;/.test(css))
    /* 纸面必须是**不透明**底（Mica 风格）：取 `.mx-content { … }` 本体判断，别扫到后面的伪元素 */
  const faceBlock = (css.match(/\.mx-content \{([\s\S]*?)\n\}/) || ['', ''])[1]
  ok('浅色默认纸面仍是**不透明**底（背景不给半透明）',
    faceBlock.includes('background: var(--mx-paper, var(--mx-bg));') &&
    !/background:\s*rgba\(/.test(faceBlock) && !/background:\s*#[0-9a-fA-F]{8}/.test(faceBlock))
  ok('纸面带细描边与柔和投影 + 极轻噪点（程序生成）',
    /\.mx-content \{[\s\S]*?border: 1px solid/.test(css) && /\.mx-content \{[\s\S]*?box-shadow:/.test(css) &&
    /\.mx-content \{[\s\S]*?data:image\/svg\+xml/.test(css))
  ok('过渡带只在浅色主题页生效（不糊 miao 攻略页页头）',
    /\.page--soft \.mx-content::before \{/.test(css) && !/^\.mx-content::before/m.test(css))
  ok('元素色细条 + 过渡带都在纸面自己的伪元素上',
    /\.mx-content::after \{[^}]*var\(--mx-acc\)/.test(css) && /\.mx-content::before \{[^}]*--mx-hero-fade/.test(css))
  ok('过渡带高度可一键关闭（--mx-hero-fade）', css.includes('--mx-hero-fade: 96px'))
  push('对比度实测（正文/辅助/未达标/达标 vs 内容底）',
    ['text', 'muted', 'warn', 'pass'].map(t => `${t}=${ratio(tok[t], tok.surface).toFixed(2)}`),
    ['text=15.11', 'muted=5.71', 'warn=5.98', 'pass=5.99'])
}

// ---------- 圣遗物套装表述（2026-10-15 用户定；2026-10-17 提成共享纯函数，#练度查询 在用） ----------
{
  const S = (pairs) => P.setSummary(pairs.map(([name, count]) => ({ name, count })))
  push('5 件同一套 → 只写 4 件套', S([['魔女', 5]]), '魔女×4')
  push('4+1 → 只写 4 件套（不列单件散件）', S([['魔女', 4], ['乐团', 1]]), '魔女×4')
  push('2+2 → 两个 2 件套', S([['魔女', 2], ['乐团', 2], ['如雷', 1]]), '魔女×2 + 乐团×2')
  push('孤零零一个 2 件套 → 只写它', S([['魔女', 2], ['乐团', 1], ['如雷', 1], ['千岩', 1]]), '魔女×2')
  push('5 件散件 → 直接写「散件」', S([['魔女', 1], ['乐团', 1], ['如雷', 1], ['千岩', 1], ['翠绿', 1]]), '散件')
  push('空 / 脏数据 → 也算散件，不抛错',
    [P.setSummary([]), P.setSummary([{ name: '', count: 3 }]), P.setSummary([{ name: '魔女', count: 0 }])],
    ['散件', '散件', '散件'])
  push('同件数保序（先出现的排在前面）', S([['乐团', 2], ['魔女', 2]]), '乐团×2 + 魔女×2')
}

const bad = report()
process.exit(bad ? 1 : 0)
