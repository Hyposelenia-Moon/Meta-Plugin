/**
 * 渲染：把 `resources/<app>/<tpl>.html` 交给框架（puppeteer）截图
 *
 * 遵循框架约定（与 Mhydps-Plugin/components/render.js 同一套用法）：
 *   - `data.tplFile`：模板路径，框架按 cwd（bot 根）解析；
 *   - `data._res_path`：模板内 CSS/图片的前缀（渲染 HTML 落在 `temp/html/<插件名>/<app>/<tpl>/`）；
 *   - `data._data_path`：模板内引用随包数据的路径前缀（榜单头像等）；
 *   - `data.saveId`：唯一化，避免并发渲染同一模板时互相覆盖；
 *   - `data.renderScale`：缩放（框架渲染后端不暴露 DPR 旋钮，用 CSS zoom）。
 *
 * ⚠ T1（框架 import 深度）：运行时刻本文件位于 `<插件根>/lib/components/`，比 JS 插件**多一层**，
 *   到 bot 根需要 **四** 层 `../`；tsc **不会重写** import 路径。
 * ⚠ T2（tsc 解析不到框架文件）：框架模块在 bot 根、不在本工程内 → 用 `@ts-expect-error` 抑制，
 *   路径按"运行时刻在 `lib/` 下"来写。
 * 这两条由 `test/framework-path.test.mjs` 持续守着。
 */
import fs from 'node:fs'
import path from 'node:path'
import { botRoot, outDir, pluginRoot, resourcesDir } from '../dir.js'
import { COPYRIGHT, DPS_COPYRIGHT } from './constants.js'
import { getRenderScale } from './config.js'

/** 插件目录名（渲染资源路径与框架临时 HTML 路径都按它拼） */
export const PLUGIN_NAME = path.basename(pluginRoot)

/** miao 的布局文件（框架 runtime.js 注入的 `elemLayout` 就是它；缺失只丢样式，不影响出图） */
const MIAO_LAYOUT = path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'common', 'layout', 'elem.html')

/**
 * 渲染 HTML 距 bot 根的层级：
 * `<tpl>` → `<app>` → `<插件名>` → `html` → `temp` → bot 根，共 5 级
 */
const RES_PREFIX = '../../../../../'

/** 模板内资源路径前缀（模板里写 `{{_res_path}}/common/base.css`） */
export const resPath = `${RES_PREFIX}plugins/${PLUGIN_NAME}/resources`

/**
 * 模板内缓存路径前缀（模板里写 `{{_data_path}}/avatar/xxx.webp`）
 *
 * ⚠ 指向 **`out/`（未跟踪缓存）**，不是 `data/`：后者是本仓库**入库的攻略数据**，
 *   运行时刻写它会挡住 bot 侧的 `#更新`（设计文档 §13.1 B14）。
 */
export const cachePath = `${RES_PREFIX}plugins/${PLUGIN_NAME}/out`

/** 榜单 / 危战 / 状态 / 练度页的模板子目录 */
export const DPS_APP = 'dps'

type Screenshot = (name: string, data: Record<string, unknown>) => Promise<unknown>

/** 框架 puppeteer 后端的形状（静态 import 与 CJS 互操作都兼容） */
interface FrameworkPuppeteer {
  default?: { screenshot?: Screenshot }
  screenshot?: Screenshot
}

let frameworkModule: Promise<unknown> | null = null

/**
 * **惰性**加载框架的 puppeteer 后端
 *
 * 为什么用动态 import 而不是文件头的静态 import：
 *   静态 import 会让 `lib/components/render.js` 一被加载就去找 `<bot>/lib/puppeteer/puppeteer.js`，
 *   于是**开发工作区里任何套件都无法 import 渲染层**（路径不存在 → 模块加载即失败），
 *   回退逻辑也就没法单测。改成首次调用时再加载后：套件可以 import、可以驱动"出图失败走文本"的路径，
 *   而生产行为完全不变（首次调用一次解析，之后走模块缓存）。
 */
async function frameworkPuppeteer (): Promise<{ screenshot: Screenshot }> {
  if (!frameworkModule) {
    // @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见文件头 T1 / T2）
    frameworkModule = import('../../../../lib/puppeteer/puppeteer.js')
  }
  const mod = (await frameworkModule) as FrameworkPuppeteer
  const backend = (mod.default ?? mod) as { screenshot?: Screenshot }
  if (typeof backend?.screenshot !== 'function') {
    throw new Error('框架 puppeteer 后端不可用：没有 screenshot 方法')
  }
  return { screenshot: backend.screenshot.bind(backend) }
}

export interface RenderOptions {
  /** 模板子目录：`resources/<app>/<tpl>.html`，默认 `codex` */
  app?: string
  /** 图片格式，默认 jpeg */
  imgType?: string
}

/**
 * 渲染模板并截图
 *
 * @param tpl 模板名（对应 `resources/<app>/<tpl>.html`）
 * @param data 模板数据
 * @param opts 可选：模板子目录、图片格式
 * @returns 成功返回 segment.image 对象；失败返回 false
 */
