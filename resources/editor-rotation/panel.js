/* 面板与词条页签 —— 按游戏里的圣遗物一件件填，实时算最终面板。 */
'use strict'

const P = {
  roster: [],
  sets: [],
  weapons: [],
  tables: null,
  cards: new Map() // charId -> { weaponId, refinement, slots: { slot: { setId, level, mainKey, subs: [{key,value}] } } }
}

const SLOTS = [
  ['flower', '生之花'],
  ['plume', '死之羽'],
  ['sands', '时之沙'],
  ['goblet', '空之杯'],
  ['circlet', '理之冠']
]

const SUB_KEYS = ['hp', 'atk', 'def', 'hpPct', 'atkPct', 'defPct', 'mastery', 'recharge', 'cpct', 'cdmg']
const LABEL = {
  hp: '生命值', atk: '攻击力', def: '防御力',
  hpPct: '生命%', atkPct: '攻击%', defPct: '防御%',
  mastery: '元素精通', recharge: '元素充能', cpct: '暴击率', cdmg: '暴击伤害',
  heal: '治疗加成', phy: '物理伤害', pyro: '火伤', hydro: '水伤', electro: '雷伤', cryo: '冰伤', anemo: '风伤', geo: '岩伤', dendro: '草伤', dmg: '伤害加成'
}
const PCT = new Set(['hpPct', 'atkPct', 'defPct', 'recharge', 'cpct', 'cdmg', 'heal', 'phy', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro', 'dmg'])

const label = (key) => LABEL[key] || key
const fmt = (key, value) => PCT.has(key) ? `${(value * 100).toFixed(1)}%` : String(Math.round(value))

function el (tag, props = {}) {
  const node = document.createElement(tag)
  Object.assign(node, props)
  return node
}

function selectBox (options, value, onChange) {
  const node = el('select')
  node.innerHTML = options.map(item => `<option value="${item.value}">${item.label}</option>`).join('')
  if (value !== undefined) node.value = String(value)
  node.addEventListener('change', () => onChange(node.value))
  return node
}

async function bootPanel () {
  const [roster, sets, weapons, tables] = await Promise.all([
    fetch('/api/roster').then(r => r.json()),
    fetch('/api/sets').then(r => r.json()),
    fetch('/api/weapons').then(r => r.json()),
    fetch('/api/stat-tables').then(r => r.json())
  ])
  P.roster = roster.items
  P.sets = sets.items
  P.weapons = weapons.items
  P.tables = tables
  window.addEventListener('rotation-team-changed', renderPanel)
  renderPanel()
}

function cardOf (charId) {
  if (!P.cards.has(charId)) {
    P.cards.set(charId, {
      weaponId: '',
      refinement: 1,
      slots: Object.fromEntries(SLOTS.map(([slot]) => [slot, { setId: '', level: 20, mainKey: '', subs: [] }]))
    })
  }
  return P.cards.get(charId)
}

function defaultMain (slot) {
  const mains = P.tables?.slots?.[slot] ?? []
  return mains[0] ?? ''
}

async function recompute (charId, card) {
  const box = document.querySelector(`[data-panel-stats="${charId}"]`)
  if (!box) return
  const artifacts = SLOTS.map(([slot]) => ({ slot, item: card.slots[slot] })).filter(({ item }) => item.setId)
    .map(({ slot, item }) => ({
      slot,
      setId: item.setId,
      level: item.level,
      main: { key: item.mainKey, value: P.tables.mainStats[item.mainKey]?.[P.tables.levels.indexOf(item.level)] ?? 0 },
      sub: item.subs.filter(sub => sub.key && sub.value).map(sub => ({ key: sub.key, value: Number(sub.value) }))
    }))
  if (!artifacts.length) { box.textContent = '填一件圣遗物后这里显示面板'; box.className = 'panel-stats muted'; return }
  box.textContent = '计算中…'
  try {
    const body = await fetch('/api/panel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ characterId: charId, weaponId: card.weaponId, refinement: card.refinement, artifacts })
    }).then(r => r.json())
    if (!body.ok) {
      box.textContent = `暂时算不出来：${(body.issues || []).map(issue => issue.message).join('；')}`
      box.className = 'panel-stats bad'
      return
    }
    const s = body.stats
    const order = ['hp', 'atk', 'def', 'mastery', 'cpct', 'cdmg', 'recharge', 'geo', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'dendro', 'phy']
    const parts = order.filter(key => s[key]).map(key => `${label(key)} ${fmt(key, s[key])}`)
    const extra = order.filter(key => !s[key]).map(key => `${label(key)} 0`).slice(0, 3)
    box.textContent = [...parts, ...extra].join(' · ')
    box.className = 'panel-stats ok'
  } catch (err) {
    box.textContent = `计算失败：${err.message}`
    box.className = 'panel-stats bad'
  }
}

function renderPanel () {
  const host = document.getElementById('panel-members')
  if (!host || !P.tables) return
  const team = window.__rotationState?.team ?? []
  host.innerHTML = ''
  if (!team.length) { host.innerHTML = '<p class="muted">先在「① 拼一条轴」里选好队伍。</p>'; return }
  for (const charId of team) {
    const entry = P.roster.find(item => item.charId === charId)
    if (!entry) continue
    const card = cardOf(charId)
    const box = el('section', { className: 'member-card' })
    const head = el('div', { className: 'card-head' })
    head.innerHTML = `<h3>${entry.cn}</h3>`
    head.appendChild(selectBox(
      [{ value: '', label: '选择武器…' }, ...P.weapons.map(w => ({ value: w.id, label: `${w.name}（${w.star}★）` }))],
      card.weaponId,
      value => { card.weaponId = value; recompute(charId, card) }
    ))
    head.appendChild(selectBox(
      [1, 2, 3, 4, 5].map(n => ({ value: n, label: `精${n}` })),
      card.refinement,
      value => { card.refinement = Number(value); recompute(charId, card) }
    ))
    box.appendChild(head)

    for (const [slot, slotLabel] of SLOTS) {
      const item = card.slots[slot]
      if (!item.mainKey) item.mainKey = defaultMain(slot)
      if (!item.subs.length) item.subs = [{ key: '', value: '' }, { key: '', value: '' }, { key: '', value: '' }, { key: '', value: '' }]
      const row = el('div', { className: 'artifact-row' })
      const main = el('div', { className: 'artifact-main' })
      main.innerHTML = `<span class="slot-name">${slotLabel}</span>`
      main.appendChild(selectBox([{ value: '', label: '套装…' }, ...P.sets.map(s => ({ value: s.id, label: s.name }))], item.setId, value => { item.setId = value; recompute(charId, card) }))
      main.appendChild(selectBox(P.tables.levels.map(level => ({ value: level, label: `+${level}` })), item.level, value => { item.level = Number(value); recompute(charId, card) }))
      const mains = (P.tables.slots[slot] ?? []).map(key => ({ value: key, label: label(key) }))
      main.appendChild(selectBox(mains, item.mainKey, value => { item.mainKey = value; recompute(charId, card) }))
      row.appendChild(main)
      const subs = el('div', { className: 'artifact-subs' })
      for (const sub of item.subs) {
        const pair = el('div', { className: 'sub-pair' })
        const statSel = selectBox([{ value: '', label: '副词条…' }, ...SUB_KEYS.map(key => ({ value: key, label: label(key) }))], sub.key, value => {
          sub.key = value
          sub.value = ''
          renderPanel()
          recompute(charId, card)
        })
        const values = sub.key ? (P.tables.subValues[sub.key] ?? []).map(value => ({ value, label: fmt(sub.key, value) })) : []
        const valueSel = selectBox([{ value: '', label: '档位' }, ...values], sub.value, value => { sub.value = value; recompute(charId, card) })
        pair.appendChild(statSel)
        pair.appendChild(valueSel)
        subs.appendChild(pair)
      }
      row.appendChild(subs)
      box.appendChild(row)
    }
    const stats = el('div', { className: 'panel-stats muted' })
    stats.dataset.panelStats = charId
    stats.textContent = '填一件圣遗物后这里显示面板'
    box.appendChild(stats)
    host.appendChild(box)
  }
}





function panelPayload (team) {
  return team.map(charId => {
    const card = P.cards.get(charId)
    if (!card?.weaponId) throw new Error(`${P.roster.find(r => r.charId === charId)?.cn ?? charId} 还没选武器`)
    const artifacts = SLOTS.map(([slot]) => ({ slot, item: card.slots[slot] })).filter(({ item }) => item.setId)
      .map(({ slot, item }) => ({
        slot,
        setId: item.setId,
        level: item.level,
        main: { key: item.mainKey, value: P.tables.mainStats[item.mainKey]?.[P.tables.levels.indexOf(item.level)] ?? 0 },
        sub: item.subs.filter(sub => sub.key && sub.value).map(sub => ({ key: sub.key, value: Number(sub.value) }))
      }))
    if (!artifacts.length) throw new Error(`${P.roster.find(r => r.charId === charId)?.cn ?? charId} 还没有填圣遗物`)
    return { characterId: charId, weaponId: card.weaponId, refinement: card.refinement, artifacts }
  })
}

function debuffsNow () {
  const num = id => Number(document.getElementById(id)?.value) || 0
  return { resistanceReduction: num('panel-rr') / 100, defenseReduction: num('panel-dr') / 100, defenseIgnore: num('panel-di') / 100 }
}

function renderResult (body) {
  const box = document.getElementById('panel-result')
  if (!body.ok) {
    box.className = 'status bad'
    box.textContent = `跑不了：\n${(body.issues || []).map(issue => `· ${issue.path}：${issue.message}`).join('\n')}`
    return
  }
  const nameOf = actorId => P.roster.find(item => item.keys?.[0] === actorId)?.cn ?? actorId
  const energy = (body.energy || []).map(item => `${nameOf(item.actorId)} ${Math.round(item.end)}/${item.max}`).join(' · ')
  const rows = (body.actions || []).filter(item => item.total > 0).sort((a, b) => b.total - a.total)
  const table = rows.map(item => `<tr><td>${nameOf(item.actorId)}</td><td>${item.actionId}</td><td>${item.hits}</td><td>${Math.round(item.total).toLocaleString()}</td></tr>`).join('')
  const detail = body.detail || {}
  const list = (items, render, empty) => (items && items.length ? items.map(render).join('') : `<li>${empty}</li>`)
  const reactionRows = list(detail.reactions, item => `<li>${item.kind}：${item.hits} 段，反应贡献 ${Math.round(item.total).toLocaleString()}</li>`, '无')
  const triggerRows = list(detail.triggers, item => `<li>${item.effectId} × ${item.count}</li>`, '无')
  const resourceRows = list((detail.resources || []).filter(item => item.status !== 'ok'), item => `<li>${item.id}：${item.status}${item.message ? `（${item.message}）` : ''}</li>`, '无')
  const problemRows = list(detail.problems, item => `<li>${item.path}：${item.message}</li>`, '无')
  const stageRows = list(detail.stages, item => `<li>${item.stage}：${item.status}${item.issues ? `（${item.issues} 个问题）` : ''}</li>`, '无')
  box.className = 'status ok'
  box.innerHTML = `<div class="result-head">DPS <b>${Math.round(body.dps)}</b> · 总伤害 ${Math.round(body.dps * 120).toLocaleString()} · 暴击口径 ${body.crit === 'critical' ? '全暴击' : body.crit === 'non-critical' ? '不暴击' : '期望'}</div>` +
    `<div class="muted">结束时能量：${energy}</div>` +
    `<table class="result-table"><thead><tr><th>角色</th><th>动作</th><th>命中</th><th>伤害</th></tr></thead><tbody>${table}</tbody></table>` +
    `<details class="advanced"><summary>完整报告（口径 / 阶段 / 反应 / 触发 / 资源 / 问题）</summary>` +
    `<div class="muted">口径：${detail.target?.id ?? '—'}（Lv${detail.target?.level ?? '—'}、抗性 ${detail.target?.resistance ?? '—'}）· 版本：${detail.versions?.pack ?? '—'} / ${detail.versions?.panels ?? '—'}</div>` +
    `<div class="muted">阶段：</div><ul class="report-list">${stageRows}</ul>` +
    `<div class="muted">反应：</div><ul class="report-list">${reactionRows}</ul>` +
    `<div class="muted">触发：</div><ul class="report-list">${triggerRows}</ul>` +
    `<div class="muted">资源告警：</div><ul class="report-list">${resourceRows}</ul>` +
    `<div class="muted">问题：</div><ul class="report-list">${problemRows}</ul>` +
    `</details>`
}

async function runPanel () {
  const box = document.getElementById('panel-result')
  const team = window.__rotationState?.team ?? []
  if (!team.length) { box.className = 'status bad'; box.textContent = '先在「拼一条轴」里选好队伍'; return }
  let panels
  try { panels = panelPayload(team) } catch (err) { box.className = 'status bad'; box.textContent = err.message; return }
  box.className = 'status'
  box.textContent = '正在跑…'
  try {
    const body = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panels, rotation: window.__rotationFile, crit: document.getElementById('panel-crit')?.value })
    }).then(r => r.json())
    renderResult(body)
  } catch (err) {
    box.className = 'status bad'
    box.textContent = `请求失败：${err.message}`
  }
}

