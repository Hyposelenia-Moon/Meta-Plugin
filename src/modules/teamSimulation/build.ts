import { SCHEMA_VERSION } from './types.js'
import type { ArtifactSlot, CharacterBuild, Failure, Issue, MechanicSource, PermanentBuildResult, PermanentData, PermanentStats, StatKey, StatValue } from './types.js'

const statKeys = new Set<StatKey>(['hp', 'atk', 'def', 'hpPct', 'atkPct', 'defPct', 'mastery', 'cpct', 'cdmg', 'recharge', 'dmg', 'phy', 'heal', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'])
const slots: ArtifactSlot[] = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const elements = new Set(['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'])
const artifactMaxLevel: Record<number, number> = { 1: 4, 2: 4, 3: 12, 4: 16, 5: 20 }
/** 各部位允许的主词条；契约层不依赖适配器，手写输入也要按这个集合拒绝。 */
const mainKeys: Record<ArtifactSlot, StatKey[]> = {
  flower: ['hp'],
  plume: ['atk'],
  sands: ['hpPct', 'atkPct', 'defPct', 'recharge', 'mastery'],
  goblet: ['hpPct', 'atkPct', 'defPct', 'mastery', 'phy', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'],
  circlet: ['hpPct', 'atkPct', 'defPct', 'mastery', 'cpct', 'cdmg', 'heal']
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const failure = (issues: Issue[]): Failure => ({ status: issues.some(x => x.code === 'unsupported') ? 'unsupported' : issues.some(x => x.code === 'invalid' || x.code === 'version-mismatch') ? 'invalid' : 'incomplete', issues })
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const add = (out: Issue[], code: Issue['code'], path: string, message: string) => out.push({ code, path, message })

function validateStat(value: unknown, path: string, issues: Issue[]): value is StatValue {
  if (!object(value)) { add(issues, value === undefined ? 'missing' : 'invalid', path, '必须是属性对象'); return false }
  let valid = true
  if (!str(value.key)) { add(issues, value.key === undefined ? 'missing' : 'invalid', `${path}.key`, '必须提供属性键'); valid = false }
  else if (!statKeys.has(value.key as StatKey)) { add(issues, 'unsupported', `${path}.key`, `不支持属性 ${value.key}`); valid = false }
  if (!finite(value.value)) { add(issues, value.value === undefined ? 'missing' : 'invalid', `${path}.value`, '必须是有限数值'); valid = false }
  else if (value.value < 0) { add(issues, 'invalid', `${path}.value`, '属性值不得为负'); valid = false }
  return valid
}

export function requiredEffectSources(build: CharacterBuild): MechanicSource[] {
  const effects: MechanicSource[] = [
    // 效果来源带真实档位：同一角色不同突破、同一武器不同精炼的静态效果可能不同，
    // 身份只写 id 会让低档位的 verified-static 静默套到高档位上。
    { kind: 'character', id: `character:${build.characterId}:a${build.ascension}` },
    { kind: 'weapon', id: `weapon:${build.weapon.id}:r${build.weapon.refinement}` }
  ]
  if (build.constellation > 0) effects.push({ kind: 'constellation', id: `constellation:${build.characterId}:${build.constellation}` })
  const counts: Record<string, number> = Object.create(null)
  for (const artifact of build.artifacts) counts[artifact.setId] = (counts[artifact.setId] || 0) + 1
  for (const [setId, count] of Object.entries(counts)) {
    if (count >= 2) effects.push({ kind: 'artifact-set', id: `artifact-set:${setId}:2pc` })
    if (count >= 4) effects.push({ kind: 'artifact-set', id: `artifact-set:${setId}:4pc` })
  }
  return effects
}

/** 校验 adapter 产出的完整输入契约；不对缺失字段补默认值。 */
export function validateCharacterBuild(input: unknown): { status: 'raw-complete'; build: CharacterBuild; simulationReady: false } | Failure {
  const issues: Issue[] = []
  if (!object(input)) return failure([{ code: 'invalid', path: 'build', message: '角色配装必须是对象' }])
  const b = input
  if (b.schemaVersion === undefined) add(issues, 'missing', 'schemaVersion', '缺少契约版本')
  else if (b.schemaVersion !== SCHEMA_VERSION) add(issues, 'version-mismatch', 'schemaVersion', '契约版本不匹配')
  if (b.panelCheck !== undefined) add(issues, 'unsupported', 'panelCheck', 'P0 不接受只有最终面板的输入：无法证明哪些效果已计入，请提供可重建的原始配装')
  for (const key of ['actorId', 'characterId', 'name'] as const) {
    if (b[key] === undefined) add(issues, 'missing', key, '必填字段缺失')
    else if (!str(b[key])) add(issues, 'invalid', key, '必须是非空字符串')
  }
  if (!str(b.element)) add(issues, b.element === undefined ? 'missing' : 'invalid', 'element', '元素必填')
  else if (!elements.has(b.element)) add(issues, 'unsupported', 'element', `不支持元素 ${b.element}`)
  if (b.level === undefined) add(issues, 'missing', 'level', '必填字段缺失')
  else if (!Number.isInteger(b.level) || b.level < 1) add(issues, 'invalid', 'level', '角色等级必须是正整数')
  else if (b.level > 100) add(issues, 'unsupported', 'level', 'P0仅支持角色等级 1..100')
  if (b.ascension === undefined) add(issues, 'missing', 'ascension', '必填字段缺失')
  else if (!Number.isInteger(b.ascension) || b.ascension < 0) add(issues, 'invalid', 'ascension', '角色突破必须是非负整数')
  else if (b.ascension > 7) add(issues, 'unsupported', 'ascension', 'P0仅支持角色突破等级 0..7')
  if (b.constellation === undefined) add(issues, 'missing', 'constellation', '必填字段缺失')
  else if (!Number.isInteger(b.constellation) || b.constellation < 0 || b.constellation > 6) add(issues, 'invalid', 'constellation', '命座必须是 0..6 整数')
  if (!object(b.talents)) add(issues, b.talents === undefined ? 'missing' : 'invalid', 'talents', '天赋等级对象缺失')
  else {
    for (const key of ['normal', 'skill', 'burst']) {
      if (b.talents[key] === undefined) add(issues, 'missing', `talents.${key}`, '必填字段缺失')
      else if (!Number.isInteger(b.talents[key]) || b.talents[key] < 1 || b.talents[key] > 10) add(issues, 'invalid', `talents.${key}`, '原始天赋必须是 1..10 整数')
    }
    // 加成来源只登记能指认的项；来源还必须登记在 requiredEffects，避免把未审计的等级加成塞进输入。
    if (b.talents.modifiers !== undefined && !Array.isArray(b.talents.modifiers)) add(issues, 'invalid', 'talents.modifiers', '天赋加成来源必须是数组，无法指认时省略该字段')
    else if (Array.isArray(b.talents.modifiers)) b.talents.modifiers.forEach((m: unknown, i: number) => {
      const p = `talents.modifiers.${i}`
      if (!object(m)) { add(issues, 'invalid', p, '天赋加成必须是对象'); return }
      if (!str(m.source)) add(issues, m.source === undefined ? 'missing' : 'invalid', `${p}.source`, '加成来源id必填')
      if (!['normal', 'skill', 'burst'].includes(m.talent)) add(issues, m.talent === undefined ? 'missing' : 'invalid', `${p}.talent`, '天赋类型必须是 normal/skill/burst')
      if (!Number.isInteger(m.levels) || m.levels < 1) add(issues, m.levels === undefined ? 'missing' : 'invalid', `${p}.levels`, '提升等级必须是正整数')
    })
  }
  if (!object(b.weapon)) add(issues, b.weapon === undefined ? 'missing' : 'invalid', 'weapon', '武器对象缺失')
  else {
    for (const key of ['id', 'name'] as const) if (!str(b.weapon[key])) add(issues, b.weapon[key] === undefined ? 'missing' : 'invalid', `weapon.${key}`, '必须是非空字符串')
    for (const key of ['level', 'ascension', 'refinement'] as const) {
      const value = b.weapon[key]
      const min = key === 'ascension' ? 0 : 1
      const max = key === 'level' ? 90 : key === 'ascension' ? 6 : 5
      if (value === undefined) add(issues, 'missing', `weapon.${key}`, '必填字段缺失')
      else if (!Number.isInteger(value) || value < min) add(issues, 'invalid', `weapon.${key}`, `必须是大于等于 ${min} 的整数`)
      else if (value > max) add(issues, key === 'refinement' ? 'invalid' : 'unsupported', `weapon.${key}`, `P0支持范围 ${min}..${max}`)
    }
  }
  if (!Array.isArray(b.artifacts)) add(issues, b.artifacts === undefined ? 'missing' : 'invalid', 'artifacts', '圣遗物必须是数组')
  else {
    const seen = new Set<string>()
    b.artifacts.forEach((a: unknown, i: number) => {
      const p = `artifacts.${i}`
      if (!object(a)) { add(issues, 'invalid', p, '圣遗物必须是对象'); return }
      if (!slots.includes(a.slot)) add(issues, a.slot === undefined ? 'missing' : 'invalid', `${p}.slot`, '部位无效')
      else if (seen.has(a.slot)) add(issues, 'invalid', `${p}.slot`, '五个部位必须唯一')
      else seen.add(a.slot)
      for (const key of ['name', 'setId'] as const) if (!str(a[key])) add(issues, a[key] === undefined ? 'missing' : 'invalid', `${p}.${key}`, '必须是非空字符串')
      if (!Number.isInteger(a.rarity) || a.rarity < 1 || a.rarity > 5) add(issues, a.rarity === undefined ? 'missing' : 'invalid', `${p}.rarity`, '品质必须是 1..5 整数')
      if (!Number.isInteger(a.level) || a.level < 0) add(issues, a.level === undefined ? 'missing' : 'invalid', `${p}.level`, '必须是非负整数')
      else if (artifactMaxLevel[a.rarity] !== undefined && a.level > artifactMaxLevel[a.rarity]) add(issues, 'invalid', `${p}.level`, `超过品质强化上限 ${artifactMaxLevel[a.rarity]}`)
      validateStat(a.main, `${p}.main`, issues)
      const allowed = slots.includes(a.slot) ? mainKeys[a.slot as ArtifactSlot] : null
      if (allowed && object(a.main) && statKeys.has(a.main.key) && !allowed.includes(a.main.key)) add(issues, 'invalid', `${p}.main.key`, `${a.slot} 部位的主词条不能是 ${a.main.key}`)
      if (!Array.isArray(a.sub)) add(issues, a.sub === undefined ? 'missing' : 'invalid', `${p}.sub`, '副词条必须是数组')
      else {
        a.sub.forEach((s: unknown, j: number) => validateStat(s, `${p}.sub.${j}`, issues))
        const subKeys = new Set<string>()
        const duplicated = new Set<string>()
        for (const s of a.sub) if (object(s) && str(s.key)) { if (subKeys.has(s.key)) duplicated.add(s.key); subKeys.add(s.key) }
        for (const key of duplicated) add(issues, 'invalid', `${p}.sub`, `副词条不能出现重复属性 ${key}`)
        if (object(a.main) && str(a.main.key) && subKeys.has(a.main.key)) add(issues, 'invalid', `${p}.sub`, `副词条不能与主词条同属性 ${a.main.key}`)
      }
    })
    if (seen.size !== 5) add(issues, 'missing', 'artifacts', '必须恰好包含五个不同部位')
  }
  if (!Array.isArray(b.requiredEffects)) add(issues, b.requiredEffects === undefined ? 'missing' : 'invalid', 'requiredEffects', '机制来源列表必须是数组')
  if (!object(b.provenance)) add(issues, b.provenance === undefined ? 'missing' : 'invalid', 'provenance', '来源信息缺失')
  else {
    if (!str(b.provenance.provider)) add(issues, 'missing', 'provenance.provider', '来源提供者必填')
    for (const key of ['providerVersion', 'sourceTime']) if (b.provenance[key] === undefined) add(issues, 'missing', `provenance.${key}`, '未知值必须显式提供 null')
    if (b.provenance.providerVersion !== null && b.provenance.providerVersion !== undefined && !str(b.provenance.providerVersion)) add(issues, 'invalid', 'provenance.providerVersion', '版本必须为非空字符串或 null')
    if (b.provenance.sourceTime !== null && b.provenance.sourceTime !== undefined && !(str(b.provenance.sourceTime) || finite(b.provenance.sourceTime))) add(issues, 'invalid', 'provenance.sourceTime', '来源时间必须为字符串、有限数值或 null')
  }
  if (!issues.length) {
    const expected = requiredEffectSources(b as CharacterBuild)
    const actual = b.requiredEffects as unknown[]
    const ids = new Set<string>()
    actual.forEach((e, i) => {
      if (!object(e)) { add(issues, 'invalid', `requiredEffects.${i}`, '机制来源必须是对象'); return }
      if (!str(e.id)) add(issues, 'missing', `requiredEffects.${i}.id`, '机制来源 id 缺失')
      if (!['character', 'weapon', 'artifact-set', 'constellation'].includes(e.kind)) add(issues, 'unsupported', `requiredEffects.${i}.kind`, '不支持的机制来源类型')
      if (str(e.id)) { if (ids.has(e.id)) add(issues, 'invalid', `requiredEffects.${i}.id`, '机制来源重复'); ids.add(e.id) }
    })
    for (const e of expected) {
      if (!ids.has(e.id)) add(issues, 'missing', 'requiredEffects', `未审计必需效果 ${e.id}`)
      else if (!actual.some(a => object(a) && a.id === e.id && a.kind === e.kind)) add(issues, 'invalid', 'requiredEffects', `机制类型与来源身份不匹配 ${e.id}`)
    }
    for (const id of ids) if (!expected.some(e => e.id === id)) add(issues, 'invalid', 'requiredEffects', `存在非预期机制来源 ${id}`)
    if (Array.isArray(b.talents.modifiers)) b.talents.modifiers.forEach((m: any, i: number) => {
      if (str(m?.source) && !ids.has(m.source)) add(issues, 'invalid', `talents.modifiers.${i}.source`, '天赋加成来源必须登记在 requiredEffects 中')
    })
  }
  if (issues.length) return failure(issues)
  return { status: 'raw-complete', build: b as CharacterBuild, simulationReady: false }
}

export interface PermanentDataExpectation { gameVersion: string; bundleId: string; source: string }
const statNames: (keyof PermanentStats)[] = ['mastery', 'cpct', 'cdmg', 'recharge', 'dmg', 'phy', 'heal', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro', 'normalDmg', 'chargedDmg', 'plungeDmg', 'skillDmg', 'burstDmg', 'normalCpct', 'chargedCpct', 'plungeCpct', 'skillCpct', 'burstCpct']

/** 构建永久面板，只计基础白值、经过审计的静态效果和圣遗物属性。 */
export function buildPermanentStats(input: unknown, dataInput: unknown, expected: PermanentDataExpectation): PermanentBuildResult {
  const checked = validateCharacterBuild(input)
  if (checked.status !== 'raw-complete') return checked
  const build = checked.build
  const issues: Issue[] = []
  if (!object(dataInput)) return failure([{ code: 'invalid', path: 'permanentData', message: '永久数据必须是对象' }])
  const d = dataInput as unknown as PermanentData
  for (const key of ['gameVersion', 'bundleId', 'source'] as const) {
    if (!str(expected?.[key])) add(issues, 'missing', `expected.${key}`, '必须提供期望值')
    if (!str(d[key])) add(issues, 'missing', `permanentData.${key}`, '永久数据元信息必须完整')
    else if (d[key] !== expected?.[key]) add(issues, 'version-mismatch', `permanentData.${key}`, '永久数据元信息与期望值不一致')
  }
  if (!object(d.character) || !object(d.weapon)) add(issues, 'missing', 'permanentData.identity', '角色与武器数据身份缺失')
  else {
    for (const [key, value] of [['character.id', build.characterId], ['weapon.id', build.weapon.id], ['character.level', build.level], ['character.ascension', build.ascension], ['weapon.level', build.weapon.level], ['weapon.ascension', build.weapon.ascension]] as [string, unknown][]) {
      const [owner, field] = key.split('.')
      const got = (d as any)[owner][field]
      if (got !== value) add(issues, 'version-mismatch', `permanentData.${key}`, '永久数据身份/等级与配装输入不一致')
    }
  }
  const checkBonuses = (list: unknown, path: string) => {
    if (!Array.isArray(list)) { add(issues, list === undefined ? 'missing' : 'invalid', path, '属性列表缺失'); return }
    list.forEach((s, i) => validateStat(s, `${path}.${i}`, issues))
  }
  /** 静态加成不能绕过效果审计：突破/武器那类加成必须登记到对应来源的 modifiers 里。 */
  const requireEmptyBonuses = (list: unknown, path: string) => {
    if (!Array.isArray(list)) { add(issues, list === undefined ? 'missing' : 'invalid', path, '属性列表缺失'); return }
    if (list.length) add(issues, 'unsupported', path, 'P0 不接受未经审计的静态加成，请登记到对应来源的效果 modifiers')
  }
  if (!object(d.character) || !object(d.character.base)) add(issues, 'missing', 'permanentData.character.base', '角色基础白值缺失')
  else for (const key of ['hp', 'atk', 'def'] as const) if (!finite(d.character.base[key]) || d.character.base[key] <= 0) add(issues, 'invalid', `permanentData.character.base.${key}`, '基础白值必须是正有限数值')
  if (!object(d.weapon) || !finite(d.weapon.baseAtk) || d.weapon.baseAtk < 0) add(issues, 'invalid', 'permanentData.weapon.baseAtk', '武器白值必须是非负有限数值')
  if (object(d.character)) requireEmptyBonuses(d.character.bonuses, 'permanentData.character.bonuses')
  if (object(d.weapon)) requireEmptyBonuses(d.weapon.bonuses, 'permanentData.weapon.bonuses')
  if (!object(d.effects)) add(issues, 'missing', 'permanentData.effects', '效果审计表缺失')
  const effectEntries: [string, any][] = []
  const unmodeled: { id: string; reason: string }[] = []
  if (object(d.effects)) for (const source of requiredEffectSources(build)) {
    const effect = d.effects[source.id]
    if (!effect) { add(issues, 'missing', `permanentData.effects.${source.id}`, 'requiredEffect 未逐项审计'); continue }
    if (!['verified-static', 'known-no-static', 'unsupported'].includes(effect.status)) add(issues, 'invalid', `permanentData.effects.${source.id}.status`, '效果审计状态无效')
    else if (effect.status === 'unsupported') add(issues, 'unsupported', `permanentData.effects.${source.id}`, '此必需效果不受 P0 支持')
    if (typeof effect.runtimeRequired !== 'boolean') add(issues, 'invalid', `permanentData.effects.${source.id}.runtimeRequired`, '必须显式标注运行时效果状态')
    if (effect.status === 'verified-static' || effect.status === 'known-no-static') checkBonuses(effect.modifiers, `permanentData.effects.${source.id}.modifiers`)
    if (effect.status === 'known-no-static' && effect.modifiers?.length) add(issues, 'invalid', `permanentData.effects.${source.id}.modifiers`, 'known-no-static 必须是空数组')
    if (effect.unmodeled !== undefined) {
      // 没建模的部分必须有人话说明；只写「有偏差」等于没说，结果里也没法披露到具体效果。
      if (typeof effect.unmodeled !== 'string' || !effect.unmodeled.trim()) add(issues, 'invalid', `permanentData.effects.${source.id}.unmodeled`, 'unmodeled 必须是非空字符串')
      else if (effect.status === 'unsupported') add(issues, 'invalid', `permanentData.effects.${source.id}.unmodeled`, 'unsupported 已经整体不支持，不能再声明未建模部分')
      else unmodeled.push({ id: source.id, reason: effect.unmodeled.trim() })
    }
    if (effect.note !== undefined && (typeof effect.note !== 'string' || !effect.note.trim())) add(issues, 'invalid', `permanentData.effects.${source.id}.note`, 'note 必须是非空字符串')
    effectEntries.push([source.id, effect])
  }
  if (issues.length) return failure(issues)
  const values: Record<string, number> = Object.fromEntries([...statNames.map(k => [k, k === 'cpct' ? 0.05 : k === 'cdmg' ? 0.5 : k === 'recharge' ? 1 : 0]), ['hp', 0], ['atk', 0], ['def', 0]])
  const flat = { hp: 0, atk: 0, def: 0 }, pct = { hp: 0, atk: 0, def: 0 }
  const trace: { source: string; key: string; value: number }[] = [
    { source: 'standard-base', key: 'cpct', value: 0.05 },
    { source: 'standard-base', key: 'cdmg', value: 0.5 },
    { source: 'standard-base', key: 'recharge', value: 1 },
    { source: 'character-base', key: 'hp', value: d.character.base.hp },
    { source: 'character-base', key: 'atk', value: d.character.base.atk },
    { source: 'character-base', key: 'def', value: d.character.base.def },
    { source: 'weapon-base', key: 'atk', value: d.weapon.baseAtk }
  ]
  const addStat = (source: string, stat: StatValue) => {
    if (stat.key === 'hp' || stat.key === 'atk' || stat.key === 'def') flat[stat.key] += stat.value
    else if (stat.key === 'hpPct' || stat.key === 'atkPct' || stat.key === 'defPct') pct[stat.key.slice(0, -3) as keyof typeof pct] += stat.value
    else values[stat.key] += stat.value
    trace.push({ source, key: stat.key, value: stat.value })
  }
  for (const [id, effect] of effectEntries) {
    trace.push({ source: id, key: `audit:${effect.status}`, value: 1 })
    if (effect.status === 'verified-static') for (const s of effect.modifiers) addStat(id, s)
    if (effect.runtimeRequired) trace.push({ source: id, key: 'runtimeRequired', value: 1 })
  }
  for (const a of build.artifacts) {
    addStat(`artifact:${a.slot}:main`, a.main)
    for (const s of a.sub) addStat(`artifact:${a.slot}:sub`, s)
  }
  const base = { hp: d.character.base.hp, atk: d.character.base.atk + d.weapon.baseAtk, def: d.character.base.def, weaponAtk: d.weapon.baseAtk }
  const stats = { ...values, hp: base.hp * (1 + pct.hp) + flat.hp, atk: base.atk * (1 + pct.atk) + flat.atk, def: base.def * (1 + pct.def) + flat.def } as PermanentStats
  if (!Object.values(stats).every(Number.isFinite)) return failure([{ code: 'invalid', path: 'stats', message: '属性累计溢出为非有限数值' }])
  const setCounts: Record<string, number> = Object.create(null)
  for (const a of build.artifacts) setCounts[a.setId] = (setCounts[a.setId] || 0) + 1
  /*
   * 转换式 4 件套（2026-11-02 切片 4）：绝缘之旗印 400184，
   * 元素爆发伤害 + 元素充能效率的 25%，最多 +75%。依赖组装后的充能效率，所以放在这里折算。
   */
  if ((setCounts['400184'] || 0) >= 4) {
    const bonus = Math.min(0.25 * stats.recharge, 0.75)
    stats.burstDmg = (stats.burstDmg ?? 0) + bonus
    trace.push({ source: 'artifact-set:400184:4pc', key: 'burstDmg', value: bonus })
  }
  return { status: 'permanent-ready', scope: 'permanent-stats', simulationReady: false, stats, base, setCounts, runtimeEffects: effectEntries.filter(([, e]) => e.runtimeRequired).map(([id]) => id), unmodeled, trace, gameVersion: d.gameVersion, bundleId: d.bundleId }
}
