/**
 * Vue Flow API 单例注入层（C04 seed —— 部分实现）。
 *
 * Vue Flow 的 provide/inject API 只在组件 setup 内可用。本模块把它桥接成
 * 模块级单例，让 Pinia store / 业务代码能在 setup 外调用。
 *
 * 契约：
 *   - initVueFlowApi(api)：在组件 setup 内调用，注入 API
 *   - requireApi()：在 setup 外调用，返回已注入的 API；未注入时抛错
 *
 * 当前状态：initVueFlowApi 的函数体被掏空（TODO），requireApi 的守卫也不完整。
 * 任务：补全两者使单例注入机制工作。
 */

class VueFlowApiNotInitializedError extends Error {
  constructor() {
    super('VueFlowApi 尚未初始化：必须先在组件 setup 内调用 initVueFlowApi()')
    this.name = 'VueFlowApiNotInitializedError'
  }
}

// 模块级单例
let _api: unknown = null

// TODO: 补全此函数 —— 把传入的 api 存入 _api 单例
export function initVueFlowApi(api: unknown): void {
  // 函数体被掏空，当前什么都不做
}

// TODO: 补全此函数的守卫 —— 若 _api 为 null 必须抛 VueFlowApiNotInitializedError
export function requireApi(): unknown {
  // 当前直接返回 _api（无守卫），即使未初始化也不报错 —— 这是 bug
  return _api
}

export { VueFlowApiNotInitializedError }
