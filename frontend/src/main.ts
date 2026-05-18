/**
 * @file main.ts
 * @description Precis 前端应用入口
 *
 * 初始化 Vue 3 应用，挂载 Pinia、Router、i18n 等核心插件。
 * 在 Electron 环境下动态获取后端端口并更新 API 地址。
 */

import './assets/main.css'
// 注意：electron-api.d.ts 是类型声明文件，会在编译时被 TypeScript 处理
// 无需显式导入，.d.ts 文件会自动被包含在编译中

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { initApiBaseUrl } from './core/services/httpClient'
import { applyThemePreference, getStoredThemePreference } from './core/utils/theme'

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

  // 初始化 API 地址（支持 Electron 动态端口）
  await initApiBaseUrl()

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)
  app.use(i18n) // 集成 i18n 到应用

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

initApp()
