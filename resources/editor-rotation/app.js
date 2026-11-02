/* 队伍轴编辑器前端 —— 原生 JS，无框架。默认视图全是人话，JSON 收进「高级设置」。 */
'use strict'

const state = {
  slots: ['', '', '', ''],
  roster: [],
  actions: new Map(), // 动作包键 -> 动作列表
  file: null,
  recording: null // 录制解析后的轴文件
}

const $ = (id) => document.getElementById(id)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

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
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

/* ---------------- 中文名与提示 ---------------- */

const KIND_LABEL = { normal: '普通攻击', skill: '元素战技', burst: '元素爆发', charged: '重击', aimed: '瞄准射击' }

function actionLabel (actionOrId, kindHint) {
  const id = typeof actionOrId === 'string' ? actionOrId : actionOrId.id
  const kind = typeof actionOrId === 'string' ? kindHint : actionOrId.kind
  const suffix = String(id.split('.').slice(1).join('.'))
  const normal = suffix.match(/^normal-(\d+)$/)
  if (normal) return `普通攻击 第${normal[1]}段`
  if (suffix === 'skill') return '元素战技'
  if (suffix === 'burst') return '元素爆发'
  if (suffix === 'charged') return '重击'
  if (KIND_LABEL[kind]) return KIND_LABEL[kind]
  return suffix
}

function secondsText (frames) {
  if (!Number.isFinite(Number(frames))) return ''
  return `${(Number(frames) / 60).toFixed(1)} 秒`
}

const HINT_RULES = [
  [/动作包里没有\s*([^\s，。]+)/, (m) => `队伍里没有「${m[1]}」这条动作数据（该角色还没收录这段动作）`],
  [/等不到可用状态|deadlock/, () => '这一步能量或冷却不够；可以先勾上「能量够了才放」，或把充能效率调高'],
  [/目标已经是前台角色/, () => '这一步是重复切人，可以删掉'],
  [/早于上一动作最早可取消帧/, () => '这一步排得太早，把它往前挪一点'],
  [/没有可解析的动作|动作 id 不能为空/, () => '有一步没选动作，补上再检查'],
  [/测量窗口|window/, () => '「打多久」太短，装不下最后一步；把它调大一点']
]

function explain (issue) {
  const text = String(issue?.message ?? '')
  for (const [pattern, to] of HINT_RULES) {
    const match = text.match(pattern)
    if (match) return `${to(match)}${issue.path ? `（位置：${issue.path}）` : ''}`
  }
  return text || '未知问题'
}

function setStatus (el, kind, text) {
  el.dataset.kind = kind
  el.className = `status ${kind}`
  el.textContent = text
}

/* ---------------- 数据加载 ---------------- */

async function loadRoster () {
  state.roster = (await api('/api/roster')).items
}

async function actionsFor (key) {
  if (!state.actions.has(key)) state.actions.set(key, (await api(`/api/actions?key=${encodeURIComponent(key)}`)).items)
  return state.actions.get(key)
}

const rosterEntry = (charId) => state.roster.find(entry => entry.charId === charId)
const keyOf = (charId) => rosterEntry(charId)?.key ?? ''
const teamKeys = () => state.file.team.map(keyOf).filter(Boolean)

/* ---------------- 拼装页 ---------------- */

function renderTeam () {
  const box = $('team')
  box.innerHTML = ''
  for (let i = 0; i < 4; i += 1) state.slots[i] = state.file.team[i] || ''
  state.slots.forEach((value, slot) => {
    const wrap = document.createElement('label')
    wrap.className = 'slot'
    const input = document.createElement('input')
    input.setAttribute('list', 'roster-list')
    input.placeholder = `第 ${slot + 1} 位角色`
    input.value = value ? (rosterEntry(value)?.cn ?? '') : ''
    input.addEventListener('change', () => {
      const text = input.value.trim()
      const entry = text ? state.roster.find(item => item.cn === text || item.key === text) : null
      if (text && !entry) { input.value = value ? (rosterEntry(value)?.cn ?? '') : ''; setStatus($('status'), 'bad', `找不到角色「${text}」，请从下拉列表里选`); return }
      state.slots[slot] = entry ? entry.charId : ''
      for (let i = 0; i < 4; i += 1) if (i !== slot && state.slots[i] === state.slots[slot]) state.slots[i] = ''
      state.file.team = state.slots.filter(Boolean)
      if (state.file.id && state.file.id.startsWith('auto-')) state.file.id = ''
      render()
    })
    wrap.appendChild(input)
    const chip = document.createElement('span')
    chip.className = 'slot-index'
    chip.textContent = `位置 ${slot + 1}`
    wrap.appendChild(chip)
    box.appendChild(wrap)
  })
  const list = document.createElement('datalist')
  list.id = 'roster-list'
  list.innerHTML = state.roster.map(entry => `<option value="${entry.cn}"></option>`).join('')
  box.appendChild(list)
}

