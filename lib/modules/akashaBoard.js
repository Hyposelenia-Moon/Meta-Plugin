/**
 * akashaBoard — 阿卡莎角色榜条目的归一化（v3 P5，纯函数）
 *
 * 数据来自 `/api/leaderboards?...&calculationId=<id>`（每个角色榜 20 条，含上榜者的完整配装）。
 * 字段口径（2026-10-14 用真实样本核对过，夹具见 `test/fixtures/akasha-board.sample.json`）：
 *   - 名次 `index`；身份 `uid` / `owner.nickname` / `name`（角色英文名）
 *   - 伤害 `calculation.result`（分项在 `calculation.additional[]`，英文名）
 *   - 武器 `weapon.{name, icon, weaponInfo}`（英文名，中文靠 textmap）
 *   - 圣遗物 `artifactObjects`（**按部位键控的对象**：`EQUIP_SHOES` 等 Enka 名）
 *     每件的 `mainStatKey` 是 Enka 属性名（`FIGHT_PROP_*`）→ 直接走本仓库既有的 `ENKA_PROP_CN`
 *   - 套装 `artifactSets`（英文套装名 + 件数）
 *   - 面板数值在 **`stats`**（`maxHp` / `atk` / `baseAtk` / `elementalMastery` …；`propMap` 只有 `ascension`/`level`）
 *   - 天赋 `talentsLevelMap.{normalAttacks,elementalSkill,elementalBurst}.level`
 *   - 双爆分 `critValue`
 *
 * 中文名一律走 textmap（`/api/textmap/zh-CN`：`{translation:{"<英文小写>":"<中文>"}}`）；
 * 翻不到时**回落英文原文**而不是留空。
 */
import { ENKA_PROP_CN } from '../components/constants.js';
/** Enka 部位键 → 中文部位名 */
export const SLOT_CN = {
    EQUIP_BRACER: '生之花',
    EQUIP_NECKLACE: '死之羽',
    EQUIP_SHOES: '时之沙',
    EQUIP_RING: '空之杯',
    EQUIP_DRESS: '理之冠'
};
/** 站点 `stats` 的键 → 中文（翻不到就原样显示） */
export const STAT_CN = {
    maxHp: '生命值',
    atk: '攻击力',
    def: '防御力',
    baseAtk: '基础攻击力',
    baseHp: '基础生命值',
    baseDef: '基础防御力',
    elementalMastery: '元素精通',
    critRate: '暴击率',
    critRate_: '暴击率',
    critDMG: '暴击伤害',
    critDMG_: '暴击伤害',
    critDamage: '暴击伤害',
    energyRecharge: '元素充能效率',
    healingBonus: '治疗加成',
    incomingHealingBonus: '受治疗加成',
    shieldStrength: '护盾强效',
    elementalBonus: '元素伤害加成',
    physicalBonus: '物理伤害加成',
    anemoDamageBonus: '风元素伤害加成',
    geoDamageBonus: '岩元素伤害加成',
    electroDamageBonus: '雷元素伤害加成',
    dendroDamageBonus: '草元素伤害加成',
    hydroDamageBonus: '水元素伤害加成',
    pyroDamageBonus: '火元素伤害加成',
    cryoDamageBonus: '冰元素伤害加成',
    physicalDamageBonus: '物理伤害加成'
};
/** textmap 翻译（键是英文小写；翻不到返回原文） */
export function translate(textmap, en) {
    const text = String(en ?? '').trim();
    if (!text)
        return '';
    const hit = textmap?.translation?.[text.toLowerCase()];
    return hit ? String(hit) : text;
}
/** 归一化单条榜记录 */
export function normalizeBoardEntry(raw, textmap = null) {
    const artis = [];
    const objects = raw?.artifactObjects;
    if (objects && typeof objects === 'object') {
        for (const [equip, piece] of Object.entries(objects)) {
            const mainKey = String(piece?.mainStatKey || piece?.main?.key || '');
            artis.push({
                slot: equip,
                slotCn: SLOT_CN[equip] || equip,
                mainKey,
                // ⚠ 实测 `mainStatKey` 不是 Enka 枚举而是英文短语（`ATK%` / `Pyro DMG Bonus` / `Crit DMG`），
                //    而 textmap 里正好有这些词的译文 → 先试 Enka 表，再走 textmap，最后回落原文
                mainCn: ENKA_PROP_CN[mainKey] || translate(textmap, mainKey)
            });
        }
        // 按固定部位顺序排（花羽沙杯冠）
        const order = Object.keys(SLOT_CN);
        artis.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    }
    const sets = [];
    const setObj = raw?.artifactSets;
    if (setObj && typeof setObj === 'object') {
        for (const [name, ds] of Object.entries(setObj)) {
            sets.push({ name, nameCn: translate(textmap, name), count: Number(ds?.count) || 0 });
        }
        sets.sort((a, b) => b.count - a.count);
    }
    const stats = [];
    const rawStats = raw?.stats;
    if (rawStats && typeof rawStats === 'object') {
        for (const [key, ds] of Object.entries(rawStats)) {
            const value = Number(ds?.value ?? ds);
            if (!Number.isFinite(value))
                continue;
            stats.push({ key, label: STAT_CN[key] || key, value });
        }
    }
    const weaponRaw = raw?.weapon;
    const weaponName = String(weaponRaw?.name || '');
    const affix = Number(weaponRaw?.weaponInfo?.affix ?? weaponRaw?.affix ?? weaponRaw?.refinement ?? weaponRaw?.weaponInfo?.refinement) || 0;
    return {
        rank: Number(raw?.index) || 0,
        uid: String(raw?.uid || ''),
        nickname: String(raw?.owner?.nickname || ''),
        charName: String(raw?.name || ''),
        charNameCn: translate(textmap, raw?.name),
        cons: Number(raw?.constellation) || 0,
        critValue: Number(raw?.critValue) || 0,
        damage: Number(raw?.calculation?.result) || 0,
        weapon: weaponName ? { name: weaponName, nameCn: translate(textmap, weaponName), affix } : null,
        artis,
        sets,
        stats,
        talent: {
            A: Number(raw?.talentsLevelMap?.normalAttacks?.level) || 0,
            E: Number(raw?.talentsLevelMap?.elementalSkill?.level) || 0,
            Q: Number(raw?.talentsLevelMap?.elementalBurst?.level) || 0
        },
        lastBuildUpdate: Number(raw?.lastBuildUpdate) || 0
    };
}
/** 归一化整页榜条目（`payload.data` 是记录数组） */
export function normalizeBoard(payload, textmap = null) {
    const list = Array.isArray(payload?.data) ? payload.data : [];
    const entries = list.map(r => normalizeBoardEntry(r, textmap)).filter(e => e.uid);
    entries.sort((a, b) => (a.rank || 999) - (b.rank || 999));
    return { entries, total: entries.length };
}
/** 按名次取一条（名次从 1 开始；取不到返回 null） */
export function pickByRank(entries, rank) {
    const want = Math.max(1, Math.floor(Number(rank) || 1));
    const sorted = [...(entries || [])].sort((a, b) => (a.rank || 999) - (b.rank || 999));
    return sorted[want - 1] || null;
}
/**
 * akasha `stats` 里的**比例键**（值域 0~1，展示要 ×100 才是百分数）
 *
 * ⚠ miao 的 `Format.pct(n)` 只拼 `%`、**不乘 100**（乘 100 的是 `Format.percent`），
 *   所以比例换算必须自己来，否则 0.7933 会显示成 `0.8%`（2026-10-15 四项目复核 P2）。
 */
