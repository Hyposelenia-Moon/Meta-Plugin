/**
 * 帮助配置套件（2026-10-14：两小一大 + 主菜单只放常用指令）
 *
 * 三页各自过结构门禁；主菜单说明更严（≤16 字 = "常用指令的简洁解释"），分菜单 ≤40 字（可正常解释）。
 * 覆盖表按**三页并集**检查，避免"主菜单精简后把入口弄丢"。
 */
import path from 'node:path'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('帮助配置（两小一大）')

const mod = await import('file://' + path.join(pluginRoot, 'resources', 'help', 'help-cfg.js').replace(/\\/g, '/'))
const pages = mod.helpPages || {}
const pageNames = ['meta', 'guide', 'dps']

ok('三个页面都在（meta / guide / dps）', pageNames.every(n => pages[n]?.cfg && Array.isArray(pages[n]?.list)))
ok('总帮助别名为 meta（helpCfg / helpList 指向同一份）',
  mod.helpCfg?.title === pages.meta?.cfg?.title && mod.helpList?.length === pages.meta?.list?.length)

const DESC_LIMIT = { meta: 24, guide: 30, dps: 30 }

for (const name of pageNames) {
  const page = pages[name]
  if (!page) continue
  const items = page.list.flatMap(g => g.list || [])
  const titles = items.map(i => i.title)

  ok(`${name}: 页头有标题与副标题`, typeof page.cfg.title === 'string' && page.cfg.title.length > 0 &&
    typeof page.cfg.subTitle === 'string' && page.cfg.subTitle.length > 0)
  ok(`${name}: 分组非空且每组有名字`, page.list.length > 0 && page.list.every(g => typeof g.group === 'string' && g.group && g.list?.length > 0))
  ok(`${name}: 每条只有 title / desc`, items.every(i => Object.keys(i).every(k => k === 'title' || k === 'desc')))
  ok(`${name}: 标题以 # 开头`, items.every(i => String(i.title).trim().startsWith('#')))
  ok(`${name}: 标题唯一`, new Set(titles).size === titles.length, titles.filter((t, i) => titles.indexOf(t) !== i).join(','))
  ok(`${name}: 每组 ≤ 8 条`, page.list.every(g => g.list.length <= 8), page.list.map(g => `${g.group}:${g.list.length}`).join(' '))
  const limit = DESC_LIMIT[name] || 40
  ok(`${name}: 说明 ≤ ${limit} 字`, items.every(i => i.desc.length <= limit),
    items.filter(i => i.desc.length > limit).map(i => `${i.title}(${i.desc.length})`).join(','))
  ok(`${name}: 没有语法 / 参数表 / 示例字段`, items.every(i => !i.syntax && !i.args && !i.examples))
  ok(`${name}: 没有分组级 auth（权限由 apps 层管）`, page.list.every(g => !g.auth))
}

// 主菜单要"常用"：条数克制，且给出三个入口
{
  const meta = pages.meta
  const items = meta.list.flatMap(g => g.list || [])
  ok('主菜单条数克制（≤12 条）', items.length <= 12, String(items.length))
  ok('主菜单含攻略 / 练度 / 伤害 / 榜单四类常用入口',
    ['#胡桃攻略', '#练度查询 胡桃', '#胡桃dps', '#DPS榜'].every(t => items.some(i => i.title === t)),
    items.map(i => i.title).join(' | '))
  ok('主菜单指向两个分菜单', items.some(i => i.title === '#攻略帮助') && items.some(i => i.title === '#DPS帮助'))
  ok('总菜单含「数据与维护」，分菜单不再重复承载',
    meta.list.some(g => g.group === '数据与维护') && !pages.dps.list.some(g => g.group === '数据与维护') && !pages.guide.list.some(g => g.group === '数据与维护'))
  const maxLen = Math.max(...items.map(i => i.desc.length))
  ok('主菜单解释居中：一行说清且不口语化（10~24 字）', maxLen <= 24 && maxLen >= 10, String(maxLen))
}

// 覆盖表：三页并集
{
  const all = pageNames.flatMap(n => (pages[n]?.list || []).flatMap(g => g.list || []))
  const combined = all.map(i => `${i.title} ${i.desc}`)
  const need = ['#胡桃攻略', '#练度查询 胡桃', '#配装 胡桃 3', '#胡桃dps', '#危战', '#队伍伤害 四人名',
    '#队伍伤害 轴:重击×8', '#队伍伤害 词条:+20暴击', '#DPS榜', '#DPS视频',
    '#攻略状态', '#DPS更新']
  push('三页并集覆盖全部入口（含旧写法说明）', need.filter(k => !combined.some(t => t.includes(k))), [])
  ok('已移除的攻略写法没被写回帮助页',
    !combined.some(t => t.includes('#攻略 胡桃') || t.includes('#攻略 武器')))
  // 2026-10-14 用户定：帮助页**只讲新写法**，不出现旧写法说明
  const legacyNotes = JSON.stringify(mod.helpPages).match(/旧写法|同义\\|同页|亦可|仍可用/g) || []
  push('帮助页不出现旧写法的说明性文字', legacyNotes, [])
}

// app 接线
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'help.ts'))
  ok('app 按页面取配置（helpPages）', src.includes('helpPages?.[page]'))
  ok('app 认 #meta（总帮助）', src.includes('META_HELP_RULE') && src.includes('isMetaHelpCommand'))
  ok('app 判页：meta / dps / guide', src.includes("return 'meta'") && src.includes("return 'dps'") && src.includes("return 'guide'"))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
}

const bad = report()
process.exit(bad ? 1 : 0)