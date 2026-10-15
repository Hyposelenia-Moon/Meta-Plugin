/**
 * 渲染实测：4 个模板都要能在真实框架渲染后端里出图，且模板里的资源/头像路径必须能解析到文件
 *
 * 这条是「路径层级」的守门人：框架把 HTML 写到 `temp/html/Meta-Plugin/dps/<tpl>/<saveId>.html`，
 * `components/render.js` 里的 `../../../../../../` 少一层就会 CSS 全丢、头像全裂，但**渲染不会报错**。
 * 所以这里不只看出图，还把渲染产物里的 href/src 解析回磁盘核对。
 *
 * 缺前置（不在 bot 环境 / 没装浏览器 / 缺依赖）时打印「跳过」并以 0 退出。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  checker,
  installFrameworkStubs,
  loadFixture,
  mod,
  pluginRoot,
  requireRenderEnv, renderEnvIssues, recordSkip,
  appRoot,
  ensureTmpDir
} from './_helper.mjs'

installFrameworkStubs({ echoError: true })

// 渲染时模板按固定相对路径找 `plugins/Meta-Plugin/out/`（头像缓存），故本套件不改数据目录
delete process.env.META_DATA_DIR

const { renderDps } = await import(mod('components/render.js'))
const { normalizeTeams, normalizeTeams2 } = await import(mod('model/TeamStore.js'))
const { buildRows } = await import(mod('modules/rankQuery.js'))
const { buildRows: buildRaidRows } = await import(mod('modules/raidQuery.js'))
const { cacheInfo, getCounts } = await import(mod('model/TeamStore.js'))
const { avatarStats } = await import(mod('model/AvatarStore.js'))
const { helpCfg, helpList } = await import(mod('resources/help/help-cfg.js'))
const { versions } = await import(mod('model/CharacterIndex.js'))
const { COPYRIGHT, SITE_NAME, formatTime, agoText } = await import(mod('components/constants.js'))
const { pluginVersion, yunzaiVersion, versionText } = await import(mod('components/pluginVersion.js'))

// 前置检查放在 import **之后**：普通环境也会真正执行上面的 import（残留的失效模块会立刻报错，不再被"跳过"掩盖）

const { check, finish } = checker()

/**
 * 2026-10-15 审核 P2 #14：前置检查**不再静默退出** —— 记录一次"部分跳过"并按
 * 通过/失败/跳过三段打印汇总；静态契约检查由 `render-static.test.mjs` 在普通环境照常运行。
 */
{
  const problems = renderEnvIssues()
  if (problems.length) {
    recordSkip(`实际截图部分：${problems.join('；')}`)
    finish()
  }
}


/** 1×1 webp：给模板一张真实存在的立绘，验证 _data_path 能解析到文件 */
const FAKE_AVATAR = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
const avatarDir = path.join(pluginRoot, 'data', 'avatar')
const avatarFile = path.join(avatarDir, '10000046.webp')
const hadAvatar = fs.existsSync(avatarFile)
if (!hadAvatar) {
  fs.mkdirSync(avatarDir, { recursive: true })
  fs.writeFileSync(avatarFile, FAKE_AVATAR)
}

const outDir = path.join(ensureTmpDir(), 'render')
fs.mkdirSync(outDir, { recursive: true })

/**
 * 渲染一次并落盘产物
 * @returns {Promise<{img: object|null, html: string, err: string}>}
 */
async function renderOnce (tpl, data, saveId) {
  try {
    const img = await renderDps(tpl, { ...data, saveId })
    const htmlPath = path.join(appRoot, 'temp', 'html', 'Mhydps-Plugin', 'dps', tpl, `${saveId}.html`)
    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : ''
    if (html) fs.writeFileSync(path.join(outDir, `${tpl}.html`), html, 'utf8')
    // 出图对象里带 Buffer 时落一份 jpg，便于人工看排版
    const raw = img?.file ?? img?.data
    const buf = Buffer.isBuffer(raw)
      ? raw
      : (typeof raw === 'string' && raw.startsWith('data:') ? Buffer.from(raw.split(',')[1], 'base64') : null)
    if (buf) fs.writeFileSync(path.join(outDir, `${saveId}.jpg`), buf)
    else if (process.env.META_DEBUG_RENDER) console.log(`  （${saveId} 图片形态：${typeof raw} keys=${img ? Object.keys(img).join(',') : 'null'}）`)
    return { img, html, err: '' }
  } catch (err) {
    return { img: null, html: '', err: err?.message || String(err) }
  }
}

