/**
 * 六模块视图模型
 *
 * 数据 → 视图的唯一入口：`CodexStore` 读出的原始 guide 交给维护者区的单一真相做归一
 * （`v2ToSections` + `normalizeGuideSections`），这里只负责组装页面需要的东西，
 * 并提供「分支取用」（`#攻略 <角色> 武器` 这类，命令侧在阶段 3 接）。
 *
 * 归一的语义（档位词 推荐/可选/过渡、`＞`、等价候选 `=`、2+2 简写、专武标红/绿、活动标签、
 * 空模块「暂无」）**全部由维护者区负责**，本模块不重复实现、也不改写结果。
 */
import type { Guide } from '../model/CodexStore.js'
import { listGuidePresets, selectGuidePreset } from './guidePresets.js'
import { attackIcon, characterSplash, iconForRef, talentIcon } from '../model/IconResolver.js'
import { buildCodexPresentation, normalizeMetaValue, type CodexMeta } from '../components/presentation.js'
import {
  EMPTY_TEXT,
  WEAPON_REFINE_HINT,
  buildV2Sections,
  type DisplaySection
} from '../model/markup.js'

/** 六个模块的规范标题（= `guide-display.mjs` 的 `DISPLAY_SECTIONS` 标题，也就是分支命令用的词） */
export const SUB_VIEW_TITLES = ['武器', '圣遗物', '天赋', '面板', '命座', '配队'] as const

export type SubViewTitle = (typeof SUB_VIEW_TITLES)[number]

export interface CodexView {
  /** 角色标准名 */
  name: string
  /** 建议等级 / 定位 / 100级提升 …（原样透传，模板决定怎么展示） */
  meta: Record<string, unknown>
  /** 面向模板的 meta 行：**只保留有值的项**（空串不进模板，避免出现"定位："这种空行） */
  metaRows: Array<{ label: string, value: string }>
  /** 归一后的六个模块（顺序固定：武器 → 圣遗物 → 天赋 → 面板 → 命座 → 配队） */
  sections: DisplaySection[]
  /**
   * 是否有攻略内容 —— 判据与维护者流水线、`CodexStore.isFilled` 一致：**`meta` 任一字段非空**。
   * 空档角色（米提亚 / 瓦列里）为 false：不进列表，点名查询回「攻略待补充」（§13.1 B12）。
   */
  hasContent: boolean
  /** 模板用的小文案 */
  hints: {
    /** 空模块占位（`暂无`） */
    empty: string
    /** 武器精炼提示 */
    refine: string
  }
}

export interface BuildViewOptions {
  /** 本角色的专武表（`CodexStore.getSignature(name)`） */
  signature?: Record<string, unknown> | null
  /** 全局武器标签表（`CodexStore.getWeaponTags()`） */
  weaponTags?: Record<string, unknown> | null
}

/**
 * 组装角色攻略视图
 *
 * @param guide `CodexStore.getGuide(name)` 的原始数据
 * @param opts 专武表与武器标签表（不传也能出图，只是没有专武标色与活动标签）
 * @returns 无数据或原始多预设未选择时返回 null；多预设必须先 selectGuidePreset 投影。
 */
export function buildCodexView (guide: Guide | null, opts: BuildViewOptions = {}): CodexView | null {
  if (!guide) return null
  if (Array.isArray(guide.presets)) {
    const presets = listGuidePresets(guide)
    // 只自动选择唯一预设；多预设返回 null，由命令层提示选择，不合并或猜第一份。
    if (presets.length !== 1) return null
    guide = selectGuidePreset(guide, presets[0])
  }

  const meta = (guide.meta && typeof guide.meta === 'object')
    ? guide.meta as Record<string, unknown>
    : {}

  /*
   * meta 行：占位值（`___%`）不进模板（2026-10-15 审核意见 4.4：图片与文本回退同一份来源），
   * 且"占位值"不算攻略内容 —— `hasContent` 沿用「meta 有非空值」这一条（与维护者流水线的
   * `isFilled` 同口径），否则空档角色会因为一个未填字段被当成"有攻略"。
   */
  const metaRows = Object.entries(meta)
    .map(([label, value]) => ({ label, value: normalizeMetaValue(value) }))
    .filter(row => row.value.length > 0)

  const sections = buildV2Sections(guide, {
    signature: opts.signature ?? null,
    weaponTags: opts.weaponTags ?? {}
  })

  return {
    name: String(guide.name ?? ''),
    meta,
    metaRows,
    sections,
    hasContent: metaRows.length > 0,
    hints: { empty: EMPTY_TEXT, refine: WEAPON_REFINE_HINT }
  }
}

