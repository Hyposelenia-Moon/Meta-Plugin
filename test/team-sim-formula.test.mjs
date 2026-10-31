import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { mod } from './_helper.mjs'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(import.meta.url)('typescript')
async function load(rel) {
  if (process.env.META_TEAM_SIM_SOURCE_TEST !== '1') return import(mod(`modules/teamSimulation/${rel.replace(/\.ts$/, '.js')}`))
  const source = fs.readFileSync(path.join(root, 'src', 'modules', 'teamSimulation', rel), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const { calculateOrdinaryHit } = await load('formula.ts')
const base = { kind: 'ordinary', reaction: 'none', gameVersion: '6.0', source: 'synthetic-fixture-not-game-tested', additiveBase: 0, damageBonus: 0, canCrit: true, crit: 'expected', critRate: 0.5, critDamage: 1, attackerLevel: 90, enemyLevel: 90, defenseReduction: 0, defenseIgnore: 0, resistance: 0.1, resistanceReduction: 0, scaling: [] }
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`)

// 攻击倍率：1000 ATK × 2 × (1+50%伤害) × (1+50%×100%爆伤) × 防御 1/2 × 抗性 90% = 2025
const atk = calculateOrdinaryHit({ ...base, scaling: [{ stat: 1000, multiplier: 2 }], damageBonus: 0.5 })
assert.equal(atk.status, 'calculated')
close(atk.factors.base, 2000, '攻击白值倍率基础')
close(atk.factors.damageBonus, 1.5, '攻击伤害乘区')
close(atk.factors.crit, 1.5, '期望暴击乘区')
close(atk.factors.defense, 0.5, '同级防御乘区')
close(atk.factors.resistance, 0.9, '正抗乘区')
close(atk.damage, 2025, '攻击倍率手算伤害')

// 生命倍率：20000 HP × 0.1 = 2000；基础暴击率标准边界值 0.05 时期望暴击为 1.05（爆伤 1）。
const hp = calculateOrdinaryHit({ ...base, scaling: [{ stat: 20000, multiplier: 0.1 }], critRate: 0.05, resistance: 0, attackerLevel: 90, enemyLevel: 90 })
close(hp.damage, 1050, '生命倍率手算伤害')

// 防御倍率：1500 DEF × 0.8 = 1200；减防 20%、无视 25% 时防御乘区 = 190/(190+190×.8×.75)=.625。
const def = calculateOrdinaryHit({ ...base, scaling: [{ stat: 1500, multiplier: 0.8 }], crit: 'non-critical', canCrit: false, resistance: 0, defenseReduction: 0.2, defenseIgnore: 0.25 })
close(def.factors.defense, 0.625, '减防/无视防御乘区')
close(def.damage, 750, '防御倍率手算伤害')

// 混合倍率：1000×1 + 20000×.05 + 1000×.5 = 2500，再乘负抗 1.1、暴击 1.25、防御 .5 = 1718.75
const mixed = calculateOrdinaryHit({ ...base, scaling: [{ stat: 1000, multiplier: 1 }, { stat: 20000, multiplier: 0.05 }, { stat: 1000, multiplier: 0.5 }], critRate: 0.25, critDamage: 1, resistance: -0.2 })
close(mixed.factors.base, 2500, '混合倍率基础')
close(mixed.factors.resistance, 1.1, '负抗乘区')
close(mixed.damage, 1718.75, '混合倍率手算伤害')

const overflow = calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }], critRate: 2, critDamage: 0.5, resistance: 0.75 })
close(overflow.factors.effectiveCritRate, 1, '暴击率正溢出钳制')
close(overflow.factors.resistance, 1 / 4, '高抗段')
close(overflow.factors.effectiveDefenseReduction, 0, '默认减防')
const reduced = calculateOrdinaryHit({ ...base, scaling: [{ stat: 1, multiplier: 1 }], defenseReduction: 1 })
close(reduced.factors.effectiveDefenseReduction, 0.9, '减防上限')
// 目标口径：绑定只读预设后等级/抗性必须与预设一致，结果回填目标身份。
const targeted = calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }], targetId: 'dummy-lv100', enemyLevel: 100 })
assert.equal(targeted.status, 'calculated')
assert.deepEqual(targeted.target, { id: 'dummy-lv100', level: 100, resistance: 0.1 })
assert.deepEqual(calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }] }).target, { id: 'custom', level: 90, resistance: 0.1 })
assert.equal(calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }], targetId: 'dummy-lv100', enemyLevel: 90 }).status, 'invalid')
assert.equal(calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }], targetId: 'dummy-lv100', resistance: 0 }).status, 'invalid')
assert.equal(calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }], targetId: 'unknown-target' }).status, 'unsupported')
// P2 起反应走独立分支：未知 kind 是 invalid；只写反应名却不给触发元素与附着，也是 invalid。
assert.equal(calculateOrdinaryHit({ ...base, scaling: [{ stat: 1, multiplier: 1 }], kind: 'reaction' }).status, 'unsupported')
const partialReaction = calculateOrdinaryHit({ ...base, scaling: [{ stat: 1, multiplier: 1 }], reaction: 'vaporize' })
assert.equal(partialReaction.status, 'incomplete')
assert.deepEqual(partialReaction.issues.map(issue => issue.path), ['element', 'aura', 'mastery'])
for (const patch of [{ critRate: -0.1 }, { critDamage: -0.1 }, { damageBonus: -1.1 }, { scaling: [{ stat: 1, multiplier: -1 }] }, { enemyLevel: NaN }, { defenseIgnore: 1.01 }]) assert.equal(calculateOrdinaryHit({ ...base, scaling: [{ stat: 1, multiplier: 1 }], ...patch }).status, 'invalid')
assert.equal(calculateOrdinaryHit({ ...base, scaling: [{ stat: 1, multiplier: 1 }], additiveBase: undefined }).status, 'incomplete')
for (const field of Object.keys(base)) {
  const missingField = { ...base, scaling: [{ stat: 1, multiplier: 1 }] }
  delete missingField[field]
  const result = calculateOrdinaryHit(missingField)
  assert.equal(result.status, 'incomplete', `missing ${field}`)
  assert.ok(result.issues.some(i => i.path === field))
}
close(calculateOrdinaryHit({ ...base, scaling: [{ stat: 3, multiplier: 0.1 }], additiveBase: 0.01, crit: 'critical', critDamage: 0.5, defenseIgnore: 1, resistance: 0 }).damage, 0.465, '不取整及显式暴击')
for (const patch of [{ attackerLevel: 90.5 }, { enemyLevel: 90.5 }, { defenseReduction: 1.01 }, { defenseReduction: 20 }, { additiveBase: -0.01 }]) {
  assert.equal(calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }], ...patch }).status, 'invalid', JSON.stringify(patch))
}
const cappedReduction = calculateOrdinaryHit({ ...base, scaling: [{ stat: 100, multiplier: 1 }], defenseReduction: 0.95 })
assert.equal(cappedReduction.status, 'calculated')
close(cappedReduction.factors.effectiveDefenseReduction, 0.9, '95%减防截断为90%')
console.log('team-sim-formula: passed; all expectations are independent manual calculations, synthetic only (not in-game verified)')
