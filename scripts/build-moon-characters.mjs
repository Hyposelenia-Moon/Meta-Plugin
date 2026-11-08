/**
 * 生成月兆角色名单 `data/team-sim/moon-characters.json`
 *
 * 口径来源（2026-11-08 查证）：
 *  - 规则：队伍中编入 1 位月兆角色 → 初辉；编入 2 位 → 满辉（不是叠层）。
 *    出处：https://www.9game.cn/yuanshen/11379142.html
 *  - 身份：miao 角色数据里天赋文本出现「月兆·满辉 / 月兆·初辉」的即为月兆角色
 *    （这类文本只在月兆角色身上给出满辉档的强化描述）。
 *
 * 用法：node scripts/build-moon-characters.mjs [miaoRoot]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIAO_ROOT = process.argv[2] ?? process.env.MIAO_ROOT ?? 'D:/Program Files/Yunzai/Yunzai/plugins/miao-plugin/resources/meta-gs'
const ROSTER_PATH = path.join(ROOT, 'data/team-sim/roster.json')
const OUT_PATH = path.join(ROOT, 'data/team-sim/moon-characters.json')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))

/** 去掉 miao 文本里的 html 标签，压平空白 */
function plain (text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 从 data.json 原文里抽第一条「月兆·满辉/初辉」证据 */
function evidenceOf (raw) {
  let parsed
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
  const strings = []
  const walk = (value) => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(parsed)
  const hits = strings
    .map((text) => plain(text))
    .map((text, index) => ({ text, index }))
    .filter((item) => item.text.includes('月兆·'))
  if (!hits.length) return null
  const chosen = hits.find((item) => item.text.includes('月兆·满辉') || item.text.includes('月兆·初辉')) ?? hits[0]
  let text = chosen.text
  // 有些角色的天赋把「月兆·满辉」单独成行，后面紧跟正文；行太短就接上下一段。
  if (text.length < 14) {
    const next = plain(strings[chosen.index + 1] ?? '')
    if (next) text = `${text}：${next}`
  }
  return text.slice(0, 80)
}

if (!fs.existsSync(path.join(MIAO_ROOT, 'character'))) {
  console.error(`缺少 miao 数据目录：${MIAO_ROOT}`)
  process.exit(1)
}

const roster = readJson(ROSTER_PATH)
const byCn = new Map(roster.characters.map((entry) => [entry.cn, entry]))

const characters = []
const missing = []
for (const dir of fs.readdirSync(path.join(MIAO_ROOT, 'character'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const file = path.join(MIAO_ROOT, 'character', dir.name, 'data.json')
  if (!fs.existsSync(file)) continue
  const raw = fs.readFileSync(file, 'utf8')
  const evidence = evidenceOf(raw)
  if (!evidence) continue
  const entry = byCn.get(dir.name)
  if (!entry) {
    missing.push(dir.name)
    continue
  }
  characters.push({
    charId: entry.charId,
    cn: entry.cn,
    element: entry.element,
    status: entry.status,
    evidence
  })
}

characters.sort((a, b) => Number(a.charId) - Number(b.charId))

const out = {
  schemaVersion: 1,
  source: {
    identity: 'miao 角色天赋文本含「月兆·满辉|初辉」',
    rule: '队伍中 1 位月兆角色 → 初辉；2 位及以上 → 满辉',
    ruleUrl: 'https://www.9game.cn/yuanshen/11379142.html',
    note: '满辉下非月兆角色施放元素战技/爆发给全队月曜反应伤害加成（20 秒、最高 36%）尚未建模，细则与月曜伤害模型一起补。'
  },
  counts: { characters: characters.length },
  characters
}

fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`)
console.log(JSON.stringify({ characters: characters.length, missing, path: path.relative(ROOT, OUT_PATH) }))
