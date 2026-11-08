/**
 * 黄金集读取 —— 发布闸门要吃的「期望值 vs 实跑值」两份文件。
 *
 * 文件位置固定在 `data/team-sim/golden/`：
 *   - `cases.json`：手算用例（期望值 + 推导），**入库**；
 *   - `actuals.json`：`scripts/audit-golden.mjs` 从同一批用例重算的实跑值，**入库**。
 *
 * 读不到或是坏数据时返回 `undefined`：闸门会照常给出「证据不足」，而不是拿半份数据冒充达标。
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../dir.js';
const goldenDir = path.join(dataDir, 'team-sim', 'golden');
const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return undefined;
    }
};
const asArray = (value, key) => {
    if (Array.isArray(value))
        return value;
    const nested = value && typeof value === 'object' ? value[key] : undefined;
    return Array.isArray(nested) ? nested : [];
};
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
/** 只做结构校验：字段不对就整份丢弃，避免把「看起来像黄金集」的脏数据喂给闸门。 */
const toCases = (value) => {
    const items = asArray(value, 'cases');
    if (!items.length)
        return undefined;
    const cases = [];
    for (const item of items) {
        const entry = item;
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim())
            return undefined;
        if (typeof entry.source !== 'string' || !entry.source.trim())
            return undefined;
        if (!entry.expected || !isFiniteNumber(entry.expected.total) || entry.expected.total <= 0)
            return undefined;
        cases.push(entry);
    }
    return cases;
};
const toActuals = (value) => {
    const items = asArray(value, 'actuals');
    if (!items.length)
        return undefined;
    const actuals = [];
    for (const item of items) {
        const entry = item;
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim())
            return undefined;
        if (!isFiniteNumber(entry.total))
            return undefined;
        actuals.push({ id: entry.id, total: entry.total });
    }
    return actuals;
};
/** 读取黄金集；缺文件或结构不合法时返回 `undefined`（闸门据此判「证据不足」）。 */
export function loadGoldenSet() {
    const cases = toCases(readJson(path.join(goldenDir, 'cases.json')));
    const actuals = toActuals(readJson(path.join(goldenDir, 'actuals.json')));
    if (!cases || !actuals)
        return undefined;
    return { cases, actuals };
}
//# sourceMappingURL=GoldenSet.js.map