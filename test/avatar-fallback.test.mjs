/**
 * 头像兜底与补图可见化（2026-11-26）
 *
 * 起因：站点立绘 `out/avatar/<character_id>.webp` 只在查询联网开着时才会下载。
 * 关着联网（默认）或站点抓不到时，榜单/危战/练度/队伍伤害页的成员头像整块变成文字方块，
 * 用户看不出是"没联网"还是"图挂了"。修法两层：
 *   1. `modules/teamView.ts` 的 `faceSrc`：站点立绘缺失时回落到 miao `imgs/face.webp`
 *      → Atlas 图标 → 文字占位，模板按 `avatar` → `faceSrc` → 文字 依次取；
 *   2. `model/AvatarStore.ts` 的 `avatarFillStatus()`：把最近一次补图的结果
 *      （联网关闭 / 全部命中 / 成功与失败张数 / 首条错误）留档，`#meta状态` 写出来。
 *
 * 覆盖方式：前四组是**行为层**（真的 import 编译产物、真的建/删缓存文件），
 * 最后一组是**结构层**（app 本体 `extends` 框架 plugin，纯 node 下不能 import，
 * 所以对模板与 `src/apps/status.ts` 做源码断言，与 `status-proxy` 套件同一口径）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('头像兜底（miao face / Atlas / 文字）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)

// ---------- 0. 环境：临时数据目录 + 空头像缓存 + 联网关闭 ----------
const tmp = ensureTmp()
const dataRoot = path.join(tmp, 'avatar-fallback-data')
fs.rmSync(dataRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(dataRoot, 'avatar'), { recursive: true })
process.env.META_DATA_DIR = dataRoot
const cfgFile = path.join(tmp, 'avatar-fallback.yaml')
const writeCfg = (networkEnabled) => fs.writeFileSync(cfgFile, [
  'priority: 8000',
  `networkEnabled: ${networkEnabled}`,
  'dpsAvatarEnabled: true',
  'dpsTimeoutMs: 1'
].join('\n') + '\n', 'utf8')
writeCfg(false)
process.env.META_CONFIG_FILE = cfgFile

const AV = await load('model/AvatarStore.js')
const TV = await load('modules/teamView.js')
const CI = await load('model/CharacterIndex.js')

// ---------- 1. 本地兜底头像：miao face → Atlas → 空串 ----------
{
  ok('findCharacter 能解析「莫娜」（兜底头像要有 character_id 做锚点）', !!CI.findCharacter('莫娜')?.character_id)
  ok('空名字不查盘', TV.localFaceUrl('') === '' && TV.localFaceUrl('   ') === '')

  const miaoRoot = process.env.META_MIAO_DIR || path.resolve(pluginRoot, '..', 'miao-plugin')
  const monaFace = path.join(miaoRoot, 'resources', 'meta-gs', 'character', '莫娜', 'imgs', 'face.webp')
  if (fs.existsSync(monaFace)) {
    const url = TV.localFaceUrl('莫娜')
    push('localFaceUrl 给的是绝对 file:// 地址（前缀）', url.slice(0, 7), 'file://')
    let real = ''
    try { real = fileURLToPath(url) } catch { /* 非法 URL 交给断言 */ }
    ok(`地址指向真实存在的 face.webp（${real || '解析失败'}）`, real === monaFace && fs.existsSync(real))
    // 不存在的角色：miao 与 Atlas 都拿不到 → 空串（模板据此落到文字占位）
    push('没有资源的名字 → 空串（不抛错）', TV.localFaceUrl('不存在的角色ZZZ'), '')
  } else {
    console.log(`跳过：未找到 miao 资源（${miaoRoot}）—— 兜底头像路径未校验`)
    ok('miao 缺席时 localFaceUrl 也不抛错', typeof TV.localFaceUrl('莫娜') === 'string')
  }
}

// ---------- 2. 成员视图：两级来源单选（有站点图就不填兜底） ----------
{
  const mona = CI.findCharacter('莫娜')
  const id = String(mona?.character_id || '')
  const members = [{ charId: '莫娜', constellation: 2 }]

  const empty = TV.memberViews(members)[0]
  push('站点立绘没缓存 → avatar 为空（模板不会渲染 _data_path 裂图）', empty.avatar, '')
  push('站点立绘没缓存 → 填 faceSrc 作为兜底', empty.faceSrc, TV.localFaceUrl('莫娜'))
  ok('命座与展示字段不受影响', empty.name === '莫娜' && empty.cText === 'C2' && empty.constellation === 2)

  // 造一张"已缓存"的站点立绘（内容无所谓，只要求文件存在且非空）
  const cachedFile = AV.avatarFile(id)
  fs.writeFileSync(cachedFile, Buffer.from([0x52, 0x49, 0x46, 0x46]), null)
  const cached = TV.memberViews(members)[0]
  push('站点立绘已缓存 → avatar 给 id', cached.avatar, id)
  push('站点立绘已缓存 → faceSrc 留空（来源单选，不叠两套图）', cached.faceSrc, '')
  push('avatarStats 认到这张缓存', AV.avatarStats([id]), { total: 1, cached: 1 })

  const unknown = TV.memberViews([{ charId: '不存在的角色ZZZ', constellation: 0 }])[0]
  ok('查不到记录的名字：两个来源都空 → 落到文字占位', unknown.avatar === '' && unknown.faceSrc === '')
}

