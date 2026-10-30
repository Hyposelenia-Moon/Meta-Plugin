/**
 * 练度文本回退的「差在哪」判定（2026-10-27 复审 R2）
 *
 * 复验口径：**对比行里没有 warn ≠ 全部达标**。
 * dps 规则下 SSS/SS 词条会让综合维度 below，但 rows 里的词条评分行、套装行都是 ok，
 * 于是"差在哪"曾经只写「全部达标」，而同一条回复又给「提升词条」建议。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { push, ok, report } = createChecks('练度文本回退（差在哪）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const { gradeText } = await load('modules/gradeText.js')

const dim = (key, label, ratio, state, weight = 0) => ({ key, label, ratio, weight, detail: '', state })
const makeResult = (dims, extra = {}) => ({
  charName: '胡桃',
  total: 88,
  rank: 'SSS',
  dims,
  panelTier: '大毕业',
  rows: [],
  suggestions: ['圣遗物：提升有效词条至 ACE（暴击 / 爆伤 / 攻击等）'],
  suggestionRows: [],
  assessable: true,
  notes: [],
  ...extra
})

// ---------- 1. 维度 below 但没有未达标行（R2 现场） ----------
{
  const result = makeResult([
    dim('comprehensive', '综合', 0.92, 'below', 0.65),
    dim('weapon', '武器', 1, 'met', 0.2),
    dim('talent', '天赋', 1, 'met', 0.15)
  ])
  const text = gradeText(result, [], '武器 护摩之杖')
  ok('综合 92% below 时不再写「全部达标」', !text.includes('全部达标'), text)
  ok('差在哪写出维度级未达标（综合 92%）', /综合 92% 未达标/.test(text), text)
  ok('建议仍保留（提升词条）', text.includes('提升有效词条'))
}

// ---------- 2. 维度 unknown（缺评分）时不能与「全部达标」并列 ----------
{
  const result = makeResult([
    dim('comprehensive', '综合', null, 'unknown'),
    dim('weapon', '武器', 1, 'met', 0.2)
  ], { assessable: false, suggestions: ['数据不全：先补上缺失的装备 / 圣遗物信息再评估，暂不判定达标'] })
  const text = gradeText(result, [], '')
  ok('未知维度写「数据不全」而不是「全部达标」',
    text.includes('数据不全') && !text.includes('全部达标'), text)
}

// ---------- 3. 真·全部达标 ----------
{
  const result = makeResult([
    dim('comprehensive', '综合', 1, 'met', 0.65),
    dim('weapon', '武器', 1, 'met', 0.2),
    dim('talent', '天赋', 1, 'met', 0.15)
  ], { suggestions: ['各维度均已达标'] })
  const text = gradeText(result, [], '')
  ok('三维全 met 时仍写「全部达标」', text.includes('全部达标'), text)
}

// ---------- 4. 有未达标行时按行展示（不重复维度行） ----------
{
  const result = makeResult([
    dim('comprehensive', '综合', 0.9, 'below', 0.65)
  ])
  const miss = [{ id: 'talent:Q', group: '天赋', name: 'Q', target: '10', actual: '7', verdict: 'warn' }]
  const text = gradeText(result, miss, '')
  ok('有未达标行时优先列行明细', text.includes('天赋 Q') && text.includes('7 → 10'), text)
  ok('有行明细时不追加维度行', !text.includes('综合 90% 未达标'), text)
}

const bad = report()
process.exit(bad ? 1 : 0)
