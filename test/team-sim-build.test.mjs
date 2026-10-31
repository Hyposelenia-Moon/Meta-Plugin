import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mod } from './_helper.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(import.meta.url)('typescript')
async function load() {
  if (process.env.META_TEAM_SIM_SOURCE_TEST !== '1') return import(mod('modules/teamSimulation/build.js'))
  const source = fs.readFileSync(path.join(root, 'src/modules/teamSimulation/build.ts'), 'utf8')
  const typesSource = fs.readFileSync(path.join(root, 'src/modules/teamSimulation/types.ts'), 'utf8')
  const typesJs = ts.transpileModule(typesSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const typesUrl = `data:text/javascript;base64,${Buffer.from(typesJs).toString('base64')}`
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("'./types.js'", JSON.stringify(typesUrl))
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const { validateCharacterBuild, requiredEffectSources, buildPermanentStats } = await load()
const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const stats = [
  [{ key: 'hp', value: 4780 }, { key: 'hpPct', value: 0.05 }],
  [{ key: 'atk', value: 311 }, { key: 'atkPct', value: 0.1 }],
  [{ key: 'defPct', value: 0.2 }, { key: 'mastery', value: 20 }],
  [{ key: 'pyro', value: 0.466 }, { key: 'cpct', value: 0.07 }],
  [{ key: 'cdmg', value: 0.62 }, { key: 'recharge', value: 0.1 }]
]
const build = {
  schemaVersion: 1, actorId: 'player:synthetic', characterId: 'char:fixture', name: 'Synthetic Character', element: 'pyro', level: 90, ascension: 6, constellation: 1,
  talents: { normal: 9, skill: 9, burst: 9 }, weapon: { id: 'weapon:fixture', name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
  artifacts: slots.map((slot, i) => ({ slot, name: `Artifact ${slot}`, setId: i < 4 ? 'fixture-set' : 'offpiece', rarity: 5, level: 20, main: stats[i][0], sub: stats[i].slice(1) })),
  requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
}
build.requiredEffects = requiredEffectSources(build)
const charSource = `character:${build.characterId}:a${build.ascension}`
const weaponSource = `weapon:${build.weapon.id}:r${build.weapon.refinement}`
// 静态加成不留在 bonuses（P0 要求为空），一律走已审计来源的 modifiers。
const data = {
  gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data',
  character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000, atk: 300, def: 700 }, bonuses: [] },
  weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500, bonuses: [] },
  effects: Object.fromEntries(build.requiredEffects.map(e => [e.id,
    e.id === charSource ? { status: 'verified-static', modifiers: [{ key: 'hpPct', value: 0.1 }, { key: 'atkPct', value: 0.1 }], runtimeRequired: false }
      : e.id === weaponSource ? { status: 'verified-static', modifiers: [{ key: 'cpct', value: 0.02 }], runtimeRequired: true }
        : { status: 'known-no-static', modifiers: [], runtimeRequired: false }
  ]))
}
const expected = { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' }
const valid = validateCharacterBuild(build)
assert.equal(valid.status, 'raw-complete')
assert.equal(valid.simulationReady, false)
const out = buildPermanentStats(build, data, expected)
assert.equal(out.status, 'permanent-ready')
assert.equal(out.simulationReady, false)
assert.equal(out.scope, 'permanent-stats')
assert.equal(out.stats.hp, 10000 * 1.15 + 4780)
assert.equal(out.stats.atk, (300 + 500) * (1 + 0.1 + 0.1) + 311)
assert.equal(out.stats.def, 700 * 1.2)
assert.equal(out.stats.mastery, 20)
assert.equal(out.stats.cpct, 0.05 + 0.07 + 0.02)
assert.equal(out.stats.cdmg, 0.5 + 0.62)
assert.equal(out.stats.recharge, 1.1)
assert.equal(out.stats.pyro, 0.466)
assert.deepEqual({ ...out.setCounts }, { 'fixture-set': 4, offpiece: 1 })
assert.equal(out.trace.filter(t => t.key.startsWith('audit:')).length, build.requiredEffects.length)

// 四个独立角色（不同角色id/元素/武器/白值）+ 四种构筑 shape；全部是合成配装，不是游戏实测。
const characterIds = new Set()
for (const [index, sets] of [
  ['A', 'A', 'A', 'A', 'B'],
  ['A', 'A', 'B', 'B', 'C'],
  ['A', 'B', 'C', 'D', 'E'],
  ['B', 'B', 'B', 'B', 'A']
].entries()) {
  const shaped = structuredClone(build)
  shaped.actorId = `synthetic:${index}:actor`
  shaped.characterId = `char:fixture-${index}`
  shaped.name = `Synthetic Character ${index}`
  shaped.element = ['pyro', 'hydro', 'electro', 'cryo'][index]
  shaped.constellation = index
  shaped.weapon.id = `weapon:fixture-${index}`
  shaped.artifacts.forEach((a, i) => { a.setId = sets[i] })
  shaped.requiredEffects = requiredEffectSources(shaped)
  const shapedData = structuredClone(data)
  shapedData.character = { ...shapedData.character, id: shaped.characterId, base: { hp: 9000 + index * 100, atk: 250 + index * 10, def: 600 + index * 20 } }
  shapedData.weapon = { ...shapedData.weapon, id: shaped.weapon.id, baseAtk: 400 + index * 20 }
  shapedData.effects = Object.fromEntries(shaped.requiredEffects.map(e => [e.id, { status: 'known-no-static', modifiers: [], runtimeRequired: index !== 3 }]))
  characterIds.add(shaped.characterId)
  const result = buildPermanentStats(shaped, shapedData, expected)
  assert.equal(result.status, 'permanent-ready', JSON.stringify(result))
  assert.equal(result.stats.hp, (9000 + index * 100) * 1.05 + 4780, `角色 ${index} 生命`)
  assert.equal(result.stats.atk, (650 + index * 30) * 1.1 + 311, `角色 ${index} 攻击`)
  assert.equal(result.stats.def, (600 + index * 20) * 1.2, `角色 ${index} 防御`)
  assert.equal(result.simulationReady, false)
  assert.equal(Object.values(result.setCounts).reduce((n, x) => n + x, 0), 5)
  assert.equal(result.trace.filter(t => t.key.startsWith('audit:')).length, shaped.requiredEffects.length)
  if (index === 3) assert.deepEqual(result.runtimeEffects, [])
}
assert.equal(characterIds.size, 4, '四个独立角色的永久面板必须各自带着自己的身份与白值')
assert.deepEqual(out.runtimeEffects, ['weapon:weapon:fixture:r1'])
assert.ok(out.trace.some(t => t.source === 'character:char:fixture:a6' && t.key === 'hpPct'))
assert.ok(out.trace.some(t => t.source === 'artifact:flower:main'))

const dup = structuredClone(build); dup.artifacts[1].slot = 'flower'
assert.equal(validateCharacterBuild(dup).status, 'invalid')
const missing = structuredClone(build); missing.artifacts.pop()
assert.ok(['incomplete', 'invalid'].includes(validateCharacterBuild(missing).status))
const badStat = structuredClone(build); badStat.artifacts[0].sub[0].key = 'mystery'
assert.equal(validateCharacterBuild(badStat).status, 'unsupported')
const nonfinite = structuredClone(build); nonfinite.artifacts[0].main.value = Infinity
assert.equal(validateCharacterBuild(nonfinite).status, 'invalid')
// 契约层不依赖适配器：主词条部位、副词条重复与主副同键在这里同样要拒绝，直接调 buildPermanentStats 的输入绕不过去。
const wrongMainSlot = structuredClone(build); wrongMainSlot.artifacts[0].main = { key: 'cdmg', value: 0.5 }
assert.ok(validateCharacterBuild(wrongMainSlot).issues.some(i => i.path === 'artifacts.0.main.key' && i.code === 'invalid'), JSON.stringify(validateCharacterBuild(wrongMainSlot)))
const fixedHpOnSands = structuredClone(build); fixedHpOnSands.artifacts[2].main = { key: 'hp', value: 4780 }
assert.ok(validateCharacterBuild(fixedHpOnSands).issues.some(i => i.path === 'artifacts.2.main.key' && i.code === 'invalid'), JSON.stringify(validateCharacterBuild(fixedHpOnSands)))
const genericDmgOnGoblet = structuredClone(build); genericDmgOnGoblet.artifacts[3].main = { key: 'dmg', value: 0.466 }
assert.ok(validateCharacterBuild(genericDmgOnGoblet).issues.some(i => i.path === 'artifacts.3.main.key' && i.code === 'invalid'), JSON.stringify(validateCharacterBuild(genericDmgOnGoblet)))
const duplicateSub = structuredClone(build); duplicateSub.artifacts[4].sub.push({ key: 'recharge', value: 0.1 })
assert.ok(validateCharacterBuild(duplicateSub).issues.some(i => i.path === 'artifacts.4.sub' && i.code === 'invalid' && i.message.includes('重复属性')), JSON.stringify(validateCharacterBuild(duplicateSub)))
const mainAlsoSub = structuredClone(build); mainAlsoSub.artifacts[0].sub.push({ key: 'hp', value: 300 })
assert.ok(validateCharacterBuild(mainAlsoSub).issues.some(i => i.path === 'artifacts.0.sub' && i.code === 'invalid' && i.message.includes('与主词条同属性')), JSON.stringify(validateCharacterBuild(mainAlsoSub)))
const noAudit = structuredClone(build); noAudit.requiredEffects = []
assert.ok(validateCharacterBuild(noAudit).issues.some(i => i.path === 'requiredEffects' && i.code === 'missing'))
const unknown = structuredClone(build); unknown.requiredEffects[0].kind = 'talent'
assert.equal(validateCharacterBuild(unknown).status, 'unsupported')
const noEffect = structuredClone(data); delete noEffect.effects[build.requiredEffects[0].id]
assert.ok(buildPermanentStats(build, noEffect, expected).issues.some(i => i.path.includes(build.requiredEffects[0].id)))
// 突破与精炼必须进来源 id：同一角色/武器在不同档位的静态效果可能不同，裸 id 会让低档位审计静默套到高档位。
const characterKey = charSource
const weaponKey = weaponSource
assert.equal(characterKey, 'character:char:fixture:a6')
assert.equal(weaponKey, 'weapon:weapon:fixture:r1')
const otherRefinement = structuredClone(data)
otherRefinement.effects['weapon:weapon:fixture:r5'] = otherRefinement.effects[weaponKey]
delete otherRefinement.effects[weaponKey]
const refinementResult = buildPermanentStats(build, otherRefinement, expected)
assert.ok(refinementResult.issues.some(i => i.code === 'missing' && i.path === `permanentData.effects.${weaponKey}`), JSON.stringify(refinementResult))
const otherAscension = structuredClone(data)
otherAscension.effects['character:char:fixture:a5'] = otherAscension.effects[characterKey]
delete otherAscension.effects[characterKey]
const ascensionResult = buildPermanentStats(build, otherAscension, expected)
assert.ok(ascensionResult.issues.some(i => i.code === 'missing' && i.path === `permanentData.effects.${characterKey}`), JSON.stringify(ascensionResult))
const shiftedAscension = structuredClone(build); shiftedAscension.ascension = 5
assert.ok(validateCharacterBuild(shiftedAscension).issues.some(i => i.code === 'missing' && i.message.includes('character:char:fixture:a5')), JSON.stringify(validateCharacterBuild(shiftedAscension)))
const unsupportedEffect = structuredClone(data); unsupportedEffect.effects[build.requiredEffects[0].id].status = 'unsupported'
assert.equal(buildPermanentStats(build, unsupportedEffect, expected).status, 'unsupported')
const mismatch = structuredClone(data); mismatch.character.level = 89
assert.equal(buildPermanentStats(build, mismatch, expected).status, 'invalid')
const wrongBundle = structuredClone(data); wrongBundle.bundleId = 'other'
assert.ok(buildPermanentStats(build, wrongBundle, expected).issues.some(i => i.code === 'version-mismatch'))
const missingSourceTime = structuredClone(build); delete missingSourceTime.provenance.sourceTime
assert.equal(validateCharacterBuild(missingSourceTime).status, 'incomplete')
const wrongKind = structuredClone(build); wrongKind.requiredEffects[0].kind = 'weapon'
assert.equal(validateCharacterBuild(wrongKind).status, 'invalid')
// 天赋加成：只有能指认、且已登记在 requiredEffects 的来源才允许写入；省略表示未建模。
const withModifier = structuredClone(build)
withModifier.talents.modifiers = [{ source: 'constellation:char:fixture:1', talent: 'skill', levels: 3 }]
assert.equal(validateCharacterBuild(withModifier).status, 'raw-complete', JSON.stringify(validateCharacterBuild(withModifier)))
const unregisteredModifier = structuredClone(withModifier)
unregisteredModifier.talents.modifiers[0].source = 'constellation:char:fixture:2'
assert.ok(validateCharacterBuild(unregisteredModifier).issues.some(i => i.path === 'talents.modifiers.0.source' && i.code === 'invalid'))
const unknownTalent = structuredClone(withModifier); unknownTalent.talents.modifiers[0].talent = 'plunge'
assert.equal(validateCharacterBuild(unknownTalent).status, 'invalid')
const zeroLevels = structuredClone(withModifier); zeroLevels.talents.modifiers[0].levels = 0
assert.equal(validateCharacterBuild(zeroLevels).status, 'invalid')
const badModifiers = structuredClone(build); badModifiers.talents.modifiers = {}
assert.equal(validateCharacterBuild(badModifiers).status, 'invalid')
// 只有最终面板的输入资格在 P0 明确拒绝，而不是猜哪些效果已计入。
const panelOnly = structuredClone(build)
panelOnly.panelCheck = { stats: { hp: 1234 }, includedEffects: { known: false } }
const panelResult = validateCharacterBuild(panelOnly)
assert.equal(panelResult.status, 'unsupported')
assert.ok(panelResult.issues.some(i => i.path === 'panelCheck'))
const unknownModifier = structuredClone(data); unknownModifier.effects[charSource].modifiers.push({ key: 'unknown', value: 1 })
assert.equal(buildPermanentStats(build, unknownModifier, expected).status, 'unsupported')
const nanModifier = structuredClone(data); nanModifier.effects[weaponSource].modifiers[0].value = NaN
assert.equal(buildPermanentStats(build, nanModifier, expected).status, 'invalid')
// 静态加成不能走无审计通道：bonuses 非空直接拒绝，而不是悄悄累加进面板。
const injectedBonus = structuredClone(data); injectedBonus.character.bonuses.push({ key: 'atk', value: 1000 })
const injectedResult = buildPermanentStats(build, injectedBonus, expected)
assert.equal(injectedResult.status, 'unsupported')
assert.ok(injectedResult.issues.some(i => i.path === 'permanentData.character.bonuses' && i.code === 'unsupported'), JSON.stringify(injectedResult))
const injectedWeaponBonus = structuredClone(data); injectedWeaponBonus.weapon.bonuses.push({ key: 'atkPct', value: 1 })
assert.ok(buildPermanentStats(build, injectedWeaponBonus, expected).issues.some(i => i.path === 'permanentData.weapon.bonuses' && i.code === 'unsupported'))
const malformedAudit = structuredClone(data); malformedAudit.effects[build.requiredEffects[0].id].runtimeRequired = undefined
assert.equal(buildPermanentStats(build, malformedAudit, expected).status, 'invalid')
for (const key of ['gameVersion', 'bundleId', 'source']) {
  const noMetadata = structuredClone(data); delete noMetadata[key]
  assert.equal(buildPermanentStats(build, noMetadata, expected).status, 'incomplete')
  const altered = { ...data, [key]: `${data[key]}-mismatch` }
  assert.equal(buildPermanentStats(build, altered, expected).status, 'invalid')
}
const setPath = (target, path, value) => {
  const parts = path.split('.')
  const final = parts.pop()
  let owner = target
  for (const part of parts) owner = owner[part]
  owner[final] = value
}
for (const [path, value, status] of [
  ['level', 0, 'invalid'], ['level', 1.5, 'invalid'], ['level', 101, 'unsupported'],
  ['ascension', -1, 'invalid'], ['ascension', 8, 'unsupported'],
  ['constellation', -1, 'invalid'], ['constellation', 7, 'invalid'],
  ['talents.normal', 0, 'invalid'], ['talents.skill', 11, 'invalid'], ['talents.burst', 1.5, 'invalid'],
  ['weapon.level', 0, 'invalid'], ['weapon.level', 91, 'unsupported'], ['weapon.ascension', 7, 'unsupported'],
  ['weapon.refinement', 0, 'invalid'], ['weapon.refinement', 6, 'invalid'],
  ['artifacts.0.rarity', 0, 'invalid'], ['artifacts.0.rarity', 6, 'invalid'],
  ['artifacts.0.main.value', -1, 'invalid'], ['artifacts.0.sub.0.value', -0.1, 'invalid'],
  ['element', 'unknown', 'unsupported']
]) {
  const changed = structuredClone(build)
  setPath(changed, path, value)
  const result = validateCharacterBuild(changed)
  assert.equal(result.status, status, `${path}=${value}: ${JSON.stringify(result)}`)
}
for (const [rarity, cap] of [[1, 4], [2, 4], [3, 12], [4, 16], [5, 20]]) {
  const changed = structuredClone(build)
  changed.artifacts[0].rarity = rarity
  changed.artifacts[0].level = cap
  changed.artifacts[0].sub = []
  assert.equal(validateCharacterBuild(changed).status, 'raw-complete', `rarity ${rarity} cap ${cap}`)
  changed.artifacts[0].level = cap + 1
  assert.equal(validateCharacterBuild(changed).status, 'invalid', `rarity ${rarity} above cap`)
}
const maxCharacter = structuredClone(build); maxCharacter.level = 100; maxCharacter.ascension = 7
maxCharacter.requiredEffects = requiredEffectSources(maxCharacter)
assert.equal(validateCharacterBuild(maxCharacter).status, 'raw-complete')
const negativeBonus = structuredClone(data); negativeBonus.effects[charSource].modifiers[0].value = -0.1
assert.equal(buildPermanentStats(build, negativeBonus, expected).status, 'invalid')
console.log('team-sim-build: passed; four synthetic artifact shapes exercised; fixture is not in-game verified')
