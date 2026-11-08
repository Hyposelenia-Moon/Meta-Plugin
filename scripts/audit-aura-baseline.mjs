/**
 * 附着口径基线审计：把 data/team-sim/rotations/ 下的真实轴在 declared 与 simulated 两种模式下各跑一遍。
 *
 * 用途：
 *   1. 纯岩（无反应）轴必须逐位相等——这是附着状态机不泄漏的底线。
 *   2. 其余轴给出「补充反应声明后」的差异范围，供判断 simulated 是否可信。
 *
 * 只读：不改 data/、不写仓库（结果默认输出到 out/audit-aura-baseline.json）。
 * 依赖运行时的 miao 数据（永久数据现算），缺 miao 时整轮跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const WEAPON_KIND = { WEAPON_SWORD_ONE_HAND: 'sword', WEAPON_CLAYMORE: 'claymore', WEAPON_POLE: 'polearm', WEAPON_BOW: 'bow', WEAPON_CATALYST: 'catalyst' }
const WEAPON_KINDS = ['sword', 'claymore', 'polearm', 'bow', 'catalyst']

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }

const listOf = (value, ...keys) => {
  if (Array.isArray(value)) return value
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key]
  return []
}

/**
 * @param {{ root?: string, miaoRoot?: string }} [options]
 */
