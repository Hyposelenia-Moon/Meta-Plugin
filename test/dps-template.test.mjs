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
  rank: { app: 'rank', bg: 'bg-rank.jpg' },
  raid: { app: 'raid', bg: 'bg-raid.jpg' },
  status: { app: 'status', bg: 'bg-status.jpg' },
  help: { app: 'help', bg: 'bg-help.jpg' },
  'char-dps': { app: 'char-dps', bg: 'bg-rank.jpg' },
  tiers: { app: 'tiers', bg: 'bg-raid.jpg' },
  grade: { app: 'grade', bg: 'bg-rank.jpg' },
  'team-damage': { app: 'team-damage', bg: 'bg-rank.jpg' }
}

// ---------- 1. 模板与背景图 ----------
for (const [tpl, meta] of Object.entries(TEMPLATES)) {
  const file = path.join(tplDir, `${tpl}.html`)
  ok(`${tpl}.html 已迁入`, fs.existsSync(file))
  const html = readText(file)
  ok(`${tpl}: 引用公共样式`, html.includes('{{_res_path}}/common/base.css') && html.includes('{{_res_path}}/common/components.css'))
  ok(`${tpl}: 用自己那张背景图`, html.includes(`{{_res_path}}/common/${meta.bg}`))
  ok(`${tpl}: 保留合并前的缩放与版权写法`,
    html.includes('{{renderScale}}') && html.includes('{{copyright}}'))
  ok(`${tpl}: 背景图文件在`, fs.existsSync(path.join(commonDir, meta.bg)))
}

// 榜单/危战页引用头像缓存（练度/状态页不需要）
for (const tpl of ['rank', 'raid', 'char-dps', 'tiers']) {
  ok(`${tpl}: 引用 out/ 下的头像缓存路径`, readText(path.join(tplDir, `${tpl}.html`)).includes('{{_data_path}}/avatar/'))
}

// ---------- 2. CSS 引用的资源都能解析 ----------
{
  const refs = new Set()
  for (const f of ['base.css', 'components.css']) {
    const css = readText(path.join(commonDir, f))
    for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const ref = m[1].trim()
      if (/^(data:|https?:)/.test(ref)) continue
      refs.add(path.normalize(path.join('common', ref)))
    }
  }
  push('CSS 里 url(...) 引用的资源都在（相对 resources/）',
    [...refs].filter(rel => !fs.existsSync(path.join(resDir, rel))), [])
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
  grade: ['title', 'subtitle', 'uid', 'ranks', 'total', 'panelTier', 'dims', 'rows', 'groups', 'suggestions', 'notes'],
  'team-damage': ['title', 'subtitle', 'uid', 'members', 'refs', 'refTotal', 'approxCost', 'notes'],
    status: ['siteName', 'title', 'hasData', 'dataTime', 'ageText', 'ttlText', 'staleText', 'proxy', 'networkEnabled', 'codexFilled', 'codexTotal', 'miaoOk', 'atlasOk', 'sources', 'versions', 'avatar', 'pluginVersion', 'yunzaiVersion', 'versionText']
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
      ['raid', { ...base, title: '#DPS危战榜', subtitle: '版本 7.1 · 按金数升序', total: raidRows.length, page: 1, totalPages: 1, rows: raidRows }],
      ['status', {
        ...base,
        title: '#DPS状态',
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
        ok('rank 渲染含背景图与样式', html.includes('bg-rank.jpg') && html.includes('base.css'))
        ok('rank 渲染含数据来源', html.includes('原神DPS数据库'))
      }
      if (tpl === 'raid') ok('raid 渲染含背景图', html.includes('bg-raid.jpg'))
      if (tpl === 'status') ok('status 渲染含版本行', html.includes('Mhydps-Plugin'))
    }
  }
}

const bad = report()
process.exit(bad ? 1 : 0)
