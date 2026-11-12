/**
 * 黄金集审计：把 `data/team-sim/golden/cases.json` 里的手算用例交给内核重算，产出 `actuals.json`。
 *
 * 为什么单独一支脚本：
 *   - 期望值是**手算**的（推导写在用例的 source 里），不能由引擎自己生成；
 *   - 实跑值必须能被任何人复跑核对，所以固定成文件入库，测试再比对文件与重算结果是否一致。
 *
 * 两种用例：
 *   - `mode: 'ordinary'`：单发直伤，走 `calculateOrdinaryHit`（含增幅/激化乘区）；
 *   - `mode: 'timeline'`：直伤一行 + 反应一段，走 `simulateTimeline` + `calculateTimelineDamage`。
 *
 * 只读 data/，只写 `data/team-sim/golden/actuals.json`（该文件是发布闸门的输入，入库）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CASES_REL = 'data/team-sim/golden/cases.json'
const ACTUALS_REL = 'data/team-sim/golden/actuals.json'

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

const ordinaryDamage = (K, item, gameVersion) => {
  const result = K.calculateOrdinaryHit({
    kind: 'ordinary',
    gameVersion,
    source: `golden:${item.id}`,
    canCrit: true,
    ...item.scenario
  })
  if (!result || result.status !== 'calculated') {
    throw new Error(`${item.id} 的实跑没有算出结果：${JSON.stringify(result?.issues ?? result)}`)
  }
  return result.damage
}

const timelineDamage = async (root, item, defaults) => {
  const base = pathToFileURL(path.join(root, 'lib/modules/teamSimulation')).href
  const K = await import(`${base}/index.js`)
  const HD = await import(`${base}/hitDamage.js`)
  const declared = Array.isArray(item.scenario.hits) ? item.scenario.hits : [item.scenario.hit]
  const hits = declared.map(hit => ({ ...defaults.hit, ...hit }))
  const stats = { ...defaults.stats, ...item.scenario.stats }
  const targetPresetId = item.scenario.targetPresetId ?? defaults.target
  const actionId = 'golden.action'
  const pack = {
    [actionId]: {
      id: actionId,
      actorId: 'golden',
      kind: 'skill',
      timing: { type: 'frames', frames: 40 },
      hits: hits.map(hit => ({
        atFrame: hit.atFrame,
        motionValue: hit.motionValue,
        scaling: hit.scaling,
        element: hit.element,
        canCrit: hit.canCrit,
        ...(hit.reaction ? { reaction: hit.reaction } : {})
      }))
    }
  }
  const timeline = K.simulateTimeline({
    scheduler: 'fixed',
    frameTier: K.FRAME_TIERS['fps-60'],
    actions: pack,
    actors: [{ actorId: 'golden', energy: 0, energyMax: 60 }],
    activeActorId: 'golden',
    measurementEndFrame: 120,
    steps: [{ id: 'golden-step', kind: 'action', actorId: 'golden', actionId, atFrame: 0 }]
  })
  if (timeline.status !== 'simulated') throw new Error(`${item.id} 的轴没有跑起来：${JSON.stringify(timeline.issues ?? timeline.status)}`)
  const out = HD.calculateTimelineDamage({
    timeline,
    contexts: {
      golden: {
        level: 90,
        targetPresetId,
        crit: 'expected',
        gameVersion: '7.1',
        source: `golden:${item.id}`,
        stats,
        debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
      }
    }
  })
  if (out.status !== 'calculated') throw new Error(`${item.id} 的结算失败：${JSON.stringify(out.issues ?? out.status)}`)
  return out.total
}

/**
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ cases: any[], actuals: any[], report: any, issues: any[] }>}
 */
export async function auditGolden (options = {}) {
  const root = options.root ?? path.resolve(import.meta.dirname, '..')
  const K = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')).href)

  const raw = readJson(path.join(root, CASES_REL))
  const cases = Array.isArray(raw?.cases) ? raw.cases : []
  const gameVersion = typeof raw?.gameVersion === 'string' ? raw.gameVersion : '7.1'
  const defaults = {
    stats: raw?.defaults?.timelineStats ?? {},
    hit: { atFrame: 5, motionValue: 1, scaling: 'atk', canCrit: false, ...(raw?.defaults?.timelineHit ?? {}) },
    target: raw?.defaults?.timelineTarget ?? 'dummy-lv100'
  }
  const issues = K.validateGoldenCases(cases)

  const actuals = []
  for (const item of cases) {
    const mode = item.mode ?? 'ordinary'
    const damage = mode === 'timeline'
      ? await timelineDamage(root, item, defaults)
      : ordinaryDamage(K, item, gameVersion)
    /* 存 6 位小数：够闸门判误差，又不会因为浮点尾数天天改文件。 */
    actuals.push({ id: item.id, total: Number(damage.toFixed(6)) })
  }

  const report = K.evaluateGolden(cases, actuals)
  return { cases, actuals, report, issues }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)

if (invokedDirectly) {
  const root = path.resolve(import.meta.dirname, '..')
  const { actuals, report, issues } = await auditGolden({ root })
  if (issues.length) {
    console.error('黄金集用例本身不合法：')
    for (const issue of issues) console.error(`  · ${issue.path}：${issue.message}`)
    process.exitCode = 1
  } else {
    const target = path.join(root, ACTUALS_REL)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify({
      schemaVersion: 1,
      note: '由 scripts/audit-golden.mjs 从 cases.json 的 scenario 重算写入；期望值见 cases.json，勿手改本文件。',
      actuals
    }, null, 2)}\n`)
    console.log(`黄金集：${actuals.length} 例，${report.gate}（${report.reason}）`)
    console.log(`  中位误差：${report.median ?? '—'}，最大误差：${report.max ?? '—'}`)
    console.log(`  已写入 ${ACTUALS_REL}`)
    if (report.gate !== 'pass') process.exitCode = 1
  }
}
