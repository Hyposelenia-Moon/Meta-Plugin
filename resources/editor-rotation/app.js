/* 轴编辑器前端 —— 原生 JS，无框架。状态只有一份 file，任何改动都重画。 */
'use strict'

const state = {
  slots: ['', '', '', ''],
  roster: [],
  actions: new Map(), // key -> [{ id, kind, ... }]
  file: null
}

const $ = (id) => document.getElementById(id)

function emptyFile () {
  return {
    schemaVersion: 1,
    id: '',
    team: [],
    measurementEndFrame: 7243,
    scheduler: 'asap-sequence',
    frameTierId: 'fps-60',
    loop: true,
    sequence: []
  }
}

async function api (url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `${res.status}`)
  return body
}

async function loadRoster () {
  const body = await api('/api/roster')
  state.roster = body.items
}

async function actionsFor (key) {
  if (!state.actions.has(key)) {
    const body = await api(`/api/actions?key=${encodeURIComponent(key)}`)
    state.actions.set(key, body.items)
  }
  return state.actions.get(key)
}

function teamKeys () {
  return state.file.team.map(id => state.roster.find(entry => entry.charId === id)?.key).filter(Boolean)
}

function actorOf (step) {
  if (typeof step === 'string') return step.split('.')[0]
  return step.actorId || String(step.actionId || '').split('.')[0]
}

function actionIdOf (step) {
  return typeof step === 'string' ? step : String(step.actionId || '')
}

function isOptional (step) {
  return typeof step !== 'string' && step.optional === true
}

function renderTeam () {
  const box = $('team')
  box.innerHTML = ''
  // 先把一份 file.team 摊回四个槽位（槽位顺序就是界面上的顺序）。
  for (let i = 0; i < 4; i += 1) state.slots[i] = state.file.team[i] || ''
  for (let slot = 0; slot < 4; slot += 1) {
    const select = document.createElement('select')
    select.innerHTML = '<option value="">（空）</option>' + state.roster
      .map(entry => `<option value="${entry.charId}">${entry.cn}（${entry.key}）</option>`)
      .join('')
    select.value = state.slots[slot]
    select.addEventListener('change', () => {
      state.slots[slot] = select.value
      // 同一个角色不能出现在两个位置：后选的保留，另一格清空。
      for (let i = 0; i < 4; i += 1) if (i !== slot && state.slots[i] === select.value) state.slots[i] = ''
      state.file.team = state.slots.filter(Boolean)
      render()
    })
    box.appendChild(select)
  }
}

async function renderSteps () {
  const box = $('steps')
  box.innerHTML = ''
  const keys = teamKeys()
  $('empty').style.display = state.file.sequence.length ? 'none' : ''
  for (let index = 0; index < state.file.sequence.length; index += 1) {
    const step = state.file.sequence[index]
    const row = document.createElement('div')
    row.className = `step${isOptional(step) ? ' optional' : ''}`

    const no = document.createElement('div')
    no.className = 'no'
    no.textContent = String(index + 1)
    row.appendChild(no)

    const actor = document.createElement('select')
    actor.innerHTML = keys.map(key => {
      const entry = state.roster.find(item => item.key === key)
      return `<option value="${key}">${entry ? entry.cn : key}</option>`
    }).join('') || '<option value="">先选队伍</option>'
    actor.value = actorOf(step)
    row.appendChild(actor)

    const action = document.createElement('select')
    const currentActor = actor.value
    const list = currentActor ? await actionsFor(currentActor) : []
    action.innerHTML = list.map(item => `<option value="${item.id}">${item.id}（${item.kind}${item.frames ? ` ${item.frames}帧` : ''}${item.energyCost ? ` · ${item.energyCost}能量` : ''}）</option>`).join('') ||
      '<option value="">没有动作</option>'
    action.value = actionIdOf(step)
    if (!action.value && list.length) action.value = list[0].id
    row.appendChild(action)

    actor.addEventListener('change', async () => {
      const list = await actionsFor(actor.value)
      setStep(index, actor.value, list[0] ? list[0].id : '', isOptional(step))
      render()
    })
    action.addEventListener('change', () => {
      setStep(index, actor.value, action.value, isOptional(step))
      render()
    })

    const flag = document.createElement('label')
    flag.className = 'tag'
    flag.innerHTML = '<input type="checkbox"> 可选'
    flag.querySelector('input').checked = isOptional(step)
    flag.querySelector('input').addEventListener('change', event => {
      setStep(index, actorOf(step), actionIdOf(step), event.target.checked)
      render()
    })
    row.appendChild(flag)

    const tools = document.createElement('div')
    tools.className = 'tools'
    tools.appendChild(button('↑', () => move(index, -1)))
    tools.appendChild(button('↓', () => move(index, 1)))
    tools.appendChild(button('×', () => { state.file.sequence.splice(index, 1); render() }))
    row.appendChild(tools)

    box.appendChild(row)
  }
}

function button (text, onClick) {
  const el = document.createElement('button')
  el.className = 'btn mini'
  el.textContent = text
  el.addEventListener('click', onClick)
  return el
}

function setStep (index, actorId, actionId, optional) {
  if (!actionId) { state.file.sequence[index] = actionId; return }
  state.file.sequence[index] = optional ? { actionId, actorId, optional: true } : actionId
}

