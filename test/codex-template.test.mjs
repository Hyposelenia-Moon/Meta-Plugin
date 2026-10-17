/**
 * 攻略页模板自检（阶段 1.3c：与 miao 图鉴一致）
 *
 * 模板改为「继承 miao 布局 + 复用 miao 样式」后，这四层依然守住：
 *   1. **结构约定**：`{{extend elemLayout}}` + `{{block}}`、样式全部引 `{{_miao_path}}`（不复制 miao 的 CSS）、
 *      六模块循环、empty/teams/rows 三分支、专武两色、活动标签、精炼提示；
 *   2. **不混入 miao 的 API 数据块**：模板里不得出现 `holding`/`materials`/`usage`（提瓦特小助手数据，
 *      miao 自己都标注「未经允许请勿使用」）；
 *   3. **类名**：我们的 `.codex-*` 必须在本页 `<style>` 里定义；其余静态类必须能在 **miao 的 CSS** 里找到
 *      （miao 不在场时跳过这半，`META_MIAO_DIR` 可指定路径）；
 *   4. **页级字段契约**：模板用到的根标识符必须都在 `toPageData()` 的返回里；
 *      能解析到 art-template **且能找到 miao 布局**时，真渲染一次并断言无残留。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('攻略页模板（codex.html，miao 版式）')

const tplFile = path.join(pluginRoot, 'resources', 'codex', 'codex.html')
ok('resources/codex/codex.html 存在', fs.existsSync(tplFile))
if (!fs.existsSync(tplFile)) {
  report()
  process.exit(1)
}
const tpl = readText(tplFile)

/** miao-plugin 目录：环境变量优先，其次按插件同级目录猜（bot 部署里就是同级） */
const miaoDir = process.env.META_MIAO_DIR || path.resolve(pluginRoot, '..', 'miao-plugin')
const hasMiao = fs.existsSync(path.join(miaoDir, 'resources', 'common', 'layout', 'elem.html'))

// ---------- 1. 结构约定（2026-10-15 用户定：回到本插件迭代前的自绘版式） ----------
ok('不再继承 miao 图鉴外壳（无 {{extend elemLayout}} / {{block}}）',
  !tpl.includes('{{extend elemLayout}}') && !tpl.includes("{{block '") )
ok('用本插件自己的样式表', tpl.includes('{{_res_path}}/common/base.css') && tpl.includes('{{_res_path}}/common/components.css'))
for (const css of ['common/tpl.css', 'character/profile-detail.css']) {
  ok(`天赋图标引 miao 组件样式：${css}`, tpl.includes(`{{_miao_path}}${css}`))
}
ok('不引 miao 图鉴卡片样式（wiki/character-wiki.css）', !tpl.includes('wiki/character-wiki.css'))
/*
 * 「不复制 miao 的样式」：自有 CSS 里不得出现 miao 的类名（只引用不复制）。
 * `.talent-icon` 只在**本页 `<style>`** 里做尺寸覆盖（组件本体仍来自 miao 的 profile-detail.css）。
 */
