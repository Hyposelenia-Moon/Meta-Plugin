/** miao 原始配装适配。只读取公开 Avatar/Artis 字段，不用最终面板或伤害行反推配装。 */
import type { ArtifactSlot, BuildAdaptResult, CharacterBuild, Issue, SourceInfo, StatKey, StatValue, TeamBuildResult } from '../modules/teamSimulation/index.js'
import { requiredEffectSources, validateCharacterBuild } from '../modules/teamSimulation/index.js'
import { loadMiaoModels, resolveUid } from './MiaoProfile.js'

type RecordLike = Record<string, any>
const obj = (value: unknown): RecordLike => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {}
const text = (value: unknown): string => typeof value === 'string' && value.trim() ? value.trim() : ''
const slots: ArtifactSlot[] = ['flower', 'plume', 'sands', 'goblet', 'circlet']
// miao 的 hp/atk/def 圣遗物词条表示百分数，hpPlus 等才是固定值；所有比例只在入口除100一次。
const keys: Record<string, { key: StatKey, ratio: boolean }> = {
  hp: { key: 'hpPct', ratio: true }, atk: { key: 'atkPct', ratio: true }, def: { key: 'defPct', ratio: true },
  hpPlus: { key: 'hp', ratio: false }, atkPlus: { key: 'atk', ratio: false }, defPlus: { key: 'def', ratio: false },
  mastery: { key: 'mastery', ratio: false }, cpct: { key: 'cpct', ratio: true }, cdmg: { key: 'cdmg', ratio: true },
  recharge: { key: 'recharge', ratio: true }, dmg: { key: 'dmg', ratio: true }, phy: { key: 'phy', ratio: true }, heal: { key: 'heal', ratio: true },
  pyro: { key: 'pyro', ratio: true }, hydro: { key: 'hydro', ratio: true }, electro: { key: 'electro', ratio: true },
  cryo: { key: 'cryo', ratio: true }, anemo: { key: 'anemo', ratio: true }, geo: { key: 'geo', ratio: true }, dendro: { key: 'dendro', ratio: true }
}
// 花/羽主词条固定；沙/杯/冠按游戏允许集合校验，避免串位或被伪造的原始id混过完整性校验。
const mainKeys: Record<ArtifactSlot, StatKey[]> = {
  flower: ['hp'], plume: ['atk'],
  sands: ['hpPct', 'atkPct', 'defPct', 'recharge', 'mastery'],
  goblet: ['hpPct', 'atkPct', 'defPct', 'mastery', 'phy', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'],
  circlet: ['hpPct', 'atkPct', 'defPct', 'mastery', 'cpct', 'cdmg', 'heal']
}

/** 纯适配入口，可用冻结的公开字段对象离线复验。sourceTime未知必须传null，不能伪造当前时间。 */
export function adaptMiaoAvatar (input: unknown, provenance: SourceInfo): BuildAdaptResult {
  const avatar = obj(input)
  const issues: Issue[] = []
  const issue = (code: Issue['code'], path: string, message: string): void => { issues.push({ code, path, message }) }
  if (avatar.game !== 'gs') issue('unsupported', 'game', 'P0只支持原神gs原始配装')
  const character = obj(avatar.char)
  const weapon = obj(avatar.weapon)
  const stat = (raw: unknown, path: string): StatValue | null => {
    const value = obj(raw)
    const key = typeof value.key === 'string' && Object.hasOwn(keys, value.key) ? keys[value.key] : undefined
    if (!key) { issue('unsupported', `${path}.key`, '未识别的原始词条类型'); return null }
    if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0) {
      issue('invalid', `${path}.value`, '原始词条必须为非负有限数字，不能使用展示文本'); return null
    }
    return { key: key.key, value: key.ratio ? value.value / 100 : value.value }
  }
  const artifacts: CharacterBuild['artifacts'] = []
  try {
    const artis = avatar.artis
    if (!artis || typeof artis.forEach !== 'function') issue('missing', 'artifacts', '未取到公开Artis实例，不能从套装摘要反推五件配装')
    else artis.forEach((raw: unknown, index: unknown) => {
      const row = obj(raw)
      const n = typeof index === 'number' ? index : typeof index === 'string' && /^[1-5]$/.test(index) ? Number(index) : NaN
      const path = `artifacts.${String(index)}`
      if (!Number.isInteger(n) || n < 1 || n > 5) { issue('invalid', path, '原神部位索引必须为1..5'); return }
      const slot = slots[n - 1]
      // 原始mainId必须是正整数且与解码id严格一致；null/0/字符串都证明不了已解码。
      if (!Number.isInteger(row.mainId) || row.mainId <= 0) issue(row.mainId === undefined ? 'missing' : 'invalid', `${path}.mainId`, '原始主词条id必须是正整数，空值或展示文本不能证明已解码')
      else if (obj(row.main).id !== row.mainId) issue('invalid', `${path}.mainId`, '主词条解码id与原始id不一致')
      if (!Array.isArray(row.attrIds)) issue(row.attrIds === undefined ? 'missing' : 'invalid', `${path}.attrIds`, '缺少原始副词条id列表')
      else if (row.attrIds.length < 1) issue('invalid', `${path}.attrIds`, '圣遗物不可能没有副词条，空列表不能算已解码')
      const main = stat(row.main, `${path}.main`)
      if (main && !mainKeys[slot].includes(main.key)) issue('invalid', `${path}.main`, `${slot} 部位的主词条不能是 ${main.key}`)
      if (!Array.isArray(row.attrs)) { issue('missing', `${path}.attrs`, '缺少已解码副词条'); return }
      // miao 的 attrs 已按词条合并，长度即副词条条数；五星满级在游戏内恒为4条。
      if (row.star === 5 && row.level === 20 && row.attrs.length !== 4) issue('invalid', `${path}.attrs`, '五星满级圣遗物必须恰好4条副词条')
      const rolls = row.attrs.reduce((n: number, x: unknown) => n + (Number.isInteger(obj(x).upNum) && obj(x).upNum >= 1 ? obj(x).upNum : NaN), 0)
      if (Array.isArray(row.attrIds) && rolls !== row.attrIds.length) issue('invalid', `${path}.attrIds`, '原始副词条未完整解码，禁止丢弃未知词条后继续')
      const sub = row.attrs.map((x: unknown, i: number) => stat(x, `${path}.sub.${i}`)).filter((x: StatValue | null): x is StatValue => x !== null)
      if (main) artifacts.push({ slot, name: text(row.name), setId: text(row.set), rarity: row.star, level: row.level, main, sub })
    })
  } catch { issue('invalid', 'artifacts', '读取原始Artis实例失败') }
  const original = (key: string): number => {
    const value = obj(avatar.talent?.[key])
    if (typeof value.original !== 'number') issue('missing', `talents.${key}.original`, '必须提供原始天赋等级，禁止用命座加成后的等级替代')
    return value.original
  }
  const rawId = (value: unknown): string => typeof value === 'number' && Number.isInteger(value) ? String(value) : text(value)
  const actorId = rawId(avatar.id)
  const characterId = rawId(character.id)
  // actorId 是面板实例id，characterId 才是角色身份；不能用avatar.id冒充角色id。
  if (!characterId) issue('missing', 'char.id', '缺少角色id，不能用面板实例id代替')
  else if (!actorId) issue('missing', 'id', '缺少角色面板实例id')
  else if (actorId !== characterId) issue('invalid', 'char.id', '面板实例id与角色id不一致')
  const weaponId = rawId(weapon.id)
  const build: CharacterBuild = {
    schemaVersion: 1, actorId, characterId, name: text(character.name) || text(avatar.name), element: text(avatar.elem),
    level: avatar.level, ascension: avatar.promote, constellation: avatar.cons,
    talents: { normal: original('a'), skill: original('e'), burst: original('q') },
    weapon: { id: weaponId, name: text(weapon.name), level: weapon.level, ascension: weapon.promote, refinement: weapon.affix },
    artifacts, requiredEffects: [], provenance
  }
  build.requiredEffects = requiredEffectSources(build)
  const validated = validateCharacterBuild(build)
  if (validated.status !== 'raw-complete') issues.push(...validated.issues)
  if (issues.length) return { status: issues.some(x => x.code === 'invalid') ? 'invalid' : issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'incomplete', issues }
  return { status: 'raw-complete', build: structuredClone(build), simulationReady: false }
}