/** 核对 HTML 里的相对引用是否都能落到真实文件（href/src 与 CSS 里的 url(...)，含背景图） */
function checkRefs (html, htmlDir, label, refRe) {
  const refs = [...html.matchAll(refRe)].map(m => m[1])
  const urls = [...html.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map(m => m[1])
  const all = [...new Set([...refs, ...urls])]
  check(`${label}：模板内无残留未替换占位符`, !/\{\{|\}\}/.test(html))
  check(`${label}：引用了资源文件`, all.length > 0, `${all.length} 处`)
  const broken = all.filter(ref => {
    if (/^(https?:|data:|#)/.test(ref)) return false
    const abs = path.resolve(htmlDir, ref.split('?')[0])
    return !fs.existsSync(abs)
  })
  check(`${label}：所有相对引用都能解析到文件`, broken.length === 0, broken.slice(0, 3).join(' | '))
  return all
}

const teams = normalizeTeams(loadFixture('teams.sample.json'))
const raids = normalizeTeams2(loadFixture('teams2.sample.json'))
const enka = loadFixture('enka.sample.json')
const now = Date.now()

// ---- rank ----
const rankData = {
  siteName: SITE_NAME,
  title: '#DPS榜',
  subtitle: '玛薇卡 · 按期望DPS降序',
  fetchedAt: formatTime(now),
  total: teams.length,
  page: 1,
  totalPages: 1,
  pageSize: teams.length,
  rows: buildRows(teams, 1),
  copyright: COPYRIGHT
}
const rank = await renderOnce('rank', rankData, 'test-rank')
check('rank 出图成功', Boolean(rank.img), rank.err)
if (rank.html) {
  const refs = checkRefs(rank.html, path.dirname(path.join(appRoot, 'temp', 'html', 'Mhydps-Plugin', 'dps', 'rank', 'x.html')), 'rank', /(?:href|src)="([^"]+)"/g)
  check('rank：头像走 data/avatar 相对路径', refs.some(r => r.includes('data/avatar/10000046.webp')), refs.find(r => r.includes('avatar')) || '')
  check('rank：渲染了角色名', rank.html.includes('玛薇卡') && rank.html.includes('胡桃'))
  check('rank：命座角标为纯数字（站点式圆形角标）', /class="avatar-con">6</.test(rank.html))
  check('rank：头像带金环样式类', rank.html.includes('avatar-img') || rank.html.includes('avatar-text'))
  check('rank：渲染了伤害与金数', rank.html.includes('323.0 万') && rank.html.includes('48'))
  check('rank：渲染了名次', rank.html.includes('rank-badge') || rank.html.includes('rank'))
  check('rank：页脚带版权行', rank.html.includes('mhydps.cn'))
  /* 2026-10-15 用户定：移除原先的背景图（新的美观底图/模糊主题另行设计） */
  check('rank：不再铺旧插画底图', !rank.html.includes('bg-rank.jpg') && !rank.html.includes('page-bg'))
  check('rank：文字都落在深色内容条上', rank.html.includes('head-card') && rank.html.includes('body-card') && rank.html.includes('foot-card'))
  check('rank：已移除行尾视频列', !rank.html.includes('rank-side') && !rank.html.includes('video-mark'))
  check('rank：不残留浅色主题的蒙版令牌', !rank.html.includes('page-veil') && !rank.html.includes('hero-scrim'))
  check('rank：榜单行数与数据条数一致', (rank.html.match(/class="rank-row"/g) || []).length === rankData.rows.length, `${rankData.rows.length} 行`)
}

// ---- raid ----
const raidData = {
  siteName: SITE_NAME,
  title: '#危战',
  subtitle: '版本 7.1 · 按金数升序',
  fetchedAt: formatTime(now),
  total: raids.length,
  page: 1,
  totalPages: 1,
  rows: buildRaidRows(raids, 1),
  copyright: COPYRIGHT
}
const raid = await renderOnce('raid', raidData, 'test-raid')
check('raid 出图成功', Boolean(raid.img), raid.err)
if (raid.html) {
  checkRefs(raid.html, path.dirname(path.join(appRoot, 'temp', 'html', 'Mhydps-Plugin', 'dps', 'raid', 'x.html')), 'raid', /(?:href|src)="([^"]+)"/g)
  check('raid：渲染了首领与版本', raid.html.includes('矮灵雕刻师') && raid.html.includes('7.1'))
  check('raid：渲染了耗时', raid.html.includes('>24<') && raid.html.includes('秒'))
  check('raid：已移除行尾视频列', !raid.html.includes('rank-side') && !raid.html.includes('video-mark'))
}

// ---- status ----
const statusData = {
  siteName: SITE_NAME,
  title: '#meta状态',
  hasData: true,
  dataTime: formatTime(now),
  ageText: agoText(1000),
  ttlText: '30 分钟',
  staleText: '有效',
  proxy: 'http://proxy.example:8080',
  sources: [
    { name: 'DPS数据库', count: teams.length },
    { name: '危战榜单', count: raids.length }
  ],
  versions: `${versions().length} 个版本（5.7 ~ 7.1）`,
  avatar: avatarStats(),
  pluginVersion,
  yunzaiVersion,
  versionText,
  copyright: COPYRIGHT
}
const status = await renderOnce('status', statusData, 'test-status')
check('status 出图成功', Boolean(status.img), status.err)
if (status.html) {
  checkRefs(status.html, path.dirname(path.join(appRoot, 'temp', 'html', 'Mhydps-Plugin', 'dps', 'status', 'x.html')), 'status', /(?:href|src)="([^"]+)"/g)
  check('status：渲染了条数与代理', status.html.includes('DPS数据库') && status.html.includes('proxy.example:8080'))
}