/** 模板数据的可选页头/页脚字段 */
export interface PageOptions {
  /** 页脚版权行（`components/constants.ts` 的 COPYRIGHT） */
  copyright?: string
  /** 渲染缩放（`components/render.ts` 会塞进模板数据） */
  renderScale?: number
  /** 角色立绘（miao 相对路径；与 portraitSrc 二选一，后者优先） */
  portrait?: string
  /**
   * 角色立绘**完整地址**（图库 / miao 默认立绘都行，ProfileImgRes.pageImageUrl() 的产物）
   *
   * 图库图可能在别的盘，不能像 miao 资源那样拼 {{_miao_path}}，所以要传整串地址。
   */
  portraitSrc?: string
  /** 立绘的 data: URL（页面内自量自裁用；空则退回 portraitSrc） */
  portraitData?: string
  /** 留白判定参数（页面脚本用；来自 ProfileImgRes.cropCfg） */
  cropCfg?: { tol: number, cover: number, min: number, colorCap: number, whiteLevel: number, whiteLineCover: number }
  /** 原神字体（标题区「角色攻略」用；空 = 没找到字体文件，回落系统字体） */
  genshinFont?: { family: string, url: string }
  /** 攻略数据文件最后修改时间（YYYY.MM.DD；空 = 读不到，模板写「未提供」） */
  guideUpdatedAt?: string
  /**
   * 立绘区宽高比（ProfileImgRes.pickPagePortrait().ratio）
   *
   * 模板用它给立绘框定高（spect-ratio），图库大图按 object-fit: cover 裁进来 ——
   * 这样「比例不同的大图」也能用，而版面高度与用默认立绘时一致。
   */
  portraitRatio?: string
  /**
   * 主体层定位（ProfileImgRes.planPortraitBox() 的产物，百分比字符串）
   *
   * 白边图裁掉白边后按 contain 摆进卡片，铺不满的边由模板里的模糊层兜住。
   */
  portraitBox?: { width: string, height: string, left: string, top: string }
  /** 页头副标题（默认「角色攻略」） */
  subTitle?: string
  /**
   * 角色元素（miao 的 `data.json.elem`，如 `pyro`）
   *
   * 交给 miao 的布局（`elemLayout` 把它拼成 `elem-pyro` 之类），用于套用**对应元素**的底图与底纹；
   * 不传时布局默认 `hydro`（会与角色元素不符，背景偏蓝）。
   */
  element?: string
}

/** 模板数据（`resources/codex/codex.html` 的数据契约；字段名改动必须同步模板与套件） */
export interface CodexPageData extends CodexView {
  copyright: string
  renderScale: number
  portrait: string
  /** 立绘完整地址（优先于 portrait） */
  portraitSrc: string
  portraitData: string
  /** 留白判定参数（页面脚本用，来自 ProfileImgRes.cropCfg） */
  cropCfg: { tol: number, cover: number, min: number, colorCap: number, whiteLevel: number, whiteLineCover: number }
  /** 原神字体（标题区「角色攻略」用；空 = 回落系统字体） */
  genshinFont: { family: string, url: string }
  /** 攻略数据文件最后修改时间（YYYY.MM.DD；空 = 未提供） */
  guideUpdatedAt: string
  /** 立绘区宽高比（空串 = 不锁定，退回图片自身比例） */
  portraitRatio: string
  /** 立绘主体层定位（宽高/左上角，百分比字符串；空串 = 走模板默认铺满） */
  portraitBox: { width: string, height: string, left: string, top: string }
  subTitle: string
  element: string
  /** 展示层投影（2026-10-15 UI 重构：章节序号 + 共享行组件 + 来源条；旧字段全部保留） */
  mx: CodexMeta
}

