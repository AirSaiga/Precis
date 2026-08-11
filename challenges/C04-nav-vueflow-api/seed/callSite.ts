/**
 * 调用方示例（C04）：展示 vueFlowApi 的使用契约。
 * 此文件不需修改，仅供参考。
 */
import { initVueFlowApi, requireApi, VueFlowApiNotInitializedError } from './vueFlowApi'

// 模拟组件 setup 内的初始化
function setupComponent(): void {
  const mockApi = { addNodes: () => {}, removeNodes: () => {} }
  initVueFlowApi(mockApi)
}

// 模拟 setup 外的业务代码调用
function businessCode(): unknown {
  try {
    return requireApi()
  } catch (e) {
    if (e instanceof VueFlowApiNotInitializedError) {
      return null  // 调用方可以据此降级
    }
    throw e
  }
}

// 测试入口
export function runScenario(): { afterInitWithoutInit: unknown; afterInit: unknown } {
  // 场景 1：未 init 就 requireApi —— 应抛错（守卫生效）
  let withoutInit: unknown = 'no-throw'
  try { requireApi() } catch (e) {
    if (e instanceof VueFlowApiNotInitializedError) withoutInit = 'threw-correctly'
  }
  // 场景 2：init 后 requireApi —— 应返回注入的 api
  setupComponent()
  const afterInit = businessCode()
  return { afterInitWithoutInit: withoutInit, afterInit }
}
