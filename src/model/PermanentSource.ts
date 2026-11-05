/**
 * 永久数据的**运行时**生成：按玩家实际的角色 + 武器 + 精炼现算，不再要求先跑离线脚本。
 *
 * 为什么放在 model 层：这里要读 miao 的 meta-gs 原始数据（角色白值、武器白值/副属性、套装文本），
 * 属于「外部数据源适配」；内核（teamSimulation/）只收已经成形的 `PermanentData`，保持纯函数。
 *
 * 口径与 `scripts/gen-permanent.mjs` 完全一致：
 *   - 角色 90 级白值 / 突破加成、武器白值与副属性取 miao 结构化字段；
 *   - 能一对一解析的 2 件套写 modifiers，其余（4 件套、命座、未登记武器被动）逐条进 unmodeled，
 *     绝不「不知道就当没有」；
 *   - 生成的 effects 覆盖全部套装与 1–6 命，换配装不需要重生成。
 *
 * 与脚本的差别只有一处：这里只按 `weaponId` 查武器（玩家配装里带的是 id），脚本按名字查。
 */
import fs from 'node:fs'
import path from 'node:path'
import { botRoot } from '../dir.js'
import type { PermanentData, StatKey, StatValue } from '../modules/teamSimulation/types.js'
import type { EffectSpec, EffectTriggerKind } from '../modules/teamSimulation/effects.js'

/**
 * miao 数据根：优先环境变量，其次按 Yunzai 标准安装位置找；开发仓库不在 Yunzai/plugins 下时
 * 还要回落到本机已知路径，否则运行时现算会静默变成「读不到」。
 */
function resolveMiaoRoot (): string {
  const candidates: string[] = []
  if (process.env.MIAO_ROOT) candidates.push(process.env.MIAO_ROOT)
  candidates.push(path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs'))
  candidates.push('D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs')
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'character'))) return candidate
  }
  return candidates[0] ?? ''
}

const MIAO_ROOT = resolveMiaoRoot()
const CHARACTER_DIR = path.join(MIAO_ROOT, 'character')
const ARTIFACT_FILE = path.join(MIAO_ROOT, 'artifact', 'data.json')
const WEAPON_DIR = path.join(MIAO_ROOT, 'weapon')

const GAME_VERSION = '7.1'
const BUNDLE_ID = 'permanent-7.1'
const SOURCE = 'miao meta-gs 7.1（白值/突破/武器副属性）+ 运行时按玩家配装生成；套装与被动按本仓库已审计结论披露'
const LEVEL = 90
const ASCENSION = 6

const ELEMENTS: Record<string, string> = { 火: 'pyro', 水: 'hydro', 雷: 'electro', 冰: 'cryo', 风: 'anemo', 岩: 'geo', 草: 'dendro' }
const ELEMENT_KEYS = new Set(['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'])

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6
const pct = (raw: unknown): number => round6(Number(raw) / 100)
const flat = (raw: unknown): number => round6(Number(raw))

const UTILITY_PASSIVE = /锻造|烹饪|合成|采集|派遣|钓鱼|矿石|料理|药剂/

interface MiaoCharacter {
  id?: string | number
  name?: string
  elem?: string
  attr?: { keys?: string[], details?: Record<string, number[]> }
  growAttr?: { key?: string, value?: number }
  passive?: Array<{ name?: string, desc?: string }>
  cons?: Record<string, { name?: string }>
}
interface MiaoWeapon {
  id?: string | number
  name?: string
  attr?: { atk?: Record<string, number>, bonusKey?: string, bonusData?: Record<string, number> }
  affixTitle?: string
  affixData?: { text?: string }
}
interface ArtifactSet { name?: string, skills?: Record<string, string> }
type ArtifactData = Record<string, ArtifactSet>

/** 武器被动的人审结论（与 scripts/gen-permanent.mjs 的 WEAPON_NOTES 同步维护）。 */
const WEAPON_NOTES: Record<string, { status: 'verified-static' | 'known-no-static', static?: StatValue[], runtimeRequired: boolean, unmodeled?: string }> = {
  13303: { status: 'known-no-static', static: [], runtimeRequired: false, unmodeled: undefined },
  11415: { status: 'verified-static', static: [], runtimeRequired: true, unmodeled: '元素战技伤害提高防御力的 40%（R1）：内核没有「按防御折算伤害」通道，未计入' },
  12510: { status: 'verified-static', static: [{ key: 'defPct', value: 0.28 }], runtimeRequired: true, unmodeled: '普通攻击与重击伤害提高防御力的 40%（R1）：内核没有「按防御折算伤害」通道，未计入' },
  15401: { status: 'known-no-static', static: [], runtimeRequired: true, unmodeled: '暴击产生元素微粒回能（60% 概率 / 12 秒一次）：产球随机与暴击依赖都未建模' }
}