ok('不复制 miao 的样式（自有共享 CSS 里没有 miao 类名）', (() => {
  const own = readText(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css')).replace(/\/\*[\s\S]*?\*\//g, '')
  return !/\.(basic|detail|char-|cont|wiki-|talent-icon)\b/.test(own)
})())
ok('迭代前版式的结构类齐全（页头 + 单张内容卡 + 分块）',
  ['codex-head', 'codex-portrait', 'codex-name', 'codex-meta', 'mx-section__title', 'mx-section', 'codex-row', 'codex-row-label', 'codex-row-items', 'mx-footer'].every(k => tpl.includes(k)))
ok('页头字段：立绘（图库优先，缺了退回 miao 相对路径）/ 名字 / 副标题 / 定位 / 属性行',
  tpl.includes('{{if portraitSrc}}') && tpl.includes('{{else if portrait}}') && tpl.includes('{{name}}') &&
  tpl.includes('{{subTitle}}') && tpl.includes("meta['定位']") && tpl.includes('{{each metaRows row}}'))
/* 2026-10-17 改版：立绘 = 取景窗（aspect-ratio 定高）+ 主体层 cover 铺满 + 边缘模糊描边；页头卡片整块移除 */
ok('页头卡片已移除（不再有 .header-title / 独立 header 卡）',
  !tpl.includes('header-title') && !tpl.includes('header-sub') && !tpl.includes('class="header"'))
ok('立绘卡用 `.head-card--portrait` 标记（选择器不再依赖"第二个 head-card"）',
  tpl.includes('head-card head-card--portrait') && tpl.includes('.card.head-card.head-card--portrait'))
/* 2026-10-17 第三轮：立绘 = **一张圆角图**（取景窗 aspect-ratio 定高 + 单层 img cover 铺满）
   不允许再套模糊底 / 边缘描边 —— 那两层会造成「卡片套卡片」的观感（用户反馈） */
ok('立绘是单层图（不再有 `.codex-portrait-bg` / `.codex-portrait-edge` 这两层）',
  !tpl.includes('codex-portrait-bg') && !tpl.includes('codex-portrait-edge'))
/* 2026-10-17 第四轮：**页面内自量自裁** —— 清单按文件名索引，图库不同步就会漏裁，
   所以立绘改用 `data:` URL 内嵌（canvas 不被污染），页面脚本量完立刻摆正并居中 */
ok('立绘用 data: URL（`portraitData` 优先，配不出时退回原地址）',
  tpl.includes('src="{{portraitData || portraitSrc}}"') &&
  tpl.includes('src="{{portraitData || (_miao_path + portrait)}}"'))
ok('页面内自量自裁脚本在位（取像素 + 同款 cover 数学 + 参数来自 cropCfg）',
  tpl.includes('getImageData(0, 0, w, h)') &&
  tpl.includes('Math.max(W / cw, H / ch)') &&
  tpl.includes('{{cropCfg.tol}}') &&
  tpl.includes('{{cropCfg.colorCap}}') &&
  tpl.includes('{{cropCfg.whiteLineCover}}'))
ok('自量自裁失败时有兜底（try/catch 后直接 return，保持服务端盒）',
  /catch \(e\) \{ return \}/.test(tpl))
ok('立绘结构：取景窗按默认立绘比例定高（`aspect-ratio: {{portraitRatio}}`）',
  tpl.includes('aspect-ratio: {{portraitRatio}}') && tpl.includes('class="codex-portrait"'))
/* 2026-10-17：立绘四角圆角 20px（比页面卡片的 10px 大一号），靠 overflow:hidden 裁圆
   ⚠ 用 `[^}]*` 限定在**同一条规则内**，别用 `[\s\S]*?` —— 那样会匹配到后面别的元素的 10px */
ok('立绘四角圆角 20px（`.codex-portrait` 的 border-radius + overflow:hidden）',
  /\.codex-portrait\s*\{[^}]*border-radius:\s*20px/.test(tpl) &&
  /\.codex-portrait\s*\{[^}]*overflow:\s*hidden/.test(tpl))
/* 2026-10-17：面板网格排版 + 标签语义配色 + 立绘区标题分色 + 页脚去「口径：」 */
ok('面板区改成网格（`.codex-stats` 等宽列 + `.codex-stat-k/.codex-stat-v`，按 section.kind === \'stats\' 分支）',
  tpl.includes("section.kind === 'stats'") &&
  /\.codex-stats\s*\{[^}]*display:\s*grid/.test(tpl) &&
  /\.codex-stats\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/.test(tpl) &&
  /\.codex-stat-k\s*\{[^}]*color:\s*var\(--gold\)/.test(tpl))
ok('面板字号与其它区一致（标签 22px = 行标签、数值 26px = 正文）',
  /\.codex-stat-k\s*\{[^}]*font-size:\s*22px/.test(tpl) &&
  /\.codex-stat-v\s*\{[^}]*font-size:\s*26px/.test(tpl) &&
  /\.codex-row-items\s*\{[^}]*font-size:\s*26px/.test(tpl))
/* 2026-10-17 补充：面板格不画底板（底板会显得「整块缩在卡片里」）；立绘标题不用合成粗体 */
ok('面板格不画独立底板（无 background / border-left，左边界与其它行一致）',
  /\.codex-stat\s*\{[^}]*border-bottom:[^}]*\}/.test(tpl) &&
  !/\.codex-stat\s*\{[^}]*\bbackground:/.test(tpl) &&
  !/\.codex-stat\s*\{[^}]*border-left:/.test(tpl))