/** 视图 → 模板数据（模板只读这里给出的字段） */
export function toPageData (view: CodexView, opts: PageOptions = {}): CodexPageData {
  return {
    ...view,
    copyright: opts.copyright ?? '',
    renderScale: opts.renderScale ?? 1,
    portrait: opts.portrait ?? '',
    portraitSrc: opts.portraitSrc ?? '',
    portraitData: opts.portraitData ?? '',
    cropCfg: opts.cropCfg ?? { tol: 6, cover: 0.98, min: 0.03, colorCap: 0.12, whiteLevel: 240, whiteLineCover: 0.95 },
    genshinFont: opts.genshinFont ?? { family: '', url: '' },
    guideUpdatedAt: opts.guideUpdatedAt ?? '',
    portraitRatio: opts.portraitRatio ?? '',
    portraitBox: opts.portraitBox ?? { width: '', height: '', left: '', top: '' },
    subTitle: opts.subTitle ?? '角色攻略',
    element: opts.element ?? '',
    mx: buildCodexPresentation(view, {
      copyright: opts.copyright ?? '',
      sources: [{
        source: 'codex',
        name: '',
        mode: 'local',
        modeText: '',
        updatedAt: opts.guideUpdatedAt ?? '',
        observedAt: 0
      }]
    })
  }
}

/** 是否为合法的分支词（武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队） */
export function isSubViewTitle (key: string): key is SubViewTitle {
  return (SUB_VIEW_TITLES as readonly string[]).includes(String(key ?? '').trim())
}

/** 取某个模块；词非法或不存在返回 null */
export function pickSection (view: CodexView, key: string): DisplaySection | null {
  const title = String(key ?? '').trim()
  if (!isSubViewTitle(title)) return null
  return view.sections.find(section => section.title === title) ?? null
}

/** 收窄成单模块视图（`#攻略 <角色> 武器` 用）；词非法返回 null */
export function narrowToSubView (view: CodexView, key: string): CodexView | null {
  const section = pickSection(view, key)
  if (!section) return null
  return { ...view, sections: [section] }
}

/**
 * 给视图条目挂图标
 *
 * 图标是**相对 miao resources 的路径**（模板里配 `{{_miao_path}}`）：
 * miao 优先、Atlas 兜底、都没有就不挂（模板回落纯文字，不出现破图）。
 * 命座图标需要角色上下文（`constellation:N` 的 ref 只有序号）。
 */