function readJson (file: string): unknown | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** 按目录类型（sword/claymore/polearm/bow/catalyst）找武器；类型要跟着返回，4 件套条件要用。 */
function findWeaponById (weaponId: string): { weapon: MiaoWeapon, type: string } | null {
  let types: string[] = []
  try { types = fs.readdirSync(WEAPON_DIR) } catch { return null }
  for (const type of types) {
    let names: string[] = []
    try { names = fs.readdirSync(path.join(WEAPON_DIR, type)) } catch { continue }
    for (const name of names) {
      const raw = readJson(path.join(WEAPON_DIR, type, name, 'data.json'))
      if (raw && typeof raw === 'object' && String((raw as MiaoWeapon).id) === weaponId) return { weapon: raw as MiaoWeapon, type }
    }
  }
  return null
}

function ascensionModifier (character: MiaoCharacter): { status: 'verified-static' | 'unsupported', modifiers: StatValue[], reason?: string } {
  const grow = character.growAttr
  if (!grow || typeof grow.key !== 'string') return { status: 'unsupported', modifiers: [], reason: '突破加成缺失' }
  const value = Number(grow.value)
  if (!Number.isFinite(value)) return { status: 'unsupported', modifiers: [], reason: '突破加成不是数字' }
  switch (grow.key) {
    case 'dmg': {
      const key = ELEMENT_KEYS.has(String(character.elem)) ? String(character.elem) : ELEMENTS[String(character.elem)]
      return key ? { status: 'verified-static', modifiers: [{ key: key as StatKey, value: pct(value) }] } : { status: 'unsupported', modifiers: [], reason: `无法把 dmg 突破加成映射到元素（elem=${character.elem}）` }
    }
    case 'cpct': case 'cdmg': case 'atkPct': case 'defPct': case 'hpPct': case 'recharge': case 'phy': case 'heal':
      return { status: 'verified-static', modifiers: [{ key: grow.key as StatKey, value: pct(value) }] }
    case 'mastery':
      return { status: 'verified-static', modifiers: [{ key: 'mastery', value: flat(value) }] }
    default:
      return { status: 'unsupported', modifiers: [], reason: `未收录的突破加成键 ${grow.key}` }
  }
}

function weaponSubstat (weapon: MiaoWeapon): StatValue | null {
  const key = weapon.attr?.bonusKey
  const raw = weapon.attr?.bonusData?.[String(LEVEL)]
  if (!key || !Number.isFinite(Number(raw))) return null
  return ['mastery', 'hp', 'atk', 'def'].includes(key)
    ? { key: key as StatKey, value: flat(raw) }
    : { key: key as StatKey, value: pct(raw) }
}