function fillExample () {
  const team = window.__rotationState?.team ?? []
  for (const charId of team) {
    const entry = P.roster.find(item => item.charId === charId)
    const card = cardOf(charId)
    const elem = entry?.element && ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'].includes(entry.element) ? entry.element : 'geo'
    const mains = { flower: 'hp', plume: 'atk', sands: 'atkPct', goblet: elem, circlet: 'cpct' }
    for (const [slot] of SLOTS) {
      card.slots[slot] = { setId: '400189', level: 20, mainKey: mains[slot], subs: [{ key: 'cdmg', value: 0.7 }, { key: 'mastery', value: 40 }, { key: '', value: '' }, { key: '', value: '' }] }
    }
  }
  renderPanel()
}

async function loadProfiles () {
  const list = document.getElementById('panel-profile-list')
  if (!list) return
  const body = await fetch('/api/profiles').then(r => r.json())
  list.innerHTML = '<option value="">载入已保存的面板…</option>' + (body.items || []).map(item => `<option value="${item.id}">${item.id}（${item.team} 人）</option>`).join('')
}

async function saveProfile () {
  const name = document.getElementById('panel-profile-name').value.trim()
  if (!name) { alert('先给面板起个名字'); return }
  const team = window.__rotationState?.team ?? []
  let panels
  try { panels = panelPayload(team) } catch (err) { alert(err.message); return }
  const body = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: { id: name, panels } })
  }).then(r => r.json())
  if (!body.ok) { alert((body.issues || []).map(issue => issue.message).join('；')); return }
  await loadProfiles()
  document.getElementById('panel-result').textContent = `面板已保存：${body.path}`
}

