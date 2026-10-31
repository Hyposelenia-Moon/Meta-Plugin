#!/usr/bin/env node
/**
 * 生成永久数据（data/team-sim/permanent/<charId>-<weaponId>-r<refine>.json）。
 *
 * 能自动算的：角色 90 级白值、突破加成、武器白值与副属性——全部取 miao meta-gs 的结构化字段。
 * 需要人审的：角色固有天赋、武器被动、套装 4 件套、命座——没有结构化数据，
 * 这里只做两件事：能用属性键表达的静态部分写进 modifiers，其余逐条写进 unmodeled 说明。
 * 任何一条都不允许「不知道就当成没有」：解析不出就标 unsupported，让配装直接跑不起来。
 *
 * 用法：
 *   node scripts/gen-permanent.mjs --char 钟离 --weapon 黑缨枪 [--refine 1]
 *   node scripts/gen-permanent.mjs --preset geo-four
 *   node scripts/gen-permanent.mjs --preset geo-four --dry   # 只写 out/permanent-drafts/
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIAO_ROOT = process.env.MIAO_ROOT ?? 'D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs'
const CHARACTER_DIR = path.join(MIAO_ROOT, 'character')
const ARTIFACT_FILE = path.join(MIAO_ROOT, 'artifact', 'data.json')
const WEAPON_DIR = path.join(MIAO_ROOT, 'weapon')
const ROSTER_FILE = path.join(ROOT, 'data', 'team-sim', 'roster.json')
const OUT_DIR = path.join(ROOT, 'data', 'team-sim', 'permanent')
const DRAFT_DIR = path.join(ROOT, 'out', 'permanent-drafts')

const GAME_VERSION = '7.1'
// 所有永久文件共用一套元信息：simulateTeam 拿第一个成员的面板当版本基准，逐文件不同会直接判版本不一致。
const BUNDLE_ID = 'permanent-7.1'
const SOURCE = 'miao meta-gs 7.1（白值/突破/武器副属性）+ 本仓库人工审计（套装与被动）'

const LEVEL = 90
const ASCENSION = 6

/** 元素中文名 → 属性键。 */
const ELEMENTS = { 火: 'pyro', 水: 'hydro', 雷: 'electro', 冰: 'cryo', 风: 'anemo', 岩: 'geo', 草: 'dendro' }
/** 已经是属性键的元素名。 */
const ELEMENT_KEYS = new Set(['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'])

/** 统一保留 6 位小数：百分比换算后会留下 0.28800000000000003 这类尾巴，抽查时很碍眼。 */
const round6 = (value) => Math.round(value * 1e6) / 1e6
const pct = (raw) => round6(Number(raw) / 100)
const flat = (raw) => round6(Number(raw))

/** 工具函数：读 JSON，缺文件直接报错退出，不静默降级。 */
function readJson (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    console.error(`[gen-permanent] 读不到 ${file}：${error.message}`)
    process.exit(1)
  }
}

function readText (file) { return fs.readFileSync(file, 'utf8') }

/**
 * 突破加成：miao 的 growAttr 是结构化字段（key + value，value 已是百分数）。
 * dmg 指「角色所属元素的伤害加成」，换成元素键；认不出的键标 unsupported 而不是丢掉。
 */
function ascensionModifier (character) {
  const grow = character.growAttr
  if (!grow || typeof grow.key !== 'string') return { status: 'unsupported', modifiers: [], runtimeRequired: false, reason: '突破加成缺失' }
  const value = Number(grow.value)
  if (!Number.isFinite(value)) return { status: 'unsupported', modifiers: [], runtimeRequired: false, reason: '突破加成不是数字' }
  switch (grow.key) {
    case 'dmg': {
      // miao 的 elem 已经是属性键（geo/pyro/…）；认不出就标 unsupported，不猜元素。
      const key = ELEMENT_KEYS.has(character.elem) ? character.elem : ELEMENTS[character.elem]
      return key ? { status: 'verified-static', modifiers: [{ key, value: pct(value) }] } : { status: 'unsupported', modifiers: [], reason: `无法把 dmg 突破加成映射到元素（elem=${character.elem}）` }
    }
    case 'cpct': case 'cdmg': case 'atkPct': case 'defPct': case 'hpPct': case 'recharge': case 'phy': case 'heal':
      return { status: 'verified-static', modifiers: [{ key: grow.key, value: pct(value) }] }
    case 'mastery':
      return { status: 'verified-static', modifiers: [{ key: 'mastery', value: flat(value) }] }
    default:
      return { status: 'unsupported', modifiers: [], reason: `未收录的突破加成键 ${grow.key}` }
  }
}

