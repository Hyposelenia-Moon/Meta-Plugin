/**
 * 同步 miao 的卡片底片到本仓库（维护期脚本，不入套件）
 *
 * 背景（2026-10-18 用户决定 A）：模块卡的底片原先直接引用 miao 的相对路径，
 * miao 缺失/改路径时纹理 404 → 卡片没有底色、浅色文字压在元素立绘上几乎不可读。
 * 现在仓库自带一份副本 `resources/common/cont/card-bg.png`，CSS 指向本地副本；
 * 本脚本用于**从 miao 拉取最新底片**，`pnpm test` 会校验两者字节一致（miao 存在时）。
 *
 * 用法：
 *   node scripts/sync-card-bg.mjs            # 从 bot 的 miao-plugin 复制覆盖
 *   node scripts/sync-card-bg.mjs --check    # 只比对，不写盘（不一致时退出码 1）
 *   META_MIAO_DIR=… node scripts/sync-card-bg.mjs   # 指定 miao resources 目录
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const localFile = path.join(root, 'resources', 'common', 'cont', 'card-bg.png')

/** miao resources 目录（与其它模块同一套候选规则） */
function miaoDirs () {
  const out = []
  if (process.env.META_MIAO_DIR) out.push(path.resolve(process.env.META_MIAO_DIR))
  const bot = process.env.META_BOT_ROOT || 'D:/Program Files/Yunzai/Yunzai'
  out.push(path.join(bot, 'plugins', 'miao-plugin', 'resources'))
  out.push(path.resolve(root, '..', 'miao-plugin', 'resources'))
  return out
}

const rel = path.join('common', 'cont', 'card-bg.png')
const srcFile = miaoDirs().map(d => path.join(d, rel)).find(f => fs.existsSync(f))
const check = process.argv.includes('--check')

if (!srcFile) {
  console.error('✗ 没找到 miao 的 card-bg.png；候选目录：\n  ' + miaoDirs().join('\n  '))
  process.exit(check ? 1 : 1)
}

const src = fs.readFileSync(srcFile)
if (check) {
  if (!fs.existsSync(localFile)) {
    console.error(`✗ 本仓库缺少副本：${path.relative(root, localFile)}`)
    process.exit(1)
  }
  const local = fs.readFileSync(localFile)
  if (!src.equals(local)) {
    console.error(`✗ 副本与 miao 不一致（miao ${src.length}B / 本地 ${local.length}B）→ 跑 node scripts/sync-card-bg.mjs`)
    process.exit(1)
  }
  console.log(`✓ 副本与 miao 一致（${local.length} 字节）`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(localFile), { recursive: true })
fs.writeFileSync(localFile, src)
console.log(`✓ 已同步 ${path.relative(root, localFile)}（${src.length} 字节，来源 ${srcFile}）`)
