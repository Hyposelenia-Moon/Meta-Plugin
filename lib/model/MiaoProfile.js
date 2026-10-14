/**
 * MiaoProfile — miao 面板薄桥（v3 P2）
 *
 * 职责：把 miao 的"玩家面板"适配成 `modules/grade.ts` 要的 `BuildSnapshot`，
 * 并把「账号从哪来」交给 miao（复用它的米游社绑定，命令里不写 UID）。
 *
 * 为什么是薄桥：miao 的内部结构会变（`models/Player`、`models/Character`、`ArtisMark`），
 * 全部耦合集中在本文件，改版只需改这里；评分器保持纯函数、可离线单测。
 *
 * 读取全部**防御式**：字段缺失/形状变化 → 返回 `ok: false` 或降级（绝不抛到消息层）。
 * 开发工作区没有 bot/miao 时，动态 import 会失败 → 同样走 `ok: false`（套件据此跳过）。
 */
import { ENKA_PROP_CN } from '../components/constants.js';
import { miaoPluginDir } from './MiaoPanel.js';
/** Enka/miao 的圣遗物顺序（`EnkaData.artisIdxMap` 与面板渲染都按这个次序） */
const SLOTS = ['生之花', '死之羽', '时之沙', '空之杯', '理之冠'];
const UID_RE = /(?:^|\D)([1-9]\d{8})(?:\D|$)/;
/** miao 动态 import 的 URL 工厂（与 MiaoPanel 同一手法：目录来自 miaoPluginDir） */
function miaoUrl(rel) {
    const dir = miaoPluginDir();
    if (!dir)
        throw new Error('未找到 miao-plugin 目录');
    const sep = rel.includes('/') ? '/' : '\\';
    return `file:///${dir.replace(/\\/g, '/')}${sep === '/' ? '/' : '/'}${rel.replace(/\\/g, '/')}`;
}
/** miao 的模型入口（`models/index.js` 导出 Player / Character / ArtisMark 等） */
async function miaoModels() {
    const mod = await import(miaoUrl('models/index.js'));
    return (mod?.default && typeof mod.default === 'object') ? { ...mod.default, ...mod } : mod;
}
/**
 * 解析本次要查的账号
 *
 * 顺序与 miao 一致：**事件里的 uid → 消息里的 10 位 UID → miao 的米游社绑定**。
 * 未绑定时 miao 会自己回 `#扫码登录` 按钮（我们据此返回 `prompted`，不再重复回复）。
 */
export async function resolveUid(e, explicitUid = '') {
    const given = String(explicitUid || '').trim();
    if (UID_RE.test(given))
        return { uid: given.match(UID_RE)[1] };
    const fromEvent = String(e.uid || '');
    if (UID_RE.test(fromEvent))
        return { uid: fromEvent.match(UID_RE)[1] };
    const fromMsg = String(e?.msg || '').match(UID_RE);
    if (fromMsg)
        return { uid: fromMsg[1] };
    // 交给 miao：它内部会处理"已绑定账号"，未绑定时回 #扫码登录
    try {
        const common = await import(miaoUrl('apps/profile/ProfileCommon.js'));
        if (typeof common.getTargetUid === 'function') {
            const uid = await common.getTargetUid(e);
            if (uid)
                return { uid: String(uid) };
            return { uid: '', prompted: e._replyNeedUid === true, error: '没有可用的账号：请先让米游社绑定生效（miao 侧 `#扫码登录`）' };
        }
    }
    catch (err) {
        return { uid: '', error: `无法读取 miao 的账号绑定：${err?.message || err}` };
    }
    return { uid: '', error: '没有可用的账号：请在命令里带上 10 位 UID，或先在 miao 侧绑定米游社' };
}
/** 从 miao 的天赋对象里取等级（兼容 `{level}` / `{original}` / 纯数字三种形状） */
function talentLevel(ds) {
    if (typeof ds === 'number' && Number.isFinite(ds))
        return ds;
    const obj = ds;
    for (const key of ['level', 'original', 'value']) {
        const v = Number(obj?.[key]);
        if (Number.isFinite(v) && v > 0)
            return v;
    }
    return 0;
}
/** 圣遗物 → 契约（主词条取中文名，与攻略同口径） */
function artisOf(profile) {
    const list = Array.isArray(profile?.artis) ? profile.artis : [];
    return list.slice(0, 5).map((arti, idx) => {
        const mainKey = String(arti?.main?.key || '');
        return {
            slot: SLOTS[idx] || `部位${idx + 1}`,
            set: String(arti?.set || ''),
            mainName: ENKA_PROP_CN[mainKey] || mainKey,
            level: Number(arti?.level) || 0
        };
    });
}
/**
 * 读取某个角色的面板（没有本地缓存时让 miao 去取一次）
 *
 * @param e         消息事件（传给 miao 的绑定解析）
 * @param charName  角色名（支持别名，用**本插件**的索引解析，再交给 miao 取 id）
 * @param explicitUid 命令里显式写的 UID（可空）
 */
