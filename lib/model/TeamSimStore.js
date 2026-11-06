/**
 * 队伍模拟的运行期取数 —— 只读 `data/team-sim/**`，不写文件、不联网。
 *
 * 四步各自可独立失败，调用方拿结构化 issues 翻成人话即可：
 *   1. 名录 `roster.json`：miao charId → gcsim 键
 *   2. 数据包 `packs/<键>.json`：动作与命中
 *   3. 轴 `rotations/<任意名>.json`：录制 + 键位表，按队伍成员匹配
 *   4. 永久数据 `permanent/<charId>.json`：基础白值与效果
 *
 * 面板不在这里读：原始配装来自 `TeamBuildAdapter`，两边各自只认公开字段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../dir.js';
import { buildRuntimePermanent } from './PermanentSource.js';
import { combineDataPacks, recordingToRotation, validateRecording, validateRotation, simulateTimeline, FRAME_TIERS } from '../modules/teamSimulation/index.js';
const teamSimDir = path.join(dataDir, 'team-sim');
/** 轴文件目录：一份录制 + 一张键位表 */
export const rotationsDir = path.join(teamSimDir, 'rotations');
/** 永久数据目录：每个角色一份 */
export const permanentDir = path.join(teamSimDir, 'permanent');
const rosterFile = path.join(teamSimDir, 'roster.json');
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const reason = (error) => (error instanceof Error ? error.message : String(error));
function readJson(file) {
    try {
        return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
    catch (error) {
        return { issue: { code: 'missing', path: file, message: `读不到或解析失败：${reason(error)}` } };
    }
}
let rosterCache = null;
/** 名录；文件缺失直接抛错（构建期产物没生成就是部署问题，不该静默） */
export function loadRoster() {
    if (rosterCache)
        return rosterCache;
    const raw = fs.readFileSync(rosterFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.characters))
        throw new Error('roster.json 缺少 characters');
    rosterCache = parsed;
    return parsed;
}
/** 旅行者按元素展开：10000005 → aether*，10000007 → lumine* */
function travelerKey(charId, element) {
    const prefix = charId === '10000005' ? 'aether' : charId === '10000007' ? 'lumine' : '';
    if (!prefix || !element.trim())
        return null;
    return `${prefix}${element.trim().toLowerCase()}`;
}
/**
 * 角色 → gcsim 键。名录里没有、没有 gcsim 数据、旅行者缺元素，都算「用不了」，各自给出原因。
 */
export function resolveKey(entry, build) {
    const path_ = `member.${build.name || build.characterId}`;
    if (!entry)
        return { issue: { code: 'missing', path: path_, message: `${build.name || build.characterId}（${build.characterId}）不在名录里` } };
    if (entry.status === 'no-gcsim')
        return { issue: { code: 'unsupported', path: path_, message: `${entry.cn} 还没有 gcsim 动作数据` } };
    if (entry.status === 'alias')
        return { issue: { code: 'unsupported', path: path_, message: `${entry.cn} 是别名条目，请直接换用空或荧` } };
    if (entry.status === 'traveler') {
        const key = travelerKey(entry.charId, build.element);
        if (!key)
            return { issue: { code: 'missing', path: path_, message: `${entry.cn} 需要知道元素才能选键` } };
        return { key };
    }
    const key = entry.keys[0];
    if (!key)
        return { issue: { code: 'missing', path: path_, message: `${entry.cn} 的名录条目没有键` } };
    return { key };
}
/** 四份原始配装 → 合成一份数据包；任何一个角色缺包就整体不可用 */
export function loadTeamPack(builds) {
    const issues = [];
    const keys = [];
    let roster;
    try {
        roster = loadRoster();
    }
    catch (error) {
        return { status: 'incomplete', keys, issues: [{ code: 'missing', path: 'data/team-sim/roster.json', message: reason(error) }] };
    }
    const packs = [];
    for (const build of builds) {
        const entry = roster.characters.find(c => c.charId === build.characterId);
        const { key, issue } = resolveKey(entry, build);
        if (issue || !key) {
            if (issue)
                issues.push(issue);
            continue;
        }
        keys.push(key);
        const file = path.join(teamSimDir, 'packs', `${key}.json`);
        const read = readJson(file);
        if (read.issue)
            issues.push({ ...read.issue, path: `data/team-sim/packs/${key}.json`, message: `缺少 ${key} 的动作数据` });
        else
            packs.push(read.value);
    }
    if (issues.length) {
        const status = issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'incomplete';
        return { status, keys, issues };
    }
    const merged = combineDataPacks(packs);
    if (merged.status !== 'ok' || !merged.pack)
        return { status: merged.status === 'unsupported' ? 'unsupported' : 'incomplete', keys, issues: merged.issues };
    return { status: 'ok', keys, pack: merged.pack, issues: [] };
}
/** 列出目录下所有轴文件（缺失目录按「没有轴」处理） */
export function listRotationFiles() {
    try {
        return fs.readdirSync(rotationsDir).filter(name => name.endsWith('.json')).map(name => path.join(rotationsDir, name)).sort();
    }
    catch {
        return [];
    }
}
/**
 * 按队伍成员找轴：team 集合完全相等才算命中；同名多份时取文件名排序第一份并在 issues 里提示。
 * 没命中时返回 `nearby`（重合 ≥2 人的轴，按重合人数降序），调用方可以据此提示「差哪个人」。
 */
