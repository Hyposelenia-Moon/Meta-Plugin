/**
 * 渲染静态契约（2026-10-15 审核 P2 #14）
 *
 * 审核点：`render-templates.test.mjs` 仍 import 已删除的 `modules/buildQuery.js` / `model/EnkaClient.js`，
 * 且开发环境**先整条跳过**，把这些错误一起掩盖了。
 *
 * 本套件专做**不需要浏览器**的契约检查，任何环境都会运行：
 *  1. 渲染套件引用的模块是否都存在（防再次引入失效路径）；
 *  2. 模板文件与占位符语法；
 *  3. `components/render.ts` 的模板/资源路径层级与回退契约。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('渲染静态契约')

const suiteSrc = readText(path.join(pluginRoot, 'test', 'render-templates.test.mjs'))

// ---------- 1. 渲染套件不得引用不存在的模块 ----------
{
  const refs = [...suiteSrc.matchAll(/mod\('([^']+)'\)/g)].map(m => m[1])
  const missing = refs.filter(rel => rel.startsWith('resources/') ? !fs.existsSync(path.join(pluginRoot, rel)) : !fs.existsSync(path.join(libDir, rel)))
  push('渲染套件引用的模块都存在', missing, [])
  ok('渲染套件不再 import 已删除模块', !/buildQuery\.js|EnkaClient\.js/.test(suiteSrc))
  ok('渲染套件引用当前模块（subViews / CodexStore 等）', refs.length > 0 && refs.every(r => !/^(modules\/buildQuery|model\/EnkaClient)/.test(r)))
  ok('前置检查不再静默退出（记录跳过并打印汇总）', /recordSkip\(/.test(suiteSrc) && /renderEnvIssues\(\)/.test(suiteSrc) && /finish\(\)/.test(suiteSrc))
}

// ---------- 2. 模板与占位符 ----------
{
  const tplDir = path.join(pluginRoot, 'resources', 'dps')
  const tpls = fs.readdirSync(tplDir).filter(f => f.endsWith('.html'))
  ok('dps 模板齐备', tpls.length >= 4, `${tpls.length} 个`)
  // 源码模板里允许 `{{...}}`（运行时替换），但不得出现未闭合的花括号
  const unbalanced = tpls.filter(f => {
    const text = fs.readFileSync(path.join(tplDir, f), 'utf8')
    return (text.match(/\{\{/g) || []).length !== (text.match(/\}\}/g) || []).length
  })
  push('模板里花括号成对（无残留半截占位符）', unbalanced, [])
  const helpDir = path.join(pluginRoot, 'resources', 'help')
  const helpTpls = fs.existsSync(helpDir) ? fs.readdirSync(helpDir).filter(f => f.endsWith('.html')) : []
  ok('帮助页资源存在（模板或配置）', helpTpls.length > 0 || fs.existsSync(path.join(helpDir, 'help-cfg.js')), helpTpls.join(',') || 'help-cfg.js')
}

// ---------- 3. render.ts 的路径与回退契约 ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'components', 'render.ts'))
  ok('模板路径以本插件 resources 为根', /path\.join\(resourcesDir, app, `\$\{tpl\}\.html`\)/.test(src))
  ok('模板缺失时返回 false（不静默）', /攻略页模板不存在/.test(src))
  ok('截图失败返回 false 交文本回退', /retType: 'base64'/.test(src) && /if \(b64\.length < 64\)/.test(src))
  push('框架 import 仍是四层相对路径', (src.match(/\.\.\/\.\.\/\.\.\/\.\.\/lib\//g) || []).filter((v, i, a) => a.indexOf(v) === i).length > 0 ? [] : ['缺少四层 ../ 的框架 import'], [])
}

const bad = report()
process.exit(bad ? 1 : 0)