async function loadProfile () {
  const id = document.getElementById('panel-profile-list').value
  if (!id) return
  const body = await fetch(`/api/profile?id=${encodeURIComponent(id)}`).then(r => r.json())
  if (!body.profile) { alert('读不到这份面板'); return }
  for (const panel of body.profile.panels) {
    const card = cardOf(panel.characterId)
    card.weaponId = panel.weaponId || ''
    card.refinement = panel.refinement || 1
    card.slots = Object.fromEntries(SLOTS.map(([slot]) => [slot, { setId: '', level: 20, mainKey: defaultMain(slot), subs: [] }]))
    for (const artifact of panel.artifacts || []) {
      const levelIndex = P.tables.levels.indexOf(artifact.level)
      card.slots[artifact.slot] = {
        setId: artifact.setId,
        level: artifact.level,
        mainKey: artifact.main?.key,
        subs: (artifact.sub || []).map(sub => ({ key: sub.key, value: sub.value })).concat(Array(4).fill({ key: '', value: '' })).slice(0, 4)
      }
      void levelIndex
    }
  }
  renderPanel()
}
bootPanel().then(() => {
  document.getElementById('panel-run')?.addEventListener('click', runPanel)
  document.getElementById('panel-example')?.addEventListener('click', fillExample)
  document.getElementById('panel-profile-save')?.addEventListener('click', saveProfile)
  document.getElementById('panel-profile-load')?.addEventListener('click', loadProfile)
  loadProfiles()
})