export function withIcons (view: CodexView, ctx: { character: string }): CodexView {
  const sections = view.sections.map(section => {
    const next: DisplaySection = { ...section }

    if (Array.isArray(section.rows)) {
      /** 单个条目的图标解析（原逻辑原样保留） */
      const resolveItem = (item: Record<string, unknown>): Record<string, unknown> => {
        const icon = iconForRef(String(item.ref ?? ''), { character: ctx.character })
        if (icon) return { ...item, icon: icon.rel, iconSource: icon.source }
        // 天赋三格：攻略数据只给字母（A/E/Q），ref 取不到图标时按**练度页同源规则**再解析一次
        // （`IconResolver.talentIcon()` → `MiaoRes.talentIcon()`：命中 `talentCons` 用命座图标，否则 `icons/talent-{letter}.webp`）
        // 真实数据字段是 `name`（攻略 JSON 的 `v2.talents.order`），模板侧才叫 `text` —— 这里两个都认
        const letter = String((item as { name?: unknown }).name ?? item.text ?? '').trim()
        if (/^[AEQ]$/.test(letter)) {
          const talent = talentIcon(ctx.character, letter)
          if (talent) return { ...item, icon: talent.rel, iconSource: talent.source }
          // A（普攻）槽：面板用角色武器类型的**通用武器图标**（`common/item/atk-*.webp`）
          if (letter === 'A') {
            const atk = attackIcon(ctx.character)
            if (atk) return { ...item, icon: atk.rel, iconSource: atk.source }
          }
        }
        return item
      }

      next.rows = section.rows.map(row => ({
        ...row,
        // 同级并列（数据里把同级的几件写成一个 item，名字用 `\` 连接，渲染显示为 `=`）：
        // 规则要求它们是**独立个体**，各自带图标 → 此处按 `\` 拆成多项，项间分隔符用 `=`。
        items: (row.items ?? []).flatMap(item => {
          const raw = String((item as { name?: unknown }).name ?? item.text ?? '')
          const joiner = raw.includes('\\') ? '\\' : (raw.includes('=') ? '=' : '')
          if (!joiner) return [resolveItem(item as Record<string, unknown>)]
          const parts = raw.split(joiner).map(s => s.trim()).filter(Boolean)
          const refRaw = String((item as { ref?: unknown }).ref ?? '')
          return parts.map((name, i) => resolveItem({
            ...(item as Record<string, unknown>),
            name,
            text: name,
            ref: refRaw ? refRaw.split(':')[0] + ':' + name : '',   // 用种类前缀 + 新名字重建（视图里的 ref 可能与文本分隔符不同）
            sepAfter: i < parts.length - 1 ? '=' : String((item as { sepAfter?: unknown }).sepAfter ?? '')
          }))
        })
      }))
    }

    if (Array.isArray(section.teams)) {
      next.teams = section.teams.map(team => ({
        ...team,
        members: (team.members ?? []).map(member => {
          const icon = iconForRef(String(member.ref ?? ''), { character: ctx.character })
          /*
           * 多选槽（`莫娜 / 沃雅妮莎`）：逐个候选解析图标（2026-10-18 核对修复 #9）。
           * 首选之外的候选没有 `ref`，按 `character:<名字>` 现拼一个再解析；解析不到就留空，模板画名字。
           */
          /*
           * 2026-10-18：候选槽（`莫娜 / 沃雅妮莎`）必须在**这一层**拆好，
           * 因为图标解析（iconForRef）就发生在这里；presentation 之后才拆的话 alts 永远没有图标。
           */
          const nameRaw = String((member as { name?: unknown }).name ?? '')
          const splitNames = nameRaw.split(/[／/]/).map(s => s.trim()).filter(Boolean)
          const altList = (member as { alts?: unknown[] }).alts?.length
            ? (member as { alts: unknown[] }).alts
            : (splitNames.length ? splitNames : [nameRaw]).map(n => ({ name: n, icon: '' }))
          const alts = altList.map(alt => {
            if (!alt || typeof alt !== 'object') return alt
            const altIcon = iconForRef(`character:${String((alt as { name?: string }).name ?? '')}`, { character: ctx.character })
            return altIcon ? { ...alt, icon: altIcon.rel } : alt
          })
          return { ...(icon ? { ...member, icon: icon.rel } : member), alts }
        })
      }))
    }

    return next
  })

  return { ...view, sections }
}

/** 页头立绘（相对 miao resources 的路径；取不到返回 null，模板不画立绘） */
export function portraitOf (character: string): string | null {
  try {
    return characterSplash(character)?.rel ?? null
  } catch {
    return null
  }
}

/**
 * 视图 → 纯文本（渲染失败时回落，内容与出图同源）
 *
 * 与帮助页同一策略：出图挂了就发文本版，而不是"图挂了就没内容"。
 */
export function viewToText (view: CodexView): string {
  const lines: string[] = [`${view.name} · ${view.hints.empty === EMPTY_TEXT ? '攻略' : '攻略'}`]

  for (const row of view.metaRows) lines.push(`${row.label}：${row.value}`)

  for (const section of view.sections) {
    lines.push('', `【${section.title}】`)
    if (section.empty) {
      lines.push(view.hints.empty)
      continue
    }
    if (section.kind === 'teams') {
      for (const team of section.teams ?? []) {
        const members = (team.members ?? []).map(m => `${m.name ?? ''}${m.note ? `（${m.note}）` : ''}`).join(' + ')
        lines.push(`· ${team.tag ? `${team.tag}：` : ''}${members}${team.text ? `${team.text}` : ''}`)
      }
      continue
    }
    for (const row of section.rows ?? []) {
      const items = (row.items ?? [])
        .map(item => `${item.text ?? ''}${item.note ? `（${item.note}）` : ''}`)
        .join(' ')
      lines.push(`· ${row.label ? `${row.label}：` : ''}${items}`)
    }
    if (section.title === '武器') lines.push(view.hints.refine)
  }

  return lines.join('\n')
}
