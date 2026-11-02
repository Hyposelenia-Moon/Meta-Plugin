/**
 * 「本队伍没有轴」的回复文案（2026-11-02）。
 *
 * 关键契约：不能只写「需要轴」；要给出最接近的现有轴、差哪个人、以及一段能直接照抄的顺序轴模板。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { ok, report } = createChecks('队伍伤害 · 缺轴提示')
const mod = await import(pathToFileURL(path.join(libDir, 'modules', 'teamDamage.js')).href)
const builds = [
  { actorId: 'bennett', characterId: '10000032', name: '班尼特' },
  { actorId: 'xiangling', characterId: '10000023', name: '香菱' },
  { actorId: 'xingqiu', characterId: '10000025', name: '行秋' },
  { actorId: 'furina', characterId: '10000089', name: '芙宁娜' }
]
const actions = []
for (const build of builds) {
  actions.push({ id: `${build.actorId}.skill`, actorId: build.actorId, kind: 'skill' })
  actions.push({ id: `${build.actorId}.normal-1`, actorId: build.actorId, kind: 'normal' })
}
const nearby = [{ file: 'national-skills.json', name: 'national-skills', team: ['10000052', '10000023', '10000032', '10000025'], shared: ['10000023', '10000032', '10000025'] }]

const rosterNames = { '10000052': '雷电将军', '10000023': '香菱', '10000032': '班尼特', '10000025': '行秋' }
const text = mod.rotationHelpText({ builds, actions, nearby, rosterNames, windowFrames: 7243 })
ok('明确说没有轴、不能出数', /没有轴/.test(text))
ok('指出最接近的现有轴与重合人数', /national-skills（重合 3\/4/.test(text))
ok('点名换成该轴还差的人（用名录中文名）', /只差 雷电将军/.test(text))
ok('给出顺序轴文件位置', /data\/team-sim\/rotations\/<队伍名>\.json/.test(text))

const json = text.slice(text.indexOf('{'))
const template = JSON.parse(json)
ok('模板是合法 JSON，且 team 是四个 charId', Array.isArray(template.team) && template.team.length === 4 && template.team[0] === '10000032')
ok('模板窗口是标准 7243 帧', template.measurementEndFrame === 7243)
ok('模板用 asap-sequence + fps-60', template.scheduler === 'asap-sequence' && template.frameTierId === 'fps-60')
ok('模板顺序是每人一个战技 + 一个普攻', template.sequence.length === 8 && template.sequence[0] === 'bennett.skill')

const bare = mod.rotationHelpText({ builds, actions, nearby: [], windowFrames: 7243 })
ok('没有相近轴时不编候选', !/最接近的现有轴/.test(bare))
ok('没有相近轴时仍给模板', /"sequence"/.test(bare))

report()