export function findRotation(charIds) {
    const wanted = [...charIds].sort().join(',');
    const hits = [];
    const nearby = [];
    const issues = [];
    for (const file of listRotationFiles()) {
        const read = readJson(file);
        if (read.issue) {
            issues.push(read.issue);
            continue;
        }
        const raw = read.value;
        if (!isObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.team)) {
            issues.push({ code: 'invalid', path: path.basename(file), message: '轴文件必须是 { schemaVersion: 1, team: [...] }' });
            continue;
        }
        const team = raw.team;
        if ([...team].sort().join(',') === wanted) {
            hits.push({ file, rotationFile: raw });
            continue;
        }
        const shared = team.filter(id => charIds.includes(id));
        if (shared.length >= 2) {
            nearby.push({ file, name: String(raw.id ?? path.basename(file, '.json')), team, shared });
        }
    }
    if (!hits.length) {
        nearby.sort((a, b) => b.shared.length - a.shared.length);
        return { nearby: nearby.slice(0, 3), issues };
    }
    if (hits.length > 1)
        issues.push({ code: 'invalid', path: 'rotations', message: `有 ${hits.length} 份轴都声明了这支队伍，取 ${path.basename(hits[0].file)}` });
    return { file: hits[0].file, rotationFile: hits[0].rotationFile, nearby: [], issues };
}
/** 录制 + 键位表 → 轴；键位版本不一致、窗口不合法、步骤引用不存在的动作都会被拒绝 */
export function toRotation(file, pack) {
    if (Array.isArray(file.sequence) && file.sequence.length)
        return sequenceToRotation(file, pack);
    if (file.recording === undefined || file.keymap === undefined) {
        return { status: 'invalid', issues: [{ code: 'missing', path: 'rotation', message: '轴文件要么给 sequence（顺序轴），要么给 recording + keymap（录制轴）' }] };
    }
    const checked = validateRecording(file.recording);
    if (checked.status !== 'ok' || !checked.recording)
        return { status: checked.status === 'unsupported' ? 'unsupported' : 'invalid', issues: checked.issues };
    const converted = recordingToRotation(checked.recording, file.keymap, {
        id: file.id,
        measurementEndFrame: file.measurementEndFrame,
        ...(file.scheduler ? { scheduler: file.scheduler } : {})
    });
    if (converted.status !== 'ok' || !converted.rotation)
        return { status: converted.status === 'unsupported' ? 'unsupported' : 'invalid', issues: converted.issues };
    const issues = validateRotation(converted.rotation, pack);
    if (issues.length)
        return { status: issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', rotation: converted.rotation, issues };
    return { status: 'ok', rotation: converted.rotation, issues };
}
/**
 * 顺序轴 → 轴：只写动作顺序，帧交给 `asap-sequence` 调度器。
 *
 * 角色变化时自动插一个切人步骤（`kind: 'switch'`），与录制轴里 `to_xxx` 键等价；
 * 初始能量缺省 0、上限取该角色爆发动作的 energyCost（没有爆发就按 100）。
 * 引用了包里没有的动作仍由 `validateRotation` 拒绝——不跑空。
 */
function sequenceToRotation(file, pack) {
    const issues = [];
    const tierId = file.frameTierId ?? 'fps-60';
    const tier = FRAME_TIERS[tierId];
    if (!tier)
        return { status: 'unsupported', issues: [{ code: 'unsupported', path: 'frameTierId', message: `未知帧率档位 ${tierId}` }] };
    const actions = pack.actions ?? {};
    const steps = [];
    let index = 0;
    let currentActor = '';
    for (const raw of file.sequence ?? []) {
        const actionId = typeof raw === 'string' ? raw.trim() : String(raw.actionId ?? '').trim();
        if (!actionId) {
            issues.push({ code: 'invalid', path: `sequence.${index}`, message: '顺序轴的动作 id 不能为空' });
            index += 1;
            continue;
        }
        const actorId = typeof raw === 'string' ? actionId.split('.')[0] : String(raw.actorId ?? actionId.split('.')[0]);
        if (!actions[actionId]) {
            issues.push({ code: 'unsupported', path: `sequence.${index}`, message: `动作包里没有 ${actionId}` });
            index += 1;
            continue;
        }
        const packActor = actions[actionId].actorId;
        if (packActor && packActor !== actorId) {
            issues.push({ code: 'invalid', path: `sequence.${index}`, message: `${actionId} 属于 ${packActor}，但 actorId 写成了 ${actorId}` });
            index += 1;
            continue;
        }
        if (currentActor && currentActor !== actorId)
            steps.push({ id: `switch-${index}`, kind: 'switch', actorId });
        const stepId = `step-${index}`;
        const optional = typeof raw !== 'string' && raw.optional === true;
        steps.push({ id: stepId, kind: 'action', actorId, actionId, ...(optional ? { optional: true } : {}) });
        currentActor = actorId;
        index += 1;
    }
    if (!steps.length) {
        const all = [...issues, { code: 'invalid', path: 'sequence', message: '顺序轴里没有一个可解析的动作' }];
        return { status: all.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', issues: all };
    }
    const actors = actorInitOf(file, pack, steps);
    const firstActor = steps.find(step => step.kind === 'action' || step.kind === 'switch')?.actorId;
    const activeActorId = file.actors?.[0]?.actorId ?? firstActor ?? actors[0].actorId;
    // optional 步骤交给内核的 ASAP 调度器处理：攒不够能量就跳过这一次、继续往下排（见 timeline.ts）。
    const expanded = file.loop === true ? loopSteps(steps, file, pack, tier, actors, activeActorId) : steps;
    const rotation = {
        id: file.id,
        scheduler: 'asap-sequence',
        frameTier: tier,
        measurementEndFrame: file.measurementEndFrame,
        steps: expanded,
        actors,
        activeActorId,
        ...(file.energyRecharge ? { energyRecharge: file.energyRecharge } : {})
    };
    const checked = validateRotation(rotation, pack);
    const all = [...issues, ...checked];
    // 顺序轴里写错一个动作不能让整份轴「看起来成功」——有问题就按问题类型失败，错在哪一条都在 issues 里。
    if (all.length)
        return { status: all.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', rotation, issues: all };
    // 机制规划（buff 窗口/活跃段）目前只认 fixed 调度，所以顺序轴在这里先跑一遍空时间线，
    // 把 asap 排出来的实际帧固化成固定轴——作者只写顺序，内核看到的仍是可规划的固定帧。
    return freezeSequenceFrames(rotation, pack);
}
/**
 * 顺序轴 → 固定轴：用一次空时间线（不结算伤害归属）取每个步骤的实际帧。
 * 这一步只决定「第几帧按下去」，数值仍由后续正式模拟算。
 */
function freezeSequenceFrames(rotation, pack) {
    const dry = simulateTimeline({
        scheduler: rotation.scheduler,
        steps: rotation.steps,
        actions: pack.actions ?? {},
        actors: rotation.actors,
        activeActorId: rotation.activeActorId,
        frameTier: rotation.frameTier,
        measurementEndFrame: rotation.measurementEndFrame,
        energyRecharge: rotation.energyRecharge
    });
    if (dry.issues.length)
        return { status: 'invalid', issues: dry.issues };
    const frameOf = new Map();
    const skipped = new Set();
    for (const request of dry.requests) {
        if (request.actualFrame !== null)
            frameOf.set(request.stepId, request.actualFrame);
        else if (request.reason === 'optional-skipped')
            skipped.add(request.stepId);
    }
    // 被跳过的 optional 动作连同它前面的换人一起从固定轴里删掉，否则固定轴里会留下「换了人却没动作」。
    const dropped = new Set();
    rotation.steps.forEach((step, index) => {
        if (step.kind === 'action' && skipped.has(step.id))
            dropped.add(index);
    });
    rotation.steps.forEach((step, index) => {
        if (step.kind === 'switch' && dropped.has(index + 1))
            dropped.add(index);
    });
    /*
     * 换人步骤不进 `requests`（它不产生动作请求），但固定轴要求每步都有帧。
     * 空跑的时间线会把每次换人的实际帧记进 events（phase=state、kind=switch），按出现顺序对上即可；
     * 万一事件对不上（理论上不会），退回「下一个动作的实际帧」。
     */
    const switchFrames = dry.events.filter(event => event.phase === 'state' && event.kind === 'switch').map(event => event.frame);
    // 先按出现顺序把所有换人步骤对上事件帧（包括稍后会被删掉的），再放进固定轴，避免删步骤后帧错位。
    const switchFrameOf = new Map();
    let switchCursor = 0;
    rotation.steps.forEach((step, index) => {
        if (step.kind !== 'switch')
            return;
        if (switchCursor < switchFrames.length)
            switchFrameOf.set(index, switchFrames[switchCursor++]);
    });
    const actionFrames = rotation.steps
        .map((step, index) => ({ step, index }))
        .filter(item => item.step.kind === 'action' && frameOf.has(item.step.id))
        .map(item => ({ index: item.index, frame: frameOf.get(item.step.id) }));
    const frameForSwitch = (index) => {
        const exact = switchFrameOf.get(index);
        if (exact !== undefined)
            return exact;
        const next = actionFrames.find(item => item.index > index);
        if (next)
            return next.frame;
        const prev = [...actionFrames].reverse().find(item => item.index < index);
        return prev ? prev.frame : null;
    };
    const frozen = [];
    rotation.steps.forEach((step, index) => {
        if (dropped.has(index))
            return;
        if (step.kind === 'wait') {
            frozen.push(step);
            return;
        }
        const atFrame = step.kind === 'switch' ? frameForSwitch(index) : frameOf.get(step.id);
        if (atFrame === undefined || atFrame === null) {
            return;
        }
        frozen.push({ ...step, atFrame });
    });
    const expected = rotation.steps.filter((step, index) => step.kind !== 'wait' && !dropped.has(index)).length;
    const missing = expected - frozen.filter(step => step.kind !== 'wait').length;
    if (missing > 0)
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'steps', message: `有 ${missing} 个步骤没有排到执行帧，无法固化成固定轴` }] };
    /*
     * 删过步骤后，固定轴里可能出现「目标是当前前台角色」的冗余换人（例如被删掉的爆发前后各有一个换人）。
     * 固定调度会把它当错误（目标已经是前台角色），所以这里按实际前台重排一次：冗余换人直接去掉。
     */
    const normalized = [];
    let current = rotation.activeActorId;
    for (const step of frozen) {
        if (step.kind === 'switch') {
            if (step.actorId === current)
                continue;
            current = step.actorId;
            normalized.push(step);
            continue;
        }
        if (step.kind === 'action')
            current = step.actorId;
        normalized.push(step);
    }
    const fixed = { ...rotation, scheduler: 'fixed', steps: normalized };
    const issues = validateRotation(fixed, pack);
    if (issues.length)
        return { status: issues.some(x => x.code === 'unsupported') ? 'unsupported' : 'invalid', rotation: fixed, issues };
    return { status: 'ok', rotation: fixed, issues: [] };
}
/**
 * 把顺序轴循环到测量窗口结束。
 *
 * 逐轮追加、每加一轮先空跑一次：只要这一轮会越过窗口或排不出（冷却/能量等不到）就停下，
 * 保留上一轮的步骤。循环边界换人时自动补切人。只解决「动作写一遍就结束、DPS 被摊薄」的问题，
 * 不改变单次动作的数值口径。
 */
