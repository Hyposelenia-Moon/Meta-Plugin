/**
 * 攻略页模板自检（阶段 1.3a）
 *
 * 四层：
 *   1. **结构约定**：无 `{{extend}}`（本插件模板是独立模板，不走 miao 的布局继承）、引用公共样式、
 *      用 `_res_path` / `renderScale` / `copyright`、六个模块循环、empty / teams / rows 三分支、
 *      专武两色、活动标签、空模块文案、武器精炼提示；
 *   2. **类名存在性**：模板里出现的静态 class 必须能在公共样式或页内 `<style>` 里找到（防拼写漂移）；
 *   3. **字段契约**：模板用到的页级字段必须都在 `toPageData()` 的返回里；
 *   4. **真渲染（可选）**：能解析到 `art-template` 时（bot 部署副本里可以，它随框架装在 bot 根）
 *      用真实数据渲染胡桃，断言关键内容与"无未渲染残留"；开发工作区解析不到 → 跳过并 exit 0。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('攻略页模板（codex.html）')

const tplFile = path.join(pluginRoot, 'resources', 'codex', 'codex.html')
ok('resources/codex/codex.html 存在', fs.existsSync(tplFile))
if (!fs.existsSync(tplFile)) {
  report()
  process.exit(1)
}
const tpl = readText(tplFile)

// ---------- 1. 结构约定 ----------
ok('不继承 miao 的布局（无 {{extend}}）', !tpl.includes('{{extend'))
ok('引用公共 base.css', tpl.includes('/common/base.css'))
ok('引用公共 components.css', tpl.includes('/common/components.css'))
ok('资源走 {{_res_path}}', tpl.includes('{{_res_path}}'))
ok('缩放用 renderScale', tpl.includes('zoom:{{renderScale}}'))
ok('页脚输出 copyright', tpl.includes('{{copyright}}'))
ok('遍历六个模块', tpl.includes('{{each sections section}}'))
ok('空模块分支', tpl.includes('{{if section.empty}}') && tpl.includes('{{emptyText}}'))
ok('配队分支', tpl.includes("section.kind === 'teams'"))
ok('行分支（rows/items）', tpl.includes('{{each section.rows row}}') && tpl.includes('{{each row.items item}}'))
ok('严格专武标红类', tpl.includes('sig-strict') && tpl.includes('{{if item.sig}}'))
ok('实际专属标绿类', tpl.includes('sig-alt') && tpl.includes('{{if item.sigAlt}}'))
ok('活动标签走 note', tpl.includes('codex-note-inline') && tpl.includes('{{item.note}}'))
ok('档位标签用归一给的 labelClass', tpl.includes('{{row.labelClass}}'))
ok('武器精炼提示', tpl.includes('{{refineHint}}'))
ok('立绘可选（{{if portrait}}）', tpl.includes('{{if portrait}}'))
{
  const opens = (tpl.match(/\{\{(?:if|each)\b/g) || []).length
  const closes = (tpl.match(/\{\{\/(?:if|each)\}\}/g) || []).length
  ok('art-template 块开闭配对', opens === closes)
}

// ---------- 2. 类名存在性 ----------
const styleBlock = (tpl.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1]
const defined = new Set()
const CSS_CLASS_RE = /\.([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g
for (const file of ['common/base.css', 'common/components.css']) {
  const css = readText(path.join(pluginRoot, 'resources', file))
  for (const m of css.matchAll(CSS_CLASS_RE)) defined.add(m[1])
}
for (const m of styleBlock.matchAll(CSS_CLASS_RE)) defined.add(m[1])

const usedStatic = new Set()
for (const m of tpl.matchAll(/class="([^"]*)"/g)) {
  for (const token of m[1].split(/\s+/)) {
    if (!token || token.includes('{{') || token.includes('}}')) continue
    usedStatic.add(token)
  }
}
const unknown = [...usedStatic].filter(c => !defined.has(c))
push('模板用到的静态 class 都有样式定义', unknown, [])

// ---------- 3. 字段契约 ----------
const subViewsFile = path.join(libDir, 'modules', 'subViews.js')
ok('lib/modules/subViews.js 存在', fs.existsSync(subViewsFile))
if (fs.existsSync(subViewsFile)) {
  const SV = await import(pathToFileURL(subViewsFile).href)
  const storeFile = path.join(libDir, 'model', 'CodexStore.js')
  const { CodexStore } = await import(pathToFileURL(storeFile).href)
  const store = new CodexStore()
  const view = SV.buildCodexView(store.getGuide('胡桃'), { signature: store.getSignature('胡桃'), weaponTags: store.getWeaponTags() })
  const page = SV.toPageData(view, { copyright: 'x', renderScale: 1.5 })

  // 模板里出现的"根标识符"必须能在页数据/循环变量/模板内 set 变量/框架注入量里找到
  // 只取根标识符（前面不是 `.` 的），否则 `hints.empty` 的 `empty`、`item.sig` 的 `sig` 会被误报
  const LOCAL = new Set(['if', 'else', 'each', 'set', 'true', 'false', 'null', 'undefined', 'length', 'index'])
  const LOOP = new Set(['section', 'row', 'item', 'team', 'member'])
  const SETVARS = new Set(['emptyText', 'refineHint'])
  /** 框架 / 渲染层注入，不属于插件页数据 */
  const INJECTED = new Set(['_res_path', '_data_path', 'tplFile', 'saveId', 'imgType', '$index', '$value'])
  const missing = []
  const seen = new Set()
  for (const m of tpl.matchAll(/\{\{([^}]+)\}\}/g)) {
    // 先剥掉字符串字面量：`section.kind === 'teams'` 里的 teams 不是字段引用
    const expr = m[1].trim().replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    if (!expr || expr.startsWith('/')) continue
    for (const id of expr.matchAll(/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      const name = id[1]
      if (LOCAL.has(name) || LOOP.has(name) || SETVARS.has(name) || INJECTED.has(name) || seen.has(name)) continue
      seen.add(name)
      if (!(name in page)) missing.push(name)
    }
  }
  push('模板用到的页级字段都在 toPageData() 里', missing, [])
  ok('toPageData 提供页头/页脚字段', ['name', 'metaRows', 'sections', 'hints', 'copyright', 'renderScale', 'portrait', 'subTitle'].every(k => k in page))

  // ---------- 4. 真渲染（可选）----------
  let template = null
  try {
    template = await import('art-template')
  } catch {
    template = null
  }
  if (!template) {
    console.log('跳过：art-template 不可解析（开发工作区正常；bot 部署副本里会真渲染）')
  } else {
    const render = template.default?.render ?? template.render
    const html = render(tpl, page)
    ok('真渲染：无未替换的 {{ }} 残留', !/\{\{|\}\}/.test(html))
    ok('真渲染：无 undefined', !html.includes('undefined'))
    ok('真渲染：含角色名', html.includes('胡桃'))
    ok('真渲染：含档位词', html.includes('推荐'))
    ok('真渲染：含专武文本与标色类', html.includes('护摩之杖') && html.includes('sig-strict'))
    ok('真渲染：含精炼提示', html.includes('精5'))

    // 找一个有空模块的角色，验证「暂无」真的画出来
    const withEmpty = store.listCharacters().find(n => {
      const v = SV.buildCodexView(store.getGuide(n), { signature: store.getSignature(n), weaponTags: store.getWeaponTags() })
      return v.sections.some(s => s.empty)
    })
    if (withEmpty) {
      const v = SV.buildCodexView(store.getGuide(withEmpty), { signature: store.getSignature(withEmpty), weaponTags: store.getWeaponTags() })
      const html2 = render(tpl, SV.toPageData(v, {}))
      ok(`真渲染：空模块角色（${withEmpty}）显示「暂无」`, html2.includes('暂无'))
    } else {
      console.log('跳过：没有找到含空模块的角色')
    }
  }
}

const bad = report()
process.exit(bad ? 1 : 0)
