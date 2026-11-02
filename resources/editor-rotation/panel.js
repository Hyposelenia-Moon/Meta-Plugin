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

bootPanel()


