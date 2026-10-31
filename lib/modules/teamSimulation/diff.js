const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const join = (base, key) => (base ? `${base}.${key}` : String(key));
const short = (value) => {
    if (value === undefined)
        return '（未设置）';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null)
        return String(value);
    if (Array.isArray(value))
        return `[${value.length} 项]`;
    return '{…}';
};
/** 深度比较：对象按键、数组按下标，原始值不等即一条。路径用点号，数组下标也是数字段。 */
export function diffValues(before, after, path = '') {
    if (isObject(before) && isObject(after)) {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
        const entries = [];
        for (const key of keys) {
            const hasBefore = Object.hasOwn(before, key);
            const hasAfter = Object.hasOwn(after, key);
            if (!hasBefore) {
                entries.push({ path: join(path, key), kind: 'added', after: after[key] });
                continue;
            }
            if (!hasAfter) {
                entries.push({ path: join(path, key), kind: 'removed', before: before[key] });
                continue;
            }
            entries.push(...diffValues(before[key], after[key], join(path, key)));
        }
        return entries;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
        const entries = [];
        const length = Math.max(before.length, after.length);
        for (let index = 0; index < length; index += 1) {
            const at = join(path, index);
            if (index >= before.length) {
                entries.push({ path: at, kind: 'added', after: after[index] });
                continue;
            }
            if (index >= after.length) {
                entries.push({ path: at, kind: 'removed', before: before[index] });
                continue;
            }
            entries.push(...diffValues(before[index], after[index], at));
        }
        return entries;
    }
    if (Object.is(before, after))
        return [];
    if (before === undefined)
        return [{ path, kind: 'added', after }];
    if (after === undefined)
        return [{ path, kind: 'removed', before }];
    return [{ path, kind: 'changed', before, after }];
}
const keysOf = (table) => (isObject(table) ? Object.keys(table).sort() : []);
/** 按表比对键集合；动作 id 本身带点号，所以不能靠路径字符串切分判断表级增删。 */
const tableChange = (before, after) => {
    const beforeTable = isObject(before) ? before : {};
    const afterTable = isObject(after) ? after : {};
    const added = keysOf(afterTable).filter(key => !Object.hasOwn(beforeTable, key));
    const removed = keysOf(beforeTable).filter(key => !Object.hasOwn(afterTable, key));
    const changed = keysOf(afterTable).filter(key => Object.hasOwn(beforeTable, key) && diffValues(beforeTable[key], afterTable[key]).length > 0);
    return { added, removed, changed };
};
/**
 * 数据包差异：按 `actions` / `effects` 两张表分别归并，再按整包报一次版本与 schema。
 * 条目本身不做去重削减——同一动作有多处改动就是多条，方便逐条核对。
 */
export function diffPacks(before, after) {
    const entries = diffValues(before, after);
    const actions = tableChange(before?.actions, after?.actions);
    const effects = tableChange(before?.effects, after?.effects);
    return {
        summary: {
            schemaChanged: before?.schemaVersion !== after?.schemaVersion,
            versionChanged: before?.gameVersion !== after?.gameVersion,
            actionsAdded: actions.added,
            actionsRemoved: actions.removed,
            actionsChanged: actions.changed,
            effectsAdded: effects.added,
            effectsRemoved: effects.removed,
            effectsChanged: effects.changed
        },
        entries
    };
}
/** 轴差异：步骤增删按数量统计，越界的下标算增/删，不做「第几步被挪走」的推断。 */
export function diffRotations(before, after) {
    const entries = diffValues(before, after);
    let stepsAdded = 0;
    let stepsRemoved = 0;
    let stepsChanged = 0;
    for (const entry of entries) {
        const parts = entry.path.split('.');
        if (parts[0] !== 'steps')
            continue;
        if (parts.length === 2 && entry.kind === 'added')
            stepsAdded += 1;
        else if (parts.length === 2 && entry.kind === 'removed')
            stepsRemoved += 1;
        else
            stepsChanged += 1;
    }
    return {
        summary: {
            tierChanged: before?.frameTier?.id !== after?.frameTier?.id,
            windowChanged: before?.measurementEndFrame !== after?.measurementEndFrame,
            schedulerChanged: before?.scheduler !== after?.scheduler,
            stepsAdded,
            stepsRemoved,
            stepsChanged,
            actorsChanged: JSON.stringify(before?.actors) !== JSON.stringify(after?.actors)
        },
        entries
    };
}
/** 逐条排成文本；超出 `limit` 只报总数，不静默截断。 */
export function formatDiff(entries, limit = 40) {
    const lines = entries.slice(0, limit).map(entry => {
        if (entry.kind === 'added')
            return `+ ${entry.path} = ${short(entry.after)}`;
        if (entry.kind === 'removed')
            return `- ${entry.path}（原 ${short(entry.before)}）`;
        return `~ ${entry.path}: ${short(entry.before)} → ${short(entry.after)}`;
    });
    if (entries.length > limit)
        lines.push(`…另有 ${entries.length - limit} 条改动未列出`);
    return lines;
}
//# sourceMappingURL=diff.js.map