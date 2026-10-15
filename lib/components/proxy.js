/**
 * proxy — 代理串的安全展示（2026-10-15 审核 P1）
 *
 * `#meta状态` 对所有用户开放，展示数据里若原样带上 `getProxy()` 结果，
 * 代理地址含认证信息时会在图片、文本回退与"无缓存"提示里泄露用户名/密码。
 * 本模块只做两件事：**脱敏**（去掉 URL 的用户名与密码）与**判断是否含认证**（只回答有没有，不回显）。
 *
 * 无框架依赖，可被套件直接 import 做行为断言。
 */
/** 代理展示串：统一删除 URL 里的用户名/密码 */
export function proxySafe(raw) {
    const text = String(raw || '').trim();
    if (!text)
        return '';
    try {
        const u = new URL(text);
        u.username = '';
        u.password = '';
        return u.toString().replace(/\/$/, '');
    }
    catch {
        // 解析不了（如 socks5 的某些写法）→ 退化为字符串级脱敏
        return text.replace(/\/\/[^/@\s]*@/, '//');
    }
}
/** 代理串里是否带认证信息（只看有没有，不回显） */
export function proxyHasAuth(raw) {
    return /\/\/[^/@\s]*@/.test(String(raw || ''));
}
//# sourceMappingURL=proxy.js.map