function parseTwoPiece (text: unknown): StatValue | null {
  if (typeof text !== 'string') return null
  const t = text.trim().replace(/[。.]$/, '')
  let r: RegExpExecArray | null
  if ((r = /^攻击力提高(\d+(?:\.\d+)?)%$/.exec(t))) return { key: 'atkPct', value: pct(r[1]) }
  if ((r = /^防御力提高(\d+(?:\.\d+)?)%$/.exec(t))) return { key: 'defPct', value: pct(r[1]) }
  if ((r = /^生命值(?:上限)?提[升高](\d+(?:\.\d+)?)%$/.exec(t))) return { key: 'hpPct', value: pct(r[1]) }
  if ((r = /^元素充能效率提高(\d+(?:\.\d+)?)%$/.exec(t))) return { key: 'recharge', value: pct(r[1]) }
  if ((r = /^元素精通提高(\d+(?:\.\d+)?)点$/.exec(t))) return { key: 'mastery', value: flat(r[1]) }
  if ((r = /^暴击率提高(\d+(?:\.\d+)?)%$/.exec(t))) return { key: 'cpct', value: pct(r[1]) }
  if ((r = /^造成的物理伤害提高(\d+(?:\.\d+)?)%$/.exec(t))) return { key: 'phy', value: pct(r[1]) }
  if ((r = /^(?:角色造成的)?(?:治疗加成|治疗效果)提[升高](\d+(?:\.\d+)?)%$/.exec(t))) return { key: 'heal', value: pct(r[1]) }
  if ((r = /^生命值上限提高(\d+(?:\.\d+)?)点$/.exec(t))) return { key: 'hp', value: flat(r[1]) }
  if ((r = /^防御力提高(\d+(?:\.\d+)?)点$/.exec(t))) return { key: 'def', value: flat(r[1]) }
  if ((r = /^(?:获得)?(\d+(?:\.\d+)?)%(火|水|雷|冰|风|岩|草)元素伤害加成$/.exec(t))) return { key: ELEMENTS[r[2]] as StatKey, value: pct(r[1]) }
  if ((r = /^(?:获得)?(火|水|雷|冰|风|岩|草)元素伤害加成提高(\d+(?:\.\d+)?)%$/.exec(t))) return { key: ELEMENTS[r[1]] as StatKey, value: pct(r[2]) }
  return null
}

