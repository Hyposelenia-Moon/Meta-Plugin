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
  /* 2026-10-17：`out/` 现在只放「白边清单」这类缓存（JSON），仍然不拷图片 */
  ok('只复制不写：不往 out/ 拷图（直接引用，miao 同款）',
    !/writeFileSync\([^)]*\.(webp|png|jpe?g)/i.test(src) && src.includes('pathToFileURL') && src.includes('portrait-padding.json'))
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

// ---------- 5. 攻略页立绘：图库优先，按「真实渲染尺寸」排除会发虚的小图（2026-10-17） ----------
{
  const base = path.join(ensureTmp(), 'gallery-page-portrait')
  fs.rmSync(base, { recursive: true, force: true })
  const srcDir = path.join(base, 'src')
  const charDir = path.join(srcDir, 'normal-character', '胡桃')
  fs.mkdirSync(charDir, { recursive: true })

  /** 造一张只有文件头的 PNG（解析器只读前 32 字节，够验尺寸） */
  const writePng = (file, w, h) => {
    const buf = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
    buf.writeUInt32BE(13, 8)
    buf.write('IHDR', 12, 'latin1')
    buf.writeUInt32BE(w, 16)
    buf.writeUInt32BE(h, 20)
    fs.writeFileSync(file, buf)
  }
  /** 造一张 VP8X 的 WebP 头 */
  const writeWebp = (file, w, h) => {
    const buf = Buffer.alloc(40)
    buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(32, 4); buf.write('WEBP', 8, 'latin1')
    buf.write('VP8X', 12, 'latin1'); buf.writeUInt32LE(10, 16)
    buf.writeUIntLE(w - 1, 24, 3); buf.writeUIntLE(h - 1, 27, 3)
    fs.writeFileSync(file, buf)
  }

  const std = path.join(base, 'splash.webp')
  writeWebp(std, 1482, 1024) // 默认立绘：1.4473
  writeWebp(path.join(charDir, '胡桃_1_小图_Pixiv.webp'), 741, 512)      // 一半 → 挡掉
  writePng(path.join(charDir, '胡桃_2_同尺寸.png'), 1482, 1024)           // 同尺寸 → 可用
  writeWebp(path.join(charDir, '胡桃_3_大图16x9.webp'), 1920, 1080)       // 比例不同但更大 → 可用（页面 cover 裁）
  writePng(path.join(charDir, '胡桃_4_坏图.png'), 0, 0)                   // 读不出尺寸 → 挡掉
  const sources = [srcDir]

  push('尺寸读取：PNG 头', mod.imageSizeOf(path.join(charDir, '胡桃_2_同尺寸.png')), { w: 1482, h: 1024, type: 'png' })
  push('尺寸读取：WebP VP8X 头', mod.imageSizeOf(std), { w: 1482, h: 1024, type: 'webp' })
  push('尺寸读取：坏图返回 null', mod.imageSizeOf(path.join(charDir, '胡桃_4_坏图.png')), null)

  /* 2026-10-17 口径：**不再拿默认立绘当基准**，改成「按卡片真实渲染尺寸算放大倍数」
     卡片 = 780 CSS 宽 × renderScale 1.5 → 1170px 宽；比例 1.4473 时高 808px */
  const NO_CROP = { left: 0, right: 0, top: 0, bottom: 0 }
  push('渲染需求：比例 1.4473 → 1170×808（780 × 1.5）', mod.renderTargetOf(1.4473, { renderScale: 1.5 }), { width: 1170, height: 808 })
  push('渲染需求：比例缺失 → 0×0', mod.renderTargetOf(0), { width: 0, height: 0 })
  push('筛选：1920×1080 铺进 1.4473 是缩小（合格）', mod.fitsRenderSize({ w: 1920, h: 1080, type: 'webp' }, NO_CROP, 1.4473), true)
  push('筛选：1373×772 只需放大 4.7%（≤15% 合格）', mod.fitsRenderSize({ w: 1373, h: 772, type: 'webp' }, NO_CROP, 1.4473), true)
  push('筛选：900×500 要放大 1.6 倍（不合格）', mod.fitsRenderSize({ w: 900, h: 500, type: 'webp' }, NO_CROP, 1.4473), false)
  push('筛选：300×200 要放大 4 倍（不合格）', mod.fitsRenderSize({ w: 300, h: 200, type: 'webp' }, NO_CROP, 1.4473), false)
  /* 裁白边后按**裁后**尺寸算：方形卡片(1.0) 下，1920×1080 砍掉上边 30% → 只剩 756 高，装不下 1170 高 */
  push('筛选：按裁后尺寸算（方形卡片下 1920×1080 无裁 = 合格、裁掉上 30% = 不合格）',
    [mod.fitsRenderSize({ w: 1920, h: 1080, type: 'webp' }, NO_CROP, 1.0),
      mod.fitsRenderSize({ w: 1920, h: 1080, type: 'webp' }, { left: 0, right: 0, top: 0.3, bottom: 0 }, 1.0)],
    [true, false])
  push('筛选：读不出尺寸不合格', mod.fitsRenderSize(null, NO_CROP, 1.4473), false)
  push('筛选：容差可调（同图 5% 容差下不合格、30% 下合格）',
    [mod.fitsRenderSize({ w: 1373, h: 772, type: 'webp' }, NO_CROP, 1.4473, { tolerance: 0.01 }),
      mod.fitsRenderSize({ w: 1373, h: 772, type: 'webp' }, NO_CROP, 1.4473, { tolerance: 0.3 })],
    [false, true])

  const pickedFirst = mod.pickPagePortrait('胡桃', { sources, stdFile: std, random: () => 0 })
  ok('取图：小图被挡、随机取第一张合格图', pickedFirst.src.includes(encodeURIComponent('胡桃_2_同尺寸.png')), pickedFirst.src)
  push('取图：来源标记为图库', pickedFirst.source, '图库')
  ok('取图：结果带绝对路径（页面自量要用）', typeof pickedFirst.file === 'string' && pickedFirst.file.endsWith('胡桃_2_同尺寸.png'), pickedFirst.file)
  push('取图：卡片区比例取默认立绘（1482/1024 → 1.4473）', pickedFirst.ratio, '1.4473')
  const pickedLast = mod.pickPagePortrait('胡桃', { sources, stdFile: std, random: () => 0.999 })
  ok('取图：随机到末位时能取到另一张合格图', pickedLast.src.includes(encodeURIComponent('胡桃_3_大图16x9.webp')), pickedLast.src)

  /* 图库没有合格图 → 退回默认立绘，并把原因写清 */
  const onlySmall = path.join(base, 'only-small')
  fs.mkdirSync(path.join(onlySmall, 'normal-character', '胡桃'), { recursive: true })
  writeWebp(path.join(onlySmall, 'normal-character', '胡桃', '胡桃_1_小.webp'), 300, 200)
  const fallback = mod.pickPagePortrait('胡桃', { sources: [onlySmall], stdFile: std })
  push('取图：图库全不合格时退回默认立绘', fallback.source, 'miao')
  ok('取图：退回时说明原因（放大后发虚）', fallback.note.includes('发虚'), fallback.note)
  ok('取图：退回后仍给出地址', fallback.src.length > 0, fallback.src)

  /* 默认立绘也读不出尺寸 → 不能比较，退回默认立绘；连默认立绘都没有 → 空 */
  const blind = mod.pickPagePortrait('胡桃', { sources: [onlySmall], stdFile: '' })
  push('没有默认立绘可作基准时不硬选图库图', blind.src, '')
  ok('没有基准时给出可读原因', blind.note.length > 0, blind.note)
  push('空角色名也优雅失败', mod.pickPagePortrait('').src, '')
}

