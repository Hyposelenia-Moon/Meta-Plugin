/**
 * 榜单/危战/状态模板套件（阶段 4.6）
 *
 * 4 张模板与 `common/` 资源是从 Mhydps **原样搬过来的**（不做改写），所以这里守的是：
 *   1. 模板与它引用的资源都在（CSS / 背景图 / 字体），且**引用路径能在磁盘上解析**；
 *   2. 模板用到的根字段都在 app 实际传入的数据里（契约：缺一个就是页面上出现空白或 `undefined`）；
 *   3. 模板保留合并前的关键结构（`{{renderScale}}` 缩放、`{{copyright}}`、`{{_data_path}}` 头像、
 *      四张背景图各归其页）——4.8 的真机逐字比对就靠这些不变。
 *
 * 真渲染断言需要 `art-template`（只在 bot 的 `node_modules` 里），工作区自动跳过；
 * `META_MIAO_DIR` 与它无关（dps 页不依赖 miao，用自带 CSS 与背景图）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('榜单模板与资源（阶段 4.6）')

const resDir = path.join(pluginRoot, 'resources')
const tplDir = path.join(resDir, 'dps')
const commonDir = path.join(resDir, 'common')

const TEMPLATES = {
  rank: { app: 'rank' },
  raid: { app: 'raid' },
  status: { app: 'status' },
  help: { app: 'help' },
  'char-dps': { app: 'char-dps' },
  tiers: { app: 'tiers' },
  grade: { app: 'grade' },
  'team-damage': { app: 'team-damage' },
  'akasha-build': { app: 'akasha-build' }
}

// ---------- 1. 模板 ----------
for (const [tpl] of Object.entries(TEMPLATES)) {
  const file = path.join(tplDir, `${tpl}.html`)
  ok(`${tpl}.html 已迁入`, fs.existsSync(file))
  const html = readText(file)
  ok(`${tpl}: 引用公共样式`, html.includes('{{_res_path}}/common/base.css') && html.includes('{{_res_path}}/common/components.css'))
  /*
   * 2026-10-15 用户定：**移除原先的背景图**（`bg-rank/bg-raid/bg-status/bg-help.jpg` 不再铺整页）。
   * 新的美观底图 + 模糊（亚克力/云母主题）另行设计，落地前这里守"不得再引旧底图"。
   */
  ok(`${tpl}: 不再引用旧背景图`, !/bg-(rank|raid|status|help)\.jpg/.test(html) && !html.includes('class="page-bg"'))
  ok(`${tpl}: 保留合并前的缩放与版权写法`,
    html.includes('{{renderScale}}') && html.includes('{{copyright}}'))
}

// 榜单/危战页引用头像缓存（练度/状态页不需要）
for (const tpl of ['rank', 'raid', 'char-dps', 'tiers']) {
  ok(`${tpl}: 引用 out/ 下的头像缓存路径`, readText(path.join(tplDir, `${tpl}.html`)).includes('{{_data_path}}/avatar/'))
}

