/**
 * 骨架自检（阶段 0）：确认 TS 工程与入口约定就位
 *
 * 只读文件做静态断言，不编译、不启动 bot。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createChecks, pluginRoot, readJson, readText, srcDir } from './_helper.mjs'

const { push, ok, report } = createChecks('骨架自检（阶段 0）')

// ---- package.json ----
const pkgFile = path.join(pluginRoot, 'package.json')
const hasPkg = fs.existsSync(pkgFile)
ok('package.json 存在', hasPkg)
if (hasPkg) {
  const pkg = readJson(pkgFile)
  push('package.json: name', pkg.name, 'meta-plugin')
  push('package.json: type', pkg.type, 'module')
  push('package.json: main', pkg.main, 'index.js')
  ok('package.json: 有 build 脚本', typeof pkg.scripts?.build === 'string')
  ok('package.json: 有 test 脚本', typeof pkg.scripts?.test === 'string')
  ok('package.json: 依赖 yaml', typeof pkg.dependencies?.yaml === 'string')
  ok('package.json: devDeps 有 typescript', typeof pkg.devDependencies?.typescript === 'string')
}

// ---- tsconfig.json ----
const tsFile = path.join(pluginRoot, 'tsconfig.json')
ok('tsconfig.json 存在', fs.existsSync(tsFile))
if (fs.existsSync(tsFile)) {
  // 容错：允许 JSONC 注释（tsc 支持），这里简单剥掉整行注释再解析
  const raw = readText(tsFile).split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const ts = JSON.parse(raw)
  push('tsconfig: outDir', ts.compilerOptions?.outDir, 'lib')
  push('tsconfig: rootDir', ts.compilerOptions?.rootDir, 'src')
  push('tsconfig: strict', ts.compilerOptions?.strict, true)
  push('tsconfig: include 只含 src', ts.include, ['src/**/*.ts'])
}

// ---- 根入口 index.js ----
const entryFile = path.join(pluginRoot, 'index.js')
ok('根 index.js 存在', fs.existsSync(entryFile))
if (fs.existsSync(entryFile)) {
  const text = readText(entryFile)
  ok('根 index.js 转交 lib/index.js', text.includes("./lib/index.js"))
  ok('根 index.js 导出 apps', /export\s*\{\s*apps\s*\}/.test(text))
}

// ---- src/ 骨架 ----
const expectSrc = [
  'dir.ts',
  'index.ts',
  'model/startup.ts',
  'components/config.ts',
  'types/yunzai.d.ts'
]
for (const rel of expectSrc) {
  ok(`src/${rel} 存在`, fs.existsSync(path.join(srcDir, rel)))
}

// ---- dir.ts / config.ts 的关键约定 ----
const dirText = fs.existsSync(path.join(srcDir, 'dir.ts')) ? readText(path.join(srcDir, 'dir.ts')) : ''
for (const name of ['pluginRoot', 'libDir', 'dataDir', 'resourcesDir', 'configDir']) {
  ok(`dir.ts 导出 ${name}`, dirText.includes(`export const ${name}`))
}

const cfgText = fs.existsSync(path.join(srcDir, 'components', 'config.ts'))
  ? readText(path.join(srcDir, 'components', 'config.ts'))
  : ''
ok('config.ts 有 defaultConfig', cfgText.includes('export const defaultConfig'))
ok('config.ts: networkEnabled 默认关', /networkEnabled:\s*false/.test(cfgText))
ok('config.ts 支持 META_CONFIG_FILE 覆盖', cfgText.includes('META_CONFIG_FILE'))

const bad = report()
process.exit(bad ? 1 : 0)
