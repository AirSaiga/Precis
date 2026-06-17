import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 读取环境变量，支持通过 .env 文件或命令行覆盖后端端口
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.VITE_BACKEND_PORT || '18000'
  const backendTarget = `http://localhost:${backendPort}`

  return {
    // 使用相对路径，确保 Electron 本地文件加载时能正确解析资源
    base: './',
    // Vue DevTools 仅在开发模式加载，避免污染生产构建产物
    plugins: [vue(), ...(mode !== 'production' ? [vueDevTools()] : [])],
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
      proxy: {
        // 开发环境代理：将前端以"同源路径"发起的请求转发到后端（避免 CORS）。
        // 通过 VITE_BACKEND_PORT 环境变量配置后端端口，默认 18000
        '/preview': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/workspace': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/regex': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/utils': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
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
          'src/features/**',
          'src/components/**',
        ],
        thresholds: {
          lines: 40,
          branches: 30,
          functions: 40,
        },
      },
    },
  }
})