/* 2026-10-17 用户定：名字 400（装饰字体本身够重，合成粗体会发糊）；副标题胶囊**要加粗**（700）并缩小到 19px */
ok('立绘标题字号/字重：名字 400、副标题胶囊 700 + 19px、定位与 meta 19px',
  /\.codex-name\s*\{[^}]*font-weight:\s*400/.test(tpl) &&
  /portrait \.codex-name \.codex-name-sub\s*\{[^}]*font-size:\s*19px[^}]*font-weight:\s*700/.test(tpl) &&
  /portrait \.codex-desc\s*\{[^}]*font-size:\s*19px/.test(tpl) &&
  /portrait \.codex-meta \.kv-value\s*\{[^}]*font-size:\s*19px/.test(tpl))
ok('副词条分隔符不松散（条目间距 6px、分隔符外边距 1px）',
  /codex-row:has\(\.label-副词条\) > \.codex-row-items\s*\{[^}]*column-gap:\s*6px/.test(tpl) &&
  /\.codex-sep\s*\{[^}]*margin:\s*0 1px/.test(tpl))
/* 2026-10-17 用户定：标题区「角色攻略」用原神字体（汉仪文黑-65W）。
   ⚠ 不能用模板里那个 `YS`：`{{_miao_path}}` 的 URL 带空格未编码 → 字体静默回落系统字体。 */
