import assert from 'node:assert/strict'
import fs from 'node:fs'

import { mod } from './_helper.mjs'

const { validateDataPack } = await import(mod('modules/teamSimulation/dataPack.js'))

const roster = JSON.parse(fs.readFileSync(new URL('../data/team-sim/roster.json', import.meta.url), 'utf8'))
const packsDir = new URL('../data/team-sim/packs/', import.meta.url)
const packFiles = fs.readdirSync(packsDir).filter(name => name.endsWith('.json'))

// 名录自身要自洽：数量、状态、charId 与键都不能重复。
const STATUSES = ['mapped', 'traveler', 'alias', 'no-gcsim']
assert.equal(roster.schemaVersion, 1)
assert.equal(roster.gameVersion, '7.1')
assert.ok(roster.source.includes('names.dm.json') || roster.source.includes('character.dm.go'))
assert.equal(roster.characters.length, 127)
assert.equal(roster.counts.characters, roster.characters.length)
for (const character of roster.characters) {
  assert.ok(STATUSES.includes(character.status), `未知状态 ${character.status}`)
  assert.ok(character.charId && character.cn, '每个角色都要有 charId 与中文名')
}
const ids = roster.characters.map(character => character.charId)
assert.equal(new Set(ids).size, ids.length, 'charId 不能重复')
const keys = roster.characters.flatMap(character => character.keys)
assert.equal(new Set(keys).size, keys.length, '英文键不能重复')

// 旅行者按 charId 拆成七个元素键，其余状态不为 mapped 的不能带键。
const traveler = roster.characters.filter(character => character.status === 'traveler')
assert.equal(traveler.length, 2)
for (const character of traveler) assert.equal(character.keys.length, 7, `${character.cn} 应该有七个元素键`)
for (const character of roster.characters.filter(character => character.status === 'no-gcsim')) assert.equal(character.keys.length, 0)

// 除凝光外，每个 mapped 角色都要有数据包：凝光的普攻按左右手状态交替、天赋也只给单行「普通攻击伤害」，
// 不在自动生成的范围内，必须显式列在例外里，不能悄悄消失。
const mapped = roster.characters.filter(character => character.status === 'mapped')
const packKeys = new Set(packFiles.map(name => name.replace(/\.json$/, '')))
const missing = mapped.filter(character => !packKeys.has(character.keys[0])).map(character => character.keys[0])
assert.deepEqual(missing, ['ningguang'])
assert.equal(packFiles.length, mapped.length - 1)

// 每个包都要通过内核的数据包校验，且动作 id 认得出所属角色。
const allActions = new Map()
let multiHitActions = 0
for (const name of packFiles) {
  const pack = JSON.parse(fs.readFileSync(new URL(name, packsDir), 'utf8'))
  const check = validateDataPack(pack)
  assert.deepEqual(check.issues, [], `${name} 校验未通过：${JSON.stringify(check.issues)}`)
  assert.equal(pack.gameVersion, roster.gameVersion)
  const key = name.replace(/\.json$/, '')
  for (const action of Object.values(pack.actions)) {
    assert.ok(action.id.startsWith(`${key}.`), `${name} 的动作 ${action.id} 与角色不对应`)
    // 自动生成的普攻必须落在 normal- 序号上；人工核对动作（战技/爆发）按种类命名。
    if (action.kind === 'normal') assert.ok(action.id.startsWith(`${key}.normal-`), `${name} 的普攻 ${action.id} 命名不对`)
    else assert.ok(['skill', 'burst', 'charged'].includes(action.kind), `${name} 的动作 ${action.id} 种类未知：${action.kind}`)
    assert.equal(allActions.has(action.id), false, `动作 id 重复：${action.id}`)
    allActions.set(action.id, action)
    // 施放本身无伤害的爆发（行秋/纳西妲）允许显式空 hits；普攻不允许，且无伤害动作必须有冷却
    if (!action.hits.length) {
      assert.notEqual(action.kind, 'normal', `${action.id} 普攻不能没有命中`)
      assert.ok(Number(action.cooldownFrames) > 0, `${action.id} 无伤害动作必须有冷却`)
      continue
    }
    // 2026-11-02：延迟命中（`delayed`）允许落在动作结束后（旋火轮/召唤物持续伤害），普通命中仍必须在动作内。
    for (const hit of action.hits) if (hit.delayed !== true) assert.ok(hit.atFrame < action.timing.frames, `${action.id} 命中帧必须早于动作结束`)
    for (let i = 1; i < action.hits.length; i++) assert.ok(action.hits[i].atFrame >= action.hits[i - 1].atFrame, `${action.id} 命中帧必须递增`)
    if (action.hits.length > 1) multiHitActions++
  }
}
assert.ok(multiHitActions >= 20, `多段命中动作只有 ${multiHitActions} 个，像是整段解析失效`)