// ---- help ----
const helpData = {
  helpCfg,
  helpGroup: helpList.map(g => ({ group: g.group, list: g.list.map(i => ({ title: i.title, desc: i.desc })) })),
  versionText,
  copyright: COPYRIGHT
}
const help = await renderOnce('help', helpData, 'test-help')
check('help 出图成功', Boolean(help.img), help.err)
if (help.html) {
  checkRefs(help.html, path.dirname(path.join(appRoot, 'temp', 'html', 'Mhydps-Plugin', 'dps', 'help', 'x.html')), 'help', /(?:href|src)="([^"]+)"/g)
  check('help：渲染了指令条目', help.html.includes('#DPS榜') && help.html.includes('#危战') && help.html.includes('#练度榜'))
  check('help：分组标题条数量与配置一致', (help.html.match(/class="help-group"/g) || []).length === helpList.length, `${helpList.length} 组`)
  check('help：使用三列网格', help.html.includes('class="help-grid"') || help.html.includes('help-grid cols-'))
  check('help：条目含命令与说明', help.html.includes('entry-cmd') && help.html.includes('entry-desc'))
  check('help：说明文案来自配置', help.html.includes('只看无宏、无连点的记录'))
  check('help：页头只有插件名/标题/副标题（版本行按需求已移除）', help.html.includes('game-name') && !help.html.includes('page-meta'))
  check('help：不再铺旧插画底图', !help.html.includes('bg-help.jpg') && !help.html.includes('page-bg'))
  check('help：文字都落在深色内容条上', help.html.includes('head-card') && help.html.includes('body-card') && help.html.includes('foot-card'))
  check('help：不残留横幅版式的类名', !help.html.includes('page-hero') && !help.html.includes('sheet-head') && !help.html.includes('hero-body'))
  check('help：不残留浅色主题的蒙版令牌', !help.html.includes('page-veil') && !help.html.includes('row-veil'))
  check('help：不再渲染参数表/快速上手/示例块', !help.html.includes('help-args') && !help.html.includes('快速上手') && !help.html.includes('help-example'))
  // 尖括号 placeholder 会被 art-template 转义（实体形式随版本而异，两种都认）
  check('help：示例中的尖括号被转义而非当标签', /(&#60;|&lt;)UID(&#62;|&gt;)/.test(help.html))
}

// ---- 深色插画主题：配色只在 base.css 的变量块里，模板与共享组件不写死色值 ----
const baseCss = fs.readFileSync(path.join(pluginRoot, 'resources', 'common', 'base.css'), 'utf8')
const compCss = fs.readFileSync(path.join(pluginRoot, 'resources', 'common', 'components.css'), 'utf8')

check('主题底色为深色插画底', /--bg:\s*#101219/i.test(baseCss))
check('body 使用主题底色变量', /body\s*\{[\s\S]*?background-color:\s*var\(--bg\)/.test(baseCss))
const lightLeftovers = ['#ffffff', '#f7f7fb', '#eef1f7', '#1e2230', '#4c5265', '#144f96']
  .filter(c => (baseCss + compCss).toLowerCase().includes(c))
check('样式里没有残留的浅色主题色', lightLeftovers.length === 0, lightLeftovers.join(','))
const varUses = (compCss.match(/var\(--/g) || []).length
check('组件样式全部走变量着色', varUses >= 40, `${varUses} 处`)

const templateColors = []
for (const f of ['help.html', 'rank.html', 'raid.html', 'status.html']) {
  const text = fs.readFileSync(path.join(pluginRoot, 'resources', 'dps', f), 'utf8')
  const hits = text.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)
  if (hits) templateColors.push(`${f}:${hits.join('/')}`)
}
check('模板内不写死颜色（全部走变量）', templateColors.length === 0, templateColors.join(' | '))

// 练度面板整页由 miao-plugin 的模板渲染（apps/build.js → model/MiaoBridge.js），
// 所以本插件里既不该有它的模板，也不该有它的样式。
check('练度页不自绘模板/样式（整页交给 miao 的面板代码）', !fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'build.html')) &&
  !fs.existsSync(path.join(pluginRoot, 'resources', 'profile', 'panel.css')))
check('练度页底图已删除（面板自带立绘）', !fs.existsSync(path.join(pluginRoot, 'resources', 'common', 'bg-build.jpg')))
check('练度页渲染走 miao 的模板（本插件只提供数据）', fs.existsSync(path.join(pluginRoot, 'model', 'MiaoPanel.js')))

// ---- 字体：原神字体随包分发（不联网下载），数字走提瓦特数字 ----
check('声明了原神中文字体 YS（汉仪文黑）', /@font-face\s*\{[^}]*font-family:\s*'YS'/s.test(baseCss))
check('声明了提瓦特数字字体 Number', /@font-face\s*\{[^}]*font-family:\s*'Number'/s.test(baseCss))
check('字体栈让数字优先命中 Number', /font-family:\s*'Number',\s*'YS'/.test(baseCss), baseCss.match(/font-family:[^;]*/)?.[0] || '')

const fontUrls = [...baseCss.matchAll(/url\("(\.\/font\/[^"]+)"\)/g)].map(m => m[1])
check('base.css 引用了字体文件', fontUrls.length >= 2, fontUrls.join(','))
const missingFonts = fontUrls.filter(u => !fs.existsSync(path.join(pluginRoot, 'resources', 'common', u.replace('./', ''))))
check('引用的字体文件都在仓库里', missingFonts.length === 0, missingFonts.join(','))
check('字体文件非空（>1KB）', fontUrls.every(u => {
  const p = path.join(pluginRoot, 'resources', 'common', u.replace('./', ''))
  return fs.existsSync(p) && fs.statSync(p).size > 1024
}))

const fontHardcode = []
for (const f of ['help.html', 'rank.html', 'raid.html', 'status.html']) {
  const text = fs.readFileSync(path.join(pluginRoot, 'resources', 'dps', f), 'utf8')
  if (/font-family/.test(text)) fontHardcode.push(f)
}
check('模板不硬编码字体（统一由 base.css 决定）', fontHardcode.length === 0, fontHardcode.join(','))

// ---- 原先的整页插画底图已移除（2026-10-15 用户定；新的底图/模糊主题另行设计） ----
const renderedPages = { rank, raid, status, help }
for (const [name, page] of Object.entries(renderedPages)) {
  check(`${name}：不再铺旧插画底图`, Boolean(page.html) && !/bg-(rank|raid|status|help)\.jpg/.test(page.html) && !page.html.includes('class="page-bg"'))
}

// ---- 渲染缩放：由配置注入模板（调用方传的值不生效，避免绕过配置） ----
const scaled = await renderOnce('rank', { ...rankData, renderScale: 2 }, 'test-rank-scale')
check('模板 body 上的 zoom 来自配置', /zoom:\s*1\.5/.test(scaled.html), scaled.html.match(/zoom:[^"]*/)?.[0] || scaled.err)

// ---- 产物落盘（便于人工看效果） ----
check('渲染产物已保存到 test/.test-tmp/render/', fs.readdirSync(outDir).length >= 4, fs.readdirSync(outDir).join(','))

// 清理：只删本次创建的假立绘，不动真实缓存
if (!hadAvatar) {
  try {
    fs.rmSync(avatarFile, { force: true })
  } catch { /* 忽略 */ }
}

finish()