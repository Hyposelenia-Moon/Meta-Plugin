/**
 * 攻略数据「最后更新时间」口径（`src/model/guideDate.ts`）
 *
 * 用户 2026-10-17 定：这个时间必须是**攻略数据本身**的修改时间，
 * 不能因为 UI/图片/样式变化或 `git pull` 刷新 mtime 而变。
 * 因此实现取的是 git 里该数据文件的最后提交日期；mtime 变化必须**不影响**结果。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot } from './_helper.mjs'

const { ok, push, report } = createChecks('攻略数据更新时间（git 提交日期）')
const dataDir = path.join(pluginRoot, 'data', 'gi')
const mod = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'model', 'guideDate.js')).href)

/* ---------- 1. 正常取到 `YYYY.MM.DD` ---------- */
const date = mod.guideUpdatedDate(dataDir, '胡桃')
ok('已提交的数据文件 → 返回 YYYY.MM.DD', /^\d{4}\.\d{2}\.\d{2}$/.test(date), date)

/* ---------- 2. 与文件 mtime 解耦：动 mtime 不影响结果 ---------- */
const file = path.join(dataDir, '胡桃.json')
const before = fs.statSync(file).mtime
const next = new Date(Date.now() - 86400 * 1000)   // 昨天（与提交日期不同，便于观察）
fs.utimesSync(file, next, next)
const afterTouch = mod.guideUpdatedDate(dataDir, '胡桃')
push('改 mtime 不改日期（说明与 UI/检出时间无关）', afterTouch, date)
fs.utimesSync(file, before, before)

/* ---------- 3. 名字不存在 / 空名 → 空串（页面写「未提供」） ---------- */
push('不存在的角色 → 空串', mod.guideUpdatedDate(dataDir, '不存在的角色XYZ'), '')
push('空名字 → 空串', mod.guideUpdatedDate(dataDir, '   '), '')
push('数据目录不存在 → 空串', mod.guideUpdatedDate(path.join(dataDir, 'no-such-dir'), '胡桃'), '')

/* ---------- 4. 日期只随「数据文件」的提交变，跟模板/样式无关 ---------- */
const tplDate = mod.guideUpdatedDate(path.join(pluginRoot, 'resources', 'codex'), 'codex.html')
push('非数据文件路径不会被误当成攻略数据（codex.html 取不到数据日期）', tplDate, '')

/* ---------- 5. 数据目录结论一致：同一份数据缓存后结果稳定 ---------- */
push('连续两次调用结果一致（缓存不改变语义）',
  [mod.guideUpdatedDate(dataDir, '胡桃'), mod.guideUpdatedDate(dataDir, '胡桃')],
  [date, date])

report()