function loopSteps(steps, file, pack, tier, actors, activeActorId) {
    const window = file.measurementEndFrame;
    const dry = (candidate) => simulateTimeline({
        scheduler: 'asap-sequence',
        steps: candidate,
        actions: pack.actions ?? {},
        actors,
        activeActorId,
        frameTier: tier,
        measurementEndFrame: window,
        energyRecharge: file.energyRecharge
    });
    const firstActor = steps.find(step => step.kind === 'action')?.actorId;
    let best = steps;
    let bestEnd = dry(steps).endFrame ?? 0;
    for (let round = 1;; round += 1) {
        const lastActor = [...best].reverse().find(step => step.kind === 'action' || step.kind === 'switch')?.actorId;
        const next = firstActor && lastActor && lastActor !== firstActor
            ? [{ id: `loop-switch-${round}`, kind: 'switch', actorId: firstActor }]
            : [];
        steps.forEach(step => next.push({ ...step, id: `${step.id}-r${round}` }));
        const candidate = [...best, ...next];
        const trial = dry(candidate);
        if (trial.issues.length)
            break;
        const end = trial.endFrame ?? 0;
        if (end >= window || end <= bestEnd)
            break;
        best = candidate;
        bestEnd = end;
    }
    return best;
}
/** 顺序轴的初始资源：文件里给了就用，没给就 0 能量 + 按爆发能耗推上限。 */
function actorInitOf(file, pack, steps) {
    const ids = [];
    for (const step of steps)
        if (step.kind === 'action' && step.actorId && !ids.includes(step.actorId))
            ids.push(step.actorId);
    return ids.map(actorId => {
        const given = file.actors?.find(item => item.actorId === actorId);
        const burst = Object.values(pack.actions ?? {}).find(action => action.actorId === actorId && action.kind === 'burst' && Number.isFinite(Number(action.energyCost)));
        const energyMax = given?.energyMax ?? (burst ? Number(burst.energyCost) : 100);
        return { actorId, energy: given?.energy ?? 0, energyMax: energyMax > 0 ? energyMax : 100 };
    });
}
/**
 * 永久数据：基础白值 + 已审计效果。
 *
 * 先按玩家实际配装**现算**（2026-11-06 改）：套装/命座/被动的建模口径都长在 `PermanentSource` 里，
 * 入库的 `permanent/<charId>-<武器id>-r<精炼>.json` 可能来自旧版本生成器（例如早于 4 件套建模），
 * 优先读它会静默丢掉引擎已经能算的效果。只有现算拿不到（没有 miao 数据）时才回落到入库文件。
 * 现算的副作用只在内存里，不往 `data/` 写缓存——那个目录是入库数据，运行期不能碰。
 */
