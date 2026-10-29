/**
 * Atlas-Plugin 适配层（**可选依赖**：缺失或异常必须降级，绝不报错）
 *
 * 别名走正式公共门面 `modules/aliasApi.js`，动态 import + 探测；
 * 不 import 内部实现，不写 Atlas 数据；导入或调用异常只返回空候选。
 * 双向候选由调用方按本仓库标准角色集合裁决，不能直接采用 primary。
 * 图标 / 实体信息仍预留窄接口，等待对应稳定导出。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { botRoot } from '../dir.js'

/** Atlas 插件目录：`META_ATLAS_DIR` 优先；默认 `<bot>/plugins/Atlas-Plugin` */
export function defaultAtlasRoot (): string {
  return process.env.META_ATLAS_DIR
    ? path.resolve(process.env.META_ATLAS_DIR)
    : path.join(botRoot, 'plugins', 'Atlas-Plugin')
}

export interface AtlasStatus {
  /** 插件目录（绝对路径） */
  root: string
  /** 目录是否存在 */
  present: boolean
  /** codex（攻略）相关文件是否还在——阿修剥离后会变 false */
  codex: boolean
  /** 备注（状态页展示用） */
  note: string
}

export class AtlasRes {
  readonly root: string

  constructor (root: string = defaultAtlasRoot()) {
    this.root = root
  }

  private exists (rel: string): boolean {
    try {
      return fs.existsSync(path.join(this.root, rel))
    } catch {
      return false
    }
  }

  /** 插件目录在场 */
  get present (): boolean {
    return this.exists('package.json') || this.exists('index.js')
  }

  /** codex 相关文件仍在（`model/codexIndex/*`） */
  hasCodex (): boolean {
    return this.exists('model/codexIndex/parse.js') || this.exists('model/codexIndex/index.js')
  }

  /** 是否有可用的 Atlas 能力（导入落地前只表示"在场"，不表示能取到数据） */
  available (): boolean {
    return this.present
  }

  /** 只载入正式公共门面；模块缓存交给 ESM，别名结果不缓存以支持实时变更。 */
  async resolveAlias (name: string): Promise<string[]> {
    try {
      const file = path.join(this.root, 'modules', 'aliasApi.js')
      if (!fs.existsSync(file)) return []
      const api = await import(pathToFileURL(file).href)
      if (typeof api.resolveAlias !== 'function') return []
      const result = await api.resolveAlias(name, 'gi')
      return Array.isArray(result?.candidates)
        ? [...new Set(result.candidates.filter((v: unknown): v is string => typeof v === 'string' && !!v.trim()))] as string[]
        : []
    } catch {
      return []
    }
  }

  /**
   * 预留：解析图标（`kind` + 名字 → 相对路径）
   *
   * 导出落地前一律返回 `null`（调用方据此回落到"无图"），这样即使阿修暂时没给，
   * 攻略页也只是少一张图，不会报错。
   */
  icon (_kind: string, _name: string): { rel: string, source: 'atlas' } | null {
    return null
  }

  /** 预留：实体信息（星级 / 武器类型 / 套装描述…） */
  entityOf (_kind: string, _name: string): Record<string, unknown> | null {
    return null
  }

  /** 状态上报 */
  status (): AtlasStatus {
    const present = this.present
    const codex = this.hasCodex()
    return {
      root: this.root,
      present,
      codex,
      note: !present
        ? '未安装（可选依赖，缺失不影响攻略查询）'
        : (this.exists('modules/aliasApi.js')
            ? '在场（正式别名门面可探测；图标 / 实体导出待提供）'
            : (codex ? '在场（codex 模块尚未剥离；别名门面未提供）' : '在场（codex 已剥离，别名门面未提供）'))
    }
  }
}

/** 插件运行期共用的实例 */
export const atlasRes = new AtlasRes()