// 数值抽查：荒泷一斗 N1 取 miao 天赋 10 级（156.62%），命中帧与收尾帧取自 gcsim。
const itto = JSON.parse(fs.readFileSync(new URL('aratakiitto.json', packsDir), 'utf8'))
assert.equal(itto.actions['aratakiitto.normal-1'].hits[0].motionValue, 1.5662)
assert.equal(itto.actions['aratakiitto.normal-1'].hits[0].atFrame, 23)
assert.equal(itto.actions['aratakiitto.normal-1'].timing.frames, 41)
assert.equal(itto.actions['aratakiitto.normal-4'].timing.frames, 83)
assert.equal(itto.actions['aratakiitto.normal-1'].element, 'physical')

// 法器角色的普攻天生带元素，单手剑/双手剑/长柄/弓的附魔态一律按物理落包。
const catalyst = JSON.parse(fs.readFileSync(new URL('nahida.json', packsDir), 'utf8'))
assert.equal(catalyst.actions['nahida.normal-1'].element, 'dendro')
const infused = JSON.parse(fs.readFileSync(new URL('raidenshogun.json', packsDir), 'utf8'))
assert.equal(infused.actions['raidenshogun.normal-1'].element, 'physical')

// 同段多命中：整段合计（香菱 N4 111.52%、N3 103.02%）按 miao「N段伤害2」还原成逐帧倍率，
// 与 gcsim 数据表里的单帧值（27.88%、51.51%）一致；不同值的多段（胡桃 N5）按原样逐帧展开。
const xiangling = JSON.parse(fs.readFileSync(new URL('xiangling.json', packsDir), 'utf8'))
const n3 = xiangling.actions['xiangling.normal-3'].hits
const n4 = xiangling.actions['xiangling.normal-4'].hits
assert.deepEqual(n3.map((h) => h.motionValue), [0.5151, 0.5151])
assert.deepEqual(n4.map((h) => h.motionValue), [0.2788, 0.2788, 0.2788, 0.2788])
assert.deepEqual(n4.map((h) => h.atFrame), [5, 15, 24, 29])
const hutao = JSON.parse(fs.readFileSync(new URL('hutao.json', packsDir), 'utf8'))
const hutaoN5 = hutao.actions['hutao.normal-5'].hits
assert.deepEqual(hutaoN5.map((h) => h.motionValue), [0.5936, 0.628])

// 人工核对动作目前只有纯岩四人的战技/爆发，逐项钉住数值与口径，避免以后静默扩张或改数。
const geoPack = key => JSON.parse(fs.readFileSync(new URL(`${key}.json`, packsDir), 'utf8'))
const zhongli = geoPack('zhongli')
assert.deepEqual(
  { frames: zhongli.actions['zhongli.skill'].timing.frames, atFrame: zhongli.actions['zhongli.skill'].hits[0].atFrame, mv: zhongli.actions['zhongli.skill'].hits[0].motionValue, cd: zhongli.actions['zhongli.skill'].cooldownFrames },
  { frames: 96, atFrame: 48, mv: 1.44, cd: 720 })
assert.deepEqual(
  { frames: zhongli.actions['zhongli.burst'].timing.frames, atFrame: zhongli.actions['zhongli.burst'].hits[0].atFrame, mv: zhongli.actions['zhongli.burst'].hits[0].motionValue, cost: zhongli.actions['zhongli.burst'].energyCost },
  { frames: 139, atFrame: 101, mv: 8.9972, cost: 40 })
const albedo = geoPack('albedo')
assert.deepEqual(
  { frames: albedo.actions['albedo.skill'].timing.frames, atFrame: albedo.actions['albedo.skill'].hits[0].atFrame, mv: albedo.actions['albedo.skill'].hits[0].motionValue, particles: albedo.actions['albedo.skill'].particles },
  { frames: 33, atFrame: 25, mv: 2.3472, particles: [{ atFrame: 25, count: 1, element: 'geo', travelFrames: 0 }] })
assert.equal(albedo.actions['albedo.burst'].hits[0].motionValue, 6.6096)
const gorou = geoPack('gorou')
assert.deepEqual(
  { atFrame: gorou.actions['gorou.skill'].hits[0].atFrame, mv: gorou.actions['gorou.skill'].hits[0].motionValue, count: gorou.actions['gorou.skill'].particles[0].count },
  { atFrame: 34, mv: 1.9296, count: 2 })
assert.deepEqual(
  { scaling: gorou.actions['gorou.burst'].hits[0].scaling, mv: gorou.actions['gorou.burst'].hits[0].motionValue, cost: gorou.actions['gorou.burst'].energyCost },
  { scaling: 'def', mv: 1.767888, cost: 80 })
