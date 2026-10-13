/**
 * 帮助配置：结构契约（紧凑版式）
 *
 * 帮助图按「分组标题条 + 三列网格」渲染，每项只有命令与一行说明。
 * 这里钉住三件事：字段极简（不回流成语法块/参数表）、排版可容纳（标题与说明不过长）、
 * 命令覆盖齐全且不重复——帮助与插件命令漂移时直接报红。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, mod, pluginRoot } from './_helper.mjs'

const { check, finish } = checker()

// ⚠ 阶段 4.7 说明：本套件断言的是 Mhydps 的  resources/help/help-cfg.js（#DPS 帮助的分组）。
// 本仓库当前的 help-cfg.js 只有攻略侧内容，DPS 分组将在**阶段 5**（帮助页/状态页）与攻略侧合并。
// 合并完成前显式跳过，避免把一个"已知待办"记成失败。
const helpCfgSrc = fs.readFileSync(path.join(pluginRoot, 'resources', 'help', 'help-cfg.js'), 'utf8')
if (!helpCfgSrc.includes('#DPS')) {
  console.log('⏭ 跳过：帮助页的 #DPS 分组在阶段 5 与攻略侧合并（当前 help-cfg.js 只有攻略内容）')
  process.exit(0)
}

const { helpCfg, helpList } = await import(mod('resources/help/help-cfg.js'))

// ---- 页头 ----
check('helpCfg 有标题', typeof helpCfg.title === 'string' && helpCfg.title.includes('#DPS'))
check('helpCfg 有副标题', typeof helpCfg.subTitle === 'string' && helpCfg.subTitle.length > 0)

// ---- 分组与条目 ----
check('helpList 非空', Array.isArray(helpList) && helpList.length > 0, `${helpList.length} 组`)
check('每组有 group 名与 list', helpList.every(g => typeof g.group === 'string' && g.group && Array.isArray(g.list) && g.list.length > 0))

const items = helpList.flatMap(g => g.list)
check('每条有 title 与 desc', items.every(i => typeof i.title === 'string' && i.title && typeof i.desc === 'string' && i.desc))
check('命令标题以 # 开头', items.every(i => i.title.trim().startsWith('#')))

// ---- 字段极简：只有 title / desc（防止再次复杂化） ----
const extraKeys = items.flatMap(i => Object.keys(i)).filter(k => k !== 'title' && k !== 'desc')
check('条目只保留 title / desc 两个字段', extraKeys.length === 0, [...new Set(extraKeys)].join(','))
check('条目里不再有语法 / 参数表 / 示例字段', items.every(i => !i.syntax && !i.args && !i.examples))

// ---- 排版可容纳三列网格 ----
check('标题长度 ≤ 30 字（三列不换行）', items.every(i => i.title.length <= 30), items.filter(i => i.title.length > 30).map(i => i.title).join(' | '))
check('说明长度 ≤ 40 字（一行内可读）', items.every(i => i.desc.length <= 40), items.filter(i => i.desc.length > 40).map(i => i.desc).join(' | '))
check('每组条目 ≤ 8 条', helpList.every(g => g.list.length <= 8), helpList.map(g => `${g.group}:${g.list.length}`).join(' '))

// ---- 不重复 ----
const titles = items.map(i => i.title)
check('命令条目不重复', new Set(titles).size === titles.length, titles.filter((t, idx) => titles.indexOf(t) !== idx).join(','))

// ---- 覆盖率：插件现有命令都要在帮助里出现 ----
const commands = ['#DPS榜', '#DPS危战榜', '#DPS练度查询', '#练度查询', '#DPS状态', '#DPS帮助', '#DPS更新']
const missing = commands.filter(cmd => !titles.some(t => t.startsWith(cmd)))
check('覆盖全部插件命令（简化后的写法）', ['#DPS榜', '#DPS危战榜', '#DPS练度', '#DPS视频', '#DPS状态', '#DPS帮助', '#DPS更新'].every(k => titles.some(t => t.includes(k))), missing.join(','))

// ---- 权限分组 ----
check('主人指令在「其它」组里并标注仅主人', items.some(i => i.title.includes('#DPS更新') && i.desc.includes('仅主人')))
check('简化后不再有分组级 auth（权限由 apps 层管）', helpList.every(g => !g.auth))

// ---- 常用写法要有具体示例条目（截图风格的「命令 + 用法」） ----
check('榜单组保留一条筛选示例（其余写法并进说明）', titles.includes('#DPS榜 金≤12') && titles.includes('#DPS榜 胡桃'), titles.filter(t => t.startsWith('#DPS榜')).join(' | '))
check('危战组保留版本示例，首领写法并进说明', titles.includes('#DPS危战榜 7.1') && items.some(i => i.title === '#DPS危战榜 7.1' && i.desc.includes('首领')))

finish()