async function renderSteps () {
  const box = $('steps')
  box.innerHTML = ''
  $('empty').style.display = state.file.sequence.length ? 'none' : ''
  const keys = teamKeys()
  for (let index = 0; index < state.file.sequence.length; index += 1) {
    const step = state.file.sequence[index]
    const actor = typeof step === 'string' ? step.split('.')[0] : (step.actorId || String(step.actionId).split('.')[0])
    const actionId = typeof step === 'string' ? step : String(step.actionId)
    const optional = typeof step !== 'string' && step.optional === true
    const row = document.createElement('div')
    row.className = `step${optional ? ' optional' : ''}`

    const no = document.createElement('div')
    no.className = 'no'
    no.textContent = String(index + 1)
    row.appendChild(no)

    const actorSelect = document.createElement('select')
    actorSelect.className = 'actor'
    actorSelect.innerHTML = keys.map(key => {
      const entry = state.roster.find(item => item.key === key)
      return `<option value="${key}">${entry ? entry.cn : key}</option>`
    }).join('') || '<option value="">先选队伍</option>'
    actorSelect.value = actor
    const actionSelect = document.createElement('select')
    actionSelect.className = 'action'

    const fillActions = async (actorKey, selectedId) => {
      const list = actorKey ? await actionsFor(actorKey) : []
      const groups = [
        ['普通攻击', list.filter(a => a.kind === 'normal')],
        ['元素战技 / 爆发', list.filter(a => a.kind === 'skill' || a.kind === 'burst')]
      ]
      actionSelect.innerHTML = groups.filter(([, items]) => items.length).map(([label, items]) =>
        `<optgroup label="${label}">${items.map(item => `<option value="${item.id}">${actionLabel(item)}${item.frames ? ` · ${secondsText(item.frames)}` : ''}</option>`).join('')}</optgroup>`
      ).join('') || '<option value="">没有动作</option>'
      if (selectedId) actionSelect.value = selectedId
      if (!actionSelect.value && list.length) actionSelect.value = list[0].id
    }
    await fillActions(actor, actionId)
    row.appendChild(actorSelect)
    row.appendChild(actionSelect)

    const hint = document.createElement('span')
    hint.className = 'step-hint muted'
    const current = (await actionsFor(actor)).find(item => item.id === actionId)
    hint.textContent = current?.energyCost ? `耗能 ${current.energyCost}` : ''
    row.appendChild(hint)

    actorSelect.addEventListener('change', async () => {
      const list = await actionsFor(actorSelect.value)
      setStep(index, actorSelect.value, list[0]?.id ?? '', optional)
      render()
    })
    actionSelect.addEventListener('change', () => {
      setStep(index, actorSelect.value, actionSelect.value, optional)
      render()
    })

    const flag = document.createElement('label')
    flag.className = 'tag'
    flag.innerHTML = '<input type="checkbox"> 能量够了才放'
    flag.querySelector('input').checked = optional
    flag.querySelector('input').addEventListener('change', event => {
      setStep(index, actorSelect.value, actionSelect.value, event.target.checked)
      render()
    })
    row.appendChild(flag)

    const tools = document.createElement('div')
    tools.className = 'tools'
    tools.appendChild(button('↑', () => move(index, -1)))
    tools.appendChild(button('↓', () => move(index, 1)))
    tools.appendChild(button('删除', () => { state.file.sequence.splice(index, 1); render() }))
    row.appendChild(tools)
    box.appendChild(row)
  }
}

function button (text, onClick) {
  const el = document.createElement('button')
  el.className = 'btn mini'
  el.type = 'button'
  el.textContent = text
  el.addEventListener('click', onClick)
  return el
}

