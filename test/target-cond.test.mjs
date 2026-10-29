/**
 * 攻略目标的条件标注套件（2026-10-15 真机反馈：6 命玩家戴生命头被判"未达标"）
 *
 * 现场：哥伦比娅攻略写 `理之冠：暴击伤害 / 暴击率 / 生命值（二命）`，
 * 玩家 6 命戴着生命头，差距证据却回 `生命值 → 暴击伤害 / 暴击率 / 生命值〔二命〕（未达标）`——
 * 因为比对用的是**带标注的原文**，`生命值` 永远匹配不上 `生命值（二命）`，命座门槛也被忽略。
 *
 * 本套件钉两件事：
 *   1. `parseCondMark()` 把全库出现过的六种标注形态都解析对（数值门槛 / 判不出的条件 / 纯说明）；
 *   2. 判定口径在全库攻略上成立：条件项按玩家命座判、建议与对比行同源、面板目标按属性去重。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot } from './_helper.mjs'

const { push, ok, report } = createChecks('攻略目标条件标注（含全库巡检）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const G = await load('modules/grade.js')
const SV = await load('modules/subViews.js')
const { CodexStore } = await load('model/CodexStore.js')
const { listGuidePresets, selectGuidePreset } = await load('modules/guidePresets.js')
const projectGuide = (guide, id) => {
  const presets = listGuidePresets(guide)
  const selected = id ? presets.find(p => p.id === id) : presets.length === 1 ? presets[0] : null
  if (!selected) throw new Error('测试必须明确选择独立攻略预设：' + guide.name)
  return selectGuidePreset(guide, selected)
}

// ---------- 1. 标注解析（全库实测形态逐个过） ----------
{
  const cases = [
    ['生命值（二命）', { name: '生命值', consMin: 2 }],
    ['水元素伤害加成（二命）', { name: '水元素伤害加成', consMin: 2 }],
    ['元素精通（高命）', { name: '元素精通', vague: '高命' }],
    ['元素充能效率：130%以上（4 命）', { name: '元素充能效率：130%以上', consMin: 4 }],
    ['元素充能效率：185%（满命）', { name: '元素充能效率：185%', consMin: 6 }],
    ['约 7.2%~7.8%（随命座）', { name: '约 7.2%~7.8%', vague: '随命座' }],
    // ⚠ `6%` 不能被当成"六命"（旅行者·水的六命说明）
    ['拾取源水之滴时额外治疗血量最低的角色（按其生命上限 6%）', { name: '拾取源水之滴时额外治疗血量最低的角色', note: '按其生命上限 6%' }],
    ['生命值〔二命〕', { name: '生命值', consMin: 2 }],
    ['暴击率', { name: '暴击率' }],
    ['六命专用武器', { name: '六命专用武器' }]
  ]
  for (const [raw, want] of cases) {
    const got = G.parseCondMark(raw)
    ok(`标注解析：${raw}`, got.name === want.name &&
      got.consMin === want.consMin && got.vague === want.vague && got.note === want.note,
      JSON.stringify(got))
  }
  ok('条件判定：没有门槛/判不出 → 视为满足（不惩罚玩家）',
    G.condSatisfied({ name: 'x' }, 0) === true && G.condSatisfied({ name: 'x', vague: '高命' }, 0) === true)
  ok('条件判定：二命门槛在 C6 满足、C0 不满足',
    G.condSatisfied({ name: 'x', consMin: 2 }, 6) === true && G.condSatisfied({ name: 'x', consMin: 2 }, 0) === false)
}

// ---------- 2. 真机现场复现（哥伦比娅 理之冠 生命头） ----------
{
  const store = new CodexStore()
  const guide = projectGuide(store.getGuide('哥伦比娅'), 'dps')
  ok('拿到哥伦比娅攻略', !!guide)
  const view = SV.buildCodexView(guide, { signature: store.getSignature('哥伦比娅'), weaponTags: store.getWeaponTags() })
  const targets = G.extractTargets(view, '哥伦比娅', guide)

  const crown = targets.mainStats.find(t => t.slot === '理之冠')
  ok('理之冠的目标项解析出条件项（生命值 需二命）',
    !!crown && crown.options.some(o => o.includes('生命值')) &&
    crown.optionViews.some(v => v.name === '生命值' && v.consMin === 2) &&
    crown.optionViews.every(v => !/[（(]/.test(v.name)),
    JSON.stringify(crown?.optionViews))

  const buildOf = (cons) => ({
    charName: '哥伦比娅',
    level: 100,
    cons,
    weapon: { name: targets.weapon.recommend[0], affix: 1 },
    talent: { A: 10, E: 10, Q: 10 },
    artis: [
      { slot: '生之花', set: targets.artifact.recommend[0], mainName: '生命值', level: 20 },
      { slot: '死之羽', set: targets.artifact.recommend[0], mainName: '攻击力', level: 20 },
      { slot: '时之沙', set: targets.artifact.recommend[0], mainName: '元素充能效率', level: 20 },
      { slot: '空之杯', set: targets.artifact.recommend[0], mainName: '生命值', level: 20 },
      { slot: '理之冠', set: targets.artifact.recommend[0], mainName: '生命值', level: 20 }
    ],
    artiMark: { total: 239.5, markClass: 'SSS' },
    attrs: { cpct: 65.8, cdmg: 234.6, hp: 47268, recharge: 129.2 },
    hasWeapon: true,
    hasTalent: true,
    hasMark: true
  })

  const rowOf = (cons) => G.gradeBuild(targets, buildOf(cons)).rows.find(r => r.id === 'artifact:main:理之冠')
  ok('6 命戴生命头 → 达标（用户现场：修前判未达标）', rowOf(6)?.verdict === 'ok', JSON.stringify(rowOf(6)))
  ok('2 命戴生命头 → 达标（刚好满足门槛）', rowOf(2)?.verdict === 'ok')
  ok('0 命戴生命头 → 未达标（条件项确实起作用，不是一律放过）', rowOf(0)?.verdict === 'warn')

  const sugOf = (cons) => G.gradeBuild(targets, buildOf(cons)).suggestionRows.map(s => s.text).join('\n')
  ok('6 命不再被建议"理之冠换生命值以外的头"', !/理之冠/.test(sugOf(6)), sugOf(6))
  ok('0 命仍会被建议换头（建议与对比行同源）', /理之冠/.test(sugOf(0)), sugOf(0))

  ok('面板目标按属性去重（生命值 只留一条）',
    targets.panel.filter(t => t.name === '生命值').length === 1,
    JSON.stringify(targets.panel.map(t => `${t.name}:${t.min}~${t.max}`)))

  /*
   * 审核 4.3：方向是目标的一部分，不能丢 —— 原来"输出向 生命值 35000"与"辅助向 生命值 35000"
   * 被压成两条同名目标（参考区重复）。现在跨方向同值合并成一条并保留方向列表。
   */
  {
    const hp = targets.panel.find(t => t.name === '生命值')
    const supportGuide = projectGuide(store.getGuide('哥伦比娅'), 'support')
    const supportTargets = G.extractTargets(SV.buildCodexView(supportGuide), '哥伦比娅', supportGuide)
    const supportHp = supportTargets.panel.find(t => t.name === '生命值')
    ok('输出/辅助同值目标保留在独立预设，不跨预设合并',
      !!hp && hp.groups.join('/') === '输出向' && supportHp?.groups.join('/') === '辅助向', JSON.stringify([hp?.groups, supportHp?.groups]))
    const cpct = targets.panel.find(t => t.name === '暴击率')
    ok('单方向目标带自己的方向', !!cpct && cpct.groups.join('/') === '输出向')
    ok('百分比目标带 percent 标记（当前值要补 %）', cpct?.percent === true && hp?.percent === false)

    // 参考行的稳定键与单位（审核 4.3：列语义"当前 / 参考目标"，百分比带 %）
    const rows = G.gradeBuild(targets, buildOf(6)).rows
    const hpRow = rows.find(r => r.id?.startsWith('panel:') && r.name === '生命值')
    const cpctRow = rows.find(r => r.id?.startsWith('panel:') && r.name === '暴击率')
    ok('参考行稳定键含方向',
      hpRow?.id === 'panel:输出向:hp' && cpctRow?.id === 'panel:输出向:cpct',
      `${hpRow?.id} / ${cpctRow?.id}`)
    ok('参考行按方向分组', hpRow?.group === '输出向' && cpctRow?.group === '输出向')
    ok('百分比参考行两侧都带 %',
      cpctRow?.actual.endsWith('%') === true && cpctRow?.target.endsWith('%') === true,
      `${cpctRow?.actual} → ${cpctRow?.target}`)
    ok('非百分比参考行不带 %', hpRow?.actual.endsWith('%') !== true && hpRow?.target.endsWith('%') !== true)
  }
}