export async function render (
  tpl: string,
  data: Record<string, unknown> = {},
  opts: RenderOptions = {}
): Promise<unknown | false> {
  const app = opts.app || 'codex'

  data._res_path = resPath
  data._data_path = cachePath
  data.tplFile = `./plugins/${PLUGIN_NAME}/resources/${app}/${tpl}.html`
  data.saveId = (data.saveId as string) ||
    `${tpl}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  data.imgType = opts.imgType || 'jpeg'
  data.renderScale = getRenderScale()

  // ⚠ 后端放在数据准备**之后**加载：加载失败（开发工作区没有 bot）时数据契约仍然可断言
  const puppeteer = await frameworkPuppeteer()
  const name = `${PLUGIN_NAME}/${app}/${tpl}`
  return await puppeteer.screenshot(name, data)
}

/**
 * 榜单 / 危战 / 状态 / 练度页的出图（合并自 `Mhydps-Plugin/components/render.js`，**逐字等价**）
 *
 * 与上面 `render()` 的差别仅在默认值：模板子目录固定 `dps`、版权行是 DPS 那一份
 * （两个数据源不同，页脚必须各自标注来源）。数据键与取值方式保持与合并前一致 ——
 * 模板里写的是 `{{_res_path}}/common/base.css`、`<body style="zoom:{{renderScale}}">`、
 * `{{_data_path}}/avatar/xxx.webp`、`{{copyright}}`，一个都不能改名。
 *
 * @param tpl 模板名（对应 `resources/dps/<tpl>.html`：`rank` / `raid` / `status` / `help`）
 * @param data 模板数据
 * @param opts 可选：图片格式（默认 jpeg）
 */
export async function renderDps (
  tpl: string,
  data: Record<string, unknown> = {},
  opts: { imgType?: string } = {}
): Promise<unknown | false> {
  data._res_path = resPath
  data._data_path = cachePath
  data.tplFile = `./plugins/${PLUGIN_NAME}/resources/${DPS_APP}/${tpl}.html`
  data.saveId = (data.saveId as string) ||
    `${tpl}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  data.imgType = opts.imgType || 'jpeg'
  data.renderScale = getRenderScale()
  if (data.copyright === undefined) data.copyright = DPS_COPYRIGHT

  // ⚠ 后端放在数据准备**之后**加载：加载失败（开发工作区没有 bot）时数据契约仍然可断言
  const puppeteer = await frameworkPuppeteer()
  const name = `${PLUGIN_NAME}/${DPS_APP}/${tpl}`
  return await puppeteer.screenshot(name, data)
}

/**
 * 走**框架的** `e.runtime.render`（与 miao-plugin 同一套渲染管线）
 *
 * 为什么攻略页要用它而不是上面的 `render()`：框架在 `<bot>/lib/plugins/runtime.js` 里为**所有插件**
 * 注入了 miao 的版式兼容变量 ——
 *   `_miao_path`（指向 `plugins/miao-plugin/resources/`）、
 *   `elemLayout` / `defaultLayout`（miao 的布局文件**绝对路径**）、`sys.scale`、`copyright`，
 *   而 `_res_path` 指向**本插件**的 resources。
 * 于是模板可以 `{{extend elemLayout}}` 继承 miao 的图鉴布局、直接引用 miao 的 CSS / 字体 / 图标，
 * **无需把 miao 的资产复制进本仓库**（也避免再分发它的第三方字体）。
 *
 * 前置：miao-plugin 必须已安装（本插件的必需依赖）。缺失时框架给出的路径会指向不存在的文件，
 * 页面会失去样式；状态页会显示资源来源，套件也会提示。
 */
export async function renderPage (
  e: YunzaiEvent,
  tpl: string,
  params: object = {},
  opts: { app?: string, copyright?: string } = {}
): Promise<unknown | false> {
  const app = opts.app || 'codex'
  const runtime = (e as unknown as {
    runtime?: {
      render?: (plugin: string, path: string, data: Record<string, unknown>) => Promise<unknown>
    }
  }).runtime

  if (!runtime || typeof runtime.render !== 'function') {
    logger?.error?.('[Meta] 缺少 e.runtime.render（框架过旧？），攻略页无法渲染')
    return false
  }

  // ⚠ 先自己检查模板是否存在：框架的 runtime.render 在「加载 html 错误」时**仍然返回 true**，
  // 只看返回值无法判断成败，于是"模板路径写错"会表现为**什么都不发**（连文本回落都不触发）。
  const tplFile = path.join(resourcesDir, app, `${tpl}.html`)
  if (!fs.existsSync(tplFile)) {
    logger?.error?.(`[Meta] 攻略页模板不存在：${tplFile}（app=${app}, tpl=${tpl}）`)
    return false
  }

  // miao 只在缺失时告警：页面会失去样式（`{{extend elemLayout}}` 指不到布局），但不影响出图
  if (!fs.existsSync(MIAO_LAYOUT)) {
    logger?.warn?.(`[Meta] 未找到 miao 布局（${MIAO_LAYOUT}）：攻略页会缺少样式，请确认 miao-plugin 已安装`)
  }

  return await runtime.render(PLUGIN_NAME, `${app}/${tpl}`, {
    ...params,
    copyright: opts.copyright ?? COPYRIGHT
    // ⚠ 不覆盖 `sys`：miao 的布局把 `{{sys.scale}}` 直接插在 `<body …>` 上（期望一个属性串），
    // 我们传数字会变成无效属性；页面缩放实际由 miao 的 CSS（`body{transform:scale(1.4)}`）决定。
    // 本插件的 `renderScale` 配置只作用于我们自己的模板（如帮助页 `style="zoom:{{renderScale}}"`）。
  } as Record<string, unknown>)
}
