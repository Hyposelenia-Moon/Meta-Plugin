/** 轴文件通路：仓库里的手写示例必须能被校验、被找到、被转成可执行的轴。 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot } from './_helper.mjs'

const { ok, report } = createChecks('队伍模拟 · 轴文件通路')
const mod = p => pathToFileURL(path.join(libDir, p)).href
const S = await import(mod('modules/teamSimulation/index.js'))
const Store = await import(mod('model/TeamSimStore.js'))

const rotationPath = path.join(pluginRoot, 'data', 'team-sim', 'rotations', 'geo-four.json')
ok('示例轴文件存在', fs.existsSync(rotationPath))
const file = JSON.parse(fs.readFileSync(rotationPath, 'utf8'))

const packNames = ['aratakiitto', 'gorou', 'albedo', 'zhongli']
const packs = packNames.map(name => JSON.parse(fs.readFileSync(path.join(pluginRoot, 'data', 'team-sim', 'packs', `${name}.json`), 'utf8')))
const combined = S.combineDataPacks(packs)
ok('四个动作包能合并', combined.status === 'ok', JSON.stringify(combined.issues?.slice(0, 3)))
const pack = combined.pack

const checked = S.validateRecording(file.recording)
ok('录制通过校验', checked.status === 'ok', JSON.stringify(checked.issues?.slice(0, 3)))

const converted = S.recordingToRotation(file.recording, file.keymap, {
  id: file.id,
  measurementEndFrame: file.measurementEndFrame,
  ...(file.scheduler ? { scheduler: file.scheduler } : {})
})
ok('录制能转成轴', converted.status === 'ok', JSON.stringify(converted.issues?.slice(0, 3)))
ok('示例轴 11 步', converted.rotation?.steps.length === 11, String(converted.rotation?.steps.length))
ok('窗口为 fps-60 的 120 秒（7243 帧）', converted.rotation?.measurementEndFrame === 7243)

const issues = converted.rotation ? S.validateRotation(converted.rotation, pack) : []
ok('轴与动作包匹配（无 unsupported）', issues.length === 0, JSON.stringify(issues.slice(0, 4)))

const found = Store.findRotation(file.team)
ok('按队伍 charId 能找到这份轴', !!found.rotationFile && path.basename(found.file) === 'geo-four.json', JSON.stringify(found.issues))
const viaStore = found.rotationFile ? Store.toRotation(found.rotationFile, pack) : null
ok('Store.toRotation 状态 ok', viaStore?.status === 'ok', JSON.stringify(viaStore?.issues?.slice(0, 3)))

report()
