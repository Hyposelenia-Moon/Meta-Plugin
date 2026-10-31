import { validateActionSpec } from './timeline.js';
import { validateEffects } from './effects.js';
/** 校验数据包：结构、版本、动作 id 与键一致、每个动作各自合法。 */
export function validateDataPack(input) {
    const issues = [];
    const add = (code, path, message) => issues.push({ code, path, message });
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'pack', message: '数据包必须是对象' }] };
    }
    const pack = input;
    if (pack.schemaVersion !== 1)
        add('version-mismatch', 'pack.schemaVersion', `不支持的包版本 ${String(pack.schemaVersion)}，当前只认 1`);
    for (const key of ['gameVersion', 'source']) {
        const value = pack[key];
        if (value === undefined)
            add('missing', `pack.${key}`, '必须显式标注版本与出处');
        else if (typeof value !== 'string' || !value.trim())
            add('invalid', `pack.${key}`, '必须是非空字符串');
    }
    const actions = pack.actions;
    const effects = pack.effects;
    issues.push(...validateEffects(effects));
    const effectIds = new Set(effects && typeof effects === 'object' && !Array.isArray(effects) ? Object.keys(effects) : []);
    if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
        add(actions === undefined ? 'missing' : 'invalid', 'pack.actions', '必须提供动作表');
    }
    else if (!Object.keys(actions).length) {
        add('invalid', 'pack.actions', '空动作表不能冒充可用数据包');
    }
    else {
        for (const [key, action] of Object.entries(actions)) {
            if (!key.trim()) {
                add('invalid', 'actions.', '动作键不能是空字符串，否则报错路径与引用都指向同一处');
                continue;
            }
            if (!action || typeof action !== 'object') {
                add('invalid', `actions.${key}`, '动作必须是对象');
                continue;
            }
            if (action.id !== key)
                add('invalid', `actions.${key}.id`, `动作 id 必须与键一致，收到 ${String(action.id)}`);
            issues.push(...validateActionSpec(action));
            // 触发标记必须在效果表里有对应条目：否则要么数据写错，要么机制没实现，两种都不该静默放过。
            const hits = Array.isArray(action.hits) ? action.hits : [];
            hits.forEach((hit, i) => {
                const triggerIds = Array.isArray(hit?.triggerIds) ? hit.triggerIds : [];
                triggerIds.forEach((triggerId, j) => {
                    // 空串与非字符串已经由结构校验判 invalid，这里只判「写了 id 但表里没有」。
                    if (typeof triggerId === 'string' && triggerId.trim() && !effectIds.has(triggerId))
                        add('unsupported', `actions.${key}.hits.${i}.triggerIds.${j}`, `触发标记 ${triggerId} 在 effects 表里没有登记，无法兑现`);
                });
            });
        }
    }
    if (issues.length) {
        const status = issues.some(i => i.code === 'version-mismatch') ? 'version-mismatch' : issues.some(i => i.code === 'unsupported') ? 'unsupported' : issues.some(i => i.code === 'invalid') ? 'invalid' : 'incomplete';
        return { status, issues };
    }
    return { status: 'ok', pack: pack, issues: [] };
}
//# sourceMappingURL=dataPack.js.map