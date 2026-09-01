/**
 * @file apiToken.ts
 * @description 后端 API 一次性 token 的模块级存取
 *
 * 背景（打包模式 CORS 安全）:
 * - Electron 主进程每次启动后端生成随机 token，注入后端环境变量 PRECIS_API_TOKEN，
 *   并经 IPC（electronAPI.getApiToken）下发给渲染进程
 * - 渲染进程在此保存 token，由 httpClient 请求拦截器 / sseClient 统一注入
 *   X-Precis-Auth 请求头；后端据此放行 app:// 页面（Origin: null）的跨域请求
 * - 恶意网页（沙箱 iframe，Origin 恒 null）拿不到 token，其请求仍被后端 CORS 拒绝
 *
 * 生命周期:
 * - Web / 开发模式（无 Electron IPC 下发）token 恒为空串，hasApiToken() 为 false，
 *   拦截器不注入该头，后端中间件同样未配置 token、完全直通——行为与无 token 机制一致
 * - token 仅存内存，不落 localStorage（避免持久化凭据、降低 XSS 可利用面）
 */

/** 模块级 token（空串表示未配置） */
let apiToken = ''

/**
 * 保存后端 API token（应用启动时由 main.ts 调用一次）
 *
 * @param token - Electron IPC 下发的 64 字符 hex token；空串表示无 token
 */
export function setApiToken(token: string): void {
  apiToken = token
}

/** 获取当前 token；未配置时返回空串 */
export function getApiToken(): string {
  return apiToken
}

/** 是否已配置 token（决定拦截器是否注入 X-Precis-Auth 头） */
export function hasApiToken(): boolean {
  return apiToken.length > 0
}
