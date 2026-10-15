/**
 * 角色立绘取图（`#练度查询` 用的 ProfileImg-Plugin 兼容接口）
 *
 * 覆盖：`profileImgSrc` 解析、三种目录布局的命中规则、后缀白名单与 `.bak` 屏蔽、
 * 以及"依赖缺失时只降级不报错"（开发工作区没有 bot，`portraitOf` 必须优雅失败）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('角色立绘（ProfileImg 兼容接口）')

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
}

// ---------- 2. 目录布局与后缀口径（临时图库） ----------
{
  const base = path.join(ensureTmp(), 'portrait-gallery')
  fs.rmSync(base, { recursive: true, force: true })
  const mk = (dir, files) => {
    fs.mkdirSync(dir, { recursive: true })
    for (const f of files) fs.writeFileSync(path.join(dir, f), 'x')
  }
  mk(path.join(base, 'normal-character', '胡桃'), ['胡桃_1_a_b.webp', '胡桃_2_c_d.bak'])
  mk(path.join(base, 'super-character', '神里绫华'), ['神里绫华_1_a_b.png'])
  mk(path.join(base, 'flatrole'), ['平铺_1_a_b.jpg'])
  mk(path.join(base, '旅行者'), ['旅行者_1_a_b.webp'])
  mk(path.join(base, 'typo'), ['只有说明.txt'])

  ok('normal-character 布局命中（且忽略 .bak）',
    path.basename(mod.findPortrait('胡桃', base)) === '胡桃_1_a_b.webp')
  ok('super-character 布局命中', path.basename(mod.findPortrait('神里绫华', base)) === '神里绫华_1_a_b.png')
  ok('平铺布局命中', path.basename(mod.findPortrait('旅行者', base)) === '旅行者_1_a_b.webp')
  ok('只有非图片文件时不命中', mod.findPortrait('typo', base) === '')
  ok('角色不存在时返回空串', mod.findPortrait('不存在的角色', base) === '')
  ok('空角色名返回空串', mod.findPortrait('', base) === '')

  const src = readText(path.join(pluginRoot, 'src', 'model', 'ProfileImgRes.ts'))
  ok('只认 4 种后缀（webp/png/jpg/jpeg）',
    /IMG_EXTS = \['\.webp', '\.png', '\.jpg', '\.jpeg'\]/.test(src))
  ok('不 import ProfileImg-Plugin 的内部模块（只走目录与配置约定）',
    !/ProfileImg-Plugin'/.test(src.replace(/botRoot, 'plugins', 'ProfileImg-Plugin'/g, '')))
  ok('兼容接口的三种布局都实现了',
    src.includes("'normal-character'") && src.includes("'super-character'"))
  ok('复制到未跟踪缓存 out/（不写 data/）', src.includes('outDir') && !src.includes('dataDir'))
}

// ---------- 3. 依赖缺失时只降级（本工作区没有 bot） ----------
{
  const r = mod.portraitOf('胡桃')
  ok('取不到立绘时返回 ok:false 而不是抛错', r.ok === false && r.rel === '')
  ok('降级原因可读', typeof r.note === 'string' && r.note.length > 0, r.note)
  const none = mod.portraitOf('')
  ok('空角色名也优雅失败', none.ok === false)
}

const bad = report()
process.exit(bad ? 1 : 0)