export async function auditRotations (options = {}) {
  const root = options.root ?? path.resolve(import.meta.dirname, '..')
  const miaoRoot = options.miaoRoot ?? process.env.MIAO_ROOT ?? 'D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs'
  const dir = rel => path.join(root, rel)
  const load = rel => import(pathToFileURL(path.join(root, 'lib', rel)).href)

  if (!fs.existsSync(path.join(miaoRoot, 'character'))) {
    const error = new Error(`缺少 miao 数据目录：${miaoRoot}`)
    error.code = 'ENOMIAO'
    throw error
  }

  const S = await load('model/TeamSimStore.js')
  const P = await load('model/PermanentSource.js')
  const K = await load('modules/teamSimulation/index.js')
  const A = await load('model/TeamBuildAdapter.js')

  const roster = listOf(readJson(dir('data/team-sim/roster.json')), 'entries', 'characters', 'items')
  const weapons = listOf(readJson(dir('data/team-sim/weapon-params.json')), 'entries', 'weapons', 'items').filter(item => item?.id && item?.type)
  const byCharId = new Map(roster.map(entry => [String(entry.charId), entry]))

  const weaponOf = kind => {
    const pool = weapons.filter(item => item.type === kind)
    pool.sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || String(a.id).localeCompare(String(b.id)))
    return pool[0] ?? null
  }

  const avatarOf = entry => {
    const miao = readJson(path.join(miaoRoot, 'character', entry.cn, 'data.json'))
    if (!miao) throw new Error(`miao 缺 ${entry.cn}`)
    const kind = WEAPON_KIND[miao.weapon] ?? (WEAPON_KINDS.includes(miao.weapon) ? miao.weapon : null)
    const weapon = kind ? weaponOf(kind) : null
    if (!weapon) throw new Error(`缺可用的 ${String(miao.weapon)} 武器`)
    // 合成面板：华馆四件 + 一件散件，只为把管线跑通，不把结论写进报告。
    const mains = ['hpPlus', 'atkPlus', 'def', 'geo', 'cdmg']
    const values = [4780, 311, 58.3, 46.6, 62.2]
    const rows = mains.map((key, i) => ({
      mainId: i + 1,
      main: { id: i + 1, key, value: values[i] },
      star: 5, level: 20, name: '合成圣遗物', set: '400189', attrIds: [11, 12, 13, 14],
      attrs: [['cpct', 3.9], ['mastery', 16], ['recharge', 5.2], ['atk', 4.1]].map(([k, value]) => ({ key: k, value, upNum: 1 }))
    }))
    return {
      game: 'gs', id: String(entry.charId),
      char: { id: String(entry.charId), name: entry.cn },
      elem: miao.elem, level: 90, promote: 6, cons: 0,
      weapon: { id: String(weapon.id), name: weapon.name, level: 90, promote: 6, affix: 1 },
      talent: Object.fromEntries(['a', 'e', 'q'].map(k => [k, { original: 10 }])),
      artis: { forEach (fn) { rows.forEach((row, i) => fn(row, i + 1)) } }
    }
  }

  const shape = result => {
    const damage = result?.damage
    const rows = damage?.rows ?? []
    const reactions = rows.filter(row => row.reaction)
    const bursts = Object.keys(damage?.perAction ?? {}).filter(key => key.endsWith('.burst')).length
    return {
      status: result?.status ?? null,
      total: typeof damage?.total === 'number' ? damage.total : null,
      rows: rows.length,
      reactionRows: reactions.length,
      reactionKinds: [...new Set(reactions.map(row => row.reaction?.kind).filter(Boolean))].sort(),
      burstActions: bursts
    }
  }

  const rotationsDir = dir('data/team-sim/rotations')
  const files = fs.readdirSync(rotationsDir).filter(file => file.endsWith('.json')).sort()
  const rows = []

  for (const file of files) {
    const rotationFile = readJson(path.join(rotationsDir, file))
    const row = { file, status: null, error: null, declared: null, simulated: null, delta: null }
    try {
      const sequence = Array.isArray(rotationFile?.sequence) ? rotationFile.sequence : []
      const startActors = Array.isArray(rotationFile?.start?.actors) ? rotationFile.start.actors
        : Array.isArray(rotationFile?.recording?.start?.actors) ? rotationFile.recording.start.actors : []
      const actorIds = startActors.length
        ? startActors.map(actor => actor.actorId)
        : [...new Set(sequence.map(step => (typeof step === 'string' ? step : step?.actionId ?? '').split('.')[0]).filter(Boolean))]
      if (!actorIds.length) throw new Error('轴里没有可识别的 actorId')

      const packs = []
      const members = []
      let expected = null
      for (const actorId of actorIds) {
        const entry = roster.find(candidate => (candidate.keys ?? []).includes(actorId)) ?? byCharId.get(String(rotationFile?.team?.[actorIds.indexOf(actorId)]))
        if (!entry) throw new Error(`轴里的 ${actorId} 不在名录`)
        const pack = readJson(dir(`data/team-sim/packs/${actorId}.json`))
        if (!pack) throw new Error(`缺动作包 ${actorId}`)
        packs.push(pack)
        const adapted = A.adaptMiaoAvatar(avatarOf(entry), { provider: 'synthetic-public-avatar', providerVersion: null, sourceTime: null })
        if (adapted.status !== 'raw-complete') throw new Error(`${actorId} 适配失败 ${adapted.status} ${JSON.stringify((adapted.issues ?? []).slice(0, 3))}`)
        adapted.build.actorId = actorId
        const permanent = P.buildRuntimePermanent({
          characterId: String(entry.charId), name: entry.cn,
          weaponId: String(adapted.build.weapon.id), refinement: adapted.build.weapon.refinement
        })
        if (!permanent.ok) throw new Error(`${actorId} 永久数据失败 ${permanent.error}`)
        expected ??= { gameVersion: permanent.data.gameVersion, bundleId: permanent.data.bundleId, source: permanent.data.source }
        members.push({ build: adapted.build, permanentData: permanent.data })
      }

      const combined = K.combineDataPacks(packs)
      if (combined.status !== 'ok') throw new Error(`动作包合并失败 ${JSON.stringify(combined.issues?.slice(0, 2))}`)
      const pack = combined.pack
      const converted = S.toRotation(rotationFile, pack)
      if (converted.status !== 'ok') throw new Error(`轴转换失败 ${JSON.stringify(converted.issues?.slice(0, 2))}`)

      const run = auraMode => K.simulateTeam({
        pack,
        rotation: converted.rotation,
        members,
        expected,
        targetPresetId: K.DPS_STANDARD.targetId,
        crit: 'expected',
        debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        auraMode
      })

      row.declared = shape(run('declared'))
      row.simulated = shape(run('simulated'))
      if (row.declared.total !== null && row.simulated.total !== null) row.delta = Number((row.simulated.total - row.declared.total).toFixed(2))
      row.status = row.declared.status === 'calculated' && row.simulated.status === 'calculated' ? 'ok' : 'not-calculated'
    } catch (error) {
      row.error = String(error?.message ?? error)
    }
    rows.push(row)
  }

  return { rows, completed: rows.filter(row => row.status === 'ok').length, total: rows.length }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (invokedDirectly) {
  const root = path.resolve(import.meta.dirname, '..')
  try {
    const result = await auditRotations({ root })
    const out = path.join(root, 'out/audit-aura-baseline.json')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
    for (const row of result.rows) console.log(JSON.stringify(row))
    console.log(`done ${result.completed}/${result.total}`)
    if (result.completed !== result.total) process.exitCode = 1
  } catch (error) {
    if (error?.code === 'ENOMIAO') { console.log(String(error.message)); process.exit(0) }
    throw error
  }
}
