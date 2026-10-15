/**
 * 攻略页渲染回退 —— **行为层**断言（2026-10-15 复核后重写）
 *
 * 复核点（原套件只查源码正则，所以"错参渲染"能在它全绿时成立）：
 *  1. `retType` 属于框架 `runtime.render(plugin, path, data, cfg)` 的**第 4 参**；
 *     放到第 3 参会被忽略 → 框架自己发图并返回 `true` → 插件再回文本 = 图文双回复。
 *  2. 本版 TRSS 的 `puppeteer.screenshot` 返回的是**图片消息段**（`segment.image(...)`），
 *     不是 base64 字符串 —— 拿到段必须直接发送。
 *  3. 只有真拿到图才 `return true`；拿不到（空/极短/异常/缺 runtime/缺模板）一律 `false`，
 *     交给调用方走同源文本，绝不"既不发图也不回退"。
 *
 * 实现方式：直接 import 编译产物 `lib/components/render.js`，用假事件驱动**真实代码路径**
 * （模板用仓库里真实存在的 `resources/codex/codex.html`）。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot } from './_helper.mjs'

const { ok, report } = createChecks('攻略页渲染回退（行为）')

// Windows 绝对路径必须先转成 file:// URL，ESM 的 default loader 不接受裸盘符
const { renderPage } = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'components', 'render.js')).href)

const seg = (src) => ({ type: 'image', file: src })
globalThis.segment = { image: seg }

/** 假事件：记录 runtime.render 的实参与 e.reply 收到的消息 */
function fakeEvent (impl) {
  const calls = { render: [], reply: [] }
  const e = {
    runtime: {
      render: async (...args) => {
        calls.render.push(args)
        return await impl(...args)
      }
    },
    reply: async (msg) => {
      calls.reply.push(msg)
      return true
    }
  }
  return { e, calls }
}

// ① 框架返回图片消息段（本版真实行为）
{
  const image = seg('base64://abc')
  const { e, calls } = fakeEvent(async () => image)
  const ret = await renderPage(e, 'codex', {}, { app: 'codex' })
  ok('① 消息段 → 直接发送、返回 true、只发一次', ret === true && calls.reply.length === 1 && calls.reply[0] === image)
  ok('① retType 在第 4 参 cfg，且不在第 3 参 data 里', calls.render[0]?.[3]?.retType === 'base64' && calls.render[0]?.[2]?.retType === undefined)
}

// ② 兼容层返回 base64 字符串 → 自己包成图片段发送
{
  const b64 = 'A'.repeat(128)
  const { e, calls } = fakeEvent(async () => b64)
  const ret = await renderPage(e, 'codex', {}, { app: 'codex' })
  ok('② base64 字符串 → 包成 segment.image 后发送并返回 true', ret === true && calls.reply.length === 1 && calls.reply[0]?.file === `base64://${b64}`)
}

// ③ 兼容层返回 `{ base64 }` 对象
{
  const b64 = 'B'.repeat(128)
  const { e, calls } = fakeEvent(async () => ({ base64: b64 }))
  const ret = await renderPage(e, 'codex', {}, { app: 'codex' })
  ok('③ { base64 } 对象 → 同样发图', ret === true && calls.reply[0]?.file === `base64://${b64}`)
}

// ④ 框架自己已发图（返回 true）→ 视为成功，绝不再补一条文本
{
  const { e, calls } = fakeEvent(async () => true)
  const ret = await renderPage(e, 'codex', {}, { app: 'codex' })
  ok('④ 返回 true（框架已发图）→ 成功且不重复发送', ret === true && calls.reply.length === 0)
}

// ⑤ 拿不到图（false / undefined / 空串 / 极短串）→ 一律 false，不进文本
for (const [name, value] of [['false', false], ['undefined', undefined], ['空串', ''], ['极短串', 'abc'], ['空对象', {}]]) {
  const { e, calls } = fakeEvent(async () => value)
  const ret = await renderPage(e, 'codex', {}, { app: 'codex' })
  ok(`⑤ ${name} → 返回 false 且不发送`, ret === false && calls.reply.length === 0)
}

// ⑥ 截图管线抛错 → 也按"拿不到图"处理
{
  const { e, calls } = fakeEvent(async () => { throw new Error('boom') })
  const ret = await renderPage(e, 'codex', {}, { app: 'codex' })
  ok('⑥ 渲染抛错 → 返回 false（交回退）且不发送', ret === false && calls.reply.length === 0)
}

// ⑦ 缺 runtime / 缺模板 → false，且不去调框架
{
  const e = { reply: async () => true }
  ok('⑦ 缺少 e.runtime.render → false', (await renderPage(e, 'codex', {}, { app: 'codex' })) === false)
  const { e: e2, calls } = fakeEvent(async () => seg('x'))
  ok('⑦ 模板不存在 → false 且不调用框架渲染', (await renderPage(e2, 'does-not-exist', {}, { app: 'codex' })) === false && calls.render.length === 0)
}

const bad = report()
process.exit(bad ? 1 : 0)
