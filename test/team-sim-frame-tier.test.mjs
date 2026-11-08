import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { convertPackToFrameTier, validateDataPack, FRAME_TIERS } from '../lib/modules/teamSimulation/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadIttoPack () {
  const file = path.join(root, 'data', 'team-sim', 'packs', 'aratakiitto.json')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

test('帧率换档：60 档与未登记档原样返回同一对象', () => {
  const pack = loadIttoPack()
  assert.equal(convertPackToFrameTier(pack, 'fps-60'), pack)
  assert.equal(convertPackToFrameTier(pack, undefined), pack)
  assert.equal(convertPackToFrameTier(pack, 'fps-999'), pack)
})

test('帧率换档：按档位 fps 比例折算帧数，且仍通过数据包校验', () => {
  const pack = loadIttoPack()
  const factor = FRAME_TIERS['fps-217'].fps / FRAME_TIERS['fps-60'].fps
  const converted = convertPackToFrameTier(pack, 'fps-217')

  const original = pack.actions['aratakiitto.normal-1']
  const scaled = converted.actions['aratakiitto.normal-1']
  assert.equal(original.timing.type, 'frames')
  assert.equal(scaled.timing.type, 'frames')
  assert.equal(scaled.timing.frames, Math.round(original.timing.frames * factor))
  assert.equal(scaled.hits[0].atFrame, Math.round(original.hits[0].atFrame * factor))

  for (const [id, action] of Object.entries(converted.actions)) {
    assert.equal(action.id, id)
    const frames = action.timing.type === 'frames' ? action.timing.frames : action.timing.k
    let previous = -1
    for (const hit of action.hits) {
      assert.ok(Number.isInteger(hit.atFrame), `${id} 命中帧必须是整数`)
      assert.ok(hit.atFrame >= previous, `${id} 命中帧必须非降`)
      assert.ok(hit.atFrame < frames, `${id} 命中帧不能越过动作时长`)
      previous = hit.atFrame
    }
    if (action.cooldownFrames !== undefined) assert.ok(Number.isInteger(action.cooldownFrames))
  }

  const checked = validateDataPack(converted)
  assert.equal(checked.status, 'ok', JSON.stringify(checked.issues?.slice(0, 3)))

  // 原包不被就地改写
  assert.equal(pack.actions['aratakiitto.normal-1'].timing.frames, original.timing.frames)
})