// ---------- 3. 补图状态：联网关闭 / 本次无目标 / 全部已缓存 ----------
{
  const id = String(CI.findCharacter('莫娜')?.character_id || '')

  const off = await AV.ensureAvatars([id])
  const offStatus = AV.avatarFillStatus()
  push('联网关闭：不下载、不报失败', { downloaded: off.downloaded, failed: off.failed }, { downloaded: 0, failed: 0 })
  push('联网关闭：状态记 network-off（状态页据此写"跳过下载"）', offStatus?.reason, 'network-off')
  push('联网关闭：已缓存的张数照实统计', { total: offStatus?.total, cached: offStatus?.cached }, { total: 1, cached: 1 })

  const none = await AV.ensureAvatars([])
  push('没有目标 id → 总数 0', none.total, 0)
  push('没有目标 id → no-targets', AV.avatarFillStatus()?.reason, 'no-targets')

  // 联网开着但一张不缺：队列为空，不会真的发请求（所以这条断言离线也安全）
  writeCfg(true)
  const all = await AV.ensureAvatars([id])
  const allStatus = AV.avatarFillStatus()
  push('全都已缓存 → 不下载', { downloaded: all.downloaded, failed: all.failed }, { downloaded: 0, failed: 0 })
  push('全都已缓存 → 状态记 all-cached', allStatus?.reason, 'all-cached')
  push('全都已缓存 → cached 等于 total', { cached: allStatus?.cached, total: allStatus?.total }, { cached: 1, total: 1 })
  writeCfg(false)

  // 清空缓存后 resetAvatars 要把状态一起清掉（否则状态页会显示上一轮的旧结论）
  AV.resetAvatars()
  push('resetAvatars 清空状态', AV.avatarFillStatus(), null)
  push('resetAvatars 清空缓存文件', AV.avatarStats().cached, 0)
}

// ---------- 4. 模板：avatar → faceSrc → 文字 三级回落 ----------
{
  const TPLS = {
    'rank.html': 'c',
    'raid.html': 'c',
    'char-dps.html': 'c',
    'tiers.html': 'c',
    'grade.html': 'c', // 单行写法：{{if}}<img/>{{else if}}<img/>{{else}}<div>{{/if}}
    'team-damage.html': 'm'
  }
  const missing = []
  for (const [file, v] of Object.entries(TPLS)) {
    const html = readText(path.join(pluginRoot, 'resources', 'dps', file))
    const iAvatar = html.indexOf(`{{if ${v}.avatar}}`)
    const iFace = html.indexOf(`{{else if ${v}.faceSrc}}`)
    const iText = html.indexOf('avatar-text')
    const branch = new RegExp(`\\{\\{else if ${v}\\.faceSrc\\}\\}[\\s\\S]{0,160}?<img class="avatar-img" src="\\{\\{${v}\\.faceSrc\\}\\}"/>`)
    if (iAvatar < 0 || iFace < 0 || iText < 0 || !(iAvatar < iFace && iFace < iText) || !branch.test(html)) missing.push(file)
  }
  push('六个头像模板都按 avatar → faceSrc → 文字 依次回落', missing, [])
}

// ---------- 5. 状态页：补图结果可见 ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'status.ts'))
  ok('状态页读 avatarFillStatus()', src.includes("from '../model/AvatarStore.js'") && src.includes('avatarFillStatus()'))
  ok('状态页把补图结果写进数据与文本回退', src.includes('avatarFillText:') && src.includes('上次补图：${data.avatarFillText}'))
  ok('联网关闭 / 全部命中 / 从未补过 都有对应文案',
    src.includes("case 'network-off'") && src.includes("case 'all-cached'") && src.includes('尚未补过图'))
  const tpl = readText(path.join(pluginRoot, 'resources', 'dps', 'status.html'))
  ok('状态页模板渲染补图行', /上次补图：\{\{avatarFillText\}\}/.test(tpl))
  ok('补图统计只在模型层算（状态页不自己拼 downloaded/failed）', !/downloaded:\s*0,\s*failed:\s*0/.test(src))
}

const bad = report()
process.exit(bad ? 1 : 0)