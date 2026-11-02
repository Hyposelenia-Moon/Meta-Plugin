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
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
report()
