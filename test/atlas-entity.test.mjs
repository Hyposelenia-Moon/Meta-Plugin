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

  // 缓存：第二次读取必须是同一个对象（只读一次 JSON）
  const again = atlas.entityOf('character', '阿贝多')
  ok('实体查询有缓存', again === albedo)

  /* ---------- 3. 攻略页接线 ---------- */
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

  /* ---------- 4. 图鉴正文补全（codexOf + fillFromAtlas） ---------- */
  const codex = atlas.codexOf('安娜丝塔夏')
  ok('codexOf 读到天赋 3 条', Array.isArray(codex?.skills) && codex.skills.length === 3)
  ok('天赋字母顺序 A/E/Q', codex?.skills.map(skill => skill.letter).join(',') === 'A,E,Q')
  ok('天赋带名字', (codex?.skills?.[0]?.name ?? '').length > 0)
  ok('命座 6 条', Array.isArray(codex?.constellations) && codex.constellations.length === 6)
  ok('命座带官方名', (codex?.constellations?.[0]?.name ?? '').length > 0)
  ok('基础生命 ≈ 991', Math.abs((codex?.base?.hp ?? 0) - 991.4528) < 1e-6)
  ok('缓存：第二次同一对象', atlas.codexOf('安娜丝塔夏') === codex)

  const { fillFromAtlas } = await import(pathToFileURL(subViewsFile).href)
  const guide = {
    name: '安娜丝塔夏',
    sections: [
      { key: 'talents', title: '天赋', rows: [{ kind: 'talents', items: [{ name: 'A', talentLevel: 1 }, { name: 'E', talentLevel: 10 }] }] },
      { key: 'panels', title: '面板', rows: [] },
      { key: 'constellations', title: '命座', rows: [{ items: [{ index: 2, text: '全队爆伤' }] }] }
    ]
  }
  const filled = fillFromAtlas(guide, codex)
  const talentItem = filled.sections[0].rows[0].items[0]
  ok('天赋补上官方名', talentItem.atlasName === codex.skills[0].name)
  ok('天赋补上描述', (talentItem.atlasDesc ?? '').length > 0)
  ok('面板补出基础行', filled.sections[1].rows.some(row => row.label === '基础'))
  const consItem = filled.sections[2].rows[0].items[0]
  ok('命座保留原文', consItem.text === '全队爆伤')
  ok('命座补上官方名与描述', (consItem.atlasName ?? '').length > 0 && (consItem.atlasDesc ?? '').length > 0)
  ok('图鉴为空时不改视图', fillFromAtlas(guide, null) === guide)
}

report()