const ittoCurated = geoPack('aratakiitto')
assert.deepEqual(
  { frames: ittoCurated.actions['aratakiitto.skill'].timing.frames, atFrame: ittoCurated.actions['aratakiitto.skill'].hits[0].atFrame, mv: ittoCurated.actions['aratakiitto.skill'].hits[0].motionValue, count: ittoCurated.actions['aratakiitto.skill'].particles[0].count },
  { frames: 42, atFrame: 18, mv: 5.5296, count: 3 })
// 一斗爆发不造成伤害，包内不该出现爆发动作。
assert.equal(ittoCurated.actions['aratakiitto.burst'], undefined)

// 2026-11-02 第一批人工核对动作：抽查命中帧、倍率、能量、产球元素与冷却。
const bennett = geoPack('bennett')
assert.deepEqual(
  { frames: bennett.actions['bennett.skill'].timing.frames, atFrame: bennett.actions['bennett.skill'].hits[0].atFrame, mv: bennett.actions['bennett.skill'].hits[0].motionValue, cd: bennett.actions['bennett.skill'].cooldownFrames, particle: bennett.actions['bennett.skill'].particles[0] },
  { frames: 42, atFrame: 16, mv: 2.4768, cd: 240, particle: { atFrame: 16, count: 2, element: 'pyro', travelFrames: 0 } })
assert.deepEqual(
  { mv: bennett.actions['bennett.burst'].hits[0].motionValue, cost: bennett.actions['bennett.burst'].energyCost, cd: bennett.actions['bennett.burst'].cooldownFrames },
  { mv: 4.1904, cost: 60, cd: 900 })
const xingqiu = geoPack('xingqiu')
assert.deepEqual(xingqiu.actions['xingqiu.skill'].hits.map(h => h.atFrame), [12, 31])
assert.deepEqual(xingqiu.actions['xingqiu.skill'].hits.map(h => h.motionValue), [3.024, 3.4416])
assert.equal(xingqiu.actions['xingqiu.skill'].cooldownFrames, 1260)
assert.equal(xingqiu.actions['xingqiu.burst'].hits.length, 0, '行秋爆发施放本身无伤害，hits 必须为空数组')
assert.equal(xingqiu.actions['xingqiu.burst'].energyCost, 80)
const kazuha = JSON.parse(fs.readFileSync(new URL('kaedeharakazuha.json', packsDir), 'utf8'))
assert.deepEqual(
  { frames: kazuha.actions['kaedeharakazuha.burst'].timing.frames, atFrame: kazuha.actions['kaedeharakazuha.burst'].hits[0].atFrame, mv: kazuha.actions['kaedeharakazuha.burst'].hits[0].motionValue, cost: kazuha.actions['kaedeharakazuha.burst'].energyCost },
  { frames: 93, atFrame: 82, mv: 4.7232, cost: 60 })
