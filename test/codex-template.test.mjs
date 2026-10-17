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
/* 2026-10-17 图库接入：立绘铺满卡片区 —— cover 裁切 + 按默认立绘比例定高（口径改动必须过这条门禁） */
ok('立绘铺满卡片区：`object-fit: cover` + `aspect-ratio: {{portraitRatio}}`',
  /\.codex-portrait\s*\{[\s\S]*?object-fit:\s*cover/.test(tpl) && tpl.includes('aspect-ratio: {{portraitRatio}}'))
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
