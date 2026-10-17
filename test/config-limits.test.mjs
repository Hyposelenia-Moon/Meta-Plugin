/**
 * 配置边界：越界/非法值一律回落到安全值
 *
 * 配置写错（0.1、999、NaN）不能把渲染打爆或让请求永不超时，所以每个取值函数都要有夹取，
 * 这里逐项钉住边界；同时验证代理地址会被修剪空白。
 */
import fs from 'node:fs'
import path from 'node:path'
import { checker, installFrameworkStubs, mod, requireDeps, tempDataDir } from './_helper.mjs'

installFrameworkStubs()
requireDeps('yaml')

const cfgDir = tempDataDir('config-limits')
const cfgFile = path.join(cfgDir, 'config.yaml')
fs.writeFileSync(cfgFile, [
  'priority: 8000',
  'renderScale: 9',
  'proxy: "  http://proxy.example:8080  "',
  'dpsCacheTtlMinutes: 0',
  'dpsPageSize: 999',
  'dpsTimeoutMs: 1',
  'dpsAvatarEnabled: false'
].join('\n'), 'utf8')

process.env.META_CONFIG_FILE = cfgFile

  const { getPluginConfig, getProxy, getRenderScale, clampRenderScale, getPageSize, getDpsCacheTtlMinutes, getDpsTimeoutMs, defaultConfig } = await import(mod('components/config.js'))

const { check, finish } = checker()

// ---- 纯函数夹取（不依赖配置文件） ----
check('渲染缩放下限', clampRenderScale(0.1) === 0.5)
check('渲染缩放上限', clampRenderScale(9) === 3)
check('渲染缩放非法值回落默认', clampRenderScale('abc') === defaultConfig.renderScale)
check('渲染缩放 null 回落默认', clampRenderScale(null) === defaultConfig.renderScale)
check('渲染缩放正常值原样', clampRenderScale(2) === 2)
check('渲染缩放字符串数字可用', clampRenderScale('1.2') === 1.2)

// ---- 从配置文件取值 ----
check('配置已加载（非默认）', getPluginConfig().dpsPageSize === 999)
check('renderScale 上限夹取', getRenderScale() === 3)
check('pageSize 上限夹取为 20', getPageSize() === 20)
check('timeoutMs 下限夹取为 3000', getDpsTimeoutMs() === 3000)
check('cacheTtlMinutes 非法值回落默认', getDpsCacheTtlMinutes() === defaultConfig.dpsCacheTtlMinutes)
check('proxy 修剪空白', getProxy() === 'http://proxy.example:8080', JSON.stringify(getProxy()))
check('avatarEnabled 读到 false', getPluginConfig().dpsAvatarEnabled === false)

// ---- 缺省兜底：配置文件不存在时用默认值 ----
process.env.META_CONFIG_FILE = path.join(cfgDir, 'not-exists.yaml')
const cfg2 = await import(`${mod('components/config.js')}?fresh=1`)
check('配置文件缺失时回落默认值', cfg2.getPluginConfig().dpsPageSize === defaultConfig.dpsPageSize)
check('缺失时 priority 为 8000', cfg2.getPluginConfig().priority === 8000)

finish()
