/**
 * 编辑器「真实页面」渲染 —— **只出 HTML 字符串**，不截图、不写文件、不改数据
 *
 * 为什么需要这一层：编辑器原来的预览走 `build-html.mjs` + `templates/guide.html`
 * （维护者流水线的网页外壳），而 bot 实发的是 `resources/codex/codex.html`
 * （六模块新结构 + `mx.sections` 投影）。两套渲染 → 「编辑器里看到的」和「bot 发出来的」不是一张图。
 *
 * 这里把 bot 的那一套**原样复用**，链路与 `src/apps/codex.ts` 的 `replyPage` 一致：
 *
 *   data/gi/<角色>.json ──► 编译产物 lib/ 的投影 ──► art-template 渲染 codex.html
 *                          buildCodexView
 *                          withIcons
 *                          toPageData（+ signature / weaponTags / portrait / element）
 *
 * 依赖（缺任一项就返回 `{ ok:false, reason }`，由界面降级到简化卡，**不抛错**）：
 *   - `<插件根>/lib/**`：已入库的编译产物（插件不带 node_modules，故只能用它）
 *   - `<bot根>/node_modules` 的 `art-template`：框架依赖，插件不自带
 *   - miao 资源目录：**可选**，缺了只是没有立绘与 miao 的字体 / 图标
 *
 * 资源路径：模板里的 `_res_path` / `_miao_path` 会被重写成编辑器自己的只读路由
 * （默认 `/preview/res/`、`/preview/miao/`），这样 iframe 里 CSS 与图片才加载得出来。
 *
 * ⚠ 本文件**只在维护者机上有意义**（需要 bot），不参与 `pnpm build`，也不进 55 套。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** bot 根探测结果（`null` = 没有可用 bot；`undefined` = 还没探测过） */
let botRootCache
/** 解析好的依赖（art-template + lib 模块 + 常量） */
let depsCache = null

