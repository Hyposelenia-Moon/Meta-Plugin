/**
 * 数据层自检（阶段 1.1）
 *
 * 分两层：
 *  1. **真实数据**：对 `data/gi` 跑一遍，断言"列表 = 有内容的角色"、"空档不进列表"、
 *     专武/武器标签/索引可读；填充与空档的口径由套件**独立重算**后与 store 对比（数据增长不会误报）。
 *  2. **临时夹具**：在 `test/.test-tmp/codex-store/` 造最小数据集，验证顺序保持、缺失文件不抛错、
 *     `(mtime,size)` 签名失效、`invalidate()`、相对上一级找 `_index.json`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, dataDir, ensureTmp, libDir } from './_helper.mjs'

const { push, ok, report } = createChecks('数据层（CodexStore）')

const storeFile = path.join(libDir, 'model', 'CodexStore.js')
ok('lib/model/CodexStore.js 存在（先跑 pnpm build）', fs.existsSync(storeFile))
if (!fs.existsSync(storeFile)) {
  report()
  process.exit(1)
}

const { CodexStore } = await import(pathToFileURL(storeFile).href)
const { listGuidePresets, selectGuidePreset } = await import(pathToFileURL(path.join(libDir, 'modules', 'guidePresets.js')).href)

// ---------- 1. 真实数据 ----------
const real = new CodexStore()
const all = real.listAll()
const listed = real.listCharacters()

ok('_order 读到角色（≥ 120）', all.length >= 120)
ok('列表非空', listed.length > 0)
ok('列表是 _order 的子集', listed.every(n => all.includes(n)))
ok('列表不含空档角色', listed.every(n => real.isFilled(n)))
push('列表 + 空档 = 全部', listed.length + real.stats().empty.length, all.length)

// 独立重算「有内容 / 空档」，与 store 对比（口径：meta 任一字段非空）
const giDir = path.join(dataDir, 'gi')
const expectEmpty = []
for (const name of all) {
  const f = path.join(giDir, `${name}.json`)
  let guide = null
  try {
    guide = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    expectEmpty.push(name)
    continue
  }
  const filled = listGuidePresets(guide).some(preset =>
    Object.values(preset.meta).some(v => String(v ?? '').trim().length > 0))
  if (!filled) expectEmpty.push(name)
}
push('空档名单与独立重算一致', [...real.stats().empty].sort(), [...expectEmpty].sort())
push('stats.total == _order 条数', real.stats().total, all.length)
push('stats.filled == 列表长度', real.stats().filled, listed.length)
ok('stats.generatedAt 可读（数据版本）', typeof real.stats().generatedAt === 'string' && real.stats().generatedAt.length > 0)

// 已知角色
ok('含 胡桃', all.includes('胡桃'))
const rawHutao = real.getGuide('胡桃')
const hutaoPresets = listGuidePresets(rawHutao)
ok('胡桃 有独立预设', hutaoPresets.length > 0)
const hutao = selectGuidePreset(rawHutao, hutaoPresets[0])
ok('胡桃 攻略可读', !!hutao)
ok('胡桃 v2.weapons 非空', Array.isArray(hutao?.v2?.weapons) && hutao.v2.weapons.length > 0)
ok('胡桃 武器档位含 items', Array.isArray(hutao?.v2?.weapons?.[0]?.items) && hutao.v2.weapons[0].items.length > 0)
ok('胡桃 meta.定位 有值', String(hutao?.meta?.定位 ?? '').trim().length > 0)
ok('isFilled("胡桃") === true', real.isFilled('胡桃') === true)
// 2026-10-18 复审：米提亚已补数据，空档语义改用「库里不存在的名字」验证，不再绑定真实角色
ok('isFilled(不存在的角色) === false（空档）', real.isFilled('空档夹具·不存在的角色') === false)

// 专武 / 武器标签 / 索引
const sig = real.getSignature('胡桃')
ok('胡桃 有专武记录', !!sig && String(sig.专武 ?? '').trim().length > 0)
const sigKeys = Object.keys(real.allSignatures())
ok('专武表规模合理（≥ 50）', sigKeys.length >= 50)
ok('专武表的键都属于已收录角色', sigKeys.every(n => all.includes(n)))
const tags = real.getWeaponTags()
ok('武器标签含「活动」组', Array.isArray(tags.活动) && tags.活动.length > 0)
const index = real.getIndex()
ok('索引 characters 是数组', Array.isArray(index.characters))
ok('索引 weapons/artifacts 是数组', Array.isArray(index.weapons) && Array.isArray(index.artifacts))

// 名称解析
push('findCharacter 精确', real.findCharacter('胡桃'), '胡桃')
push('findCharacter 去空白', real.findCharacter('  胡桃  '), '胡桃')
push('findCharacter 未命中 → null', real.findCharacter('这个名字不存在'), null)
push('findCharacter 空串 → null', real.findCharacter(''), null)
ok('findCharacter 唯一包含命中', real.findCharacter('胡桃') !== null)

// 缓存：同一对象返回同一引用
ok('getGuide 命中缓存（同一引用）', real.getGuide('胡桃') === real.getGuide('胡桃'))

// ---------- 2. 临时夹具 ----------
const tmp = ensureTmp()
const root = path.join(tmp, 'codex-store')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
writeJson(path.join(root, '_order.json'), ['甲', '乙', '丙'])
writeJson(path.join(root, '甲.json'), { name: '甲', meta: { 定位: '主C' }, v2: { weapons: [{ items: [{ name: '某武器' }] }] } })
writeJson(path.join(root, '乙.json'), { name: '乙', meta: {}, v2: {} })
writeJson(path.join(root, '_signature.json'), { 甲: { 专武: '某武器' } })
writeJson(path.join(root, '_weapon-tags.json'), { 活动: ['某武器'] })
writeJson(path.join(tmp, '_index.json'), { generatedAt: '2026-01-01T00:00:00.000Z', characters: ['甲', '乙'] })

const fx = new CodexStore(root)
push('夹具：顺序按 _order 保持', fx.listAll(), ['甲', '乙', '丙'])
push('夹具：列表只含填充角色', fx.listCharacters(), ['甲'])
push('夹具：空 meta 视为空档', fx.isFilled('乙'), false)
push('夹具：缺失文件 → null（不抛错）', fx.getGuide('丙'), null)
push('夹具：索引从上一级读取', fx.getIndex().generatedAt, '2026-01-01T00:00:00.000Z')
push('夹具：专武表可读', fx.getSignature('甲')?.专武, '某武器')
push('夹具：未在专武表 → null', fx.getSignature('乙'), null)
push('夹具：stats', { total: fx.stats().total, filled: fx.stats().filled, empty: fx.stats().empty }, { total: 3, filled: 1, empty: ['乙', '丙'] })

// 签名失效：改内容 + 强制改 mtime
const jiaFile = path.join(root, '甲.json')
writeJson(jiaFile, { name: '甲', meta: { 定位: '副C（已改）' }, v2: {} })
const future = new Date(Date.now() + 5000)
fs.utimesSync(jiaFile, future, future)
push('签名失效：内容更新后读到新值', fx.getGuide('甲')?.meta?.定位, '副C（已改）')

// invalidate：清缓存后仍正确
fx.invalidate()
push('invalidate 后 listAll 一致', fx.listAll(), ['甲', '乙', '丙'])
push('invalidate 后列表一致', fx.listCharacters(), ['甲'])

delete process.env.META_CONFIG_FILE
const bad = report()
process.exit(bad ? 1 : 0)
