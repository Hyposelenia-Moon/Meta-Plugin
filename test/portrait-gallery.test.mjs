/**
 * 角色面板图 / 立绘（图库兼容，逻辑照抄 miao）
 *
 * 覆盖 miao 的四段逻辑：
 *   1. `parseProfileImgSrc` / `profileImgSources`：源列表读哪份配置、相对/绝对路径怎么算（纯函数 + 临时文件）；
 *   2. `profileImgFiles` / `profileImgPool`：单文件与目录两种形态、`normal/super` 两层、平铺层、后缀白名单；
 *   3. `profileImgByIndex`：`{角色}_{序号}_…` 命名解析、彩蛋层优先；
 *   4. `heroImageOf`：图库取不到时回落 miao 自带立绘、任何情况下都**只降级不抛错**（开发工作区没有 bot）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('角色立绘（图库兼容，照抄 miao）')

const mod = await import(pathToFileURL(path.join(libDir, 'model', 'ProfileImgRes.js')).href)

// ---------- 1. profileImgSrc 解析（纯函数） ----------
{
  const text = `
/** 图库源 */
export const profileImgSrc = [
  'profile',
  'D:/Program Files/Yunzai/Yunzai/plugins/ProfileImg-Plugin/resources/gallery/ProfileImg/miao-plugin-ProfileImg'
]
`
  push('解析 miao config 里的源列表', mod.parseProfileImgSrc(text),
    ['profile', 'D:/Program Files/Yunzai/Yunzai/plugins/ProfileImg-Plugin/resources/gallery/ProfileImg/miao-plugin-ProfileImg'])
  push('没有该键时返回空数组', mod.parseProfileImgSrc('export const other = 1'), [])
  push('空输入不抛错', mod.parseProfileImgSrc(undefined), [])

  const src = readText(path.join(pluginRoot, 'src', 'model', 'ProfileImgRes.ts'))
  ok('源列表按 miao 的顺序读三处（diy → system → profile）',
    src.includes("'config', 'profile.js'") && src.includes("'config', 'system', 'profile_system.js'") && src.includes("['profile']"))
  ok('相对源以 miao 的 resources 为基准', src.includes("path.join(miaoResources(), s)"))
  ok('不 import miao / ProfileImg-Plugin 的内部模块（只读配置与目录）',
    !/from\s+'[^']*miao-plugin/.test(src) && !/from\s+'[^']*ProfileImg-Plugin/.test(src))
  ok('只复制不写：不再往 out/ 拷图（直接引用，miao 同款）', !src.includes('outDir') && src.includes('pathToFileURL'))
}

// ---------- 2. 候选池：目录形态 / 单文件形态 / 两层 / 平铺 ----------
{
  const base = path.join(ensureTmp(), 'gallery-pool')
  fs.rmSync(base, { recursive: true, force: true })
  const mk = (dir, files) => {
    fs.mkdirSync(dir, { recursive: true })
    for (const f of files) fs.writeFileSync(path.join(dir, f), 'x')
  }
  mk(path.join(base, 's1', 'normal-character', '胡桃'), ['胡桃_1_a_b.webp', '胡桃_2_c_d.webp', '胡桃_9_x.bak', 'readme.txt'])
  mk(path.join(base, 's1', 'super-character', '胡桃'), ['胡桃_14_e_f.webp'])
  mk(path.join(base, 's1', '平铺'), ['平铺_1_a_b.jpg'])
  mk(path.join(base, 's2', 'normal-character'), ['单文件.png'])
  const sources = [path.join(base, 's1'), path.join(base, 's2')]

  const normal = mod.profileImgPool('胡桃', false, sources).map(f => path.basename(f))
  push('普通层：目录形态命中，且忽略 .bak 与非图片', normal, ['胡桃_1_a_b.webp', '胡桃_2_c_d.webp'])
  push('普通层：平铺形态（`{源}/{角色}/`）也算（第三方图库常见）',
    mod.profileImgPool('平铺', false, sources).map(f => path.basename(f)), ['平铺_1_a_b.jpg'])
  push('普通层：单文件形态（`{源}/normal-character/{角色}.png`）命中',
    mod.profileImgPool('单文件', false, sources).map(f => path.basename(f)), ['单文件.png'])
  push('彩蛋层只取 super-character（不含平铺/普通层）',
    mod.profileImgPool('胡桃', true, sources).map(f => path.basename(f)), ['胡桃_14_e_f.webp'])
  push('源不存在 / 角色不存在 → 空池', mod.profileImgPool('不存在的角色', false, sources), [])
  push('空角色名 → 空池', mod.profileImgPool('', false, sources), [])

  push('按序号选图：`{角色}_{序号}_` 命中',
    path.basename(mod.profileImgByIndex('胡桃', false, 2, sources)), '胡桃_2_c_d.webp')
  push('按序号选图：彩蛋层优先',
    path.basename(mod.profileImgByIndex('胡桃', true, 14, sources)), '胡桃_14_e_f.webp')
  push('序号不存在 → 空串', mod.profileImgByIndex('胡桃', false, 99, sources), '')
  push('序号 0 / 非数字 → 空串', mod.profileImgByIndex('胡桃', false, 0, sources), '')

  const picked = mod.pickProfileImg('胡桃', { sources })
  ok('不给序号时在池里随机取（结果一定来自池）', mod.profileImgPool('胡桃', false, sources).includes(picked))
  push('指定序号时稳定取该张（可复现）',
    path.basename(mod.pickProfileImg('胡桃', { index: 1, sources })), '胡桃_1_a_b.webp')
  push('池为空时返回空串', mod.pickProfileImg('不存在的角色', { sources }), '')
}

// ---------- 3. 页面地址：bot 内走 5 级相对前缀，bot 外走 file:// ----------
{
  const root = path.join(ensureTmp(), 'gallery-url')
  const inside = path.join(root, 'plugins', 'ProfileImg-Plugin', 'resources', 'gallery', 'ProfileImg', 'repo', 'normal-character', '胡桃', '胡桃_1_a_b.webp')
  const url = mod.pageImageUrl(inside, root)
  ok('bot 内：5 级相对前缀 + plugins/…（与模板里 miao 资源同深）',
    url.startsWith('../../../../../plugins/ProfileImg-Plugin/resources/gallery/'), url)
  ok('文件名做了 URI 编码且带扩展名', url.endsWith('/' + encodeURIComponent('胡桃_1_a_b.webp')), url)
  const outside = mod.pageImageUrl('E:/fan-repo/胡桃/胡桃_1_a_b.webp', root)
  ok('跨盘：file:// 绝对地址', outside.startsWith('file:///E:/'), outside)
}

// ---------- 4. 取图顺序与降级（本工作区没有 bot / 图库） ----------
{
  const r = mod.heroImageOf('胡桃')
  ok('取不到图时返回空串而不是抛错', r.rel === '', r.rel)
  ok('降级原因可读', typeof r.note === 'string' && r.note.length > 0, r.note)
  push('空角色名也优雅失败', mod.heroImageOf('').rel, '')
  push('miao 自带立绘兜底先看 splash0（彩蛋），再看 splash',
    readText(path.join(pluginRoot, 'src', 'model', 'ProfileImgRes.ts')).includes("['splash0.webp', 'splash.webp']"), true)
}

const bad = report()
process.exit(bad ? 1 : 0)
