/**
 * Atlas-Plugin 适配层（**可选依赖**：缺失或异常必须降级，绝不报错）
 *
 * 现状（2026-10-13）：阿修承诺的四项稳定导出**尚未落地**（设计文档 §10 第 1 项：
 * 别名解析 / 图标路径 / 实体信息 / codex 旧资产移交，形式由他定）。因此本模块当前只做：
 *   1. **存在性探测**（Atlas 仓库是否在场、codex 相关文件是否还在）；
 *   2. **状态上报**（供状态页显示"Atlas 是否可用"）；
 *   3. 预留窄接口 `icon()` / `entityOf()`，等导出形态明确后在此适配，调用方无需改动。
 *
 * 边界：
 *   - 全链路 try/catch，任何失败只 `logger.warn` 并返回降级值；
 *   - **不 import Atlas 的任何模块**：它在 bot 的另一个插件目录，且作者随时可能剥离 codex；
 *     需要数据时应当走阿修提供的稳定导出（届时用动态 import + 探测）。
 */
import fs from 'node:fs'
import path from 'node:path'
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
        : (codex ? '在场（codex 模块尚未剥离；四项稳定导出待作者提供）' : '在场（codex 已剥离，等待稳定导出）')
    }
  }
}

/** 插件运行期共用的实例 */
export const atlasRes = new AtlasRes()
