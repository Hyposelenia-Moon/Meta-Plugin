/**
 * 帮助配置自检（阶段 0.2）
 *
 * 规则来自设计文档 §8：帮助图是「分组标题条 + 三列网格」，每项**只有** title / desc 两个字段；
 * title 写成可直接照抄的「命令 + 用法」，desc 压成一行。
 *
 * 用动态 import 读 `resources/help/help-cfg.js`（它就是 ESM），保证测的是运行时真正加载的那份。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const cfgFile = path.join(pluginRoot, 'resources', 'help', 'help-cfg.js')
const { push, ok, report } = createChecks('帮助配置（resources/help/help-cfg.js）')

if (!fs.existsSync(cfgFile)) {
  console.log('✗ 缺少 resources/help/help-cfg.js')
  process.exit(1)
}

const mod = await import(pathToFileURL(cfgFile).href)
const { helpCfg, helpList } = mod

push('导出 helpCfg', typeof helpCfg, 'object')
push('导出 helpList', Array.isArray(helpList), true)

if (helpCfg && typeof helpCfg === 'object') {
  ok('helpCfg.title 是 # 开头的命令', typeof helpCfg.title === 'string' && helpCfg.title.startsWith('#'))
  ok('helpCfg.subTitle 非空', typeof helpCfg.subTitle === 'string' && helpCfg.subTitle.length > 0)
  if (helpCfg.note !== undefined) {
    ok('helpCfg.note 是单行文本', typeof helpCfg.note === 'string' && !helpCfg.note.includes('\n'))
  }
}

if (Array.isArray(helpList)) {
  ok('分组数 ≥ 2', helpList.length >= 2)

  const groupNames = []
  const titleSeen = new Map()
  const badKeys = []
  const badTitle = []
  const badDesc = []
  const dupTitles = []
  let itemCount = 0

  for (const group of helpList) {
    const name = group && group.group
    if (typeof name !== 'string' || !name.length) {
      badKeys.push(`分组缺 group 字段：${JSON.stringify(group)}`)
      continue
    }
    groupNames.push(name)
    if (!Array.isArray(group.list) || !group.list.length) {
      badKeys.push(`分组「${name}」的 list 为空`)
      continue
    }
    for (const item of group.list) {
      itemCount++
      const keys = Object.keys(item || {}).sort()
      if (keys.join(',') !== 'desc,title') badKeys.push(`「${name}」项字段异常：${keys.join(',') || '(空)'}`)
      const title = item && item.title
      if (typeof title !== 'string' || !title.startsWith('#')) badTitle.push(`${name} / ${title}`)
      if (titleSeen.has(title)) dupTitles.push(`${title}（${titleSeen.get(title)} 与 ${name}）`)
      else titleSeen.set(title, name)
      const desc = item && item.desc
      if (typeof desc !== 'string' || !desc.length || desc.includes('\n')) badDesc.push(`${name} / ${title}`)
    }
  }

  push('每项只有 title / desc 字段', badKeys, [])
  push('每项 title 以 # 开头', badTitle, [])
  push('每项 desc 非空且单行', badDesc, [])
  push('title 全局不重复', dupTitles, [])
  ok('指令项数 ≥ 6', itemCount >= 6)
  ok('分组名不重复', new Set(groupNames).size === groupNames.length)
}

// 模板侧：帮助页模板必须存在，且引用了 base/components 两个公共样式
const tplFile = path.join(pluginRoot, 'resources', 'codex', 'help.html')
ok('resources/codex/help.html 存在', fs.existsSync(tplFile))
if (fs.existsSync(tplFile)) {
  const tpl = readText(tplFile)
  ok('模板引用 common/base.css', tpl.includes('/common/base.css'))
  ok('模板引用 common/components.css', tpl.includes('/common/components.css'))
  ok('模板含三列网格 .help-grid', tpl.includes('class="help-grid'))
  ok('模板通过 {{_res_path}} 取资源前缀', tpl.includes('{{_res_path}}'))
  ok('模板使用 helpGroup 循环', tpl.includes('{{each helpGroup'))
}

// 公共样式必须已就位（阶段 4 会补 bg-*.jpg 与 font/）
for (const rel of ['common/base.css', 'common/components.css']) {
  const f = path.join(pluginRoot, 'resources', rel)
  ok(`resources/${rel} 存在`, fs.existsSync(f))
}

const bad = report()
process.exit(bad ? 1 : 0)
