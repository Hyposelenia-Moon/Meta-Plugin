/**
 * 月相（初辉 / 满辉）派生
 *
 * 口径（2026-11-08 查证，见 `data/team-sim/moon-characters.json` 的 `source`）：
 *  - 队伍中编入 1 位月兆角色 → 初辉（`initial`）；2 位及以上 → 满辉（`full`）；
 *  - 没有月兆角色时不进入任何档位，条件效果一律不生效。
 *
 * 名单只读 `data/team-sim/moon-characters.json`，由 `scripts/build-moon-characters.mjs` 生成。
 * 满辉下「非月兆角色施放元素战技/爆发，全队月曜反应伤害提升（20 秒，最高 36%）」尚未建模。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../dir.js'

export type MoonPhase = 'initial' | 'full'

const moonFile = path.join(dataDir, 'team-sim', 'moon-characters.json')

let cachedIds: Set<string> | null = null

/** 月兆角色名单；文件缺失时返回空集合（等于「全队都不是月兆角色」）。 */
export function moonCharacterIds (): Set<string> {
  if (cachedIds) return cachedIds
  try {
    const raw = JSON.parse(fs.readFileSync(moonFile, 'utf8').replace(/^\uFEFF/, ''))
    const list = Array.isArray(raw?.characters) ? raw.characters : []
    cachedIds = new Set(list.map((entry: { charId?: string }) => String(entry.charId ?? '')).filter(Boolean))
  } catch {
    cachedIds = new Set()
  }
  return cachedIds
}

/** 按队伍成员的角色 id 派生月相：1 → initial，≥2 → full，0 → undefined。 */
export function deriveMoonPhase (charIds: readonly string[], ids: Set<string> = moonCharacterIds()): MoonPhase | undefined {
  let moonCount = 0
  for (const id of new Set(charIds.map((value) => String(value)))) {
    if (ids.has(id)) moonCount++
  }
  if (moonCount >= 2) return 'full'
  if (moonCount === 1) return 'initial'
  return undefined
}