/** 武器副属性：bonusKey + bonusData["90"]；百分比键除以 100，精通/白值类保持原值。 */
function weaponSubstat (weapon) {
  const key = weapon.attr?.bonusKey
  const raw = weapon.attr?.bonusData?.[String(LEVEL)]
  if (!key || !Number.isFinite(Number(raw))) return null
  const value = Number(raw)
  return ['mastery', 'hp', 'atk', 'def'].includes(key) ? { key, value: flat(value) } : { key, value: pct(value) }
}

/**
 * 2 件套文本 → 属性键。只认能一对一的固定句式；认不出就返回 null 交给 unsupported，
 * 绝不用「大概意思」猜属性。
 */
function parseTwoPiece (text) {
  if (typeof text !== 'string') return null
  // miao 的套装描述句末带句号，先去掉；不做任何其它清洗，避免把不同句式误当成同一种加成。
  const t = text.trim().replace(/[。.]$/, '')
  let r
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
  // 元素伤害加成两种写法：「获得15%岩元素伤害加成。」与「15%火元素伤害加成。」
  if ((r = /^(?:获得)?(\d+(?:\.\d+)?)%(火|水|雷|冰|风|岩|草)元素伤害加成$/.exec(t))) return { key: ELEMENTS[r[2]], value: pct(r[1]) }
  if ((r = /^(?:获得)?(火|水|雷|冰|风|岩|草)元素伤害加成提高(\d+(?:\.\d+)?)%$/.exec(t))) return { key: ELEMENTS[r[1]], value: pct(r[2]) }
  return null
}

/**
 * 武器被动的人审结论。静态部分写进 static；条件部分写进 unmodeled。
 * 没登记的武器按「整条被动未审计」披露——宁可显式写着没算，也不假装它没有。
 */
const WEAPON_NOTES = {
  13303: { // 黑缨枪
    status: 'known-no-static', static: [], runtimeRequired: false, unmodeled: null,
    note: '克柔只对史莱姆类敌人生效，本口径目标（110 级小宝）不适用'
  },
  11415: { // 辰砂之纺锤
    status: 'verified-static', static: [], runtimeRequired: true,
    unmodeled: '元素战技伤害提高防御力的 40%（R1）：内核没有「按防御折算伤害」通道，未计入'
  },
  12510: { // 赤角石溃杵
    status: 'verified-static', static: [{ key: 'defPct', value: 0.28 }], runtimeRequired: true,
    unmodeled: '普通攻击与重击伤害提高防御力的 40%（R1）：内核没有「按防御折算伤害」通道，未计入'
  },
  15401: { // 西风猎弓
    status: 'known-no-static', static: [], runtimeRequired: true,
    unmodeled: '暴击产生元素微粒回能（60% 概率 / 12 秒一次）：产球随机与暴击依赖都未建模'
  }
}

/**
 * 角色固有天赋没有结构化数据，只有文本。这里不解析数值，只把「有这些东西但没算」写出来。
 * 突破加成本身在 ascensionModifier 里已经算进静态部分，这里只披露天赋条件效果。
 * 锻造/烹饪/合成/采集类天赋与战斗无关，写进披露会让真正的缺项被噪声淹没，先按关键词排除。
 */
const UTILITY_PASSIVE = /锻造|烹饪|合成|采集|派遣|钓鱼|矿石|料理|药剂/

function passiveNames (character) {
  const list = Array.isArray(character.passive) ? character.passive : []
  return list
    .filter(item => !UTILITY_PASSIVE.test(String(item?.desc ?? '')))
    .map(item => item?.name)
    .filter(name => typeof name === 'string' && name)
}

function constellationName (character, level) {
  const cons = character.cons
  if (!cons || typeof cons !== 'object') return null
  const entry = cons[String(level)] ?? cons[level]
  return entry && typeof entry === 'object' ? String(entry.name ?? '') : null
}

