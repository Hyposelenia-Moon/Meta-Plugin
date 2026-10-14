/**
 * 攻略页渲染失败必须回退文本（2026-10-15 审核 P2 #10）
 *
 * 审核点：TRSS 的默认 render 即使截图失败、什么都没发也返回 true，
 * 插件直接把该值当"已发送" → 可能既不发图也不回退文本。
 *
 * 开发工作区不能启动真实浏览器（审核也只在契约层核对过），所以这里做：
 *  1. 行为层 —— 复现"接受阈值"的判定（空/极短结果一律不算图）；
 *  2. 结构层 —— 断言改用 retType base64、确认有图才发送、失败返回 false 交回退，
 *     以及模板缺失 / miao 布局缺失 / 缺少 runtime 三个分支的既有处理没被破坏。
 */
import path from 'node:path'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('攻略页渲染回退')

// ---------- 1. 行为层：图像接受阈值 ----------
const accept = (rendered) => {
  const b64 = typeof rendered === 'string' ? rendered : String(rendered?.base64 || '')
  return b64.length >= 64
}
ok('截图失败（false/undefined/null）不算有图', !accept(false) && !accept(undefined) && !accept(null))
ok('空串/极短串不算有图', !accept('') && !accept('abc'))
ok('对象里没有 base64 字段不算有图', !accept({}) && !accept({ data: 'x'.repeat(200) }))
ok('足够长的 base64 字符串算有图', accept('A'.repeat(64)) && accept({ base64: 'A'.repeat(100) }))

// ---------- 2. 结构层 ----------
const src = readText(path.join(pluginRoot, 'src', 'components', 'render.ts'))
ok('改用 retType: base64 取真实截图结果', /retType: 'base64'/.test(src))
ok('确认有图后才发送（reply + segment.image）', /segment\.image\(`base64:\/\/\$\{b64\}`\)/.test(src) && /reply\.call\(e, segment\.image/.test(src))
ok('拿不到图返回 false（交给文本回退）', /if \(b64\.length < 64\) \{[\s\S]{0,200}return false/.test(src))
ok('缺少 segment/reply 也回退而不是静默', /缺少 segment\.image \/ e\.reply，无法发送攻略页截图/.test(src))
ok('模板不存在时返回 false（保留既有兜底）', /攻略页模板不存在/.test(src) && /return false/.test(src))
ok('miao 布局缺失只告警、不影响出图', /未找到 miao 布局/.test(src) && !/未找到 miao 布局[\s\S]{0,80}return false/.test(src))
ok('缺少 runtime.render 时返回 false', /缺少 e\.runtime\.render/.test(src))
push('不再把 runtime.render 的返回值直接当已发送', src.match(/return await runtime\.render\(/g) || [], [])

const bad = report()
process.exit(bad ? 1 : 0)