function setStep (index, actorId, actionId, optional) {
  if (!actionId) { state.file.sequence[index] = ''; return }
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
  if (!keys.length) { box.innerHTML = '<span class="muted">选好队伍后这里会出现每个人的充能效率</span>'; return }
  for (const key of keys) {
    const entry = state.roster.find(item => item.key === key)
    const label = document.createElement('span')
    label.textContent = entry ? entry.cn : key
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.max = '5'
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

function autoId () {
  const keys = teamKeys()
  return keys.length ? `custom-${keys.join('-')}`.slice(0, 64) : ''
}

function updateMeta () {
  const typed = $('id').value.trim()
  if (typed) state.file.id = typed
  else if (!state.file.id && teamKeys().length) {
    state.file.id = autoId()
    $('id').value = state.file.id
  }
  state.file.measurementEndFrame = Math.max(1, Math.round(Number($('window').value) || 7243))
  if ($('loop').checked) state.file.loop = true
  else delete state.file.loop
}

function renderPreview () {
  $('preview').value = JSON.stringify(state.file, null, 2)
}

function summaryText () {
  const actions = state.file.sequence.length
  if (!actions) return '还没有动作'
  const roles = new Set(teamKeys()).size
  return `${actions} 个动作 · ${roles} 名角色${state.file.loop ? ' · 会循环到结束' : ''}`
}

async function render () {
  updateMeta()
  renderTeam()
  await renderSteps()
  renderRecharge()
  renderPreview()
  renderRecordActive()
}

/* ---------------- 校验与保存 ---------------- */

async function validate () {
  updateMeta()
  renderPreview()
  setStatus($('status'), '', '检查中…')
  try {
    const result = await api('/api/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: state.file })
    })
    if (result.ok) {
      const seconds = (result.endFrame / 60).toFixed(1)
      setStatus($('status'), 'ok', `可以保存：${result.actions} 个动作，循环一轮约 ${seconds} 秒（${result.steps} 步）`)
    } else {
      setStatus($('status'), 'bad', `有 ${result.issues.length} 个问题：\n${result.issues.map(issue => `· ${explain(issue)}`).join('\n')}`)
    }
    return result
  } catch (err) {
    setStatus($('status'), 'bad', `检查失败：${err.message}`)
    return { ok: false }
  }
}

async function save () {
  updateMeta()
  if (!state.file.id) {
    $('status').className = 'status bad'
    $('status').textContent = '先在下面「高级设置」里给这条轴起个名字，再保存'
    return
  }
  const checked = await validate()
  if (!checked.ok) return
  try {
    const body = await api('/api/rotation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: state.file })
    })
    if (!body.ok) { setStatus($('status'), 'bad', `保存失败：\n${(body.issues || []).map(issue => `· ${explain(issue)}`).join('\n')}`); return }
    setStatus($('status'), 'ok', `已保存到 ${body.path}`)
    await loadExisting()
  } catch (err) {
    setStatus($('status'), 'bad', `保存失败：${err.message}`)
  }
}

/* ---------------- 已保存的轴 ---------------- */

async function loadExisting () {
  const body = await api('/api/rotations')
  $('existing').innerHTML = '<option value="">打开已保存的轴…</option>' +
    body.items.map(item => `<option value="${item.id}">${item.id}${item.ok ? '' : '（读不了）'}</option>`).join('')
}

async function loadOne (id) {
  if (!id) return
  try {
    const body = await api(`/api/rotation?id=${encodeURIComponent(id)}`)
    state.file = body.file
    $('window').value = String(state.file.measurementEndFrame || 7243)
    $('loop').checked = state.file.loop !== false
    $('id').value = state.file.id || ''
    setStatus($('status'), '', `已打开 ${id}`)
    await render()
  } catch (err) {
    setStatus($('status'), 'bad', `打开失败：${err.message}`)
  }
}

/* ---------------- 录制导入 ---------------- */

function renderRecordCommand () {
  const keys = teamKeys()
  const active = $('rec-active').value || keys[0] || ''
  if (!keys.length) { $('rec-command').textContent = '先在「拼一条轴」里选好队伍'; return }
  const command = `python scripts/record-keys.py --tier fps-60 --game-version 7.1 --keymap-version gs-default-1 \\\n  --actors ${keys.join(',')} --active ${active} --source record-keys.py@我 \\\n  --out out/recording.json`
  $('rec-command').textContent = command
}

