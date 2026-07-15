import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { dynamicBackendProxy } from './dynamic-backend-proxy'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  return {
    // 使用相对路径，确保 Electron 本地文件加载时能正确解析资源
    base: './',
    // Vue DevTools 仅在开发模式加载，避免污染生产构建产物
    // dynamicBackendProxy:中间件方案,拦截后端 API 路由转发到动态端口(Vite 8 不支持 router)
    plugins: [vue(), dynamicBackendProxy(), ...(mode !== 'production' ? [vueDevTools()] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // CodeMirror 生态（编辑器相关，体积较大且非首屏必需）
              if (
                id.includes('codemirror') ||
                id.includes('@codemirror') ||
                id.includes('vue-codemirror')
              ) {
                return 'vendor-codemirror'
              }
              // Vue Flow 生态（画布核心库）
              if (id.includes('@vue-flow')) {
                return 'vendor-vue-flow'
              }
              // 导出功能库（PDF/截图，使用频率低）
              if (id.includes('jspdf') || id.includes('html2canvas')) {
                return 'vendor-export'
              }
              // Vue 核心生态（框架运行时）
              if (
                id.includes('vue') ||
                id.includes('pinia') ||
                id.includes('vue-router') ||
                id.includes('vue-i18n')
              ) {
                return 'vendor-vue'
              }
              // 工具库
              if (id.includes('lodash-es')) {
                return 'vendor-lodash'
              }
              if (id.includes('axios')) {
                return 'vendor-http'
              }
            }
          },
        },
      },
    },
    optimizeDeps: {
      // 排除 electron 的预优化，避免构建时解析失败
      exclude: ['electron'],
    },
    server: {
      // 后端 API 代理由 dynamicBackendProxy() 插件的中间件处理(动态读取 .backend-port),
      // 此处不再配置静态 server.proxy。
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        reportsDirectory: './coverage',
        // 仅统计 .ts 文件：.vue 组件由 E2E（Playwright）覆盖，不纳入单元测试覆盖率统计
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.{test,spec}.{ts,vue}',
          'src/**/*.d.ts',
          'src/main.ts',
          'src/**/index.ts',
          'src/**/types/**',
          'src/composables/**',
          // features 下仅排除 UI/运行时相关（由 E2E 覆盖）；
          // 保留 features 根级的纯逻辑 .ts（如未来新增 utils/services）
          'src/features/**/components/**',
          'src/features/**/composables/**',
          'src/features/**/types/**',
          'src/components/**',
        ],
        thresholds: {
          lines: 48,
          branches: 37,
          functions: 46,
          statements: 47,
        },
      },
    },
  }
})
