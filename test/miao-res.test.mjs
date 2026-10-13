/**
 * 资源层自检（阶段 2）
 *
 * 三层：
 *   1. **纯函数**：`parseAliasModule()` 对 miao 别名文件的宽松解析（引号键 / 裸键 / 逗号值 / 尾随逗号）；
 *   2. **降级**：把资源根指向不存在的目录时，所有取图/别名接口都必须返回空且**不抛错**；
 *   3. **真实资源**（需要 miao 在场）：立绘 / 命座 / 武器 / 圣遗物 路径真实存在、索引规模合理、别名解析可用。
 *
 * miao 目录：`META_MIAO_DIR` 优先；否则按 `<插件根>/../miao-plugin` 找（bot 部署里就是同级）。
 * 两处都没有 → 打印「跳过」并 exit 0（开发工作区默认如此）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot } from './_helper.mjs'

const { push, ok, report } = createChecks('资源层（MiaoRes / IconResolver / AtlasRes）')

const miaoFile = path.join(libDir, 'model', 'MiaoRes.js')
const iconFile = path.join(libDir, 'model', 'IconResolver.js')
const atlasFile = path.join(libDir, 'model', 'AtlasRes.js')
ok('lib/model/MiaoRes.js 存在', fs.existsSync(miaoFile))
ok('lib/model/IconResolver.js 存在', fs.existsSync(iconFile))
ok('lib/model/AtlasRes.js 存在', fs.existsSync(atlasFile))
if (!fs.existsSync(miaoFile) || !fs.existsSync(iconFile) || !fs.existsSync(atlasFile)) {
  report()
  process.exit(1)
}

const { MiaoRes, parseAliasModule } = await import(pathToFileURL(miaoFile).href)
const { iconForRef, weaponIcon, artifactIcon, consIcon, characterSplash, characterFace } = await import(pathToFileURL(iconFile).href)
const { AtlasRes } = await import(pathToFileURL(atlasFile).href)

// ---------- 1. 纯函数：别名文件解析 ----------
{
  const sample = [
    'export const alias = {',
    '  // 1.0',
    "  琴: 'Jean,团长,代理团长',",
    '  丽莎: "Lisa,阿姨",',
    "  空: '男主,龙哥',",
    '}'
  ].join('\n')
  const table = parseAliasModule(sample)
  push('解析引号键与裸键', { 琴: table.琴, 丽莎: table.丽莎, 空: table.空 }, { 琴: 'Jean,团长,代理团长', 丽莎: 'Lisa,阿姨', 空: '男主,龙哥' })
  push('注释行不影响解析', Object.keys(table).length, 3)
  push('空文本 → 空表', parseAliasModule(''), {})
}

// ---------- 2. 降级：资源根不存在 ----------
{
  const bogusRoot = path.join(pluginRoot, 'test', '.test-tmp', 'no-such-miao', 'resources')
  fs.rmSync(path.dirname(bogusRoot), { recursive: true, force: true })
  const bogus = new MiaoRes(bogusRoot)

  let threw = false
  let status = null
  let splash = 'x'
  let cons = 'x'
  let weapon = 'x'
  let artifact = 'x'
  let aliases = null
  let resolve = 'x'
  try {
    status = bogus.status()
    splash = bogus.characterImage('胡桃')
    cons = bogus.consIcon('胡桃', 2)
    weapon = bogus.weaponIcon('护摩之杖')
    artifact = bogus.artifactIcon('炽烈的炎之魔女')
    aliases = bogus.aliases('character')
    resolve = bogus.resolveName('character', '桃')
  } catch {
    threw = true
  }
  ok('资源根不存在也不抛错', !threw)
  push('status.ok === false', status?.ok, false)
  ok('status.missing 非空', Array.isArray(status?.missing) && status.missing.length > 0)
  push('立绘 → null', splash, null)
  push('命座 → null', cons, null)
  push('武器 → null', weapon, null)
  push('圣遗物 → null', artifact, null)
  push('别名表 → 空表', aliases, {})
  push('别名解析 → null', resolve, null)
  ok('available === false', bogus.available === false)

  // Atlas 缺失同样不得抛错
  const bogusAtlas = new AtlasRes(path.join(pluginRoot, 'test', '.test-tmp', 'no-such-atlas'))
  let atlasThrew = false
  let atlasStatus = null
  try {
    atlasStatus = bogusAtlas.status()
  } catch {
    atlasThrew = true
  }
  ok('Atlas 缺失不抛错', !atlasThrew)
  push('Atlas status.present === false', atlasStatus?.present, false)
  push('Atlas available() === false', bogusAtlas.available(), false)
  push('Atlas icon() 预留返回 null', bogusAtlas.icon('weapon', '护摩之杖'), null)
}

// ---------- 3. 真实资源（miao 在场时）----------
const miaoDir = process.env.META_MIAO_DIR || path.resolve(pluginRoot, '..', 'miao-plugin')
const miaoRoot = path.join(miaoDir, 'resources')
const hasMiao = fs.existsSync(path.join(miaoRoot, 'meta-gs', 'character'))

if (!hasMiao) {
  console.log(`跳过：未找到 miao 资源（${miaoRoot}）；bot 部署里它是同级插件，开发工作区可设 META_MIAO_DIR`)
} else {
  const res = new MiaoRes(miaoRoot)

  push('status.ok', res.status().ok, true)
  const counts = res.counts()
  ok('立绘索引规模 ≥ 90', counts.character >= 90)
  ok('武器索引规模 ≥ 200', counts.weapon >= 200)
  ok('圣遗物索引规模 ≥ 50', counts.artifact >= 50)

  const splash = res.characterImage('胡桃')
  ok('胡桃立绘路径存在', !!splash && fs.existsSync(path.join(miaoRoot, splash)))
  ok('胡桃立绘在 imgs/ 下', String(splash).includes('meta-gs/character/胡桃/imgs/'))
  const cons = res.consIcon('胡桃', 2)
  ok('胡桃二命图标存在', !!cons && fs.existsSync(path.join(miaoRoot, cons)))
  const weapon = res.weaponIcon('护摩之杖')
  ok('护摩之杖图标存在', !!weapon && fs.existsSync(path.join(miaoRoot, weapon)))
  const arti = res.artifactIcon('炽烈的炎之魔女')
  ok('炽烈的炎之魔女套装图存在', !!arti && fs.existsSync(path.join(miaoRoot, arti)))

  // 别名：data-driven（取表里第一条，验证"别名 → 标准名"能命中）
  const table = res.aliases('character')
  const firstKey = Object.keys(table)[0]
  const firstAlias = String(table[firstKey] ?? '').split(/[,，]/)[0]
  ok('别名表非空', !!firstKey)
  if (firstKey && firstAlias) {
    push(`别名解析：${firstAlias} → ${firstKey}`, res.resolveName('character', firstAlias), firstKey)
  }
  push('标准名本身也认', res.resolveName('character', firstKey), firstKey)
  push('不存在的名字 → null', res.resolveName('character', '这个名字不存在'), null)

  // IconResolver 走 ref 解析
  const byRef = iconForRef('weapon:护摩之杖')
  push('ref 解析武器：source', byRef?.source, 'miao')
  ok('ref 解析武器：路径存在', !!byRef && fs.existsSync(path.join(miaoRoot, byRef.rel)))
  const consRef = iconForRef('constellation:2', { character: '胡桃' })
  ok('ref 解析命座（需上下文）', !!consRef && fs.existsSync(path.join(miaoRoot, consRef.rel)))
  push('ref 解析命座缺上下文 → null', iconForRef('constellation:2'), null)
  push('未知 ref 前缀 → null', iconForRef('nonsense:xxx'), null)
  push('空 ref → null', iconForRef(''), null)
  push('不认识的名字 → null', weaponIcon('这把武器不存在'), null)
  ok('characterFace 有值', !!characterFace('胡桃'))
  ok('characterSplash(card) 有值', !!characterSplash('胡桃', 'card'))
}

delete process.env.META_MIAO_DIR
const bad = report()
process.exit(bad ? 1 : 0)