function passiveNames (character: MiaoCharacter): string[] {
  const list = Array.isArray(character.passive) ? character.passive : []
  return list
    .filter(item => !UTILITY_PASSIVE.test(String(item?.desc ?? '')))
    .map(item => item?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
}

function constellationName (character: MiaoCharacter, level: number): string | null {
  const cons = character.cons
  if (!cons || typeof cons !== 'object') return null
  const entry = cons[String(level)]
  return entry && typeof entry === 'object' ? String(entry.name ?? '') : null
}

type EffectEntry = PermanentData['effects'][string]

/**
 * 不依赖触发条件、可直接进面板的 4 件套（2026-11-02 切片 1）。
 *
 * `weaponTypes` 为空表示不限武器；有值时按实装武器类型判断，
 * 条件不成立就不加面板，但要写进 `unmodeled` 披露（否则报告会说「已计入」）。
 */
const STATIC_FOUR_PIECE: Record<string, { key: StatKey; value: number; extra?: Array<{ key: StatKey; value: number }>; weaponTypes?: string[]; note: string; unmodeled?: string }> = {
  '400089': {
    key: 'normalDmg',
    value: 0.35,
    weaponTypes: ['sword', 'claymore', 'polearm'],
    note: '4 件套：普通攻击造成的伤害 +35%（单手剑/大剑/长柄武器）'
  },
  '400099': {
    key: 'chargedDmg',
    value: 0.35,
    weaponTypes: ['catalyst', 'bow'],
    note: '4 件套：重击造成的伤害 +35%（法器/弓）'
  },
  '400271': {
    key: 'skillDmg',
    value: 0.25,
    note: '4 件套：元素战技造成的伤害 +25%；处于队伍后台时再 +25%（后台部分见 OFF_FIELD_FOUR_PIECE）'
  },
  '400003': {
    key: 'chargedCpct',
    value: 0.3,
    note: '4 件套：重击的暴击率 +30%；内核按重击命中的暴击率加算'
  },
  '400008': {
    key: 'dmg',
    value: 0.3,
    note: '4 件套：对生命值高于 50% 的敌人造成的伤害 +30%；内核目标是无限血木桩，条件恒成立'
  },
  '400251': {
    key: 'skillDmg',
    value: 0.1,
    extra: [{ key: 'burstDmg', value: 0.1 }],
    note: '4 件套：元素战技与元素爆发造成的伤害 +10%',
    unmodeled: '4 件套「受到伤害后上述加成提高 80%，至多 5 层」需要受击模型，当前只计入常驻的 +10%'
  }
}

/**
 * 「只在后台生效」的常驻 4 件套（2026-11-05）：黄金剧团的 +25% 只在该角色不站场时计入。
 * 单独用一个效果 id，避免和审计条目 `artifact-set:<setId>:4pc` 的常驻部分互相覆盖。
 */
const OFF_FIELD_FOUR_PIECE: Record<string, { effect: EffectSpec & { trigger: EffectTriggerKind }; note: string }> = {
  '400271': {
    effect: {
      id: 'artifact-set:400271:4pc-offfield',
      target: 'self',
      stats: { skillDmg: 0.25 },
      trigger: 'always',
      offFieldOnly: true
    },
    note: '处于队伍后台时元素战技伤害再 +25%（登场后不生效）'
  }
}

/**
 * 触发式 4 件套（2026-11-02 切片 2）：由时间轴在该角色起手对应动作时激活。
 *
 * 生效时长按 60fps 帧数写（与现有动作包的帧口径一致）；换档位时尚未折算，
 * 与 §「帧数口径」里记录的限制相同。
 */
const TRIGGERED_FOUR_PIECE: Record<string, { effect: EffectSpec & { trigger: EffectTriggerKind }; note: string, unmodeled?: string }> = {
  '400164': {
    effect: {
      id: 'artifact-set:400164:4pc',
      target: 'self',
      stats: { normalDmg: 0.3, chargedDmg: 0.3 },
      durationFrames: 900,
      trigger: 'cast-skill'
    },
    note: '4 件套：施放元素战技后 15 秒内普攻与重击伤害 +30%'
  },
  '400119': {
    effect: {
      id: 'artifact-set:400119:4pc',
      target: 'team',
      stats: { atkPct: 0.2 },
      durationFrames: 720,
      trigger: 'cast-burst',
      stacking: 'ignore'
    },
    note: '4 件套：施放元素爆发后全队攻击力 +20%，持续 12 秒（同队不叠加）'
  },
  '400169': {
    effect: {
      id: 'artifact-set:400169:4pc',
      target: 'team',
      stats: { atkPct: 0.2 },
      durationFrames: 180,
      trigger: 'skill-hit',
      stacking: 'refresh'
    },
    note: '4 件套：元素战技命中敌人后全队攻击力 +20%，持续 3 秒；护盾强效 30% 不影响伤害、未建模'
  },
  '400189': {
    effect: {
      id: 'artifact-set:400189:4pc',
      target: 'self',
      stats: { defPct: 0.06, geo: 0.06 },
      durationFrames: 360,
      trigger: 'geo-hit',
      extraTriggers: ['off-field-tick'],
      icdFrames: 18,
      tickFrames: 180,
      stacking: 'stack',
      maxStacks: 4
    },
    note: '4 件套：岩元素伤害命中或后台每 3 秒获得 1 层「魄力」，每层防御 +6%、岩元素伤害 +6%，最多 4 层，持续 6 秒'
  },
  '400199': {
    effect: {
      id: 'artifact-set:400199:4pc',
      target: 'self',
      stats: { atkPct: 0.08 },
      durationFrames: 960,
      trigger: 'cast-burst',
      stacking: 'refresh'
    },
    note: '4 件套：施放元素爆发后「潜光」攻击力 +8%，持续 16 秒',
    unmodeled: '4 件套「生命值降低时攻击力再 +10%、最多 4 次」需要生命值变化模型，当前只计入爆发后的 +8%'
  },
  '400351': {
    effect: {
      id: 'artifact-set:400351:4pc',
      target: 'self',
      stats: { normalDmg: 0.6, burstDmg: 0.6 },
      trigger: 'energy-zero'
    },
    note: '4 件套：元素能量为 0 时，普通攻击与元素爆发伤害各 +60%',
    unmodeled: '普攻命中后使爆发加成失效 6 秒、爆发命中后使普攻加成失效 6 秒，这两段失效窗未建模'
  },
  '400028': {
    effect: {
      id: 'artifact-set:400028:4pc',
      target: 'self',
      stats: { normalDmg: 0.25, chargedDmg: 0.25 },
      durationFrames: 480,
      trigger: 'cast-skill',
      stacking: 'refresh'
    },
    note: '4 件套：施放元素战技后 8 秒内，普通攻击与重击伤害 +25%'
  },
  '400221': {
    effect: {
      id: 'artifact-set:400221:4pc',
      target: 'self',
      stats: { normalDmg: 0.4, chargedDmg: 0.4, plungeDmg: 0.4 },
      durationFrames: 900,
      trigger: 'charged-hit',
      stacking: 'refresh'
    },
    note: '4 件套：重击命中后 15 秒内，普攻/重击/下落伤害 +40%',
    unmodeled: '4 件套「普通攻击速度 +10%」会改变动作帧与循环节奏，当前帧表按 gcsim 静态帧计算，未提速'
  },
  '400291': {
    effect: {
      id: 'artifact-set:400291:4pc',
      target: 'self',
      stats: { geo: 0.2 },
      durationFrames: 600,
      trigger: 'cast-skill',
      stacking: 'refresh'
    },
    note: '4 件套：施放元素战技后 10 秒内岩元素伤害 +20%',
    unmodeled: '4 件套「处于结晶护盾或月笼附近时效果提高 150%」需要护盾/月笼状态，当前只计入 +20%'
  },
  '400241': {
    effect: {
      id: 'artifact-set:400241:4pc',
      target: 'self',
      stats: { atkPct: 0.07, hydro: 0.04 },
      durationFrames: 480,
      trigger: 'hit',
      stacking: 'stack',
      maxStacks: 3,
      icdFrames: 1
    },
    note: '4 件套：命中后获得 1 层「镜中水仙」，1/2/3 层攻击力 +7%/16%/25%、水元素伤害 +4%/9%/15%',
    unmodeled: '4 件套「不同来源的层独立存在」与 2/3 层的非线性增量（+16%/25%）当前按统一 +7%/+4% 叠 3 层近似，偏高或偏低取决于层数分布'
  },
  '400341': {
    effect: {
      id: 'artifact-set:400341:4pc',
      target: 'self',
      stats: { plungeDmg: 0.15 },
      durationFrames: 360,
      trigger: 'plunge-hit',
      extraTriggers: ['charged-hit', 'skill-hit'],
      stacking: 'stack',
      maxStacks: 5,
      icdFrames: 60,
      stacksPerTrigger: { 'plunge-hit': 1, 'charged-hit': 2, 'skill-hit': 2 }
    },
    note: '4 件套：下落/重击/战技命中后获得 1/2/2 层「永照的流辉」，下落攻击伤害 +15%，至多 5 层，6 秒',
    unmodeled: '4 件套「每层独立计时」当前按整池刷新近似；三个来源共用同一个 1 秒触发冷却'
  },
  '400391': {
    effect: {
      id: 'artifact-set:400391:4pc',
      target: 'self',
      stats: { atkPct: 0.25 },
      durationFrames: 360,
      trigger: 'hit',
      stacking: 'refresh'
    },
    note: '4 件套：普攻/重击/战技/爆发命中后获得「风与牧歌的眷怜」：攻击力 +25%，6 秒',
    unmodeled: '4 件套「完成魔女课业后升级为决意、额外暴击率 +20%」需要魔女课业状态，当前只计入攻击力 +25%'
  },
  '400179': {
    effect: {
      id: 'artifact-set:400179:4pc',
      target: 'self',
      stats: { normalDmg: 0.5, chargedDmg: 0.5, plungeDmg: 0.5 },
      durationFrames: 600,
      trigger: 'cast-skill',
      stacking: 'refresh',
      energyCost: 15
    },
    note: '4 件套：施放战技时若能量 ≥15 则流失 15 点能量，10 秒内普攻/重击/下落伤害 +50%',
    unmodeled: '4 件套「持续期间不再触发」当前每次施放战技都会重新触发（层数池按刷新处理）'
  },
  '400174': {
    effect: {
      id: 'artifact-set:400174:4pc',
      target: 'self',
      stats: { atkPct: 0.09 },
      durationFrames: 420,
      trigger: 'skill-hit',
      stacking: 'stack',
      maxStacks: 2,
      icdFrames: 18
    },
    note: '4 件套：元素战技命中后攻击力 +9%，7 秒，至多 2 层',
    unmodeled: '4 件套「叠满 2 层时 2 件套效果提升 100%」需要在满层时追加物理伤害加成，当前只计入攻击力部分'
  },
  '400043': {
    effect: {
      id: 'artifact-set:400043:4pc',
      target: 'team',
      durationFrames: 480,
      trigger: 'cast-burst',
      stacking: 'refresh',
      energyRestore: { amount: 2, target: 'team', excludeSelf: true, everyFrames: 120, times: 3 }
    },
    note: '4 件套：施放爆发后每 2 秒为队伍中除自己外的角色恢复 2 点元素能量，持续 6 秒'
  },
  '400058': {
    effect: {
      id: 'artifact-set:400058:4pc',
      target: 'team',
      durationFrames: 180,
      trigger: 'particle',
      stacking: 'refresh',
      icdFrames: 180,
      energyRestore: { amount: 3, target: 'team' }
    },
    note: '4 件套：获得元素微粒或晶球时，为队伍恢复 3 点元素能量，每 3 秒至多一次',
    unmodeled: '4 件套「只对队伍中的弓箭与法器角色生效」需要按武器类型过滤，当前对全队生效'
  },
  '400033': {
    effect: {
      id: 'artifact-set:400033:4pc',
      target: 'team',
      durationFrames: 480,
      trigger: 'reaction',
      stacking: 'refresh',
      stats: { mastery: 120 }
    },
    note: '4 件套：触发元素反应后，队伍中所有角色元素精通提升 120 点，持续 8 秒',
    unmodeled: '4 件套没有写明触发冷却；内核按「每次反应刷新持续时间」处理，同队不叠加'
  },
  '400204': {
    effect: {
      id: 'artifact-set:400204:4pc',
      target: 'self',
      durationFrames: 3,
      trigger: 'normal-hit',
      stacking: 'refresh',
      flatDamage: { scaling: 'atk', ratio: 0.7 * 0.5020362 }
    },
    note: '4 件套：普通攻击命中时 36% 概率追加一段「幽谷祝祀」，伤害为攻击力的 70%；未触发时下次概率 +20%（第 5 次必触发）。按期望折算为每次普攻 +攻击力的 35.1%',
    unmodeled: '36% 概率与 +20% 递增按期望折算（平均每 1.99 次普攻触发一次）；「0.2 秒内至多判定一次」未按时间窗去重'
  }
}

/**
 * 转换式 4 件套：数值依赖组装后的面板，无法写成固定 `modifiers`。
 * 审计条目声明「已建模」，换算在 `buildPermanentStats` 组装完面板后按 `setId` 执行。
 */
const CONVERT_FOUR_PIECE: Record<string, { note: string }> = {
  '400184': { note: '4 件套：元素爆发伤害 + 元素充能效率的 25%，最多 +75%（面板组装时折算）' }
}

/**
 * 对输出伤害没有可计算影响的 4 件套（治疗、抗性、拾取/开箱触发）。
 * 这套内核只算「我方造成的伤害」，既不结算受击也不结算治疗，所以这些效果按「已判定、不参与计算」登记，
 * 用 `note` 说明原因，不写 `unmodeled`（写了会当成偏低估披露并拦发布闸门）。
 */
const NO_DAMAGE_FOUR_PIECE: Record<string, string> = {
  '400013': '4 件套：按队伍元素种类获得对应抗性；内核不结算受击伤害，不影响输出',
  '400018': '4 件套：受到某元素伤害后提升该元素抗性；内核不结算受击伤害，不影响输出',
  '400047': '4 件套：开启宝箱后持续恢复生命值；内核不结算治疗与拾取，不影响输出',
  '400052': '4 件套：拾取摩拉时恢复生命值；内核不结算治疗与拾取，不影响输出',
  '400062': '4 件套：施放爆发时恢复生命值；内核不结算治疗，不影响输出',
  '400084': '4 件套：施放战技或爆发后提升队伍受治疗效果；内核不结算治疗，不影响输出',
  '400038': '4 件套：击败敌人时清除战技冷却；内核不结算击杀，不影响输出',
  '400124': '4 件套：击败敌人后重击伤害 +50% 且不消耗体力；内核不结算击杀与体力，不影响输出',
  '400311': '4 件套：脱离战斗后伤害 +50%，并在敌人燃烧状态间升降；内核不结算脱战与敌人燃烧状态，按不触发处理'
}

function buildEffects (character: MiaoCharacter, weapon: MiaoWeapon, refine: number, artifactData: ArtifactData, weaponType: string): { effects: PermissionlessEffects, runtimeEffects: Record<string, EffectSpec & { trigger: EffectTriggerKind }>, notes: string[] } {
  const effects: Record<string, EffectEntry> = {}
  const runtimeEffects: Record<string, EffectSpec & { trigger: EffectTriggerKind }> = {}
  const notes: string[] = []

  const ascension = ascensionModifier(character)
  const passives = passiveNames(character)
  effects[`character:${character.id}:a${ASCENSION}`] = ascension.status === 'unsupported'
    ? { status: 'unsupported', modifiers: [], runtimeRequired: false }
    : {
        status: 'verified-static',
        modifiers: ascension.modifiers,
        runtimeRequired: false,
        ...(passives.length ? { unmodeled: `固有天赋条件效果未建模：${passives.join('、')}` } : {})
      }
  if (ascension.status === 'unsupported') notes.push(`角色 ${character.name} 突破加成未收录：${ascension.reason}`)

  const note = WEAPON_NOTES[String(weapon.id)]
  const substat = weaponSubstat(weapon)
  if (note) {
    const modifiers = [...(substat ? [substat] : []), ...(note.static ?? [])]
    const status = modifiers.length > 0 && note.status === 'known-no-static' ? 'verified-static' : note.status
    effects[`weapon:${weapon.id}:r${refine}`] = {
      status,
      modifiers,
      runtimeRequired: note.runtimeRequired,
      ...(note.unmodeled ? { unmodeled: note.unmodeled } : {})
    }
  } else {
    effects[`weapon:${weapon.id}:r${refine}`] = {
      status: 'verified-static',
      modifiers: substat ? [substat] : [],
      runtimeRequired: true,
      unmodeled: `武器被动「${weapon.affixTitle ?? ''}」未逐项审计：${String(weapon.affixData?.text ?? '').replace(/\$\[\d\]/g, 'X').slice(0, 60)}`
    }
  }

  for (const [setId, set] of Object.entries(artifactData)) {
    const two = set?.skills?.['2']
    const four = set?.skills?.['4']
    if (typeof two === 'string') {
      const parsed = parseTwoPiece(two)
      effects[`artifact-set:${setId}:2pc`] = parsed
        ? { status: 'verified-static', modifiers: [parsed], runtimeRequired: false }
        : { status: 'unsupported', modifiers: [], runtimeRequired: false }
    } else {
      effects[`artifact-set:${setId}:2pc`] = { status: 'unsupported', modifiers: [], runtimeRequired: false }
    }
    if (typeof four === 'string') {
      const staticFour = STATIC_FOUR_PIECE[setId]
      const triggered = TRIGGERED_FOUR_PIECE[setId]
      const convert = CONVERT_FOUR_PIECE[setId]
      const noDamage = NO_DAMAGE_FOUR_PIECE[setId]
      const applies = staticFour !== undefined && (!staticFour.weaponTypes || staticFour.weaponTypes.includes(weaponType))
      if (triggered) {
        // 审计条目只声明「运行时生效」，数值与触发时机放在 runtimeEffects 里。
        effects[`artifact-set:${setId}:4pc`] = {
          status: 'verified-static',
          modifiers: [],
          runtimeRequired: true,
          ...(triggered.unmodeled ? { unmodeled: triggered.unmodeled } : {})
        }
        runtimeEffects[`artifact-set:${setId}:4pc`] = triggered.effect
      } else if (convert) {
        // 数值依赖组装后的面板，buildPermanentStats 里按 setId 换算。
        effects[`artifact-set:${setId}:4pc`] = {
          status: 'verified-static',
          modifiers: [],
          runtimeRequired: false
        }
      } else if (staticFour && applies) {
        const offField = OFF_FIELD_FOUR_PIECE[setId]
        effects[`artifact-set:${setId}:4pc`] = {
          status: 'verified-static',
          modifiers: [
            { key: staticFour.key, value: staticFour.value },
            ...(staticFour.extra ?? []).map(item => ({ key: item.key, value: item.value }))
          ],
          runtimeRequired: offField !== undefined,
          ...(staticFour.unmodeled ? { unmodeled: staticFour.unmodeled } : {}),
          ...(offField ? { note: `${staticFour.note}；${offField.note}` } : {})
        }
        if (offField) runtimeEffects[offField.effect.id] = offField.effect
      } else if (noDamage) {
        effects[`artifact-set:${setId}:4pc`] = {
          status: 'verified-static',
          modifiers: [],
          runtimeRequired: false,
          note: noDamage
        }
      } else if (staticFour) {
        effects[`artifact-set:${setId}:4pc`] = {
          status: 'verified-static',
          modifiers: [],
          runtimeRequired: false,
          unmodeled: `${staticFour.note}；当前武器类型 ${weaponType} 不满足触发条件，未计入`
        }
      } else {
        effects[`artifact-set:${setId}:4pc`] = {
          status: 'verified-static',
          modifiers: [],
          runtimeRequired: true,
          unmodeled: `${set?.name ?? setId} 4 件套未建模：${four.replace(/\s+/g, ' ').slice(0, 80)}`
        }
      }
    }
  }

  for (let level = 1; level <= 6; level += 1) {
    const name = constellationName(character, level)
    if (!name) continue
    effects[`constellation:${character.id}:${level}`] = {
      status: 'verified-static',
      modifiers: [],
      runtimeRequired: true,
      unmodeled: `命座 ${level}「${name}」未建模`
    }
  }

  return { effects, runtimeEffects, notes }
}

// 仅作类型别名，避免上面签名里写出过长的 Record 类型
type PermissionlessEffects = Record<string, EffectEntry>

export interface RuntimePermanentInput {
  characterId: string
  /** 中文名（miao 的角色目录名） */
  name: string
  weaponId: string
  refinement: number
}

export type RuntimePermanentResult =
  | { ok: true, data: PermanentData, source: 'runtime' }
  | { ok: false, error: string }

const cache = new Map<string, PermanentData>()

/**
 * 按玩家配装现算永久数据。同一角色 + 武器 + 精炼在进程内缓存，不吃重复解析 miao 的成本。
 * 任何一环拿不到（角色/武器/白值/套装表）都返回可读错误，由调用方转成 issue，不静默降级。
 */
export function buildRuntimePermanent (input: RuntimePermanentInput): RuntimePermanentResult {
  const refine = Number(input.refinement)
  if (!Number.isInteger(refine) || refine < 1 || refine > 5) return { ok: false, error: `精炼等级 ${input.refinement} 不在 1–5` }
  const key = `${input.characterId}-${input.weaponId}-r${refine}`
  const hit = cache.get(key)
  if (hit) return { ok: true, data: hit, source: 'runtime' }

  const characterFile = path.join(CHARACTER_DIR, input.name, 'data.json')
  const character = readJson(characterFile) as MiaoCharacter | null
  if (!character || typeof character !== 'object') return { ok: false, error: `读不到 ${input.name} 的 miao 角色数据（${characterFile}）` }
  if (String(character.id) !== String(input.characterId)) {
    return { ok: false, error: `${input.name} 的 miao charId 是 ${character.id}，与配装里的 ${input.characterId} 不一致` }
  }

  const found = findWeaponById(String(input.weaponId))
  if (!found) return { ok: false, error: `读不到武器 ${input.weaponId} 的 miao 数据` }
  const { weapon, type: weaponType } = found

  const artifactData = readJson(ARTIFACT_FILE) as ArtifactData | null
  if (!artifactData || typeof artifactData !== 'object') return { ok: false, error: `读不到套装表 ${ARTIFACT_FILE}` }

  const details = character.attr?.details?.[String(LEVEL)]
  if (!Array.isArray(details) || details.length < 3) return { ok: false, error: `${input.name} 没有 ${LEVEL} 级白值` }
  const baseAtk = Number(weapon.attr?.atk?.[String(LEVEL)])
  if (!Number.isFinite(baseAtk)) return { ok: false, error: `${weapon.name} 没有 ${LEVEL} 级武器白值` }
  const [hp, atk, def] = details
  if (![hp, atk, def].every(value => Number.isFinite(Number(value)))) return { ok: false, error: `${input.name} 的 ${LEVEL} 级白值不是数字` }

  const { effects, runtimeEffects } = buildEffects(character, weapon, refine, artifactData, weaponType)
  const data: PermanentData = {
    gameVersion: GAME_VERSION,
    bundleId: BUNDLE_ID,
    source: SOURCE,
    character: {
      id: String(character.id),
      level: LEVEL,
      ascension: ASCENSION,
      base: { hp: Number(hp), atk: Number(atk), def: Number(def) },
      bonuses: []
    },
    weapon: {
      id: String(weapon.id),
      level: LEVEL,
      ascension: ASCENSION,
      baseAtk,
      bonuses: []
    },
    effects,
    ...(Object.keys(runtimeEffects).length ? { runtimeEffects } : {})
  }
  cache.set(key, data)
  return { ok: true, data, source: 'runtime' }
}
