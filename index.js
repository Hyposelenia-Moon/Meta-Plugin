/**
 * Yunzai 入口兼容文件
 *
 * 为什么需要它：框架固定加载 `<插件根>/index.js`，而本插件是 TS 工程（源码 `src/` → 编译产物 `lib/`）。
 * 这里只做一件事：把加载转交给 `lib/index.js`（与 Atlas-Plugin / Mhydps-Plugin 的入口约定一致：
 * 入口负责初始化配置、启动编排、加载 apps，最后 `export { apps }`）。
 *
 * ⚠ 本文件是 JS（不参与编译），所以它相对 `lib/` 的路径是固定一层。
 */
const { apps } = await import('./lib/index.js')

export { apps }
