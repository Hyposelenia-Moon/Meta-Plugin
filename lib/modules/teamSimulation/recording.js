import { FRAME_TIERS } from './timeline.js';
import { validateRotation } from './rotation.js';
const isObject = (value) => typeof value === 'object' && value !== null;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export function validateRecording(input) {
    const issues = [];
    const add = (code, path, message) => { issues.push({ code, path, message }); };
    if (!isObject(input))
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'recording', message: '录制文件必须是对象' }] };
    if (input.schemaVersion !== 1)
        return { status: 'version-mismatch', issues: [{ code: 'version-mismatch', path: 'recording.schemaVersion', message: `只认 schemaVersion 1，收到 ${String(input.schemaVersion)}` }] };
    if (typeof input.frameTierId !== 'string' || !input.frameTierId.trim())
        add('missing', 'recording.frameTierId', '录制必须写明帧率档位：同一段按键在不同档位下对应不同帧号');
    else if (!FRAME_TIERS[input.frameTierId])
        add('unsupported', 'recording.frameTierId', `未知帧率档位 ${input.frameTierId}`);
    for (const [field, path] of [['keymapVersion', 'recording.keymapVersion'], ['gameVersion', 'recording.gameVersion'], ['source', 'recording.source']]) {
        if (typeof input[field] !== 'string' || !input[field].trim())
            add('missing', path, '录制必须自带这四项元数据，缺一不可');
    }
    const start = input.start;
    if (!isObject(start))
        add('missing', 'recording.start', '录制必须记录起手时的前台与队伍资源');
    else {
        if (typeof start.activeActorId !== 'string' || !start.activeActorId.trim())
            add('missing', 'recording.start.activeActorId', '必须记录起手前台角色');
        if (!Array.isArray(start.actors) || !start.actors.length)
            add('missing', 'recording.start.actors', '必须记录队伍初始资源');
    }
    const events = input.events;
    if (!Array.isArray(events) || !events.length)
        add('invalid', 'recording.events', '录制不能为空：至少要有一次按下');
    else {
        let previous = -1;
        let downs = 0;
        events.forEach((event, index) => {
            const p = `recording.events.${index}`;
            if (!isObject(event)) {
                add('invalid', p, '事件必须是对象');
                return;
            }
            if (!isFiniteNumber(event.atMs) || event.atMs < 0)
                add('invalid', `${p}.atMs`, '时间戳必须是非负有限毫秒数');
            else {
                if (event.atMs < previous)
                    add('invalid', `${p}.atMs`, '时间戳必须单调不减：clock 回拨会让帧号倒退');
                previous = isFiniteNumber(event.atMs) ? event.atMs : previous;
            }
            if (typeof event.key !== 'string' || !event.key.trim())
                add('missing', `${p}.key`, '事件必须带键名');
            if (event.phase !== 'down' && event.phase !== 'up')
                add('unsupported', `${p}.phase`, `未知事件相位 ${String(event.phase)}`);
            else if (event.phase === 'down')
                downs += 1;
        });
        if (!downs)
            add('invalid', 'recording.events', '录制里没有任何按下事件，无法生成步骤');
    }
    if (issues.length)
        return { status: issues.some(issue => issue.code === 'unsupported') ? 'unsupported' : 'invalid', issues };
    return { status: 'ok', issues, recording: input };
}
export function recordingToRotation(recording, keymap, options, pack) {
    const issues = [];
    const add = (code, path, message) => { issues.push({ code, path, message }); };
    if (!isObject(keymap) || typeof keymap.version !== 'string' || !isObject(keymap.bindings)) {
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'keymap', message: '键位表必须是 { version, bindings }' }] };
    }
    if (keymap.version !== recording.keymapVersion) {
        return { status: 'invalid', issues: [{ code: 'invalid', path: 'keymap.version', message: `键位表版本 ${keymap.version} 与录制记录的 ${recording.keymapVersion} 不一致，键位可能已经变了` }] };
    }
    const tier = FRAME_TIERS[recording.frameTierId];
    if (!tier)
        return { status: 'unsupported', issues: [{ code: 'unsupported', path: 'recording.frameTierId', message: `未知帧率档位 ${recording.frameTierId}` }] };
    if (typeof options?.id !== 'string' || !options.id.trim())
        add('missing', 'options.id', '轴必须有稳定 id');
    const msPerFrame = 1000 / tier.fps;
    const steps = [];
    let index = 0;
    let lastFrame = 0;
    for (const event of recording.events) {
        if (event.phase !== 'down')
            continue;
        const binding = keymap.bindings[event.key];
        if (!binding) {
            add('unsupported', `recording.events.${index}.key`, `键 ${event.key} 在键位表里没有绑定`);
            index += 1;
            continue;
        }
        const frame = Math.max(0, Math.round(event.atMs / msPerFrame));
        lastFrame = Math.max(lastFrame, frame);
        if ('switch' in binding)
            steps.push({ id: `step-${index + 1}`, kind: 'switch', actorId: binding.actorId, atFrame: frame });
        else
            steps.push({ id: `step-${index + 1}`, kind: 'action', actorId: binding.actorId, actionId: binding.actionId, atFrame: frame });
        index += 1;
    }
    if (!steps.length)
        add('invalid', 'rotation.steps', '录制里没有一个键能映射成步骤');
    if (!Number.isInteger(options?.measurementEndFrame) || options.measurementEndFrame <= lastFrame) {
        add('invalid', 'options.measurementEndFrame', `测量窗口必须大于最后一步的帧号（${lastFrame}），否则最后一段动作不会被结算`);
    }
    if (issues.length)
        return { status: issues.some(issue => issue.code === 'unsupported') ? 'unsupported' : 'invalid', issues };
    const rotation = {
        id: options.id,
        scheduler: options.scheduler ?? 'fixed',
        frameTier: tier,
        measurementEndFrame: options.measurementEndFrame,
        steps,
        actors: recording.start.actors.map(actor => ({ ...actor })),
        activeActorId: recording.start.activeActorId,
        ...(options.switchFrames === undefined ? {} : { switchFrames: options.switchFrames })
    };
    if (pack) {
        const packIssues = validateRotation(rotation, pack);
        if (packIssues.length) {
            return { status: packIssues.some(issue => issue.code === 'unsupported') ? 'unsupported' : 'invalid', issues: packIssues, rotation };
        }
    }
    return { status: 'ok', issues, rotation };
}
//# sourceMappingURL=recording.js.map