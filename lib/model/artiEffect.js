/**
 * 圣遗物「效果型」套装名解析（2026-10-18 复审 R1 后半）
 *
 * 攻略里有些推荐不是具体套装名，而是**效果**：`2精通+2精通`（米提亚）、`2生命+2生命`（妮露）。
 * 旧实现按套装名子串匹配，`精通` 永远命不中任何套装 → 只能算普通 2+2。
 *
 * 这里从 miao 的 `meta-gs/artifact/data.json` 读每套的**两件套效果文本**（`skills["2"]`），
 * 按关键词归档成效果桶（精通/生命/攻击/充能/暴击/爆伤/防御/治疗），供评分侧判定
 * 「玩家穿的两个 2 件套是否都属于该效果」。
 *
 * 取不到 miao 数据时返回空索引：调用方一律按「命不中」处理（保持旧行为，不误判达标）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { defaultMiaoRoot } from './MiaoRes.js';
/** 效果关键词 → 归档名（顺序即优先级，先命中先生效） */
const EFFECT_RULES = [
    ['精通', /元素精通/],
    ['充能', /元素充能效率/],
    ['暴击', /暴击率/],
    ['爆伤', /暴击伤害/],
    ['治疗', /治疗加成/],
    ['生命', /生命值/],
    ['攻击', /攻击力/],
    ['防御', /防御力/],
    ['增伤', /元素伤害加成|造成的伤害/]
];
let cache = null;
/** 从两件套效果文本推断效果桶（可能多桶，例如同时给精通与充能） */
export function effectBucketsOf(skillText) {
    const text = String(skillText || '');
    const out = [];
    for (const [name, re] of EFFECT_RULES)
        if (re.test(text))
            out.push(name);
    return out;
}
/** 读取并缓存效果索引（文件路径 + mtime 作为缓存键） */
export function artiEffectIndex() {
    const file = path.join(defaultMiaoRoot(), 'meta-gs', 'artifact', 'data.json');
    let key = file;
    try {
        const st = fs.statSync(file);
        key = `${file}:${st.mtimeMs}:${st.size}`;
    }
    catch {
        return { byEffect: new Map(), bySet: new Map() };
    }
    if (cache && cache.key === key)
        return cache.index;
    const byEffect = new Map();
    const bySet = new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const item of Object.values(raw)) {
            const name = String(item?.name || '').trim();
            const two = String(item?.skills?.['2'] || '');
            if (!name || !two)
                continue;
            const buckets = effectBucketsOf(two);
            if (!buckets.length)
                continue;
            bySet.set(name, buckets);
            for (const b of buckets) {
                if (!byEffect.has(b))
                    byEffect.set(b, new Set());
                byEffect.get(b).add(name);
            }
        }
    }
    catch {
        return { byEffect: new Map(), bySet: new Map() };
    }
    const index = { byEffect, bySet };
    cache = { key, index };
    return index;
}
/**
 * 该名字是否是「效果型」写法（`精通` / `生命` / `充能` …）
 *
 * 注意：判定的是**名字本身**等于效果别名，不是拿效果文本正则去匹配套装名
 * （`/元素精通/` 匹配不到 `精通` 两个字，早期实现就栽在这里）。
 */
export function effectNameOf(name) {
    const n = String(name || '').trim();
    if (!n || n.length > 4)
        return '';
    const hit = EFFECT_RULES.find(([bucket]) => n === bucket || n.includes(bucket));
    return hit ? hit[0] : '';
}
/** 效果桶下所有套装名（取不到数据时为空数组） */
export function setsWithEffect(effect) {
    return [...(artiEffectIndex().byEffect.get(effect) || [])];
}
//# sourceMappingURL=artiEffect.js.map