// ---------- 6. 白边→裁掉 + 边缘模糊铺满（2026-10-17 改版：不再跳过） ----------
{
  push('文件名判据：名字带「右移」', mod.looksPadded('胡桃_17_BLACKmeow_Pixiv_右移.webp'), true)
  push('文件名判据：名字带「偏移」', mod.looksPadded('胡桃_2_River源_米游社_偏移.webp'), true)
  push('文件名判据：正常文件名不算', mod.looksPadded('胡桃_11_Varlyn@西め38ab_Pixiv.webp'), false)
  push('文件名判据：空输入不抛错', mod.looksPadded(''), false)

  const base = path.join(ensureTmp(), 'gallery-crop')
  fs.rmSync(base, { recursive: true, force: true })
  const srcDir = path.join(base, 'src')
  const charDir = path.join(srcDir, 'normal-character', '胡桃')
  fs.mkdirSync(charDir, { recursive: true })
  const writePng = (file, w, h) => {
    const buf = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
    buf.writeUInt32BE(13, 8)
    buf.write('IHDR', 12, 'latin1')
    buf.writeUInt32BE(w, 16)
    buf.writeUInt32BE(h, 20)
    fs.writeFileSync(file, buf)
  }
  const std = path.join(base, 'splash.png')
  writePng(std, 1482, 1024)                                   // 卡片比例 1.4473
  const padded = path.join(charDir, '胡桃_10_sohnka_Pixiv.png') // 名字没标注、左白边 20%
  writePng(padded, 1920, 1107)
  const clean = path.join(charDir, '胡桃_11_Varlyn_Pixiv.png')  // 干净 16:9
  writePng(clean, 1920, 1080)
  const tiny = path.join(charDir, '胡桃_12_小图.png')           // 比默认立绘小 → 仍要排除
  writePng(tiny, 300, 200)

  const listFile = path.join(base, 'portrait-padding.json')
  fs.writeFileSync(listFile, JSON.stringify({
    scannedAt: 'x',
    threshold: 0.05,
    entries: { [padded]: { left: 0.2, right: 0, top: 0, bottom: 0 } }
  }), 'utf8')

  /* 清单读取：四边比例 */
  push('清单：读到四边白边比例', mod.portraitCropOf(padded, listFile), { left: 0.2, right: 0, top: 0, bottom: 0 })
  push('清单：没量过的图 → 全 0（照常整张用）', mod.portraitCropOf(clean, listFile), { left: 0, right: 0, top: 0, bottom: 0 })
  push('清单：文件不存在也不抛错', mod.portraitCropOf(clean, path.join(base, 'no-such.json')), { left: 0, right: 0, top: 0, bottom: 0 })
  push('清单路径落在 out/', path.basename(mod.paddingListPath()), 'portrait-padding.json')

  /* 2026-10-17：**入库基线**（键=文件名）—— 副本装好就能裁，不必先在本机扫一遍 */
  const baselineFile = path.join(base, '_portrait-padding.json')
  fs.writeFileSync(baselineFile, JSON.stringify({
    note: 'baseline',
    entries: { [path.basename(padded)]: { left: 0.201, right: 0, top: 0, bottom: 0 } }
  }), 'utf8')
  push('基线路径在 data/ 下、文件名带下划线前缀',
    [path.basename(mod.baselinePaddingListPath()), path.basename(path.dirname(mod.baselinePaddingListPath()))],
    ['_portrait-padding.json', 'data'])

  /* 2026-10-17 第四轮：页面内自量自裁要的 data: URL + 判定参数（唯一来源 cropCfg） */
  push('留白判定参数唯一来源 cropCfg',
    [mod.cropCfg.tol, mod.cropCfg.cover, mod.cropCfg.min, mod.cropCfg.colorCap, mod.cropCfg.whiteLevel, mod.cropCfg.whiteLineCover],
    [6, 0.98, 0.03, 0.12, 240, 0.95])
  ok('data: URL：PNG 出头正确且可解码回原字节',
    (() => {
      const png = padded
      const url = mod.imageDataUrl(png)
      if (!url.startsWith('data:image/png;base64,')) return false
      const back = Buffer.from(url.split(',')[1], 'base64')
      return back.equals(fs.readFileSync(png))
    })(), 'png data url')
  push('data: URL：文件不存在 → 空串', mod.imageDataUrl(path.join(base, 'no-such.webp')), '')
  push('data: URL：超过体积上限 → 空串',
    mod.imageDataUrl(padded, 10), '')

  push('基线：本机清单缺失时按**文件名**命中',
    mod.portraitCropOf(padded, path.join(base, 'no-such.json'), baselineFile),
    { left: 0.201, right: 0, top: 0, bottom: 0 })
  push('基线：同名的干净图不误命中',
    mod.portraitCropOf(clean, path.join(base, 'no-such.json'), baselineFile),
    { left: 0, right: 0, top: 0, bottom: 0 })
  push('本机清单优先于基线（换图后重扫能覆盖）',
    mod.portraitCropOf(padded, listFile, baselineFile),
    { left: 0.2, right: 0, top: 0, bottom: 0 })
  push('入库基线文件存在且非空',
    (() => { try { return Object.keys(JSON.parse(fs.readFileSync(mod.baselinePaddingListPath(), 'utf8')).entries).length > 0 } catch { return false } })(),
    true)

  /* 铺满盒：把裁掉白边后的整块 contain 进卡片，剩下的边交给模糊层 */
  const stdSize = { w: 1482, h: 1024, type: 'png' }
  push('铺满盒：无白边 16:9 → 放大到铺满（cover）并居中裁掉两侧',
    mod.planPortraitBox({ w: 1920, h: 1080, type: 'webp' }, stdSize, { left: 0, right: 0, top: 0, bottom: 0 }),
    { width: '122.837%', height: '100.000%', left: '-11.419%', top: '0.000%' })
  push('铺满盒：左白边 20% → 先裁白边再放大铺满（125% 宽、左移 25%）',
    mod.planPortraitBox({ w: 1920, h: 1107, type: 'png' }, stdSize, { left: 0.2, right: 0, top: 0, bottom: 0 }),
    { width: '125.000%', height: '104.305%', left: '-25.000%', top: '-2.152%' })
  push('铺满盒：左右各 10% → 裁掉白边后放大铺满、左右居中',
    mod.planPortraitBox({ w: 1920, h: 1080, type: 'webp' }, stdSize, { left: 0.1, right: 0.1, top: 0, bottom: 0 }),
    { width: '125.000%', height: '101.761%', left: '-12.500%', top: '-0.880%' })
  push('铺满盒：默认立绘自己 → 严丝合缝 100%×100%',
    mod.planPortraitBox({ w: 1482, h: 1024, type: 'png' }, stdSize, { left: 0, right: 0, top: 0, bottom: 0 }),
    { width: '100.000%', height: '100.000%', left: '0.000%', top: '0.000%' })
  push('铺满盒：读不出尺寸 → 空串（模板退回默认铺满）',
    mod.planPortraitBox(null, stdSize, { left: 0, right: 0, top: 0, bottom: 0 }),
    { width: '', height: '', left: '', top: '' })

  /* 取图：白边图**不再被跳过**，而是带上裁剪比例与铺满盒 */
  const sources = [srcDir]
  const pickedPadded = mod.pickPagePortrait('胡桃', { sources, stdFile: std, paddingList: listFile, random: () => 0 })
  ok('取图：白边图照常入池（不再跳过）', pickedPadded.src.includes(encodeURIComponent('胡桃_10_sohnka_Pixiv.png')), pickedPadded.src)
  push('取图：带上该图的白边比例', pickedPadded.crop, { left: 0.2, right: 0, top: 0, bottom: 0 })
  push('取图：铺满盒按裁剪后计算（cover：高度超过 100%）', pickedPadded.box.height, '104.305%')
  ok('取图：铺满盒宽度大于 100%（裁掉白边后放大）', parseFloat(pickedPadded.box.width) > 100, pickedPadded.box.width)
  push('取图：卡片比例仍是默认立绘的', pickedPadded.ratio, '1.4473')

  const pickedClean = mod.pickPagePortrait('胡桃', { sources, stdFile: std, paddingList: listFile, random: () => 0.99 })
  ok('取图：干净图也可能抽到（随机不受裁剪影响）', pickedClean.src.includes(encodeURIComponent('胡桃_11_Varlyn_Pixiv.png')), pickedClean.src)
  push('取图：干净图无裁剪', pickedClean.crop, { left: 0, right: 0, top: 0, bottom: 0 })

  /* 太小的图仍然排除（放大发虚，模糊层救不回来）→ 池里只剩小图时退回默认立绘 */
  const onlyTiny = path.join(base, 'only-tiny')
  fs.mkdirSync(path.join(onlyTiny, 'normal-character', '胡桃'), { recursive: true })
  writePng(path.join(onlyTiny, 'normal-character', '胡桃', '胡桃_1_小.png'), 300, 200)
  const fallback = mod.pickPagePortrait('胡桃', { sources: [onlyTiny], stdFile: std })
  push('取图：池里全是放大会发虚的小图 → 退回默认立绘', fallback.source, 'miao')
  ok('取图：退回原因写「放大后都会发虚」', fallback.note.includes('发虚'), fallback.note)
  push('取图：退回默认立绘时也给出铺满盒（= 1:1）', fallback.box.width, '100.000%')

  /* `面板图N`（2026-10-17 加，`#胡桃攻略 面板图3`）：点名要哪张就照用 */
  const byIndex = mod.pickPagePortrait('胡桃', { sources, stdFile: std, paddingList: listFile, index: 11 })
  ok('面板图N：按序号取到指定那张', byIndex.src.includes(encodeURIComponent('胡桃_11_Varlyn_Pixiv.png')), byIndex.src)
  push('面板图N：仍带裁剪比例（干净图为 0）', byIndex.crop, { left: 0, right: 0, top: 0, bottom: 0 })
  const byIndexPadded = mod.pickPagePortrait('胡桃', { sources, stdFile: std, paddingList: listFile, index: 10 })
  ok('面板图N：白边图也照用（不再被尺寸/白边挡）', byIndexPadded.src.includes(encodeURIComponent('胡桃_10_sohnka_Pixiv.png')), byIndexPadded.src)
  push('面板图N：白边图仍按清单裁剪', byIndexPadded.crop, { left: 0.2, right: 0, top: 0, bottom: 0 })

  const tooSmallByIndex = mod.pickPagePortrait('胡桃', { sources: [onlyTiny], stdFile: std, index: 1 })
  ok('面板图N：点名的小图也照用（用户指定优先）', tooSmallByIndex.src.includes(encodeURIComponent('胡桃_1_小.png')), tooSmallByIndex.src)

  const noSuchIndex = mod.pickPagePortrait('胡桃', { sources, stdFile: std, paddingList: listFile, index: 99, random: () => 0 })
  push('面板图N：序号不存在 → 退回随机取图', noSuchIndex.source, '图库')
  ok('面板图N：并说明"没有面板图99"', noSuchIndex.note.includes('没有面板图99'), noSuchIndex.note)
  push('面板图N：index 为 0 / 负数等同未指定', mod.pickPagePortrait('胡桃', { sources, stdFile: std, index: 0, random: () => 0 }).note, '')
}

const bad = report()
process.exit(bad ? 1 : 0)
