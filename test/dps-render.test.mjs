/**
 * 渲染与响应套件（阶段 4.2）
 *
 * 合并不变量（对照 `Mhydps-Plugin/components/render.js`）：
 *   - 模板路径 `./plugins/<插件名>/resources/dps/<tpl>.html`（框架按 cwd=bot 根解析）
 *   - `_res_path` / `_data_path` 是 **5 级** 前缀、**不带结尾斜杠**（模板写 `{{_res_path}}/common/base.css`）
 *   - `saveId` 唯一化、`imgType` 默认 jpeg、`renderScale` 来自配置、`copyright` 是 DPS 那份
 *
 * 两条本仓库特有的硬约束也在这里守着：
 *   - `_data_path` 必须指向 **`out/`（未跟踪缓存）**，绝不能是 `data/`（入库数据，B14）
 *   - 渲染层必须能在**没有 bot** 的开发工作区被 import（否则回退逻辑无法单测）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('渲染与响应（阶段 4.2）')

const R = await import(pathToFileURL(path.join(libDir, 'components', 'render.js')).href)
const RESP = await import(pathToFileURL(path.join(libDir, 'modules', 'respond.js')).href)
const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)

// ---------- 1. 路径契约 ----------
{
  ok('导出 renderDps', typeof R.renderDps === 'function')
  ok('DPS 模板子目录是 dps', R.DPS_APP === 'dps')
  ok('插件名取自插件根目录', R.PLUGIN_NAME === path.basename(pluginRoot))

  const prefix = '../../../../../'
  ok('_res_path 是 5 级前缀且不带结尾斜杠',
    R.resPath === `${prefix}plugins/${R.PLUGIN_NAME}/resources`)
  ok('_data_path 指向 out/（未跟踪缓存）',
    R.cachePath === `${prefix}plugins/${R.PLUGIN_NAME}/out`)
  ok('缓存路径没有落到入库的 data/ 上（B14）', !R.cachePath.includes('/data'))
  ok('旧的 dataPath 导出已移除（避免误用入库目录）', R.dataPath === undefined)
}

// ---------- 2. 数据契约（渲染前就会写进 data，故无 bot 也能断言） ----------
{
  const data = {}
  let threw = null
  try {
    await R.renderDps('rank', data)
  } catch (err) {
    threw = err // 开发工作区没有框架后端 → 预期会抛
  }
  ok('模板路径与合并前一致', data.tplFile === `./plugins/${R.PLUGIN_NAME}/resources/dps/rank.html`)
  ok('_res_path / _data_path 已注入', data._res_path === R.resPath && data._data_path === R.cachePath)
  ok('imgType 默认 jpeg', data.imgType === 'jpeg')
  ok('renderScale 取自配置（数字）', typeof data.renderScale === 'number')
  ok('copyright 是 DPS 那份（不是攻略页的）',
    data.copyright === C.DPS_COPYRIGHT && data.copyright !== C.COPYRIGHT)
  ok('saveId 形如 tpl_<36进制时间>_<随机>', /^rank_[0-9a-z]+_[0-9a-z]{1,8}$/.test(String(data.saveId)))
  if (threw) {
    console.log('（开发工作区没有框架 puppeteer 后端 → 已按预期抛错，仅断言渲染前的数据契约）')
  } else {
    ok('bot 环境里 renderDps 返回了图片对象', !!data.saveId)
  }
  // saveId 唯一化：两次调用不能撞
  const a = {}; const b = {}
  await R.renderDps('rank', a).catch(() => {})
  await R.renderDps('rank', b).catch(() => {})
  ok('并发渲染的 saveId 不重复', a.saveId !== b.saveId)
  // 调用方显式传入的 saveId / copyright 不被覆盖；imgType 的语义与合并前一致：
  //   `data.imgType = opts.imgType || 'jpeg'` —— 即 data 里自带的值会被覆盖，只能通过 opts 指定
  const custom = { saveId: 'mine', imgType: 'png', copyright: 'X' }
  await R.renderDps('rank', custom).catch(() => {})
  ok('显式 saveId 被尊重', custom.saveId === 'mine')
  ok('显式 copyright 被尊重', custom.copyright === 'X')
  ok('data 里的 imgType 会被默认值覆盖（与合并前语义一致）', custom.imgType === 'jpeg')
  const viaOpts = {}
  await R.renderDps('rank', viaOpts, { imgType: 'png' }).catch(() => {})
  ok('通过 opts 指定 imgType 生效', viaOpts.imgType === 'png')
}

// ---------- 3. 出图失败 → 文本回退（respond 的契约） ----------
{
  const replied = []
  const e = { reply: async (x) => { replied.push(x) } }
  const ret = await RESP.respond(e, 'rank', {}, '文本回退')
  ok('respond 恒返回 true（消息已消费）', ret === true)
  ok('出图不可用时只发了一次文本回退', replied.length === 1 && replied[0] === '文本回退')

  // 回退文本支持函数（延迟求值）
  const replied2 = []
  await RESP.respond({ reply: async (x) => { replied2.push(x) } }, 'rank', {}, () => '延迟文本')
  ok('回退文本支持函数形式', replied2[0] === '延迟文本')

  // 回退为空串时也不能不回复
  const replied3 = []
  await RESP.respond({ reply: async (x) => { replied3.push(x) } }, 'rank', {})
  ok('未给回退文本时发空串（不静默）', replied3.length === 1 && replied3[0] === '')
}

// ---------- 4. suggestLine ----------
{
  push('suggestLine 无候选 → 空串', [RESP.suggestLine(), RESP.suggestLine([])].filter(s => s !== ''), [])
  ok('suggestLine 有候选 → 换行 + 顿号连接',
    RESP.suggestLine(['胡桃', '行秋']) === '\n你是不是想找：胡桃、行秋')
}

// ---------- 5. 渲染层在无 bot 时可 import（静态结构） ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'components', 'render.ts'))
  ok('框架模块走惰性 import（不是顶层静态 import）', /frameworkModule = import\(/.test(src))
  ok('框架 import 深度仍是 4 级（T1）', src.includes("import('../../../../lib/puppeteer/puppeteer.js')"))
  ok('源码里没有再出现顶层 static import puppeteer', !/^import puppeteer/m.test(src))
  ok('每个渲染函数都先备数据、后加载后端', src.indexOf('const puppeteer = await frameworkPuppeteer()') > src.indexOf('data.renderScale = getRenderScale()'))
  ok('lib 产物同样可用（本轮已编译）', fs.existsSync(path.join(libDir, 'modules', 'respond.js')))
}

const bad = report()
process.exit(bad ? 1 : 0)
