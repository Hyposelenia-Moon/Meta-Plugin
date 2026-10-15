/**
 * 练度评分：攻略目标分桶与口径一致性（2026-10-15 外部复核第 3、6 项）—— **行为层**
 *
 * 复核点：
 *  1. 圣遗物目标必须按**结构化 `kind`** 分桶（`preferred`/`optional`/…），
 *     只认「推荐/可选」字面量会漏掉自定义标签（如哥伦比娅的「月结晶/月感电」「月绽放」）→ 目标为空；
 *  2. 组合候选 `冲浪时光\真语秘匣\万世流涌大典`：评分能命中、比较表却严格 `includes` → 自相矛盾；
 *  3. 已穿推荐 4 件套时不该再建议"凑四件套"，低分应归因到词条质量。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot } from './_helper.mjs'

const { ok, report } = createChecks('练度：攻略目标与口径（行为）')

const g = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'modules', 'grade.js')).href)
const { extractTargets, buildCompareRows, gradeBuild, matchesGuideName } = g

/** 哥伦比娅攻略的最小重现（与 `data/gi/哥伦比娅.json` 同形状） */
const guide = {
  schema: 2,
  name: '哥伦比娅',
  game: 'gi',
  v2: {
    artifacts: [
      { kind: 'preferred', label: '月结晶/月感电', sets: [{ name: '晨星与月的晓歌' }] },
      { kind: 'main', stats: { 时之沙: ['充能效率', '生命值'], 空之杯: ['生命值'], 理之冠: ['暴击伤害', '暴击率'] } },
      { kind: 'sub', stats: ['暴击率', '暴击伤害', '大生命', '充能'] },
      { kind: 'preferred', label: '月绽放', sets: [{ name: '纺月的夜歌' }] }
    ],
    weapons: [
      { label: '推荐', items: [{ name: '帷间夜曲' }, { name: '冲浪时光\\真语秘匣\\万世流涌大典' }] },
      { label: '可选', items: [{ name: '霜辰' }] }
    ]
  }
}

// 视图用**真实构建器**产出（武器目标走显示层的「推荐/可选」行）
const { buildV2Sections } = await import(pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'v2-sections.mjs')).href)
const emptyView = { metaRows: [], sections: buildV2Sections(guide) }

// ---------- ① 自定义标签也进目标 ----------
{
  const t = extractTargets(emptyView, '哥伦比娅', guide)
  ok('① `kind: preferred` 的自定义标签两条都进推荐桶', t.artifact.recommend.join(',') === '晨星与月的晓歌,纺月的夜歌')
  ok('① `kind: main` 的 stats 进主词条目标（三个部位）', t.mainStats.length === 3 && t.mainStats[0].options.includes('充能效率'))
  ok('① `kind: sub` 的副词条不进主词条目标', !JSON.stringify(t.mainStats).includes('大生命'))
}

// ---------- ② 没有结构化数据时退回标签口径 ----------
{
  const view = {
    metaRows: [],
    sections: [{
      title: '圣遗物',
      rows: [
        { label: '推荐', items: [{ text: '绝缘之旗印' }] },
        { label: '可选', items: [{ text: '追忆之注连' }] }
      ]
    }]
  }
  const t = extractTargets(view, 'X')
  ok('② 无结构化数据时仍按「推荐/可选」标签分桶', t.artifact.recommend[0] === '绝缘之旗印' && t.artifact.optional[0] === '追忆之注连')
}

// ---------- ③ 组合候选：评分与比较表同口径 ----------
{
  const t = extractTargets(emptyView, '哥伦比娅', guide)
  ok('③ 组合项按 `\\` 拆开逐项匹配', matchesGuideName('真语秘匣', t.weapon.recommend) === true)
  ok('③ 不相关武器仍不命中', matchesGuideName('以理服人', t.weapon.recommend) === false)
  const build = {
    charName: '哥伦比娅', level: 90, cons: 0,
    weapon: { name: '真语秘匣', affix: 1 },
    talent: { A: 1, E: 10, Q: 10 },
    artis: [], artiMark: null, attrs: {}
  }
  const row = buildCompareRows(t, build).find(r => r.group === '武器')
  ok('③ 比较表不再把已命中的武器标成"无数据"', row?.verdict === 'ok')
}

// ---------- ④ 套装已达标时不再建议"凑四件套" ----------
{
  const t = extractTargets(emptyView, '哥伦比娅', guide)
  const build = {
    charName: '哥伦比娅', level: 90, cons: 0,
    weapon: { name: '帷间夜曲', affix: 1 },
    talent: { A: 1, E: 10, Q: 10 },
    artis: Array.from({ length: 5 }, () => ({ slot: '生之花', set: '晨星与月的晓歌', mainName: '生命值', level: 20 })),
    artiMark: { total: 60, markClass: 'D' },
    attrs: {}
  }
  const text = gradeBuild(t, build, {}).suggestions.join('\n')
  ok('④ 不出现"凑「…」4 件"', !/凑「.+」4 件/.test(text))
  ok('④ 低分归因到词条质量', /提升有效词条/.test(text))
}

const bad = report()
process.exit(bad ? 1 : 0)
