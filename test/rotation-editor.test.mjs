/** 轴编辑器（scripts/rotation-editor.mjs）：纯函数 + HTTP 接口，落盘走临时目录，不动仓库里的轴。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks } from './_helper.mjs'

const { ok, report } = createChecks('轴编辑器')
const ROOT = path.resolve(import.meta.dirname, '..')
const E = await import(pathToFileURL(path.join(ROOT, 'scripts', 'rotation-editor.mjs')).href)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-editor-'))
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team-sim', 'rotations', 'demo-skill-sequence.json'), 'utf8'))

{
  const roster = E.loadRoster()
  ok('名录读到 100+ 角色', roster.length >= 100, String(roster.length))
  const bennett = roster.find(entry => entry.cn === '班尼特')
  ok('名录条目带可用动作包键', !!bennett && bennett.keys.length > 0)
  const list = E.actionsOf(bennett.keys[0])
  ok('动作列表含战技与爆发', list.some(a => a.kind === 'skill') && list.some(a => a.kind === 'burst'))
  ok('动作条目带帧数与能耗字段', list.every(a => typeof a.id === 'string' && typeof a.kind === 'string' && 'frames' in a && 'energyCost' in a))
}

{
  const good = await E.validateFile(demo)
  ok('入库示例轴能通过校验', good.ok, JSON.stringify(good.issues?.slice(0, 2)))
  ok('校验结果带动作数与最后帧', good.ok && good.actions > 0 && good.steps > 0 && good.endFrame > 0)

  const badAction = await E.validateFile({ ...demo, sequence: ['bennett.not-exist'] })
  ok('不存在的动作被拒绝', !badAction.ok && JSON.stringify(badAction.issues).includes('bennett.not-exist'))

  const badTeam = await E.validateFile({ ...demo, team: ['99999999'] })
  ok('队伍里不在名录的角色被拒绝', !badTeam.ok)

  const badId = await E.saveRotation({ ...demo, id: '../escape' }, tmp)
  ok('非法 id 不允许写到目录外', !badId.ok)
  ok('非法 id 没有落盘', fs.readdirSync(tmp).length === 0)

  const saved = await E.saveRotation({ ...demo, id: 'tmp-demo' }, tmp)
  ok('合法轴保存成功', saved.ok && fs.existsSync(path.join(tmp, 'tmp-demo.json')))
  const text = fs.readFileSync(path.join(tmp, 'tmp-demo.json'), 'utf8')
  ok('落盘是两空格缩进并带末尾换行', text.endsWith('\n') && text.includes('\n  "schemaVersion"'))
  const read = await E.readRotation('tmp-demo', tmp)
  ok('读回与写入一致', read.id === 'tmp-demo' && read.sequence.length === demo.sequence.length)
  ok('列表能列出刚写的轴', E.listRotations(tmp).some(item => item.id === 'tmp-demo' && item.ok))
}

{
  // HTTP 接口：起临时端口，验证前端真正会打的两个请求。
  const server = E.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  try {
    const roster = await (await fetch(`${base}/api/roster`)).json()
    ok('/api/roster 返回角色列表', Array.isArray(roster.items) && roster.items.length >= 100)
    const actions = await (await fetch(`${base}/api/actions?key=bennett`)).json()
    ok('/api/actions 返回该角色动作', Array.isArray(actions.items) && actions.items.some(a => a.id === 'bennett.skill'))
    const missing = await fetch(`${base}/api/actions?key=not-a-key`)
    ok('未知角色动作包返回 404', missing.status === 404)

    const validate = await (await fetch(`${base}/api/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: demo })
    })).json()
    ok('/api/validate 能跑通示例轴', validate.ok === true)

    const bad = await (await fetch(`${base}/api/rotation`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: { ...demo, id: 'x', sequence: ['bennett.nope'] } })
    })).json()
    ok('/api/rotation 校验失败时不落盘', bad.ok === false)
    const html = await (await fetch(`${base}/`)).text()
    ok('首页返回编辑器页面', html.includes('轴编辑器') && html.includes('app.js'))

    // 录制导入：录制器默认键位表写的是相对键，导入时展开成绝对键。
    const imported = await (await fetch(`${base}/api/import-recording`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'tmp-recording',
        recording: {
          schemaVersion: 1,
          frameTierId: 'fps-60',
          keymapVersion: 'gs-default-1',
          gameVersion: '7.1',
          source: 'record-keys.py@test',
          start: { activeActorId: 'bennett', actors: [{ actorId: 'bennett' }, { actorId: 'xiangling' }] },
          events: [
            { atMs: 0, key: 'skill', phase: 'down' },
            { atMs: 1000, key: 'switch:2', phase: 'down' },
            { atMs: 2000, key: 'normal-1', phase: 'down' }
          ]
        }
      })
    })).json()
    ok('/api/import-recording 能识别默认键位表', imported.ok === true, JSON.stringify(imported.issues?.slice(0, 2)))
    ok('录制键被展开成绝对键', imported.ok && imported.file.recording.events.map(e => e.key).join(',') === 'bennett.skill,to_xiangling,xiangling.normal-1')
    ok('导入会顺带生成键位表', imported.ok && imported.file.keymap.bindings['to_xiangling'].switch === true && imported.file.keymap.version === 'gs-default-1')
    ok('导入会带上队伍与测量窗口', imported.ok && imported.file.team.length === 2 && imported.file.measurementEndFrame >= 7243)

    const badRecording = await (await fetch(`${base}/api/import-recording`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recording: { schemaVersion: 1, frameTierId: 'fps-60', keymapVersion: 'x', start: { activeActorId: 'bennett', actors: [{ actorId: 'bennett' }] }, events: [{ atMs: 0, key: 'x', phase: 'down' }] } })
    })).json()
    ok('不认识的按键被拒绝并给出中文原因', badRecording.ok === false && /看不懂这个按键/.test(JSON.stringify(badRecording.issues)))
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

fs.rmSync(tmp, { recursive: true, force: true })


// 面板试算（P1）：词条档位表 + 内核 buildPermanentStats。
{
  const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team-sim', 'stat-tables.json'), 'utf8'))
  ok('词条档位表含五星主词条与副词条', Array.isArray(tables.levels) && tables.levels.length === 6 && tables.mainStats.cpct[5] === 0.311)
  ok('副词条总和覆盖 1–6 条强化', tables.subValues.cpct.length >= 12 && tables.subValues.cpct.includes(0.039) && tables.subValues.cpct.at(-1) === 0.234)
  ok('部位主词条与内核一致', tables.slots.sands.includes('recharge') && !tables.slots.circlet.includes('pyro') && tables.slots.flower.join() === 'hp')

  const panel = await E.computePanel({
    characterId: '10000030',
    weaponId: '13303',
    refinement: 1,
    artifacts: ['flower', 'plume', 'sands', 'goblet', 'circlet'].map((slot, i) => ({
      slot,
      setId: '400189',
      level: 20,
      main: { key: ['hp', 'atk', 'hpPct', 'geo', 'cdmg'][i], value: [4780, 311, 0.466, 0.466, 0.622][i] },
      sub: [{ key: 'cpct', value: 0.35 }]
    }))
  })
  ok('面板试算成功', panel.ok === true, JSON.stringify(panel.issues?.slice(0, 2)))
  ok('面板数值符合手算（防御 737.81×1.3、伤害加成 0.288+0.466）',
    Math.abs(panel.stats.def - 959.153) < 1e-3 && Math.abs(panel.stats.geo - 0.754) < 1e-9, JSON.stringify({ def: panel.stats.def, geo: panel.stats.geo }))
  ok('未建模的套装/天赋如实列出', panel.unmodeled.some(item => item.id.includes('artifact-set:400189:4pc')))

  const bad = await E.computePanel({
    characterId: '10000030',
    weaponId: '13303',
    artifacts: [{ slot: 'circlet', setId: '400189', level: 20, main: { key: 'cpct', value: 0.311 }, sub: [{ key: 'cpct', value: 0.039 }] }]
  })
  ok('副词条与主词条同属性被拒绝', bad.ok === false && JSON.stringify(bad.issues).includes('副词条不能与主词条同属性'))
}
report()
