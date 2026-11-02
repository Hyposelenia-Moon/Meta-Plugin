/**
 * 顺序轴（手写友好）→ RotationSpec 的转换。
 *
 * 2026-11-02 用户反馈「没有编辑器，手写精确帧轴过于复杂」，所以轴文件支持只写动作顺序：
 *   { "sequence": ["bennett.skill", "xiangling.skill", ...] }
 * 帧由 asap-sequence 调度器排，角色变化自动插切人步骤。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { ok, report } = createChecks('队伍模拟 · 顺序轴')
const mod = async (rel) => import(pathToFileURL(path.join(libDir, rel)).href)
const S = await mod('model/TeamSimStore.js')
const K = await mod('modules/teamSimulation/index.js')

const readPack = (key) => JSON.parse(fs.readFileSync(path.join('data', 'team-sim', 'packs', `${key}.json`), 'utf8'))
const teamPack = () => {
  const merged = K.combineDataPacks(['bennett', 'xiangling', 'xingqiu', 'yelan'].map(readPack))
  if (merged.status !== 'ok') throw new Error('测试数据包合成失败')
  return merged.pack
}
const baseFile = (patch = {}) => ({
  schemaVersion: 1,
  id: 'demo-skill-sequence',
  team: ['10000023', '10000025', '10000032', '10000060'],
  measurementEndFrame: 7243,
  scheduler: 'asap-sequence',
  frameTierId: 'fps-60',
  sequence: ['bennett.skill', 'xiangling.skill', 'xingqiu.skill', 'yelan.skill'],
  ...patch
})

{
  const pack = teamPack()
  const converted = S.toRotation(baseFile(), pack)
  ok('顺序轴能转成 RotationSpec', converted.status === 'ok', JSON.stringify(converted.issues))
  if (converted.rotation) {
    const r = converted.rotation
    ok('顺序轴固化成 fixed 调度（机制规划只认 fixed）', r.scheduler === 'fixed')
    ok('四个角色各插一次切人步骤（共 3 个 switch）', r.steps.filter(s => s.kind === 'switch').length === 3)
    ok('步骤顺序与输入一致', r.steps.filter(s => s.kind === 'action').map(s => s.actionId).join(',') === 'bennett.skill,xiangling.skill,xingqiu.skill,yelan.skill')
    ok('初始能量缺省 0', r.actors.every(a => a.energy === 0))
    ok('能量上限取各自爆发能耗', r.actors.map(a => `${a.actorId}:${a.energyMax}`).join(',') === 'bennett:60,xiangling:80,xingqiu:80,yelan:70')
    ok('初始前台是第一个动作的角色', r.activeActorId === 'bennett')
    ok('固化后每个步骤都有实际帧，且单调不减', r.steps.every(s => typeof s.atFrame === 'number') && r.steps.every((s, i, list) => i === 0 || s.atFrame >= list[i - 1].atFrame))
  }
}

{
  const pack = teamPack()
  const badAction = S.toRotation(baseFile({ sequence: ['bennett.skill', 'xiangling.burst2'] }), pack)
  ok('包里没有的动作被拒绝', badAction.status === 'unsupported' && badAction.issues.some(i => /动作包里没有/.test(i.message)))

  const mismatch = S.toRotation(baseFile({ sequence: [{ actionId: 'bennett.skill', actorId: 'xiangling' }] }), pack)
  ok('actorId 与动作归属不一致被拒绝', mismatch.status === 'invalid' && mismatch.issues.some(i => /属于 bennett/.test(i.message)))

  const badTier = S.toRotation(baseFile({ frameTierId: 'fps-999' }), pack)
  ok('未知帧率档位被拒绝', badTier.status === 'unsupported' && /帧率档位/.test(badTier.issues[0].message))

  const empty = S.toRotation(baseFile({ sequence: [] }), pack)
  ok('空顺序轴被拒绝', empty.status === 'invalid')

  const noRecording = S.toRotation({ schemaVersion: 1, id: 'x', team: [], measurementEndFrame: 7243 }, pack)
  ok('既没有 sequence 也没有 recording 时报可读错误', noRecording.status === 'invalid' && /sequence|recording/.test(noRecording.issues[0].message))
}

{
  // 仓库里的示例轴必须真的能过校验。
  const pack = teamPack()
  const file = JSON.parse(fs.readFileSync(path.join('data', 'team-sim', 'rotations', 'demo-skill-sequence.json'), 'utf8'))
  const converted = S.toRotation(file, pack)
  ok('入库的顺序轴示例能过校验', converted.status === 'ok', JSON.stringify(converted.issues))
  ok('示例轴只写动作顺序（13 条）', file.sequence.length === 13)
  if (converted.rotation) {
    // loop: true 要把动作铺到测量窗口，否则 120 秒窗口里只打 7 秒，DPS 会被摊薄十几倍。
    const frames = converted.rotation.steps.map(step => step.atFrame ?? 0)
    ok('loop 轴把循环展开到多轮', converted.rotation.steps.filter(step => step.kind === 'action').length > 13)
    ok('展开后所有步骤仍在 7243 帧窗口内', Math.max(...frames) < 7243)
    ok('展开后调度仍是 fixed', converted.rotation.scheduler === 'fixed')
  }
  const noLoop = S.toRotation({ ...file, loop: false }, pack)
  ok('loop: false 时只跑一遍（20 步含切人）', noLoop.status === 'ok' && noLoop.rotation?.steps.length === 20)
}

{
  // 可选步骤：初始 0 能量下放不出的爆发，标 optional 后应当被跳过而不是让整份轴失效。
  const pack = teamPack()
  const optional = {
    schemaVersion: 1,
    id: 'optional-burst',
    team: ['10000023', '10000025', '10000032', '10000060'],
    measurementEndFrame: 7243,
    scheduler: 'asap-sequence',
    frameTierId: 'fps-60',
    sequence: ['bennett.skill', { actionId: 'bennett.burst', optional: true }]
  }
  const converted = S.toRotation(optional, pack)
  ok('optional 爆发排不进去时整份轴仍可用', converted.status === 'ok', JSON.stringify(converted.issues?.slice(0, 2)))
  ok('optional 爆发确实被跳过', converted.rotation ? converted.rotation.steps.every(step => step.kind !== 'action' || !step.actionId.endsWith('.burst')) : false)

  const required = { ...optional, sequence: ['bennett.skill', 'bennett.burst'] }
  const strict = S.toRotation(required, pack)
  ok('不带 optional 的爆发排不进去时轴报错，不静默跳过', strict.status !== 'ok')
}

{
  // 目录里每一份轴都要能对着自己的数据包转成轴——顺序轴和录制轴都算。
  const roster = JSON.parse(fs.readFileSync(path.join('data', 'team-sim', 'roster.json'), 'utf8'))
  const keyOf = (charId) => roster.characters.find(c => c.charId === charId)?.keys?.[0]
  const dir = path.join('data', 'team-sim', 'rotations')
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
    const keys = (file.team ?? []).map(keyOf)
    if (keys.some(k => !k)) { ok(`${name}：队伍成员都能在名录里找到`, false, JSON.stringify(file.team)); continue }
    const merged = K.combineDataPacks(keys.map(readPack))
    if (merged.status !== 'ok') { ok(`${name}：数据包能合成`, false); continue }
    const converted = S.toRotation(file, merged.pack)
    ok(`${name}：能转成可执行的轴`, converted.status === 'ok', JSON.stringify(converted.issues?.slice(0, 2)))
  }
}

report()