// ---------- 2. CSS 引用的资源都能解析 ----------
{
  const refs = new Set()
  const outside = new Set()
  for (const f of ['base.css', 'components.css']) {
    const css = readText(path.join(commonDir, f))
    for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const ref = m[1].trim()
      if (/^(data:|https?:)/.test(ref)) continue
      /*
       * miao 资源（元素底 `bg-{元素}.webp` 等）**只引用不复制**：路径向上越出本插件目录，
       * 落到 `<Yunzai>/plugins/miao-plugin/resources/...`。这类引用单独核对，不参与"必须在 resources/ 内"的检查。
       */
      if (ref.includes('plugins/miao-plugin/')) {
        outside.add(ref)
        continue
      }
      refs.add(path.normalize(path.join('common', ref)))
    }
  }
  push('CSS 里 url(...) 引用的资源都在（相对 resources/）',
    [...refs].filter(rel => !fs.existsSync(path.join(resDir, rel))), [])
  push('越出插件目录的引用只能是 miao 资源（不复制素材）',
    [...outside].filter(ref => !/^\.\.\/\.\.\/\.\.\/\.\.\/plugins\/miao-plugin\/resources\//.test(ref)), [])
  /*
   * 2026-10-15 起：元素底用**我们自己的裁切件** `resources/common/bg/page-{元素}.webp`
   * （由 miao `common/bg/bg-{元素}.webp` 裁上带得到，见 README 许可说明），不再直接引 miao 原图。
   */
  const pageBg = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo', 'quantum', 'sr']
  push('元素底裁切件齐备（resources/common/bg/page-{元素}.webp）',
    pageBg.filter(e => !fs.existsSync(path.join(resDir, 'common', 'bg', `page-${e}.webp`))), [])
  push('base.css 引用的都是本地裁切件',
    [...refs].filter(rel => /common[\\/]bg[\\/]bg-/.test(rel)), [])
}

// ---------- 2b. 立绘行图标：元素圆环底图 + 层级 ----------
{
  const html = readText(path.join(tplDir, 'grade.html'))
  // 2026-10-15 用户反馈：天赋/命座图标只剩中间那块白色图形（缺元素圆环），命座行还整个看不见
  const rules = [...html.matchAll(/\.gd-elem-([a-z]+) \.gd-talent-icon \{ background-image: url\('([^']+)'\); \}/g)]
  const ring = new Map(rules.map(m => [m[1], m[2]]))
  push('元素圆环规则覆盖 miao 的 8 个元素（不含星铁）', ring.size, 8)
  push('每个圆环都指向同名的 talent-{elem}.webp',
    [...ring].filter(([elem, url]) => !url.endsWith(`/common/bg/talent-${elem}.webp`)), [])
  ok('.gd-talent-icon 带 z-index: 90（否则左下角命座行会被 z-index:2 的立绘盖住）',
    /\.gd-talent-icon \{[^}]*z-index: 90/.test(html))
  ok('旋绕（.gd-talent-crown）贴圆环顶边（top: 0）', /\.gd-talent-crown::after \{[^}]*top: 0/.test(html))
  const miaoRoot = process.env.META_MIAO_DIR
    ? path.join(process.env.META_MIAO_DIR, 'resources')
    : path.resolve(pluginRoot, '..', 'miao-plugin', 'resources')
  if (fs.existsSync(path.join(miaoRoot, 'common', 'bg'))) {
    push('圆环底图在 miao 里都存在',
      [...ring.values()].map(u => path.basename(u)).filter(f => !fs.existsSync(path.join(miaoRoot, 'common', 'bg', f))), [])
  } else {
    console.log(`跳过：未找到 miao 资源（${miaoRoot}）—— 圆环底图存在性未校验`)
  }
}

// ---------- 2c. 当前配装的圣遗物行：评分块独占次行、右对齐 ----------
{
  const html = readText(path.join(tplDir, 'grade.html'))
  const css = readText(path.join(resDir, 'common', 'meta-ui.css'))
  /*
   * 2026-10-15 用户定：套装名独占一行、`评分 X.Y SSS　词条数：N` 换到次行右对齐
   * （当时评分块固定 330px 把「晨星与月的晓歌×4」挤成两行、整行看着错位）。
   * UI 重构后组件换成 `.mx-equipment` + `.mx-meta-line`，这条排版要求不变。
   */
  ok('圣遗物行的评分/词条走 .mx-meta-line（独占次行）', /class="mx-meta-line"/.test(html))
  ok('次行右对齐且不换行', /\.mx-meta-line \{[^}]*text-align: right/.test(css) && /\.mx-meta-line \{[^}]*white-space: nowrap/.test(css))
  ok('套装名与评分不在同一行（两行结构）',
    /<span class="mx-equipment__text">圣遗物：/.test(html) && html.indexOf('mx-meta-line') > html.indexOf('mx-equipment__text">圣遗物：'))
}

// ---------- 3. 数据契约（模板根字段 ⊆ app 传入的数据） ----------
{
  const INJECTED = new Set(['_res_path', '_data_path', '_miao_path', 'renderScale', 'copyright', 'sys', 'elemLayout', 'defaultLayout', 'pluResPath', 'tplFile', 'saveId', 'imgType'])
  const KEYWORDS = new Set(['if', 'else', 'each', 'set', 'block', 'extend', 'true', 'false', 'null', 'undefined', 'length', 'index'])

  /** app 实际塞给模板的顶层字段（见 src/apps/{rank,raid,status}.ts 的 data 对象） */
  const APP_DATA = {
    rank: ['siteName', 'title', 'subtitle', 'fetchedAt', 'total', 'page', 'totalPages', 'pageSize', 'rows'],
    raid: ['siteName', 'title', 'subtitle', 'fetchedAt', 'total', 'page', 'totalPages', 'rows'],
  'char-dps': ['siteName', 'title', 'subtitle', 'fetchedAt', 'total', 'tierCount', 'tiers'],
  tiers: ['siteName', 'title', 'subtitle', 'fetchedAt', 'total', 'tiers'],
  // 2026-10-15：新增「当前配装 / 参考 DPS / 角色立绘」三块（后两块可缺省 → 模板用 {{if}} 兜着）
  grade: ['title', 'subtitle', 'charName', 'ranks', 'rankClass', 'total', 'panelTier', 'dims', 'missRows', 'consLine', 'suggestions', 'buildInfo', 'panelRows', 'uidText', 'consIcons', 'talentIcons', 'elemClass', 'heroImg', 'refDps', 'mx', 'assessable', 'notes'],
  'team-damage': ['title', 'subtitle', 'uid', 'members', 'refs', 'refTotal', 'approxCost', 'notes', 'referenceDps', 'referenceTotal', 'window', 'axisLabel', 'axisManual', 'patchLabel', 'contributions'],
  'akasha-build': ['title', 'subtitle', 'charName', 'rank', 'uid', 'nickname', 'cons', 'damageText', 'critValueText', 'talent', 'weapon', 'artis', 'sets', 'panel', 'mx'],
    status: ['siteName', 'title', 'hasData', 'dataTime', 'ageText', 'ttlText', 'staleText', 'proxy', 'networkEnabled', 'disabledModules', 'codexFilled', 'codexTotal', 'miaoOk', 'atlasOk', 'sources', 'versions', 'avatar', 'pluginVersion', 'yunzaiVersion', 'versionText']
  }
  const LOOP = new Set(['row', 'rows', 'c', 'item', 's', 'r', '$data', 'member', 'team'])

  /** 模板里「被 `{{if}}` 兜着」的可选字段：缺了不报错、整块不渲染（合并前就没传，属预期） */
  const OPTIONAL = { rank: ['pageSize'], raid: ['pageSize'] }

  for (const [tpl, allowed] of Object.entries(APP_DATA)) {
    const html = readText(path.join(tplDir, `${tpl}.html`))
    // 循环变量是模板自己声明的（`{{each row.tags t}}` / `{{each sources src}}`），动态收集
    const loopVars = new Set()
    for (const m of html.matchAll(/\{\{\s*each\s+(\S+)\s+([\w$]+)(?:\s+([\w$]+))?\s*\}\}/g)) {
      loopVars.add(m[2])
      if (m[3]) loopVars.add(m[3])
    }
    const optional = OPTIONAL[tpl] || []
    const missing = []
    const seen = new Set()
    for (const m of html.matchAll(/\{\{([^}]+)\}\}/g)) {
      const expr = m[1].trim().replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
      if (!expr || expr.startsWith('/') || expr.startsWith('@')) continue
      for (const id of expr.matchAll(/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        const name = id[1]
        if (KEYWORDS.has(name) || LOOP.has(name) || loopVars.has(name) || optional.includes(name) || INJECTED.has(name) || seen.has(name)) continue
        seen.add(name)
        if (!allowed.includes(name)) missing.push(name)
      }
    }
    push(`${tpl}: 模板用到的字段都在 app 传入的数据里（或显式标为可选）`, missing, [])
  }
}

// ---------- 4. 随插件分发的数据表 ----------
{
  for (const f of ['characters.json', 'bosses.json']) {
    const p = path.join(resDir, 'data', f)
    ok(`data/${f} 在`, fs.existsSync(p))
    let parsed = null
    try {
      parsed = JSON.parse(readText(p))
    } catch { /* 交给断言 */ }
    ok(`data/${f} 是合法 JSON 数组`, Array.isArray(parsed) && parsed.length > 0)
  }
}

// ---------- 5. 字体（.ttf 的 gitignore 例外必须有，否则 bot 侧拉不到文件） ----------
{
  const gi = readText(path.join(pluginRoot, '.gitignore'))
  ok('.gitignore 有 font 目录的 .ttf 例外', gi.includes('!resources/common/font/*.ttf'))
  ok('页脚数字字体已迁入', fs.existsSync(path.join(commonDir, 'font', 'tttgbnumber.ttf')))
  ok('正文字体已迁入', fs.existsSync(path.join(commonDir, 'font', 'HYWH-65W.woff')))
  ok('base.css 的 @font-face 指向 font/ 目录', readText(path.join(commonDir, 'base.css')).includes('./font/'))
}

// ---------- 6. 真渲染（需要 art-template；工作区跳过） ----------
{
  let template = null
  try {
    template = (await import('art-template')).default
  } catch {
    console.log('跳过真渲染：工作区解析不到 art-template（bot 部署副本里会跑）')
  }
  if (template) {
    const TS = await import(pathToFileURL(path.join(libDir, 'model', 'TeamStore.js')).href)
    const RQ = await import(pathToFileURL(path.join(libDir, 'modules', 'rankQuery.js')).href)
    const DQ = await import(pathToFileURL(path.join(libDir, 'modules', 'raidQuery.js')).href)
    const fixture = (n) => JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', n)))
    const rows = RQ.buildRows(TS.normalizeTeams(fixture('teams.sample.json')), 1)
    const raidRows = DQ.buildRows(TS.normalizeTeams2(fixture('teams2.sample.json')), 1)
    const base = {
      siteName: '原神DPS数据库',
      fetchedAt: '2026-10-13 12:00',
      copyright: 'Data from mhydps.cn · Created By TRSS-yunzai & Mhydps-Plugin',
      _res_path: '../../../plugins/Meta-Plugin/resources',
      _data_path: '../../../plugins/Meta-Plugin/out',
      renderScale: 1.5
    }
    const cases = [
      ['rank', { ...base, title: '#DPS榜', subtitle: '玛薇卡 · 按期望DPS降序', total: rows.length, page: 1, totalPages: 1, pageSize: 10, rows }],
      ['raid', { ...base, title: '#危战', subtitle: '版本 7.1 · 按金数升序', total: raidRows.length, page: 1, totalPages: 1, rows: raidRows }],
      ['status', {
        ...base,
        title: '#meta状态',
        hasData: true,
        dataTime: '2026-10-13 12:00',
        ageText: '5 分钟前',
        ttlText: '30 分钟',
        staleText: '有效',
        proxy: '',
        sources: [{ name: 'DPS数据库', count: rows.length }, { name: '危战榜单', count: raidRows.length }],
        versions: '2 个版本（7.0 ~ 7.1）',
        avatar: { total: 5, cached: 3 },
        pluginVersion: '0.1.0',
        yunzaiVersion: '3.1.3',
        versionText: 'Created By Yz-Bot 3.1.3 & Mhydps-Plugin 0.1.0'
      }]
    ]
    for (const [tpl, data] of cases) {
      const file = path.join(tplDir, `${tpl}.html`)
      let html = ''
      try {
        html = template.render(readText(file), data, { filename: file })
      } catch (err) {
        push(`${tpl}: 真渲染不报错`, [String(err?.message || err)], [])
        continue
      }
      push(`${tpl}: 真渲染无 {{}} 残留、无 undefined`, [/[{]{2}|[}]{2}/.test(html) ? '残留 {{}}' : '', html.includes('undefined') ? '含 undefined' : ''].filter(Boolean), [])
      if (tpl === 'rank') {
        ok('rank 渲染含样式且不再铺旧底图', html.includes('base.css') && !html.includes('bg-rank.jpg'))
        ok('rank 渲染含数据来源', html.includes('原神DPS数据库'))
      }
      if (tpl === 'raid') ok('raid 渲染不再铺旧底图', !html.includes('bg-raid.jpg'))
      if (tpl === 'status') ok('status 渲染含版本行', html.includes('Mhydps-Plugin'))
    }
  }
}

const bad = report()
process.exit(bad ? 1 : 0)
