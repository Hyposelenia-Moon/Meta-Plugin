/**
 * Yunzai 运行时最小类型声明
 *
 * 框架把 `logger` / `segment` 等挂在全局，插件代码直接使用（Atlas / Mhydps 都是这个写法）。
 * 本文件**没有 import / export**，因此是全局声明文件（script，而非 module）。
 */
declare const logger:
  | {
      info: (...args: unknown[]) => void
      warn: (...args: unknown[]) => void
      error: (...args: unknown[]) => void
      mark?: (...args: unknown[]) => void
      debug?: (...args: unknown[]) => void
      red?: (text: string) => string
      green?: (text: string) => string
      yellow?: (text: string) => string
    }
  | undefined

/** 消息事件（只声明本项目用到的字段） */
interface YunzaiEvent {
  /** 处理后的指令文本（如 `#胡桃攻略`） */
  msg: string
  /** 原始消息段 */
  message?: unknown[]
  user_id?: number | string
  group_id?: number | string
  isGroup?: boolean
  isMaster?: boolean
  /** 回复（传图片 segment 或文本） */
  reply: (msg: unknown, quote?: boolean) => Promise<unknown>
}

declare const segment: {
  image: (file: string) => unknown
  text?: (text: string) => unknown
}