/** 读 JSON，坏文件 / 缺文件一律回落到默认值（编辑器正在编辑中，不允许因此崩预览） */
function readJson (file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 某个目录能不能当 bot 根用（有 package.json，且 art-template 解析得出来） */
function usableBotRoot (dir) {
  if (!dir) return false
  try {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return false
    createRequire(path.join(dir, 'package.json'))('art-template')
    return true
  } catch {
    return false
  }
}

/**
 * 找 bot 根
 *
 * 顺序（第一个能用的胜出）：
 *   ① 显式提示（编辑器 `--bot <路径>`）
 *   ② 环境变量 `META_BOT_ROOT`
 *   ③ **部署副本布局**：`<bot根>/plugins/Meta-Plugin` → 向上两级
 *   ④ 上次记住的路径（`out/.bot-root`，`out/` 未跟踪；只在开发工作区才有意义）
 *
 * 每个候选都要过 `usableBotRoot`（有 package.json 且 art-template 解析得出来），
 * 避免「目录存在但其实不是 bot」这种误判。
 *
 * @param {string} pluginRoot 插件根
 * @param {string} [hint] 显式提示（`--bot`）
 * @returns {string|null}
 */
export function resolveBotRoot (pluginRoot, hint = '') {
  const key = `${pluginRoot}\u0000${hint}`
  if (botRootCache && botRootCache.key === key) return botRootCache.value

  const remembered = (() => {
    try {
      return fs.readFileSync(path.join(pluginRoot, 'out', '.bot-root'), 'utf8').trim()
    } catch {
      return ''
    }
  })()

  const candidates = [
    hint,
    process.env.META_BOT_ROOT,
    path.resolve(pluginRoot, '..', '..'),
    remembered
  ].map(s => String(s || '').trim()).filter(Boolean)

  for (const dir of candidates) {
    if (usableBotRoot(dir)) {
      botRootCache = { key, value: path.resolve(dir) }
      return botRootCache.value
    }
  }
  botRootCache = { key, value: null }
  return null
}

/** miao 资源目录（`<bot根>/plugins/miao-plugin/resources`）；没有就 null */
export function miaoResourcesDir (botRoot) {
  if (!botRoot) return null
  const dir = path.join(botRoot, 'plugins', 'miao-plugin', 'resources')
  try {
    return fs.statSync(dir).isDirectory() ? dir : null
  } catch {
    return null
  }
}

/** 惰性加载渲染依赖（失败抛错，由 renderCodexPage 统一转成 reason） */
async function loadDeps (pluginRoot, botRoot) {
  if (depsCache) return depsCache
  /*
   * ⚠ 必须在 import 编译产物**之前**把资源目录喂给它们：
   * `lib/model/MiaoRes.js` / `AtlasRes.js` 默认按 `<bot根>/plugins/...` 找（由 `lib/dir.js` 的
   * `pluginRoot/../..` 推算），而开发工作区不在 bot 下面 → 图标与立绘会全部解析成 null。
   * 这三个环境变量是插件本来就有的覆盖口（回归套件也用它），这里沿用，不改 lib 的行为。
   */
  const miaoPlugin = path.join(botRoot, 'plugins', 'miao-plugin')
  if (!process.env.META_MIAO_DIR && fs.existsSync(path.join(miaoPlugin, 'resources'))) process.env.META_MIAO_DIR = miaoPlugin
  if (!process.env.META_MIAO_PLUGIN && fs.existsSync(miaoPlugin)) process.env.META_MIAO_PLUGIN = miaoPlugin
  const atlasPlugin = path.join(botRoot, 'plugins', 'Atlas-Plugin')
  if (!process.env.META_ATLAS_DIR && fs.existsSync(atlasPlugin)) process.env.META_ATLAS_DIR = atlasPlugin

  const require = createRequire(path.join(botRoot, 'package.json'))
  const template = require('art-template')
  if (typeof template?.render !== 'function') throw new Error('art-template 不可用（没有 render 方法）')

  const lib = p => import(pathToFileURL(path.join(pluginRoot, 'lib', p)).href)
  const subViews = await lib('modules/subViews.js')
  const charIndex = await lib('model/CharacterIndex.js')
  const profileImg = await lib('model/ProfileImgRes.js')
  const constants = await lib('components/constants.js')

  const tplFile = path.join(pluginRoot, 'resources', 'codex', 'codex.html')
  const html = fs.readFileSync(tplFile, 'utf8')

  depsCache = {
    template,
    html,
    tplFile,
    buildCodexView: subViews.buildCodexView,
    withIcons: subViews.withIcons,
    toPageData: subViews.toPageData,
    pickPagePortrait: profileImg.pickPagePortrait,
    findCharacter: charIndex.findCharacter,
    resetIndexCache: charIndex.resetCache,
    copyright: constants.COPYRIGHT ?? ''
  }
  return depsCache
}

/**
 * 渲染 bot 实发的攻略页
 *
 * @param {object} opts
 * @param {string} opts.pluginRoot 插件根
 * @param {string} opts.name 角色名
 * @param {object} opts.character 角色 JSON（编辑器当前表单：`buildCharacter()` 的结果）
 * @param {string} [opts.resRoute] 本插件 resources 的 HTTP 前缀（末尾带 `/`）
 * @param {string} [opts.miaoRoute] miao resources 的 HTTP 前缀（末尾带 `/`）
 * @param {number} [opts.renderScale] 缩放（与 bot 的 `renderScale` 配置同义，默认 1.5）
 * @returns {Promise<{ok: true, html: string} | {ok: false, reason: string}>}
 */
export async function renderCodexPage (opts = {}) {
  const pluginRoot = path.resolve(opts.pluginRoot || path.join(process.cwd()))
  const name = String(opts.name || '').trim()
  const character = opts.character
  const resRoute = opts.resRoute || '/preview/res/'
  const miaoRoute = opts.miaoRoute || '/preview/miao/'

  try {
    if (!name) throw new Error('缺少角色名')
    if (!character || typeof character !== 'object') throw new Error('缺少角色数据')

    const botRoot = resolveBotRoot(pluginRoot, opts.botRootHint || '')
    if (!botRoot) {
      throw new Error('找不到 bot 根（缺 art-template）：设环境变量 META_BOT_ROOT，或把编辑器放进 bot 的 plugins/ 下')
    }
    const deps = await loadDeps(pluginRoot, botRoot)

    // 专武表 / 武器标签表：每次现读 —— 编辑器正在改 `data/`，不能吃 CodexStore 的进程内缓存
    const giDir = path.join(pluginRoot, 'data', 'gi')
    const signature = readJson(path.join(giDir, '_signature.json'), {})?.[name] ?? null
    const weaponTags = readJson(path.join(giDir, '_weapon-tags.json'), {})

    const view = deps.buildCodexView(character, { signature, weaponTags })
    if (!view) throw new Error('投影返回空（数据形状不对？）')

    // 图标解析依赖 miao / Atlas 资源；解析失败不该让整个预览失败，退回无图标视图
    let iconView = view
    try {
      iconView = deps.withIcons(view, { character: name })
    } catch { /* 无图标版本可用 */ }

    // 元素取自本插件角色表（miao 的 characterElement 在只装了插件的情况下会返回 null）
    let element = ''
    try {
      deps.resetIndexCache()
      element = String(deps.findCharacter(name)?.element ?? '').toLowerCase()
    } catch { /* 取不到就交给页面默认样式 */ }

    /*
     * 立绘：与 bot 同一条口径 —— 图库优先，只接受不小于默认立绘的图；
     * `ratio` 是默认立绘宽高比，模板用它给立绘框定高、`object-fit: cover` 裁满。
     */
    let portraitSrc = ''
    let portraitRatio = ''
    let portraitBox = { width: '', height: '', left: '', top: '' }
    let portraitNote = ''
    try {
      const hero = deps.pickPagePortrait(name, { renderScale: Number(opts.renderScale) || 1.5 })
      portraitSrc = hero.src || ''
      portraitRatio = hero.ratio || ''
      portraitBox = hero.box || portraitBox
      portraitNote = hero.note || ''
    } catch { /* 没有立绘就空着，模板里 `{{if portraitSrc}}` 会跳过 */ }

    const page = deps.toPageData(iconView, {
      copyright: deps.copyright,
      renderScale: Number(opts.renderScale) || 1.5,
      portraitSrc,
      portraitRatio,
      portraitBox,
      element,
      subTitle: '角色攻略'
    })

    const miaoDir = miaoResourcesDir(botRoot) || ''
    const layoutDir = path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'common', 'layout')

    const html = deps.template.render(deps.html, {
      ...page,
      // 与框架 runtime.render 注入的同名变量保持一致（模板可能用到任何一个）
      sys: { scale: 1 },
      _res_path: resRoute,
      _miao_path: miaoRoute,
      _tpl_path: path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'common', 'tpl') + path.sep,
      defaultLayout: path.join(layoutDir, 'default.html'),
      elemLayout: path.join(layoutDir, 'elem.html'),
      pluResPath: resRoute,
      _plugin: 'Meta-Plugin',
      _htmlPath: 'codex/codex',
      saveId: 'preview',
      tplFile: deps.tplFile
    })

    if (/\{\{|\}\}/.test(html)) throw new Error('渲染结果里仍有模板占位符（art-template 行为异常？）')
    return { ok: true, html, miaoDir }
  } catch (err) {
    return { ok: false, reason: (err && err.message) || String(err) }
  }
}