/** 本地缓存四人读取，供未来编排调用；不刷新、不调用calcDmg、不改动Player.e。 */
export async function readTeamBuilds (e: YunzaiEvent, names: string[], explicitUid = ''): Promise<TeamBuildResult> {
  const fail = (path: string, message: string): TeamBuildResult => ({ status: 'incomplete', members: [], issues: [{ code: 'missing', path, message }], simulationReady: false })
  if (names.length !== 4 || names.some(n => !text(n))) return fail('team', '必须指定四名角色')
  const uid = await resolveUid(e, explicitUid)
  if (!uid.uid) return fail('uid', uid.error || '没有可用账号绑定')
  try {
    const models = await loadMiaoModels()
    const player = typeof models.Player?.get === 'function' ? models.Player.get(uid.uid)
      : typeof models.Player?.create === 'function' ? models.Player.create(uid.uid, 'gs') : null
    if (!player || typeof player.getAvatar !== 'function') return fail('player', '本地没有可用Player缓存')
    const members: BuildAdaptResult[] = []
    for (const name of names) {
      const character = models.Character?.get?.(name)
      if (!character?.id) { members.push({ status: 'incomplete', issues: [{ code: 'missing', path: `team.${name}`, message: '未找到角色' }] }); continue }
      const avatar = player.getAvatar(character.id, false)
      if (!avatar) { members.push({ status: 'incomplete', issues: [{ code: 'missing', path: `team.${name}`, message: '本地没有角色面板缓存' }] }); continue }
      members.push(adaptMiaoAvatar(avatar, { provider: 'miao', providerVersion: null, sourceTime: typeof avatar._time === 'string' || typeof avatar._time === 'number' ? avatar._time : null }))
    }
    const issues = members.flatMap((m, i) => m.status === 'raw-complete' ? [] : m.issues.map(x => ({ ...x, path: `members.${i}.${x.path}` })))
    const ids = members.filter((m): m is Extract<BuildAdaptResult, { status: 'raw-complete' }> => m.status === 'raw-complete').map(m => m.build.characterId)
    if (new Set(ids).size !== ids.length) issues.push({ code: 'invalid', path: 'team', message: '四人队伍不能包含重复角色' })
    return { status: issues.length ? issues.some(x => x.code === 'invalid') ? 'invalid' : issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'incomplete' : 'raw-complete', members, issues, simulationReady: false }
  } catch (error) { return fail('miao', `读取本地模型失败：${(error as Error).message}`) }
}
