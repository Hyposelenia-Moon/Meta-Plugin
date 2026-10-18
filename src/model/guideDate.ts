/**
 * 攻略数据的「最后更新时间」
 *
 * 2026-10-17 用户定：这个时间必须是**攻略数据本身**的时间，不能受 UI、图片样式、文件系统时间影响。
 *
 * 为什么不用 mtime：`git pull` / 重新克隆 / 编辑器整目录重写都会把 mtime 刷成"今天"，
 * 于是页面上的日期看着像"刚更新过"，而数据其实几个月没动（实测本机 `data/gi/*.json` 的 mtime
 * 全都是仓库检出日 2026-10-04，与各角色数据的真实修改日无关）。
 *
 * 现在的口径：**该数据文件在 git 里的最后一次提交日期**（`git log -1 --date=format:%Y.%m.%d -- <file>`）。
 * 它只随"数据文件内容被提交"而变，改模板/图片/样式都不会动它。
 *
 * 降级：不在 git 仓库里（或机器没装 git / 命令超时）→ 返回空串，页面写「未提供」，绝不猜一个日期。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** 结果缓存：键 = `文件:mtime:size`，值 = `YYYY.MM.DD` 或 '' */
const cache = new Map<string, string>()

/** HEAD sha 缓存：`{ at, sha }`，2 秒 TTL（一次渲染里多次取日期不会重复起 git 进程） */
let headMemo: { at: number, sha: string } = { at: 0, sha: '' }

/** 仓库当前 HEAD（取不到返回空串；2 秒内复用上次结果） */
function headSha (repoRoot: string): string {
  const now = Date.now()
  if (headMemo.sha && now - headMemo.at < 2000) return headMemo.sha
  let sha = ''
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    })
    sha = String(out || '').trim()
  } catch {
    sha = ''
  }
  headMemo = { at: now, sha }
  return sha
}
/** 校验 git 输出的日期格式；不合法返回空串 */
function normalizeDate (raw: string): string {
  const text = String(raw || '').trim()
  return /^\d{4}\.\d{2}\.\d{2}$/.test(text) ? text : ''
}

/**
 * 取某个指南数据文件的「最后提交日期」
 *
 * @param dataDir 数据目录（`<插件>/data/gi`）
 * @param name 角色名（文件名去掉 `.json`）
 * @returns `YYYY.MM.DD`；不在 git 里 / 取不到返回 ''
 */
export function guideUpdatedDate (dataDir: string, name: string): string {
  const key = String(name || '').trim()
  if (!key) return ''
  const file = path.join(dataDir, `${key}.json`)

  let stamp = 'missing'
  try {
    const st = fs.statSync(file)
    stamp = `${st.mtimeMs}:${st.size}`
  } catch {
    return ''
  }
  /*
   * 缓存键 = 文件戳 + **仓库 HEAD**（2026-10-17 复审修复）。
   *
   * 只带 mtime/size 不够：正常流程是「存草稿 → 预览（缓存住上次提交日）→ 提交该 JSON → 再预览」，
   * 而 `git commit` **不改** 工作树文件的 mtime/size → 命中旧缓存，日期永远停在提交前。
   * 把 HEAD 纳入键：一提交 HEAD 就变 → 自动重算。未提交的改动仍显示上次提交日期（有意为之）。
   */
  const head = headSha(path.resolve(dataDir, '..', '..'))
  const key2 = `${file}:${stamp}:${head}`
  const hit = cache.get(key2)
  if (hit !== undefined) return hit

  let date = ''
  try {
    const repoRoot = path.resolve(dataDir, '..', '..')   // data/gi → 插件根
    const rel = path.relative(repoRoot, file).replace(/\\/g, '/')
    const out = execFileSync('git', [
      '-C', repoRoot,
      'log', '-1',
      '--format=%cd',
      '--date=format:%Y.%m.%d',
      '--', rel
    ], { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    date = normalizeDate(out)
  } catch {
    date = ''
  }
  cache.set(key2, date)   // 2026-10-18 复审修复：写入键必须与读取键一致（否则永不命中、每次都跑 git log）
  return date
}