const AKASHA_RATIO_KEYS = new Set([
    'critRate', 'critDamage', 'critDMG', 'energyRecharge', 'healingBonus',
    'pyroDamageBonus', 'hydroDamageBonus', 'electroDamageBonus', 'cryoDamageBonus',
    'anemoDamageBonus', 'geoDamageBonus', 'dendroDamageBonus', 'physicalDamageBonus'
]);
/** 该 stats 键是不是比例（容忍 `critRate_` 这类结尾下划线变体） */
export function isAkashaRatioKey(key) {
    const k = String(key || '').trim().replace(/_+$/, '');
    return AKASHA_RATIO_KEYS.has(k) || /DamageBonus$/.test(k);
}
/** 按单位格式化一条 akasha stats：比例 → `79.3%`；平铺值 → 千分位（元素精通留一位小数） */
export function formatAkashaValue(key, value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return '-';
    if (isAkashaRatioKey(key))
        return `${(n * 100).toFixed(1)}%`;
    if (String(key) === 'elementalMastery')
        return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
    return Math.round(n).toLocaleString('en-US');
}
/** 面板摘要（页面用：挑几个常用项，按固定顺序） */
export function panelSummary(entry) {
    // 单位统一走 `formatAkashaValue`：比例键 ×100、平铺键千分位（2026-10-15 四项目复核 P2）
    const pick = (keys, label) => {
        for (const k of keys) {
            const hit = entry.stats.find(s => s.key === k);
            if (hit)
                return { label, value: formatAkashaValue(k, hit.value) };
        }
        return null;
    };
    return [
        pick(['maxHp', 'baseHp'], '生命值'),
        pick(['atk', 'baseAtk'], '攻击力'),
        pick(['critRate', 'critRate_'], '暴击率'),
        pick(['critDMG', 'critDMG_', 'critDamage'], '暴击伤害'),
        pick(['elementalMastery'], '元素精通'),
        pick(['energyRecharge'], '元素充能效率')
    ].filter(Boolean);
}
//# sourceMappingURL=akashaBoard.js.map