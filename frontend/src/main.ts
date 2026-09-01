/**
 * @file main.ts
 * @description Precis 前端应用入口
 *
 * 初始化 Vue 3 应用，挂载 Pinia、Router、i18n 等核心插件。
 * 在 Electron 环境下动态获取后端端口并更新 API 地址。
 */

import './assets/main.css'
// 可变字体（latin 子集按 unicode-range 懒加载，浏览器只下载实际用到的子集）
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
// 注意：electron-api.d.ts 是类型声明文件，会在编译时被 TypeScript 处理
// 无需显式导入，.d.ts 文件会自动被包含在编译中

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { initApiBaseUrl } from './core/services/httpClient'
import { setApiToken } from './core/services/apiToken'
import { appApi } from '@/core/capabilities/appApi'
import { applyThemePreference, getStoredThemePreference } from './core/utils/theme'
import { installGlobalErrorHandler } from './composables/useGlobalErrorHandler'
import { logger } from './core/utils/logger'

/**
 * 初始化应用
 *
 * 初始化流程:
 * 1. 初始化 API 基础地址（Electron 环境下动态获取端口）
 * 2. 创建 Vue 应用实例
 * 3. 挂载插件（Pinia、Router、i18n）
 * 4. 挂载应用到 DOM
 */
async function initApp() {
  applyThemePreference(getStoredThemePreference())

  // 初始化 API 默认地址，再由能力抽象层处理 Electron 动态端口
  await initApiBaseUrl()
  // 注入后端 API 一次性 token（Electron 打包模式经 IPC 下发；Web 为空串）。
  // 必须在 initializeApiClient 之前完成——Web 适配器的 initializeApiClient 会发
  // /version 健康探测，是首个业务请求，token 头须先就位（该请求走 localhost CORS
  // 不受影响，但保持"任何业务请求前完成注入"的顺序约定）。
  try {
    setApiToken(await appApi.getApiToken())
  } catch (error) {
    logger.warn('[main] 获取后端 API token 失败，将以无 token 模式运行:', error)
  }
  await appApi.initializeApiClient()

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)
  app.use(i18n) // 集成 i18n 到应用

  // 注册全局错误处理器(必须在 pinia 挂载后、mount 前,以便 feedbackStore 可用)
  installGlobalErrorHandler(app)

  app.mount('#app')

  // 开发模式下将核心 store 挂载到 window，方便控制台调试和手动备份
  if (import.meta.env.DEV) {
    const { useGraphStore } = await import('@/stores/graphStore')
    const { useProjectStore } = await import('@/stores/projectStore')
    const graphStore = useGraphStore()
    const projectStore = useProjectStore()
    ;(window as unknown as Record<string, unknown>).__CRYSTAL_STORES__ = {
      graphStore,
      projectStore,
      exportState() {
        const state = {
          nodes: graphStore.nodes,
          edges: graphStore.edges,
          projectPaths: projectStore.currentPaths,
        }
        localStorage.setItem('crystal_dev_backup', JSON.stringify(state))
        return state
      },
      importState() {
        const raw = localStorage.getItem('crystal_dev_backup')
        if (!raw) return null
        const state = JSON.parse(raw)
        graphStore.nodes = state.nodes || []
        graphStore.edges = state.edges || []
        if (state.projectPaths) {
          projectStore.setProjectPaths(state.projectPaths)
        }
        return state
      },
    }
  }
}

initApp().catch((err: unknown) => {
  // 兜底：初始化失败（如后端端口探测异常、插件注册报错）时避免白屏无反馈。
  // 此时 Vue 应用尚未挂载，全局错误处理器不可用，只能记录日志并直接挂一条最小 DOM 提示
  logger.error('[main] 应用初始化失败:', err)
  const root = document.getElementById('app')
  if (!root) return
  const box = document.createElement('div')
  box.setAttribute('role', 'alert')
  box.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'height:100vh;gap:8px;padding:24px;text-align:center;font-family:system-ui,sans-serif;'
  const title = document.createElement('div')
  title.style.cssText = 'font-size:16px;font-weight:600;color:#d03050;'
  title.textContent = '应用初始化失败 / Failed to initialize the app'
  const detail = document.createElement('div')
  detail.style.cssText = 'font-size:12px;color:#888;max-width:640px;word-break:break-all;'
  detail.textContent = err instanceof Error ? err.message : String(err)
  box.appendChild(title)
  box.appendChild(detail)
  root.appendChild(box)
})