export function loadPermanentData(build) {
    const file = `${build.characterId}-${build.weapon.id}-r${build.weapon.refinement}.json`;
    const where = `data/team-sim/permanent/${file}`;
    const runtime = buildRuntimePermanent({
        characterId: String(build.characterId),
        name: String(build.name ?? ''),
        weaponId: String(build.weapon.id),
        refinement: Number(build.weapon.refinement)
    });
    if (runtime.ok)
        return { data: runtime.data };
    const read = readJson(path.join(permanentDir, file));
    if (read.issue) {
        // 现算与入库文件都拿不到，把两边的失败原因一起写出来。
        let siblings = [];
        try {
            siblings = fs.readdirSync(permanentDir).filter(name => name.startsWith(`${build.characterId}-`) && name.endsWith('.json'));
        }
        catch {
            siblings = [];
        }
        const hint = siblings.length
            ? `；同角色已有 ${siblings.join('、')}，武器或精炼对不上`
            : '；这个角色还没有永久数据';
        return { issue: { code: 'missing', path: where, message: `${build.name || build.characterId} 缺永久数据（${file}）${hint}；现算失败：${runtime.error}` } };
    }
    const raw = read.value;
    if (!isObject(raw) || !isObject(raw.character) || !isObject(raw.weapon)) {
        return { issue: { code: 'invalid', path: where, message: '永久数据必须含 character 与 weapon' } };
    }
    return { data: raw };
}
//# sourceMappingURL=TeamSimStore.js.map