function move (index, delta) {
  const next = index + delta
  if (next < 0 || next >= state.file.sequence.length) return
  const list = state.file.sequence
  const item = list[index]
  list[index] = list[next]
  list[next] = item
  render()
}

function renderRecharge () {
  const box = $('recharge')
  box.innerHTML = ''
  const keys = teamKeys()
  if (!keys.length) { box.innerHTML = '<span class="muted">先选队伍</span>'; return }
  for (const key of keys) {
    const entry = state.roster.find(item => item.key === key)
    const label = document.createElement('span')
    label.textContent = entry ? entry.cn : key
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.step = '0.1'
    input.value = String(state.file.energyRecharge?.[key] ?? 1)
    input.addEventListener('change', () => {
      const value = Number(input.value)
      state.file.energyRecharge = state.file.energyRecharge || {}
      if (!Number.isFinite(value) || value <= 0) delete state.file.energyRecharge[key]
      else state.file.energyRecharge[key] = value
      if (!Object.keys(state.file.energyRecharge).length) delete state.file.energyRecharge
      renderPreview()
    })
    box.appendChild(label)
    box.appendChild(input)
  }
}

function updateMeta () {
  state.file.id = $('id').value.trim()
  state.file.measurementEndFrame = Math.max(1, Math.round(Number($('window').value) || 7243))
  state.file.loop = $('loop').checked
  if (!state.file.loop) delete state.file.loop
  else state.file.loop = true
}

function renderPreview () {
  const status = $('status')
  const text = JSON.stringify(state.file, null, 2)
  $('preview').value = text
  if (status.dataset.kind === 'ok') status.textContent = status.dataset.text || '已就绪'
}

async function render () {
  updateMeta()
  renderTeam()
  await renderSteps()
  renderRecharge()
  renderPreview()
}

function setStatus (kind, text) {
  const status = $('status')
  status.dataset.kind = kind
  status.dataset.text = text
  status.className = `status ${kind}`
  status.textContent = text
}

async function validate () {
  updateMeta()
  renderPreview()
  setStatus('muted', '校验中…')
  try {
    const result = await api('/api/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: state.file })
    })
    if (result.ok) setStatus('ok', `校验通过：${result.actions} 个动作、固化成 ${result.steps} 步、最后一步第 ${result.endFrame} 帧`)
    else setStatus('bad', `校验失败：\n${result.issues.map(issue => `· ${issue.path}：${issue.message}`).join('\n')}`)
    return result
  } catch (err) {
    setStatus('bad', `请求失败：${err.message}`)
    return { ok: false }
  }
}

async function save () {
  updateMeta()
  renderPreview()
  if (!state.file.id) { setStatus('bad', '先填轴 id'); return }
  const result = await validate()
  if (!result.ok) return
  try {
    const body = await api('/api/rotation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: state.file })
    })
    if (!body.ok) { setStatus('bad', `保存失败：\n${(body.issues || []).map(i => `· ${i.path}：${i.message}`).join('\n')}`); return }
    setStatus('ok', `已保存：${body.path}`)
    await loadExisting()
  } catch (err) {
    setStatus('bad', `保存请求失败：${err.message}`)
  }
}

async function loadExisting () {
  const body = await api('/api/rotations')
  $('existing').innerHTML = '<option value="">选择已入库的轴…</option>' +
    body.items.map(item => `<option value="${item.id}">${item.id}${item.ok ? '' : '（解析失败）'}</option>`).join('')
}

async function loadOne (id) {
  if (!id) return
  try {
    const body = await api(`/api/rotation?id=${encodeURIComponent(id)}`)
    state.file = body.file
    $('id').value = state.file.id || ''
    $('window').value = String(state.file.measurementEndFrame || 7243)
    $('loop').checked = state.file.loop !== false
    setStatus('muted', `已载入 ${id}`)
    await render()
  } catch (err) {
    setStatus('bad', `载入失败：${err.message}`)
  }
}

function bind () {
  $('add').addEventListener('click', async () => {
    const key = teamKeys()[0]
    if (!key) { setStatus('bad', '先选队伍'); return }
    const first = (await actionsFor(key))[0]
    if (!first) { setStatus('bad', `${key} 没有动作`); return }
    state.file.sequence.push(first.id)
    await render()
  })
  $('add-burst').addEventListener('click', async () => {
    const key = teamKeys()[0]
    if (!key) { setStatus('bad', '先选队伍'); return }
    const burst = (await actionsFor(key)).find(item => item.kind === 'burst')
    if (!burst) { setStatus('bad', `${key} 没有爆发动作`); return }
    state.file.sequence.push({ actionId: burst.id, actorId: key, optional: true })
    await render()
  })
  $('validate').addEventListener('click', validate)
  $('save').addEventListener('click', save)
  $('load').addEventListener('click', () => loadOne($('existing').value))
  $('fresh').addEventListener('click', () => {
    state.file = emptyFile()
    $('id').value = ''
    $('window').value = '7243'
    $('loop').checked = true
    setStatus('muted', '已新建空轴')
    render()
  })
  $('id').addEventListener('input', renderPreview)
  $('window').addEventListener('change', renderPreview)
  $('loop').addEventListener('change', renderPreview)
}

async function boot () {
  try {
    await loadRoster()
    state.file = emptyFile()
    bind()
    await loadExisting()
    await render()
  } catch (err) {
    setStatus('bad', `初始化失败：${err.message}`)
  }
}

boot()




