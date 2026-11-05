/**
 * Atlas 图鉴实体兜底（图标 / 星级 / 元素 / 武器类型）
 *
 * 分三段：
 *   1. **降级**：Atlas 目录不存在时 `entityOf()` / `icon()` 都必须返回 null 且不抛错；
 *   2. **真实图鉴**（需要 Atlas-Plugin 在场）：读 `角色/五星/阿贝多.json` 得到
 *      星级 5 / 元素 geo / 武器 sword，图标走本地 `gallery/gi/*.webp`；
 *   3. **攻略页接线**：`withIcons()` 对 Atlas 来源的图标必须打 `iconAbsolute`，
 *      模板据此不再拼 `{{_miao_path}}`。
 *
 * Atlas 目录：`META_ATLAS_DIR` 优先；默认 `<bot>/plugins/Atlas-Plugin`（当前工作区
 * 不在 bot 里，因此测试自己按常见安装路径探测，找不到就跳过真实图鉴段）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot } from './_helper.mjs'

const { push, ok, report } = createChecks('图鉴兜底（AtlasRes.entityOf / icon）')

const atlasFile = path.join(libDir, 'model', 'AtlasRes.js')
ok('lib/model/AtlasRes.js 存在', fs.existsSync(atlasFile))
if (!fs.existsSync(atlasFile)) {
  report()
  process.exit(1)
}

/* ---------- 0. 找真实图鉴（必须在 import 之前设环境变量：模块级 atlasRes 只构造一次） ---------- */
const candidates = [
  process.env.META_ATLAS_DIR,
  'D:/Program Files/Yunzai/Yunzai/plugins/Atlas-Plugin',
  path.join(pluginRoot, '..', 'Atlas-Plugin')
].filter(Boolean)
const realRoot = candidates.find(dir => {
  try {
    return fs.existsSync(path.join(dir, 'tool', 'nanoka-atlas-backend', 'nanoka-atlas-backend', 'data'))
  } catch {
    return false
  }
})
if (realRoot) process.env.META_ATLAS_DIR = realRoot

const { AtlasRes } = await import(pathToFileURL(atlasFile).href)

/* ---------- 1. 降级：目录不存在 ---------- */
const bogus = new AtlasRes(path.join(pluginRoot, 'test', '.test-tmp', 'no-such-atlas'))
let threw = false
let entity = null
let icon = null
try {
  entity = bogus.entityOf('character', '阿贝多')
  icon = bogus.icon('character', '阿贝多')
} catch {
  threw = true
}
ok('Atlas 缺失时不抛错', !threw)
ok('Atlas 缺失时 entityOf 返回 null', entity === null)
ok('Atlas 缺失时 icon 返回 null', icon === null)

/* ---------- 2. 真实图鉴 ---------- */

if (!realRoot) {
  push('跳过：本机没有 Atlas 图鉴后端')
} else {
  const atlas = new AtlasRes(realRoot)
  const albedo = atlas.entityOf('character', '阿贝多')
  ok('读到角色记录', !!albedo && fs.existsSync(albedo.file))
  ok('星级 = 5', albedo?.star === 5)
  ok('元素 = geo', albedo?.element === 'geo')
  ok('武器类型 = sword', albedo?.weaponType === 'sword')
  ok('图标文件存在', !!albedo?.iconFile && fs.existsSync(albedo.iconFile))

  const icon = atlas.icon('character', '阿贝多')
  ok('icon 返回 file:// 绝对地址', !!icon && icon.rel.startsWith('file:///') && icon.source === 'atlas')
  ok('icon 地址指向真实文件', !!icon && fs.existsSync(new URL(icon.rel)))

  const weapon = atlas.entityOf('weapon', '阿莫斯之弓')
  ok('武器记录可读', !!weapon && weapon.weaponType === 'bow' && weapon.star === 5)

  ok('未知角色返回 null', atlas.entityOf('character', '并不存在的角色名') === null)

  // 新角色：gallery 里只有 `_Card` / `UI_Gacha_AvatarImg_*` 时也要能取到图
  const newbie = atlas.icon('character', '安娜丝塔夏')
  ok('新角色头像回退到 _Card', !!newbie && fs.existsSync(new URL(newbie.rel)))

  // 圣遗物套装：记录按套装 id 命名，套装名只在 affix 里 → 需要索引
  const relic = atlas.entityOf('artifact', '肇史之遗')
  ok('圣遗物套装可按名字索引', !!relic && fs.existsSync(relic.file))
  const relicIcon = atlas.icon('artifact', '肇史之遗')
  ok('圣遗物套装图标可解析', !!relicIcon && fs.existsSync(new URL(relicIcon.rel)))

  // 缓存：第二次读取必须是同一个对象（只读一次 JSON）
  const again = atlas.entityOf('character', '阿贝多')
  ok('实体查询有缓存', again === albedo)

  /* ---------- 3. 攻略页接线 ---------- */
  // subViews → IconResolver 用的是模块级 `atlasRes`，构造时读环境变量，先指到真实图鉴
  process.env.META_ATLAS_DIR = realRoot
  const subViewsFile = path.join(libDir, 'modules', 'subViews.js')
  const { withIcons } = await import(pathToFileURL(subViewsFile).href)
  // 合成一个最小 view：一条带 `ref` 的行
  const view = {
    name: '阿贝多',
    sections: [{
      key: 'weapons',
      title: '武器推荐',
      rows: [{ label: '推荐', name: '推荐武器', items: [{ ref: 'weapon:阿莫斯之弓', text: '阿莫斯之弓' }] }]
    }]
  }
  // miao 在场时武器图标由 miao 先命中；这里只断言两种来源都不会拼错前缀
  const icons = withIcons(view, { character: '阿贝多' })
  const item = icons.sections[0].rows[0].items[0]
  if (item.iconSource === 'atlas') {
    ok('Atlas 图标标记 iconAbsolute', item.iconAbsolute === true)
    ok('Atlas 图标是 file:// 绝对地址', String(item.icon).startsWith('file:///'))
  } else {
    ok('miao 图标不带 iconAbsolute', !item.iconAbsolute)
  }

  // 圣遗物套装行 + 新角色配队：两者 miao 都可能没有，Atlas 必须补上
  const view2 = {
    name: '安娜丝塔夏',
    sections: [
      {
        key: 'artifacts',
        title: '圣遗物推荐',
        rows: [{ label: '推荐', name: '推荐套装', items: [{ ref: 'artifact:肇史之遗', text: '肇史之遗' }] }]
      },
      {
        key: 'teams',
        title: '配队',
        teams: [{ tag: '推荐', members: [{ name: '安娜丝塔夏', ref: 'character:安娜丝塔夏' }] }]
      }
    ]
  }
  const filled = withIcons(view2, { character: '安娜丝塔夏' })
  const setItem = filled.sections[0].rows[0].items[0]
  const teammate = filled.sections[1].teams[0].members[0]
  ok('圣遗物套装能拿到图标', !!setItem.icon)
  ok('新角色配队头像能拿到图标', !!teammate.icon)
  for (const [label, entry] of [['套装', setItem], ['头像', teammate]]) {
    if (entry.iconSource === 'atlas') {
      ok(`${label} Atlas 图标带 iconAbsolute`, entry.iconAbsolute === true && String(entry.icon).startsWith('file:///'))
    } else {
      ok(`${label} miao 图标不带 iconAbsolute`, !entry.iconAbsolute)
    }
  }
}

report()