assert.equal(kazuha.actions['kaedeharakazuha.skill'].particles[0].element, 'anemo')
// 2026-11-02 第二批人工核对动作：香菱（锅巴/旋火轮未建模，只有爆发本体 3 段）与夜兰（生命值倍率）。
{
  const xiangling = geoPack('xiangling')
  assert.equal(xiangling.actions['xiangling.skill'].hits.length, 0, '香菱战技施放本身无伤害（锅巴未建模）')
  assert.deepEqual(
    {
      frames: xiangling.actions['xiangling.burst'].timing.frames,
      burstHits: xiangling.actions['xiangling.burst'].hits.filter(h => h.delayed !== true).map(h => h.atFrame),
      spinCount: xiangling.actions['xiangling.burst'].hits.filter(h => h.delayed === true).length,
      spinMv: xiangling.actions['xiangling.burst'].hits.find(h => h.delayed === true)?.motionValue,
      element: xiangling.actions['xiangling.burst'].hits[0].element,
      cost: xiangling.actions['xiangling.burst'].energyCost,
      cd: xiangling.actions['xiangling.burst'].cooldownFrames
    },
    // 2026-11-02 起补了旋火轮 9 段延迟伤害（第 56 帧起每 73 帧一次，10 秒）
    { frames: 80, burstHits: [18, 33, 57], spinCount: 9, spinMv: 2.016, element: 'pyro', cost: 80, cd: 1200 })
  const yelan = geoPack('yelan')
  assert.deepEqual(
    { frames: yelan.actions['yelan.skill'].timing.frames, atFrame: yelan.actions['yelan.skill'].hits[0].atFrame, mv: yelan.actions['yelan.skill'].hits[0].motionValue, scaling: yelan.actions['yelan.skill'].hits[0].scaling, particle: yelan.actions['yelan.skill'].particles[0] },
    { frames: 42, atFrame: 35, mv: 0.407, scaling: 'hp', particle: { atFrame: 35, count: 4, element: 'hydro', travelFrames: 0 } })
  assert.deepEqual(
    { atFrame: yelan.actions['yelan.burst'].hits[0].atFrame, mv: yelan.actions['yelan.burst'].hits[0].motionValue, cost: yelan.actions['yelan.burst'].energyCost, cd: yelan.actions['yelan.burst'].cooldownFrames },
    { atFrame: 76, mv: 0.1315, cost: 70, cd: 1080 })

  const fischl = geoPack('fischl')
  assert.deepEqual(
    { atFrame: fischl.actions['fischl.skill'].hits[0].atFrame, mv: fischl.actions['fischl.skill'].hits[0].motionValue, cd: fischl.actions['fischl.skill'].cooldownFrames },
    { atFrame: 38, mv: 1.96248, cd: 1518 })
  assert.deepEqual(
    { atFrame: fischl.actions['fischl.burst'].hits[0].atFrame, mv: fischl.actions['fischl.burst'].hits[0].motionValue, cost: fischl.actions['fischl.burst'].energyCost, frames: fischl.actions['fischl.burst'].timing.frames },
    { atFrame: 18, mv: 3.744, cost: 60, frames: 148 })

  const yaemiko = geoPack('yaemiko')
  assert.equal(yaemiko.actions['yaemiko.skill'].hits.length, 0, '八重战技施放本身无伤害（杀生樱未建模）')
  assert.deepEqual(
    { atFrame: yaemiko.actions['yaemiko.burst'].hits[0].atFrame, mv: yaemiko.actions['yaemiko.burst'].hits[0].motionValue, cost: yaemiko.actions['yaemiko.burst'].energyCost, frames: yaemiko.actions['yaemiko.burst'].timing.frames },
    { atFrame: 100, mv: 4.68, cost: 90, frames: 114 })

  const kuki = geoPack('kukishinobu')
  assert.deepEqual(
    { atFrame: kuki.actions['kukishinobu.skill'].hits[0].atFrame, mv: kuki.actions['kukishinobu.skill'].hits[0].motionValue, cd: kuki.actions['kukishinobu.skill'].cooldownFrames },
    { atFrame: 11, mv: 1.3628, cd: 900 })
  // 久岐忍爆发是场地 7 段；只有第 1 段落在动画内，其余会被下一个动作取消，只建模 1 段。
  assert.deepEqual(
    { count: kuki.actions['kukishinobu.burst'].hits.length, atFrame: kuki.actions['kukishinobu.burst'].hits[0].atFrame, mv: kuki.actions['kukishinobu.burst'].hits[0].motionValue, scaling: kuki.actions['kukishinobu.burst'].hits[0].scaling, cost: kuki.actions['kukishinobu.burst'].energyCost },
    { count: 1, atFrame: 50, mv: 0.0649, scaling: 'hp', cost: 60 })
  const columbina = geoPack('columbina')
  assert.deepEqual(
    { frames: columbina.actions['columbina.skill'].timing.frames, atFrame: columbina.actions['columbina.skill'].hits[0].atFrame, mv: columbina.actions['columbina.skill'].hits[0].motionValue, scaling: columbina.actions['columbina.skill'].hits[0].scaling },
    { frames: 41, atFrame: 21, mv: 0.30096, scaling: 'hp' })
  assert.deepEqual(
    { frames: columbina.actions['columbina.burst'].timing.frames, atFrame: columbina.actions['columbina.burst'].hits[0].atFrame, mv: columbina.actions['columbina.burst'].hits[0].motionValue, cost: columbina.actions['columbina.burst'].energyCost },
    { frames: 131, atFrame: 110, mv: 0.58032, cost: 60 })

  const xilonen = geoPack('xilonen')
  assert.deepEqual(
    { frames: xilonen.actions['xilonen.skill'].timing.frames, atFrame: xilonen.actions['xilonen.skill'].hits[0].atFrame, mv: xilonen.actions['xilonen.skill'].hits[0].motionValue, scaling: xilonen.actions['xilonen.skill'].hits[0].scaling, cd: xilonen.actions['xilonen.skill'].cooldownFrames, particle: xilonen.actions['xilonen.skill'].particles[0] },
    { frames: 20, atFrame: 6, mv: 3.0464, scaling: 'def', cd: 420, particle: { atFrame: 6, count: 4, element: 'geo', travelFrames: 0 } })
  assert.deepEqual(
    { atFrame: xilonen.actions['xilonen.burst'].hits[0].atFrame, mv: xilonen.actions['xilonen.burst'].hits[0].motionValue, cost: xilonen.actions['xilonen.burst'].energyCost, cd: xilonen.actions['xilonen.burst'].cooldownFrames },
    { atFrame: 96, mv: 4.7818, cost: 60, cd: 900 })

  const sucrose = geoPack('sucrose')
  assert.deepEqual(
    { frames: sucrose.actions['sucrose.skill'].timing.frames, atFrame: sucrose.actions['sucrose.skill'].hits[0].atFrame, mv: sucrose.actions['sucrose.skill'].hits[0].motionValue, particle: sucrose.actions['sucrose.skill'].particles[0] },
    { frames: 68, atFrame: 42, mv: 3.8016, particle: { atFrame: 42, count: 4, element: 'anemo', travelFrames: 0 } })
  // 砂糖爆发的三段伤害都在 65 帧动画之后，按约定整段取消。
  assert.equal(sucrose.actions['sucrose.burst'].hits.length, 0)
  assert.deepEqual(
    { frames: sucrose.actions['sucrose.burst'].timing.frames, cost: sucrose.actions['sucrose.burst'].energyCost, cd: sucrose.actions['sucrose.burst'].cooldownFrames },
    { frames: 65, cost: 80, cd: 1200 })
  const odette = geoPack('odette')
  assert.deepEqual(
    { frames: odette.actions['odette.skill'].timing.frames, atFrame: odette.actions['odette.skill'].hits[0].atFrame, mv: odette.actions['odette.skill'].hits[0].motionValue, particle: odette.actions['odette.skill'].particles[0] },
    { frames: 42, atFrame: 23, mv: 1.94544, particle: { atFrame: 23, count: 5, element: 'cryo', travelFrames: 0 } })
  // 奥黛塔爆发 3 段斩击 + 终结段都在 126 帧动画之后：为保留伤害把时长记到 145 帧（已知偏差）。
  assert.deepEqual(
    { frames: odette.actions['odette.burst'].timing.frames, atFrame: odette.actions['odette.burst'].hits.map(h => h.atFrame), mv: odette.actions['odette.burst'].hits.map(h => h.motionValue), cost: odette.actions['odette.burst'].energyCost },
    { frames: 145, atFrame: [112, 128, 140, 144], mv: [1.983168, 1.983168, 1.983168, 3.064896], cost: 60 })

  const raiden = geoPack('raidenshogun')
  assert.deepEqual(
    { frames: raiden.actions['raidenshogun.skill'].timing.frames, atFrame: raiden.actions['raidenshogun.skill'].hits[0].atFrame, mv: raiden.actions['raidenshogun.skill'].hits[0].motionValue, cd: raiden.actions['raidenshogun.skill'].cooldownFrames },
    { frames: 52, atFrame: 51, mv: 2.1096, cd: 600 })
  assert.deepEqual(
    { frames: raiden.actions['raidenshogun.burst'].timing.frames, atFrame: raiden.actions['raidenshogun.burst'].hits[0].atFrame, mv: raiden.actions['raidenshogun.burst'].hits[0].motionValue, cost: raiden.actions['raidenshogun.burst'].energyCost },
    { frames: 112, atFrame: 98, mv: 7.2144, cost: 90 })

  const chevreuse = geoPack('chevreuse')
  assert.deepEqual(
    { frames: chevreuse.actions['chevreuse.skill'].timing.frames, atFrame: chevreuse.actions['chevreuse.skill'].hits[0].atFrame, mv: chevreuse.actions['chevreuse.skill'].hits[0].motionValue, particle: chevreuse.actions['chevreuse.skill'].particles[0] },
    { frames: 31, atFrame: 25, mv: 2.0736, particle: { atFrame: 25, count: 4, element: 'pyro', travelFrames: 0 } })
  assert.deepEqual(
    { atFrame: chevreuse.actions['chevreuse.burst'].hits[0].atFrame, mv: chevreuse.actions['chevreuse.burst'].hits[0].motionValue, cost: chevreuse.actions['chevreuse.burst'].energyCost, cd: chevreuse.actions['chevreuse.burst'].cooldownFrames },
    { atFrame: 59, mv: 6.62688, cost: 60, cd: 900 })

  const mavuika = geoPack('mavuika')
  assert.deepEqual(
    { frames: mavuika.actions['mavuika.skill'].timing.frames, atFrame: mavuika.actions['mavuika.skill'].hits[0].atFrame, mv: mavuika.actions['mavuika.skill'].hits[0].motionValue, particle: mavuika.actions['mavuika.skill'].particles[0] },
    { frames: 28, atFrame: 16, mv: 1.3392, particle: { atFrame: 16, count: 5, element: 'pyro', travelFrames: 0 } })
  // 玛薇卡爆发不耗元素能量（EnergyMax=0），包内省略 energyCost。
  assert.deepEqual(
    { frames: mavuika.actions['mavuika.burst'].timing.frames, atFrame: mavuika.actions['mavuika.burst'].hits[0].atFrame, mv: mavuika.actions['mavuika.burst'].hits[0].motionValue, cost: mavuika.actions['mavuika.burst'].energyCost ?? 0, cd: mavuika.actions['mavuika.burst'].cooldownFrames },
    { frames: 141, atFrame: 106, mv: 8.0064, cost: 0, cd: 1080 })

  const shenhe = geoPack('shenhe')
  assert.deepEqual(
    { frames: shenhe.actions['shenhe.skill'].timing.frames, atFrame: shenhe.actions['shenhe.skill'].hits[0].atFrame, mv: shenhe.actions['shenhe.skill'].hits[0].motionValue, particle: shenhe.actions['shenhe.skill'].particles[0] },
    { frames: 38, atFrame: 4, mv: 2.5056, particle: { atFrame: 4, count: 3, element: 'cryo', travelFrames: 0 } })
  assert.deepEqual(
    { atFrame: shenhe.actions['shenhe.burst'].hits[0].atFrame, mv: shenhe.actions['shenhe.burst'].hits[0].motionValue, cost: shenhe.actions['shenhe.burst'].energyCost, cd: shenhe.actions['shenhe.burst'].cooldownFrames },
    { atFrame: 78, mv: 1.8144, cost: 80, cd: 1200 })

  const citlali = geoPack('citlali')
  assert.deepEqual(
    { frames: citlali.actions['citlali.skill'].timing.frames, atFrame: citlali.actions['citlali.skill'].hits[0].atFrame, mv: citlali.actions['citlali.skill'].hits[0].motionValue, particle: citlali.actions['citlali.skill'].particles[0] },
    { frames: 50, atFrame: 20, mv: 1.3133, particle: { atFrame: 20, count: 5, element: 'cryo', travelFrames: 0 } })
  // 茜特菈莉 Q 主伤害在动画（113）之后，按新规则把时长记到 119。
  assert.deepEqual(
    { frames: citlali.actions['citlali.burst'].timing.frames, atFrame: citlali.actions['citlali.burst'].hits[0].atFrame, mv: citlali.actions['citlali.burst'].hits[0].motionValue, cost: citlali.actions['citlali.burst'].energyCost },
    { frames: 119, atFrame: 118, mv: 9.6768, cost: 60 })

  const escoffier = geoPack('escoffier')
  assert.deepEqual(
    { frames: escoffier.actions['escoffier.skill'].timing.frames, atFrame: escoffier.actions['escoffier.skill'].hits[0].atFrame, mv: escoffier.actions['escoffier.skill'].hits[0].motionValue, particle: escoffier.actions['escoffier.skill'].particles[0] },
    { frames: 35, atFrame: 23, mv: 0.9072, particle: { atFrame: 23, count: 4, element: 'cryo', travelFrames: 0 } })
  assert.deepEqual(
    { atFrame: escoffier.actions['escoffier.burst'].hits[0].atFrame, mv: escoffier.actions['escoffier.burst'].hits[0].motionValue, cost: escoffier.actions['escoffier.burst'].energyCost, cd: escoffier.actions['escoffier.burst'].cooldownFrames },
    { atFrame: 92, mv: 10.6704, cost: 60, cd: 900 })

  const iansan = geoPack('iansan')
  assert.deepEqual(
    { frames: iansan.actions['iansan.skill'].timing.frames, atFrame: iansan.actions['iansan.skill'].hits[0].atFrame, mv: iansan.actions['iansan.skill'].hits[0].motionValue, particle: iansan.actions['iansan.skill'].particles[0] },
    { frames: 137, atFrame: 9, mv: 5.1552, particle: { atFrame: 9, count: 4, element: 'electro', travelFrames: 0 } })
  assert.deepEqual(
    { atFrame: iansan.actions['iansan.burst'].hits[0].atFrame, mv: iansan.actions['iansan.burst'].hits[0].motionValue, cost: iansan.actions['iansan.burst'].energyCost, cd: iansan.actions['iansan.burst'].cooldownFrames },
    { atFrame: 38, mv: 7.7472, cost: 70, cd: 1080 })

  const ororon = geoPack('ororon')
  // 宿灵球在动画（31 帧）后 41 帧落地，按新规则把时长记到 42。
  assert.deepEqual(
    { frames: ororon.actions['ororon.skill'].timing.frames, atFrame: ororon.actions['ororon.skill'].hits[0].atFrame, mv: ororon.actions['ororon.skill'].hits[0].motionValue, particle: ororon.actions['ororon.skill'].particles[0] },
    { frames: 42, atFrame: 41, mv: 3.5568, particle: { atFrame: 41, count: 3, element: 'electro', travelFrames: 0 } })
  // 灵眼音波只在动画内保留 60 帧那 1 发（后续 8 发在动画外）。
  assert.deepEqual(
    { frames: ororon.actions['ororon.burst'].timing.frames, atFrame: ororon.actions['ororon.burst'].hits.map(h => h.atFrame), mv: ororon.actions['ororon.burst'].hits.map(h => h.motionValue), cost: ororon.actions['ororon.burst'].energyCost },
    { frames: 62, atFrame: [36, 60], mv: [3.1389, 0.5976], cost: 60 })

  const rosaria = geoPack('rosaria')
  assert.deepEqual(
    { frames: rosaria.actions['rosaria.skill'].timing.frames, atFrame: rosaria.actions['rosaria.skill'].hits.map(h => h.atFrame), mv: rosaria.actions['rosaria.skill'].hits.map(h => h.motionValue), particle: rosaria.actions['rosaria.skill'].particles[0] },
    { frames: 51, atFrame: [24, 38], mv: [1.0512, 2.448], particle: { atFrame: 38, count: 3, element: 'cryo', travelFrames: 0 } })
  assert.deepEqual(
    { frames: rosaria.actions['rosaria.burst'].timing.frames, atFrame: rosaria.actions['rosaria.burst'].hits.map(h => h.atFrame), mv: rosaria.actions['rosaria.burst'].hits.map(h => h.motionValue), cost: rosaria.actions['rosaria.burst'].energyCost },
    { frames: 70, atFrame: [15, 56], mv: [1.872, 2.736], cost: 60 })

  const durin = geoPack('durin')
  // 杜林的「战技」建模的是转变窗口内的二次 E（首按本身无伤害）。
  assert.deepEqual(
    { frames: durin.actions['durin.skill'].timing.frames, atFrame: durin.actions['durin.skill'].hits[0].atFrame, mv: durin.actions['durin.skill'].hits[0].motionValue, particle: durin.actions['durin.skill'].particles[0] },
    { frames: 83, atFrame: 35, mv: 1.9008, particle: { atFrame: 35, count: 4, element: 'pyro', travelFrames: 0 } })
  // 杜林爆发后两段主伤害在动画（104）之后，按新规则把时长记到 157。
  assert.deepEqual(
    { frames: durin.actions['durin.burst'].timing.frames, atFrame: durin.actions['durin.burst'].hits.map(h => h.atFrame), mv: durin.actions['durin.burst'].hits.map(h => h.motionValue), cost: durin.actions['durin.burst'].energyCost },
    { frames: 157, atFrame: [97, 121, 154], mv: [2.14128, 1.7352, 2.01312], cost: 70 })

  const venti = geoPack('venti')
  assert.deepEqual(
    { frames: venti.actions['venti.skill'].timing.frames, atFrame: venti.actions['venti.skill'].hits[0].atFrame, mv: venti.actions['venti.skill'].hits[0].motionValue, particle: venti.actions['venti.skill'].particles[0] },
    { frames: 98, atFrame: 51, mv: 4.692, particle: { atFrame: 51, count: 3, element: 'anemo', travelFrames: 0 } })
  // 温迪爆发 20 跳全部在 95 帧动画之后，与砂糖同口径整段清零。
  assert.equal(venti.actions['venti.burst'].hits.length, 0)
  assert.deepEqual(
    { frames: venti.actions['venti.burst'].timing.frames, cost: venti.actions['venti.burst'].energyCost, cd: venti.actions['venti.burst'].cooldownFrames },
    { frames: 95, cost: 60, cd: 900 })

  const skirk = geoPack('skirk')
  // 丝柯克战技本身零伤害，伤害在七相一闪的普攻里。
  assert.equal(skirk.actions['skirk.skill'].hits.length, 0)
  // 末段命中（158）在动画（151）之后 7 帧，按 ≤30 帧规则把时长记到 159。
  assert.deepEqual(
    { frames: skirk.actions['skirk.burst'].timing.frames, atFrame: skirk.actions['skirk.burst'].hits.map(h => h.atFrame), mv: skirk.actions['skirk.burst'].hits.map(h => h.motionValue), cd: skirk.actions['skirk.burst'].cooldownFrames },
    { frames: 159, atFrame: [109, 111, 114, 125, 135, 158], mv: [2.2097, 2.2097, 2.2097, 2.2097, 2.2097, 3.6828], cd: 900 })

  const zibai = geoPack('zibai')
  assert.deepEqual(
    { frames: zibai.actions['zibai.skill'].timing.frames, atFrame: zibai.actions['zibai.skill'].hits.map(h => h.atFrame), mv: zibai.actions['zibai.skill'].hits.map(h => h.motionValue), scaling: zibai.actions['zibai.skill'].hits[0].scaling, particle: zibai.actions['zibai.skill'].particles[0] },
    { frames: 61, atFrame: [30, 34], mv: [3.1055, 2.5374], scaling: 'def', particle: { atFrame: 30, count: 1, element: 'geo', travelFrames: 0 } })
  assert.deepEqual(
    { frames: zibai.actions['zibai.burst'].timing.frames, atFrame: zibai.actions['zibai.burst'].hits.map(h => h.atFrame), mv: zibai.actions['zibai.burst'].hits.map(h => h.motionValue), cost: zibai.actions['zibai.burst'].energyCost },
    { frames: 103, atFrame: [95, 95], mv: [2.2853, 3.1994], cost: 60 })

  const mona = geoPack('mona')
  // 莫娜 E 的爆裂在 329 帧（延迟 280 帧），按场地伤害不建模；产球时机同样随幻影，未写入。
  assert.equal(mona.actions['mona.skill'].hits.length, 0)
  assert.equal(mona.actions['mona.skill'].particles, undefined)
  assert.equal(mona.actions['mona.skill'].timing.frames, 50)
  assert.deepEqual(
    { frames: mona.actions['mona.burst'].timing.frames, atFrame: mona.actions['mona.burst'].hits[0].atFrame, mv: mona.actions['mona.burst'].hits[0].motionValue, cost: mona.actions['mona.burst'].energyCost, cd: mona.actions['mona.burst'].cooldownFrames },
    { frames: 127, atFrame: 107, mv: 7.9632, cost: 60, cd: 900 })

  const ayato = geoPack('kamisatoayato')
  // 水影伤害在动画（21）后 14 帧，按 ≤30 帧规则把时长记到 36。
  assert.deepEqual(
    { frames: ayato.actions['kamisatoayato.skill'].timing.frames, atFrame: ayato.actions['kamisatoayato.skill'].hits[0].atFrame, mv: ayato.actions['kamisatoayato.skill'].hits[0].motionValue, cd: ayato.actions['kamisatoayato.skill'].cooldownFrames },
    { frames: 36, atFrame: 35, mv: 2.006, cd: 720 })
  assert.deepEqual(
    { frames: ayato.actions['kamisatoayato.burst'].timing.frames, atFrame: ayato.actions['kamisatoayato.burst'].hits[0].atFrame, mv: ayato.actions['kamisatoayato.burst'].hits[0].motionValue, cost: ayato.actions['kamisatoayato.burst'].energyCost, cd: ayato.actions['kamisatoayato.burst'].cooldownFrames },
    { frames: 140, atFrame: 139, mv: 1.1962, cost: 80, cd: 1200 })

  const flins = geoPack('flins')
  assert.deepEqual(
    { frames: flins.actions['flins.skill'].timing.frames, atFrame: flins.actions['flins.skill'].hits[0].atFrame, mv: flins.actions['flins.skill'].hits[0].motionValue, cd: flins.actions['flins.skill'].cooldownFrames },
    { frames: 42, atFrame: 23, mv: 3.2112, cd: 360 })
  // 菲林斯爆发后两段是月感电近似段（canCrit=false），最终段 164 帧超动画未建模。
  assert.deepEqual(
    { frames: flins.actions['flins.burst'].timing.frames, atFrame: flins.actions['flins.burst'].hits.map(h => h.atFrame), mv: flins.actions['flins.burst'].hits.map(h => h.motionValue), canCrit: flins.actions['flins.burst'].hits.map(h => h.canCrit), cost: flins.actions['flins.burst'].energyCost },
    { frames: 130, atFrame: [93, 110, 119], mv: [4.6771, 0.2923, 0.2923], canCrit: [true, false, false], cost: 80 })
}
// 除已人工核对的角色外，任何包都不该带非普攻动作。
const curatedKeys = new Set([
  'zhongli', 'albedo', 'gorou', 'aratakiitto',
  'bennett', 'xingqiu', 'furina', 'nahida', 'kaedeharakazuha',
  'xiangling', 'yelan', 'fischl', 'yaemiko', 'kukishinobu',
  'columbina', 'xilonen', 'sucrose', 'odette', 'raidenshogun', 'chevreuse',
  'mavuika', 'shenhe', 'citlali', 'escoffier', 'iansan', 'ororon',
  'rosaria', 'durin', 'venti', 'skirk', 'zibai', 'mona',
  'kamisatoayato', 'flins'
])
const stray = []
for (const name of packFiles) {
  const key = name.replace(/\.json$/, '')
  const pack = JSON.parse(fs.readFileSync(new URL(name, packsDir), 'utf8'))
  for (const action of Object.values(pack.actions)) if (action.kind !== 'normal' && !curatedKeys.has(key)) stray.push(action.id)
}
assert.deepEqual(stray, [])
