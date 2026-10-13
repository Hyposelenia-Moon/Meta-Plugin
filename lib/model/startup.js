/**
 * 启动编排（只读磁盘、不发网络）
 *
 * 阶段 0 先留空壳，阶段 1 在这里接入 `CodexStore`（载入 `data/gi` 索引与攻略数据）。
 * 之所以单独成文件：入口 `index.ts` 只负责"配置 → 启动 → 加载 apps"的顺序，
 * 具体载入逻辑放这里，便于回归套件直接调用而不经框架。
 */
export async function initStore() {
    // 阶段 1：读 data/gi/_order.json、data/gi/*.json、data/_index.json 等，建立内存索引
}
//# sourceMappingURL=startup.js.map