function renderRecordActive () {
  const keys = teamKeys()
  $('rec-active').innerHTML = keys.map(key => {
    const entry = state.roster.find(item => item.key === key)
    return `<option value="${key}">${entry ? entry.cn : key}</option>`
  }).join('')
  renderRecordCommand()
}

async function parseRecording () {
  let recording
  try {
    recording = JSON.parse($('rec-json').value)
  } catch {
    setStatus($('rec-status'), 'bad', '这段内容不是合法 JSON，检查是不是只粘了一半')
    return
  }
  const id = $('rec-id').value.trim() || 'recording'
  setStatus($('rec-status'), '', '解析中…')
  try {
    const body = await api('/api/import-recording', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recording, id })
    })
    if (!body.ok) {
      setStatus($('rec-status'), 'bad', `解析失败：\n${(body.issues || []).map(issue => `· ${explain(issue)}`).join('\n')}`)
      return
    }
    state.recording = body.file
    const s = body.summary
    $('rec-summary').textContent = `识别到 ${s.actions} 次动作、${s.switches} 次切人，共 ${s.actors} 名角色；录制长 ${(s.lastFrame / 60).toFixed(1)} 秒。`
    $('rec-preview').value = JSON.stringify(body.file, null, 2)
    $('rec-id').value = body.file.id
    setStatus($('rec-status'), 'ok', '解析成功，可以保存了')
  } catch (err) {
    setStatus($('rec-status'), 'bad', `解析失败：${err.message}`)
  }
}

async function saveRecording () {
  if (!state.recording) { setStatus($('rec-status'), 'bad', '先解析一段录制'); return }
  state.recording.id = $('rec-id').value.trim() || state.recording.id
  try {
    const body = await api('/api/rotation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: state.recording })
    })
    if (!body.ok) { setStatus($('rec-status'), 'bad', `保存失败：\n${(body.issues || []).map(issue => `· ${explain(issue)}`).join('\n')}`); return }
    setStatus($('rec-status'), 'ok', `已保存到 ${body.path}`)
    await loadExisting()
  } catch (err) {
    setStatus($('rec-status'), 'bad', `保存失败：${err.message}`)
  }
}

/* ---------------- 事件绑定与启动 ---------------- */

function bind () {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab))
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tab.dataset.tab}`))
    })
  })
  $('add').addEventListener('click', async () => {
    const key = teamKeys()[0]
    if (!key) { setStatus($('status'), 'bad', '先选队伍'); return }
    const first = (await actionsFor(key))[0]
    if (!first) { setStatus($('status'), 'bad', `${key} 还没有动作数据`); return }
    state.file.sequence.push(first.id)
    await render()
  })
  $('add-burst').addEventListener('click', async () => {
    const key = teamKeys()[0]
    if (!key) { setStatus($('status'), 'bad', '先选队伍'); return }
    const burst = (await actionsFor(key)).find(item => item.kind === 'burst')
    if (!burst) { setStatus($('status'), 'bad', '这个角色还没有爆发动作数据'); return }
    state.file.sequence.push({ actionId: burst.id, actorId: key, optional: true })
    await render()
  })
  $('validate').addEventListener('click', validate)
  $('save').addEventListener('click', save)
  $('load').addEventListener('click', () => loadOne($('existing').value))
  $('fresh').addEventListener('click', () => {
    state.file = emptyFile()
    $('window').value = '7243'
    $('loop').checked = true
    $('id').value = ''
    setStatus($('status'), '', '新建了一条空轴')
    render()
  })
  $('id').addEventListener('input', renderPreview)
  $('window').addEventListener('change', () => { updateMeta(); renderPreview() })
  $('loop').addEventListener('change', () => { updateMeta(); renderPreview() })
  $('rec-active').addEventListener('change', renderRecordCommand)
  $('rec-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('rec-command').textContent); setStatus($('rec-status'), 'ok', '命令已复制') } catch { setStatus($('rec-status'), 'bad', '浏览器不让复制，手动选中复制吧') }
  })
  $('rec-parse').addEventListener('click', parseRecording)
  $('rec-save').addEventListener('click', saveRecording)
  $('rec-id').addEventListener('input', () => { if (state.recording) state.recording.id = $('rec-id').value.trim() })
}

async function boot () {
  try {
    await loadRoster()
    state.file = emptyFile()
    bind()
    await loadExisting()
    await render()
    renderRecordActive()
  } catch (err) {
    setStatus($('status'), 'bad', `初始化失败：${err.message}`)
  }
}

boot()