ok('标题区副标题用原神字体（@font-face 注入 + --codex-title-font 变量）',
  tpl.includes("font-family: '{{genshinFont.family}}'") &&
  tpl.includes('src: url("{{genshinFont.url}}")') &&
  tpl.includes('--codex-title-font') &&
  /\.codex-name \.codex-name-sub\s*\{[^}]*var\(--codex-title-font/.test(tpl))
ok('仓库自带原神字体文件（不依赖其它插件也能量）',
  fs.existsSync(path.join(pluginRoot, 'resources', 'common', 'font', 'HYWH-65W.woff')))
ok('行标签按语义分类上色（tone-core/alt/muted/plain 四档）',
  tpl.includes('tone-{{row.labelTone}}') &&
  /\.codex-tier\.tone-core[^{]*\{[^}]*color:\s*var\(--gold\)/.test(tpl) &&
  /\.codex-tier\.tone-alt[^{]*\{[^}]*color:\s*var\(--accent\)/.test(tpl) &&
  /\.codex-tier\.tone-muted[^{]*\{[^}]*color:\s*var\(--muted\)/.test(tpl) &&
  /\.codex-tier\.tone-plain[^{]*\{[^}]*color:\s*var\(--text\)/.test(tpl))
ok('立绘区标题分色（名字金色 + 副标题实心胶囊 + 定位冷色胶囊）',
  /\.codex-name\s*\{[^}]*color:\s*#ffe6b3/.test(tpl) &&
  /\.codex-name \.codex-name-sub\s*\{[^}]*background:\s*linear-gradient/.test(tpl) &&
  /\.codex-desc\s*\{[^}]*border-radius:\s*999px/.test(tpl))
ok('页脚正文不再以「口径：」开头（CSS 注释里的同词不算）',
  !/mx-footer__method">口径：/.test(tpl) && tpl.includes('mx-footer__method'))
ok('配队标签与其它模块标签同色（`.codex-team-tag` 取 --gold；模板仍带 label-<tag> 类）',
  /\.codex-team-tag\s*\{[^}]*color:\s*var\(--gold\)/.test(tpl) &&
  tpl.includes('codex-team-tag label-{{team.tag}}'))
ok('立绘结构：主体层按裁白边后的盒摆放（inline width/height/left/top）',
  tpl.includes('class="codex-portrait-img"') &&
  tpl.includes('width:{{portraitBox.width}};height:{{portraitBox.height}};left:{{portraitBox.left}};top:{{portraitBox.top}}'))
ok('遍历六个模块（数据来自投影，不写死章节数）', tpl.includes('{{each mx.sections section}}'))
ok('空模块分支', tpl.includes('{{if section.empty}}') && tpl.includes('{{section.emptyText}}'))
ok('配队分支', tpl.includes('section.teams.length > 0'))
ok('行分支（rows/items）', tpl.includes('{{each section.rows row}}') && tpl.includes('{{each row.items item}}'))
ok('专武 / 可选档沿用旧版标色（sig-strict / sig-alt）',
  tpl.includes("item.tone === 'sig'") && tpl.includes('sig-strict') &&
  tpl.includes("item.tone === 'alt'") && tpl.includes('sig-alt'))
ok('活动标签走 note', tpl.includes('codex-note-inline') && tpl.includes('{{item.note}}'))
ok('武器精炼提示', tpl.includes('{{section.hint}}') && tpl.includes('mx-section__hint'))
ok('长标签独占一行（审核 4.4：不加宽标签列）', tpl.includes('codex-row--long') && tpl.includes('{{each row.labelLines l}}'))
ok('数据来源一行 + 版权', tpl.includes('{{each mx.sources s}}') && tpl.includes('codex-source') && tpl.includes('{{copyright}}'))
ok('元素底主题（page--elem + gd-elem-*）', tpl.includes('class="page page--elem"') && tpl.includes('gd-elem-{{element}}'))
{
  const ifEachOpens = (tpl.match(/\{\{(?:if|each)\b/g) || []).length
  const ifEachEnds = (tpl.match(/\{\{\/(?:if|each)\}\}/g) || []).length
  ok('if/each 开闭配对', ifEachOpens === ifEachEnds)
}

// ---------- 2. 不得混入 miao 的 API 数据块 ----------
const apiRefs = ['holding.', 'materials', 'usage.'].filter(k => tpl.includes(k))
push('未混入 miao 的 API 数据块（holding/materials/usage）', apiRefs, [])

// ---------- 3. 类名 ----------
const styleBlock = (tpl.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1]
const ownClasses = new Set()
for (const m of styleBlock.matchAll(/\.([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g)) ownClasses.add(m[1])

/*
 * 共享组件类（`.mx-*`）来自 `resources/common/meta-ui.css`（2026-10-15 UI 重构）；
 * 它们和 miao 的借来类一样是"外部已定义"的合法类名，只是来源是本插件自己的共享样式。
 */
const sharedClasses = new Set()
{
  const shared = path.join(pluginRoot, 'resources', 'common', 'meta-ui.css')
  if (fs.existsSync(shared)) {
    for (const m of readText(shared).matchAll(/\.([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g)) sharedClasses.add(m[1])
  }
}

const usedStatic = new Set()
for (const m of tpl.matchAll(/class="([^"]*)"/g)) {
  for (const token of m[1].split(/\s+/)) {
    if (!token || token.includes('{{') || token.includes('}}')) continue
    // `{{if row.kind === 'stats'}} codex-stats-row{{/if}}` 这类内联条件里的中间片段
    // （`row.kind`、`===`）不是类名 —— 只接受合法的类名字符集
    if (!/^[A-Za-z_][\w-]*$/.test(token)) continue
    usedStatic.add(token)
  }
}
push('我们自己的 .codex-* 类都在页内 <style> 里定义', [...usedStatic].filter(c => c.startsWith('codex-') && !ownClasses.has(c)), [])

if (hasMiao) {
  const miaoClasses = new Set()
  const CLS = /\.([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g
  for (const rel of ['common/common.css', 'common/tpl.css', 'character/profile-detail.css', 'wiki/character-wiki.css']) {
    const f = path.join(miaoDir, 'resources', rel)
    if (!fs.existsSync(f)) continue
    for (const m of readText(f).matchAll(CLS)) miaoClasses.add(m[1])
  }
  const alien = [...usedStatic].filter(c => !ownClasses.has(c) && !sharedClasses.has(c) && !miaoClasses.has(c))
  push('其余静态类都能在 miao 的 CSS 或本插件共享样式里找到', alien, [])
} else {
  console.log(`跳过：未找到 miao-plugin（${miaoDir}），无法校验借用类名；可设 META_MIAO_DIR`)
}

// ---------- 4. 页级字段契约 + 真渲染（可选）----------
const subViewsFile = path.join(libDir, 'modules', 'subViews.js')
ok('lib/modules/subViews.js 存在', fs.existsSync(subViewsFile))
if (fs.existsSync(subViewsFile)) {
  const SV = await import(pathToFileURL(subViewsFile).href)
  const { CodexStore } = await import(pathToFileURL(path.join(libDir, 'model', 'CodexStore.js')).href)
  const store = new CodexStore()
  const view = SV.buildCodexView(store.getGuide('胡桃'), { signature: store.getSignature('胡桃'), weaponTags: store.getWeaponTags() })
  const page = SV.toPageData(view, { copyright: 'x', renderScale: 1.5 })

  const LOCAL = new Set(['if', 'else', 'each', 'set', 'block', 'extend', 'true', 'false', 'null', 'undefined', 'length', 'index'])
  const LOOP = new Set(['section', 'row', 'item', 'team', 'member', 's', 'l'])
  const SETVARS = new Set(['emptyText', 'refineHint'])
  // 模板里 `{{set NAME = …}}` 声明的局部变量（如行类名 rowCls）不算页级字段
  for (const m of tpl.matchAll(/\{\{\s*set\s+([A-Za-z_$][\w$]*)/g)) SETVARS.add(m[1])
  const INJECTED = new Set(['_res_path', '_miao_path', '_data_path', '_tpl_path', 'defaultLayout', 'elemLayout', 'sys', 'copyright', 'pluResPath', 'tplFile', 'saveId', 'imgType', '$index', '$value'])
  const missing = []
  const seen = new Set()
  for (const m of tpl.matchAll(/\{\{([^}]+)\}\}/g)) {
    const expr = m[1].trim().replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    if (!expr || expr.startsWith('/') || expr.startsWith('@')) continue
    for (const id of expr.matchAll(/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      const name = id[1]
      if (LOCAL.has(name) || LOOP.has(name) || SETVARS.has(name) || INJECTED.has(name) || seen.has(name)) continue
      seen.add(name)
      if (!(name in page)) missing.push(name)
    }
  }
  push('模板用到的页级字段都在 toPageData() 里', missing, [])
  ok('toPageData 提供页头字段', ['name', 'meta', 'metaRows', 'sections', 'hints', 'copyright', 'renderScale', 'portrait', 'portraitSrc', 'portraitRatio', 'subTitle'].every(k => k in page))

  let template = null
  try {
    template = await import('art-template')
  } catch {
    template = null
  }
  if (!template) {
    console.log('跳过：art-template 不可解析（开发工作区正常；bot 部署副本里会真渲染）')
  } else if (!hasMiao) {
    console.log('跳过：真渲染需要 miao 的布局文件（{{extend elemLayout}}）')
  } else {
    const render = template.default?.render ?? template.render
    const html = render(tpl, {
      ...page,
      elemLayout: path.join(miaoDir, 'resources', 'common', 'layout', 'elem.html'),
      defaultLayout: path.join(miaoDir, 'resources', 'common', 'layout', 'default.html'),
      _miao_path: 'miao/', _res_path: 'meta/', sys: { scale: 1 }, copyright: 'x'
    }, { filename: tplFile })
    ok('真渲染：无未替换的 {{ }} 残留', !/\{\{|\}\}/.test(html))
    ok('真渲染：无 undefined', !html.includes('undefined'))
    ok('真渲染：含角色名', html.includes('胡桃'))
    ok('真渲染：含专武文本与标色类', html.includes('护摩之杖') && html.includes('sig-strict'))
    ok('真渲染：含精炼提示', html.includes('精5') || html.includes('精 5'))
  }
}

const bad = report()
process.exit(bad ? 1 : 0)
