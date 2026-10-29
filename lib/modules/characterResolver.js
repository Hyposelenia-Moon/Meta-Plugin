/** 攻略与练度共用角色解析；标准集合裁决双向别名，歧义不取第一项。 */
import { atlasRes } from '../model/AtlasRes.js';
import { codexStore } from '../model/CodexStore.js';
import { miaoRes } from '../model/MiaoRes.js';
const normalize = (text) => String(text ?? '').replace(/\s+/g, '').toLowerCase();
const resultOf = (candidates) => ({ name: candidates.length === 1 ? candidates[0] : null, candidates });
/** 可注入源便于离线契约测试；所有匹配都是字面量，不将用户输入用作正则。 */
export async function matchCharacter(keyword, sources) {
    const key = normalize(keyword);
    if (!key)
        return resultOf([]);
    const names = [...new Set(sources.names)];
    const exact = names.filter(name => normalize(name) === key);
    if (exact.length)
        return resultOf(exact);
    try {
        const aliases = new Set((await sources.atlas(keyword)).map(normalize));
        const hits = names.filter(name => aliases.has(normalize(name)));
        if (hits.length)
            return resultOf(hits);
    }
    catch { /* Atlas 可选，失败回落 miao / 数据 */ }
    try {
        const table = sources.miaoAliases();
        const hits = names.filter(name => Object.entries(table).some(([canonical, aliases]) => normalize(canonical) === normalize(name) &&
            [canonical, ...String(aliases ?? '').split(/[,，、]/)].some(alias => normalize(alias) === key)));
        if (hits.length)
            return resultOf(hits);
    }
    catch { /* miao 缺失仍可按标准名与唯一包含查询 */ }
    return resultOf(names.filter(name => normalize(name).includes(key)));
}
export async function resolveCharacterMatch(keyword) {
    return await matchCharacter(keyword, {
        names: codexStore.listAll(),
        atlas: name => atlasRes.resolveAlias(name),
        miaoAliases: () => miaoRes.aliases('character')
    });
}
export async function resolveCharacterName(keyword) {
    return (await resolveCharacterMatch(keyword)).name;
}
//# sourceMappingURL=characterResolver.js.map