/**
 * bossAlias — 危战首领「简写表」（2026-10-14 用户要求，手动维护）
 *
 * 榜单里的首领是全名（`resources/data/bosses.json`），但群里常用简写（如"矮灵"）。
 * 本模块读 `resources/data/boss-alias.json`：`{ "全名": ["简写1", "简写2"] }`，
 * 把用户输入解析成全名，再交给 `CharacterIndex.findBoss` 走原有逻辑（对全名完全等价，不影响等价门禁）。
 *
 * 文件缺失/格式错误一律**静默回落**（原样返回输入），不让简写表把查询带崩。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resourcesDir } from '../dir.js';
/** 简写表路径（可用 `META_BOSS_ALIAS_FILE` 覆盖；套件用它指向临时文件） */
export function bossAliasFile() {
    return process.env.META_BOSS_ALIAS_FILE
        ? path.resolve(process.env.META_BOSS_ALIAS_FILE)
        : path.join(resourcesDir, 'data', 'boss-alias.json');
}
let cache = null;
/** 简写（小写）→ 全名；读不到就是空表 */
export function loadBossAlias() {
    const file = bossAliasFile();
    if (cache && cache.file === file)
        return cache.map;
    const map = new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [full, aliases] of Object.entries(raw || {})) {
            if (full.startsWith('_'))
                continue;
            if (!Array.isArray(aliases))
                continue;
            for (const a of aliases) {
                const key = String(a || '').trim().toLowerCase();
                if (key)
                    map.set(key, full);
            }
            const self = full.trim().toLowerCase();
            if (self)
                map.set(self, full);
        }
    }
    catch { /* 没有简写表就原样透传 */ }
    cache = { file, map };
    return map;
}
/** 输入（全名或简写）→ 全名；认不出就原样返回 */
export function resolveBossName(input) {
    const text = String(input || '').trim();
    if (!text)
        return '';
    return loadBossAlias().get(text.toLowerCase()) || text;
}
/** 测试/热更新用：清掉缓存 */
export function resetBossAlias() {
    cache = null;
}
//# sourceMappingURL=bossAlias.js.map