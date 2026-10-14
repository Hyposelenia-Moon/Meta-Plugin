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
import { applyStatPatch } from '../modules/statPatch.js';
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
 * 顺序：**事件里的 uid → miao 的米游社绑定**（命令里不再出现 UID，2026-10-14 用户定）。
 * 未绑定时 miao 会自己回 `#扫码登录` 按钮（我们据此返回 `prompted`，不再重复回复）。
 */
export async function resolveUid(e, explicitUid = '') {
    const given = String(explicitUid || '').trim();
    if (UID_RE.test(given))
        return { uid: given.match(UID_RE)[1] };
    const fromEvent = String(e.uid || '');
    if (UID_RE.test(fromEvent))
        return { uid: fromEvent.match(UID_RE)[1] };
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
    return { uid: '', error: '没有可用的账号：请先在 miao 侧绑定米游社（#扫码登录）' };
}
/** `mysArtis`（套装名 + 星级）→ 我们的 artis 形状，用于 `mysPanel` 简版面板 */
function artisFromMysArtis(avatar) {
    const src = avatar?.mysArtis;
    if (!src || typeof src !== 'object')
        return [];
    return Object.keys(src).sort().map(k => {
        const a = src[k] || {};
        return { set: String(a.name || ''), level: Number(a.level) || 0, star: Number(a.star) || 0 };
    }).filter(a => a.set);
}
/** 脚注去重 + 最多 2 条 + 单条截断（miao 刷新失败这类噪音不再刷屏） */
function tidyNotes(notes) {
    const out = [];
    for (const raw of notes) {
        const text = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!text)
            continue;
        const short = text.length > 60 ? text.slice(0, 60) + '…' : text;
        if (!out.includes(short))
            out.push(short);
        if (out.length >= 2)
            break;
    }
    return out;
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
        // miao 的刷新/取数流程会通过 `player.e` 回消息（miao 自己的命令里 player 就是 `Player.create(e)`），
        // 缺了它会出现 `e.reply is not a function` —— 这里把本次命令的事件挂上去（2026-10-15）
        if (player && !player.e)
            player.e = e;
        if (!player)
            return { ok: false, error: `无法载入玩家 ${resolved.uid}` };
        /**
         * 取一次面板：按"最不容易踩到 miao 排行榜评分"的顺序尝试三条通道
         *
         * 起因：`player.refresh({profile:true})` 会顺带跑排行榜评分，其中 `ProfileRank.js`
         * 对某些数据形状会抛 `Cannot read properties of undefined (reading 'mark')`，
         * 且**崩在保存之前** → 刷新等于白跑。用户已绑米游社 ck 时，
         * `refreshMysDetail(2)`（无视缓存强制刷新米游社明细）能直接拿到完整面板且不走那条评分。
         */
        const notes = [];
        const fetchPanel = async (reason) => {
            // miao 的三条刷新通道；**每试一条就重读并检查完整性**，只有拿到完整面板才算成功
            // 与 miao 的「米游社面板更新」同款：`refreshProfile(2, true)`（force=2 + fromMys=true）
            // 是 miao `ProfileList.refreshMys` 走的调用；`refresh({profile:true})` 是它的兜底
            const channels = [
                ['米游社更新面板', async () => await player.refreshProfile?.(2, true)],
                ['通用刷新', async () => await player.refresh?.({ profile: true })],
                ['米游社明细', async () => await player.refreshMysDetail?.(2)]
            ];
            for (const [label, run] of channels) {
                try {
                    const ret = await run();
                    const got = player.getProfile?.(char.id);
                    if (got)
                        profile = got;
                    // miao 刷新返回 false = 没取到新数据；undefined 多半是方法不存在 —— 都继续下一条
                    // miao 自己的"有没有面板"判定优先（`player.hasProfile`），再兜我们的完整性检查
                    if (ret === false || !(player.hasProfile || isComplete(profile))) {
                        notes.push(`${reason} → miao「${label}」未取到完整面板`);
                        continue;
                    }
                    notes.push(`${reason} → 已用 miao「${label}」更新面板`);
                    return;
                }
                catch (err) {
                    notes.push(`miao「${label}」失败（${err?.message || err}）`);
                }
            }
            notes.push(`${reason} → 三条通道都未取到圣遗物明细（可在 miao 侧先发一次「米游社面板更新」）`);
        };
        let profile = player.getProfile?.(char.id);
        const isComplete = (p) => {
            if (!p || p.hasData === false)
                return false;
            const artis = Array.isArray(p.artis) ? p.artis : [];
            const attr = p.attr && typeof p.attr === 'object' ? Object.keys(p.attr).length : 0;
            return artis.length >= 5 && !!p.weapon?.name && attr > 0;
        };
        if (!profile || profile.hasData === false) {
            await fetchPanel('本地无面板缓存');
            profile = player.getProfile?.(char.id) || profile;
        }
        else if (!isComplete(profile)) {
            await fetchPanel('本地面板数据不完整');
            profile = player.getProfile?.(char.id) || profile;
        }
        if (!profile || profile.hasData === false) {
            return { ok: false, error: `没有取到「${local.name}」的面板数据：该角色可能未在米游社公开展示，或取数失败（miao 里可先发一次 #面板 试试）` };
        }
        // 圣遗物明细与评分都在 avatar 上（profile 上通常没有 artis）
        let avatar = null;
        try {
            // 照抄 miao 自己的读法：`getAvatar(id)`（米游社来源 mys/mysPanel 优先，才有圣遗物明细）；
            // `getAvatar(id, true)` 会给到非米游社来源（缺 artis），只作兜底
            avatar = player.getAvatar?.(char.id) || player.getAvatar?.(char.id, true) || null;
            // avatar 上没有圣遗物明细时，说明这份数据是简版（例如只带面板）→ 让 miao 重取一次再读
        }
        catch { /* 拿不到就回落 profile */ }
        // 圣遗物评分：走 miao 的规则（评分依赖副词条，展示时只列主词条）
        let artiMark = null;
        try {
            const ArtisMark = models.ArtisMark || (await import(miaoUrl('models/artis/ArtisMark.js'))).default;
            // avatar 与 profile 都试一遍（谁算得出来用谁）；miao 内部评分对数据形状敏感，
            // 某些数据下会抛（如 "Cannot read properties of undefined (reading 'mark')"）—— 这里一律降级为"无评分"
            // ⚠ 只有拿到"含主词条"的圣遗物明细时才算评分：mysPanel 简版（只有套装名）会让 miao 内部抛
            //   "Cannot read properties of undefined (reading 'mark')"，这里直接跳过
            const canScore = (c) => Array.isArray(c?.artis) && c.artis.some((a) => !!a?.main);
            for (const candidate of [player.getAvatar?.(char.id), player.getAvatar?.(char.id, true), avatar, profile].filter(canScore)) {
                if (!candidate)
                    continue;
                try {
                    const detail = ArtisMark?.getMarkDetail?.(candidate, false);
                    if (detail && Number.isFinite(Number(detail._mark))) {
                        artiMark = { total: Number(detail._mark), markClass: String(detail.markClass || '') };
                        break;
                    }
                }
                catch { /* 换下一个候选 */ }
            }
        }
        catch { /* 评分失败不影响其它维度 */ }
        const build = {
            charName: local.name,
            level: Number(avatar?.level ?? profile.level) || 0,
            cons: Number(avatar?.cons ?? profile.cons) || 0,
            weapon: profile.weapon?.name
                ? { name: String(profile.weapon.name), affix: Number(profile.weapon.affix) || 0, rarity: Number(profile.weapon.rarity) || 0 }
                : null,
            talent: {
                A: talentLevel(profile.talent?.a),
                E: talentLevel(profile.talent?.e),
                Q: talentLevel(profile.talent?.q)
            },
            artis: (() => {
                const av = player.getAvatar?.(char.id) || player.getAvatar?.(char.id, true) || avatar || profile;
                const full = artisOf(av);
                if (full.length)
                    return full;
                // miao 原生套装查询：`avatar.artisSet` = `mysArtis.getSetData()` 的 `names`
                //（`mysPanel` 简版面板也有它，这是 miao 自己页面上显示套装的同一个来源）
                const names = av?.artisSet?.names;
                if (Array.isArray(names) && names.length) {
                    return names.map(s => ({ set: String(s || ''), level: 0 })).filter(a => a.set);
                }
                // 最兜底：直接扫 `mysArtis` 原始数据（套装名 + 星级）
                return artisFromMysArtis(av || null);
            })(),
            artiMark,
            attrs: Object.fromEntries(Object.entries(profile.attr || {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]))
        };
        return { ok: true, uid: resolved.uid, build, notes: tidyNotes(notes) };
    }
    catch (err) {
        return { ok: false, error: `读取 miao 面板出错：${err?.message || err}` };
    }
}
/** 把 miao 的伤害行统一成 `{ title, value }`（helper 返回的是 `{ avg }`，防御式取第一个可用数值） */
function damageRowsOf(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const row of raw) {
        const ds = row;
        const value = Number(ds?.avg ?? ds?.dmg ?? ds?.expect ?? ds?.value);
        const title = String(ds?.title ?? '').trim();
        if (!title || !Number.isFinite(value))
            continue;
        out.push({ title, value });
    }
    return out;
}
export async function readTeamDamage(e, names, explicitUid = '', opts = {}) {
    const patch = opts.patch?.items?.length ? opts.patch : null;
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
    const { findCharacter } = await import('./CharacterIndex.js');
    const notes = [];
    const members = [];
    try {
        const player = typeof Player.get === 'function' ? Player.get(resolved.uid) : Player.create({ uid: resolved.uid });
        // miao 的刷新/取数流程会通过 `player.e` 回消息（miao 自己的命令里 player 就是 `Player.create(e)`），
        // 缺了它会出现 `e.reply is not a function` —— 这里把本次命令的事件挂上去（2026-10-15）
        if (player && !player.e)
            player.e = e;
        if (!player)
            return { ok: false, error: `无法载入玩家 ${resolved.uid}` };
        for (const raw of names) {
            const local = findCharacter(raw);
            if (!local)
                return { ok: false, error: `没有找到角色「${raw}」` };
            const char = Character.get?.(local.name) || Character.get?.(raw);
            if (!char?.id)
                return { ok: false, error: `miao 里没有角色「${local.name}」` };
            let avatar = player.getAvatar?.(char.id, true);
            if (!avatar)
                return { ok: false, error: `没有取到「${local.name}」的面板数据：该角色可能未在米游社公开展示` };
            if (avatar.isProfile === false || avatar.hasData === false) {
                notes.push(`${local.name}：本地无面板缓存，已让 miao 取一次`);
                if (typeof player.refresh === 'function') {
                    await player.refresh({ profile: true });
                    avatar = player.getAvatar?.(char.id, true);
                }
            }
            if (!avatar || avatar.hasData === false || avatar.isProfile === false) {
                return { ok: false, error: `没有取到「${local.name}」的面板数据（未公开或取数失败）` };
            }
            // 伤害规则来源（喵喵 / 组团伤害 / 自定义）
            let ruleBy = '';
            try {
                const ProfileDmg = models.ProfileDmg || (await import(miaoUrl('models/ProfileDmg.js'))).default;
                const rule = typeof ProfileDmg?.dmgRulePath === 'function' ? ProfileDmg.dmgRulePath(local.name) : null;
                ruleBy = String(rule?.createdBy || '');
            }
            catch { /* 拿不到就不标注 */ }
            let dmgRaw = [];
            if (patch) {
                // 有词条：按 miao `Avatar.calcDmg` 的同一份构造方式重建 ProfileDmg，只把 attr 换掉
                try {
                    const ProfileDmg = models.ProfileDmg || (await import(miaoUrl('models/ProfileDmg.js'))).default;
                    const ds = avatar.getData('id,level,elem,attr,cons,artis:artis.sets,trees,uid');
                    ds.talent = Object.fromEntries(Object.entries((avatar.talent || {}))
                        .map(([k, v]) => [k, Number(v?.level) || 0]));
                    ds.weapon = { name: avatar.weapon?.name, affix: avatar.weapon?.affix, level: avatar.weapon?.level };
                    ds.attr = applyStatPatch((avatar.attr || {}), patch);
                    const dmg = new ProfileDmg(ds, 'gs');
                    dmgRaw = await dmg.calcData({ enemyLv: 103, mode: 'profile' });
                }
                catch (err) {
                    notes.push(`${local.name}：词条重算失败，已回退到原面板（${err?.message || err}）`);
                    if (typeof avatar.calcDmg === 'function')
                        dmgRaw = await avatar.calcDmg({ enemyLv: 103, mode: 'profile' });
                }
            }
            else if (typeof avatar.calcDmg === 'function') {
                dmgRaw = await avatar.calcDmg({ enemyLv: 103, mode: 'profile' });
            }
            let artiMark = null;
            try {
                const detail = avatar.getArtisMark?.(false);
                if (detail && Number.isFinite(Number(detail._mark))) {
                    artiMark = { total: Number(detail._mark), markClass: String(detail.markClass || '') };
                }
            }
            catch { /* 评分拿不到不影响伤害 */ }
            members.push({
                charName: local.name,
                rarity: Number(char.star ?? char.rarity) || 5,
                level: Number(avatar.level) || 0,
                cons: Number(avatar.cons) || 0,
                weapon: avatar.weapon?.name
                    ? { name: String(avatar.weapon.name), affix: Number(avatar.weapon.affix) || 0, rarity: Number(avatar.weapon.rarity) || 0 }
                    : null,
                talent: { A: talentLevel(avatar.talent?.a), E: talentLevel(avatar.talent?.e), Q: talentLevel(avatar.talent?.q) },
                rows: damageRowsOf(dmgRaw),
                ruleBy,
                artiSets: [...new Set((Array.isArray(avatar.artis) ? avatar.artis : []).map((a) => String(a?.set || '')).filter(Boolean))],
                artiMark
            });
        }
    }
    catch (err) {
        return { ok: false, error: `读取 miao 队伍数据出错：${err?.message || err}` };
    }
    if (members.some(m => m.ruleBy && m.ruleBy !== '组团伤害')) {
        notes.push('队伍 buff：部分角色用的是 miao 的单人规则；在 miao 侧开启「组团伤害」（系统配置 teamCalc）后数值会更贴近实战');
    }
    if (patch)
        notes.push('本次伤害按你给的词条临时重算（未改动 miao 面板里的任何数据）');
    return { ok: true, uid: resolved.uid, members, notes };
}
//# sourceMappingURL=MiaoProfile.js.map