/** 生成整套 effects：角色 + 武器 + 全套装 + 全命座。多出来的条目在运行期不会被读到，但换配装时省一次重生成。 */
function buildEffects ({ character, weapon, refine, artifactData }) {
  const effects = {}
  const notes = []

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

  const note = WEAPON_NOTES[weapon.id]
  const substat = weaponSubstat(weapon)
  if (note) {
    const modifiers = [...(substat ? [substat] : []), ...(note.static ?? [])]
    // known-no-static 只用来描述「被动里没有静态加成」；副属性是实打实的静态条目，
    // 所以一旦有 modifiers 就必须是 verified-static，否则 build.ts 会判数据自相矛盾。
    const status = modifiers.length > 0 && note.status === 'known-no-static' ? 'verified-static' : note.status
    effects[`weapon:${weapon.id}:r${refine}`] = {
      status,
      modifiers,
      runtimeRequired: note.runtimeRequired,
      ...(note.unmodeled ? { unmodeled: note.unmodeled } : {})
    }
  } else {
    // 未登记的武器：副属性照算，被动整条披露成未建模。
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
    const name = set?.name ?? setId
    if (typeof two === 'string') {
      const parsed = parseTwoPiece(two)
      effects[`artifact-set:${setId}:2pc`] = parsed
        ? { status: 'verified-static', modifiers: [parsed], runtimeRequired: false }
        : { status: 'unsupported', modifiers: [], runtimeRequired: false }
    } else {
      // 有套装在 miao 里没有 2 件套描述（祭火/水/雷/冰之人这类）。写成 unsupported，
      // 免得运行期因为 requiredEffect 查不到而抛出「缺条目」这种看不出原因的错。
      effects[`artifact-set:${setId}:2pc`] = { status: 'unsupported', modifiers: [], runtimeRequired: false }
    }
    if (typeof four === 'string') {
      // 4 件套几乎都是条件/叠层效果，内核没有窗口与层数模型：静态部分记 0，整条进 unmodeled。
      effects[`artifact-set:${setId}:4pc`] = {
        status: 'verified-static',
        modifiers: [],
        runtimeRequired: true,
        unmodeled: `${name} 4 件套未建模：${four.replace(/\s+/g, ' ').slice(0, 80)}`
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

  return { effects, notes }
}

function loadRoster () {
  const roster = readJson(ROSTER_FILE)
  if (!roster || !Array.isArray(roster.characters)) {
    console.error(`[gen-permanent] ${ROSTER_FILE} 结构不对：缺少 characters`)
    process.exit(1)
  }
  return new Map(roster.characters.map(entry => [entry.cn, entry]))
}

function loadCharacter (cn) {
  const file = path.join(CHARACTER_DIR, cn, 'data.json')
  if (!fs.existsSync(file)) {
    console.error(`[gen-permanent] 找不到角色 ${cn} 的 miao 数据：${file}`)
    process.exit(1)
  }
  return readJson(file)
}

/** 武器在 miao 里按类型分目录（sword/claymore/polearm/bow/catalyst），按名字找过去。 */
function loadWeapon (name) {
  for (const type of ['sword', 'claymore', 'polearm', 'bow', 'catalyst']) {
    const file = path.join(WEAPON_DIR, type, name, 'data.json')
    if (fs.existsSync(file)) return readJson(file)
  }
  console.error(`[gen-permanent] 找不到武器 ${name} 的 miao 数据（在 ${WEAPON_DIR}/<type>/ 下都没有）`)
  process.exit(1)
}

function buildFile ({ entry, character, weapon, refine, artifactData }) {
  const details = character.attr?.details?.[String(LEVEL)]
  const keys = Array.isArray(character.attr?.keys) ? character.attr.keys : []
  if (!Array.isArray(details) || details.length < 3) {
    console.error(`[gen-permanent] ${character.name} 没有 ${LEVEL} 级白值（attr.details）`)
    process.exit(1)
  }
  const [hp, atk, def] = details
  const baseAtk = Number(weapon.attr?.atk?.[String(LEVEL)])
  if (![hp, atk, def, baseAtk].every(value => Number.isFinite(Number(value)))) {
    console.error(`[gen-permanent] ${character.name} / ${weapon.name} 的白值不是数字`)
    process.exit(1)
  }
  const { effects, notes } = buildEffects({ character, weapon, refine, artifactData })
  const unmodeledCount = Object.values(effects).filter(effect => effect.unmodeled).length
  const unsupported = Object.entries(effects).filter(([, effect]) => effect.status === 'unsupported').map(([id]) => id)
  const data = {
    schemaVersion: 1,
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
      baseAtk: Number(baseAtk),
      bonuses: []
    },
    effects
  }
  const meta = {
    charId: String(character.id),
    cn: character.name,
    key: entry?.keys?.[0] ?? entry?.key ?? null,
    weaponId: String(weapon.id),
    weapon: weapon.name,
    refine,
    file: `${character.id}-${weapon.id}-r${refine}.json`,
    effects: Object.keys(effects).length,
    unmodeled: unmodeledCount,
    unsupported: unsupported.length,
    notes
  }
  return { data, meta }
}

function writeJson (file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const PRESETS = {
  // 纯岩四人：都能落成「静态可算」的配装，4 件套一律按未建模披露（见 docs）。
  'geo-four': [
    { char: '钟离', weapon: '黑缨枪', refine: 1 },
    { char: '阿贝多', weapon: '辰砂之纺锤', refine: 1 },
    { char: '五郎', weapon: '西风猎弓', refine: 1 },
    { char: '荒泷一斗', weapon: '赤角石溃杵', refine: 1 }
  ]
}

function parseArgs (argv) {
  const args = { refine: 1, dry: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--char') args.char = argv[++i]
    else if (arg === '--weapon') args.weapon = argv[++i]
    else if (arg === '--refine') args.refine = Number(argv[++i])
    else if (arg === '--preset') args.preset = argv[++i]
    else if (arg === '--dry') args.dry = true
    else { console.error(`[gen-permanent] 未知参数 ${arg}`); process.exit(1) }
  }
  return args
}

function main () {
  const args = parseArgs(process.argv.slice(2))
  const artifactData = readJson(ARTIFACT_FILE)
  const roster = loadRoster()
  const jobs = args.preset
    ? PRESETS[args.preset]
    : (args.char && args.weapon ? [{ char: args.char, weapon: args.weapon, refine: args.refine }] : null)
  if (!jobs) {
    console.error('[gen-permanent] 用法：--char <中文名> --weapon <武器名> [--refine N] 或 --preset geo-four [--dry]')
    process.exit(1)
  }
  if (!Number.isInteger(args.refine) || args.refine < 1 || args.refine > 5) {
    console.error('[gen-permanent] --refine 必须是 1..5 的整数')
    process.exit(1)
  }

  const dir = args.dry ? DRAFT_DIR : OUT_DIR
  const metas = []
  for (const job of jobs) {
    const entry = roster.get(job.char)
    if (!entry || entry.status !== 'mapped') {
      console.error(`[gen-permanent] ${job.char} 在名录里不是 mapped（status=${entry?.status ?? 'missing'}），不能落永久数据`)
      process.exit(1)
    }
    const refine = job.refine ?? args.refine
    const character = loadCharacter(job.char)
    const weapon = loadWeapon(job.weapon)
    const { data, meta } = buildFile({ entry, character, weapon, refine, artifactData })
    writeJson(path.join(dir, meta.file), data)
    metas.push(meta)
  }

  // 报表带生成时间，属于构建产物，固定写到 out/，不放进 data/，否则 data 目录不再可复现。
  writeJson(path.join(ROOT, 'out', 'permanent-report.json'), { generatedAt: new Date().toISOString(), gameVersion: GAME_VERSION, bundleId: BUNDLE_ID, files: metas })
  for (const meta of metas) {
    console.log(`[gen-permanent] ${meta.file} 角色 ${meta.cn} / 武器 ${meta.weapon} R${meta.refine} · 效果 ${meta.effects} 条（未建模 ${meta.unmodeled}、不支持 ${meta.unsupported}）`)
    for (const note of meta.notes) console.log(`  · ${note}`)
  }
  console.log(`[gen-permanent] 共 ${metas.length} 份，输出到 ${dir}`)
}

main()