// ---------- 3. 面板目标的条件标注与去重（行秋 185% 满命） ----------
{
  const store = new CodexStore()
  const guide = projectGuide(store.getGuide('行秋'))
  const view = SV.buildCodexView(guide, { signature: store.getSignature('行秋'), weaponTags: store.getWeaponTags() })
  const targets = G.extractTargets(view, '行秋', guide)
  const recharge = targets.panel.find(t => t.name === '元素充能效率')
  ok('条件型面板目标带上命座门槛（行秋 185% 需满命）',
    recharge?.cond?.consMin === 6 && recharge.min === 185, JSON.stringify(recharge))
}

// ---------- 4. 全库巡检：所有攻略的条件标注都被解析、名字里不留括号 ----------
{
  const store = new CodexStore()
  const dir = path.join(pluginRoot, 'data', 'gi')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  const problems = []
  const marks = { 命座门槛: 0, 判不出: 0, 说明: 0, 面板条件: 0 }
  let optionTotal = 0
  for (const f of files) {
    const name = f.replace(/\.json$/, '')
    const guide = store.getGuide(name)
    if (!guide) continue
    for (const preset of listGuidePresets(guide)) {
    const projected = selectGuidePreset(guide, preset)
    const view = SV.buildCodexView(projected, { signature: store.getSignature(name), weaponTags: store.getWeaponTags() })
    const targets = G.extractTargets(view, name, projected)
    for (const t of targets.mainStats) {
      for (const v of t.optionViews) {
        optionTotal++
        if (/[（(]/.test(v.name)) problems.push(`${name} ${t.slot} 名字残留括号：${v.name}（原文 ${JSON.stringify(t.options)}）`)
        if (v.consMin) marks.命座门槛++
        else if (v.vague) marks.判不出++
        else if (v.note) marks.说明++
      }
    }
    for (const p of targets.panel) if (p.cond?.consMin || p.cond?.vague) marks.面板条件++
    }
  }
  push('全库巡检：主词条候选名不含条件标注残留', problems, [])
  ok('全库巡检：条件标注确实存在（样本量不为 0）',
    marks.命座门槛 + marks.判不出 + marks.说明 + marks.面板条件 > 0)
  console.log(`     全库：${files.length} 份攻略 / 主词条候选 ${optionTotal} 项 → 命座门槛 ${marks.命座门槛}、` +
    `判不出 ${marks.判不出}、纯说明 ${marks.说明}、条件型面板目标 ${marks.面板条件}`)
}

// ---------- 5. 命座条件不满足：计分与证据行必须同时跳过（2026-10-27 复审 新 P2） ----------
{
  const { CodexStore } = await load('model/CodexStore.js')
  const store = new CodexStore()
  const guide = projectGuide(store.getGuide('行秋'))
  const SV = await load('modules/subViews.js')
  const view = SV.buildCodexView(guide, { signature: store.getSignature('行秋'), weaponTags: store.getWeaponTags() })
  const targets = G.extractTargets(view, '行秋', guide)
  const rule = G.normalizeGradeRule('support')
  const buildFor = (cons) => ({
    charName: '行秋', level: 90, cons,
    weapon: { name: '祭礼剑', affix: 1 },
    talent: { A: 1, E: 1, Q: 10 },
    artis: [], artiMark: null,
    attrs: { cpct: 70, cdmg: 140, atk: 1600, recharge: 100 }
  })
  for (const cons of [0, 6]) {
    const r = G.gradeBuild(targets, buildFor(cons), { rule, ruleName: 'support' })
    const row = r.rows.find(x => x.id === 'panel:参考:recharge')
    ok(`C${cons}：条件型面板行保留条件标注`, !!row && String(row.target).includes('满命'), String(row?.target))
    if (cons === 0) {
      ok('C0：命座不足的目标降级为参考行（verdict=info）', row?.verdict === 'info', String(row?.verdict))
      ok('C0：不会出现该目标的未达标证据行',
        !r.rows.some(x => String(x.id || '').startsWith('panel:') && x.verdict === 'warn'))
    } else {
      ok('C6：条件满足后正常参与判定（100% < 185% → warn）', row?.verdict === 'warn', String(row?.verdict))
    }
  }
}

const bad = report()
process.exit(bad ? 1 : 0)