export async function readProfile(e, charName, explicitUid = '') {
    if (!miaoPluginDir()) {
        return { ok: false, error: '未找到 miao-plugin（必需依赖）：请确认它已安装在 bot 的 plugins 目录' };
    }
    const resolved = await resolveUid(e, explicitUid);
    if (!resolved.uid)
        return { ok: false, error: resolved.error || '没有可用的账号', prompted: resolved.prompted };
    let models;
    try {
        models = await miaoModels();
    }
    catch (err) {
        return { ok: false, error: `加载 miao 模型失败：${err?.message || err}` };
    }
    const Player = models.Player;
    const Character = models.Character;
    if (!Player || !Character)
        return { ok: false, error: 'miao 模型缺少 Player / Character（版本不兼容？）' };
    // 角色：先用本插件索引解析（含别名），再交给 miao 拿 id
    const { findCharacter } = await import('./CharacterIndex.js');
    const local = findCharacter(charName);
    if (!local)
        return { ok: false, error: `没有找到角色「${charName}」` };
    const char = Character.get?.(local.name) || Character.get?.(charName);
    if (!char?.id)
        return { ok: false, error: `miao 里没有角色「${local.name}」` };
    try {
        const player = typeof Player.get === 'function'
            ? Player.get(resolved.uid)
            : Player.create({ uid: resolved.uid });
        if (!player)
            return { ok: false, error: `无法载入玩家 ${resolved.uid}` };
        let profile = player.getProfile?.(char.id);
        const notes = [];
        if (!profile || profile.hasData === false) {
            notes.push('本地无面板缓存，已让 miao 取一次');
            if (typeof player.refresh === 'function') {
                await player.refresh({ profile: true });
                profile = player.getProfile?.(char.id);
            }
        }
        if (!profile || profile.hasData === false) {
            return { ok: false, error: `没有取到「${local.name}」的面板数据：该角色可能未在米游社公开展示，或取数失败（miao 里可先发一次 #面板 试试）` };
        }
        // 圣遗物评分：走 miao 的规则（评分依赖副词条，展示时只列主词条）
        let artiMark = null;
        try {
            const ArtisMark = models.ArtisMark || (await import(miaoUrl('models/artis/ArtisMark.js'))).default;
            const detail = ArtisMark?.getMarkDetail?.(profile, false);
            if (detail && Number.isFinite(Number(detail._mark))) {
                artiMark = { total: Number(detail._mark), markClass: String(detail.markClass || '') };
            }
        }
        catch { /* 评分失败不影响其它维度 */ }
        const build = {
            charName: local.name,
            level: Number(profile.level) || 0,
            cons: Number(profile.cons) || 0,
            weapon: profile.weapon?.name
                ? { name: String(profile.weapon.name), affix: Number(profile.weapon.affix) || 0, rarity: Number(profile.weapon.rarity) || 0 }
                : null,
            talent: {
                A: talentLevel(profile.talent?.a),
                E: talentLevel(profile.talent?.e),
                Q: talentLevel(profile.talent?.q)
            },
            artis: artisOf(profile),
            artiMark,
            attrs: Object.fromEntries(Object.entries(profile.attr || {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]))
        };
        return { ok: true, uid: resolved.uid, build, notes };
    }
    catch (err) {
        return { ok: false, error: `读取 miao 面板出错：${err?.message || err}` };
    }
}
//# sourceMappingURL=MiaoProfile.js.map