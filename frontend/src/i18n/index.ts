/**
 * @file index.ts
 * @description 国际化（i18n）配置
 *
 * 使用 vue-i18n 提供 zh-CN / en-US 双语支持。
 * 默认语言为 zh-CN，fallback 为 en-US。
 *
 * 启动时从 localStorage 读取用户语言偏好（key: generalSettings），
 * 避免刷新页面时强制回退到中文。
 */

import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

/**
 * 从 localStorage 读取用户语言偏好
 *
 * 直接读取原始 JSON 字符串解析，不依赖 Pinia store（此时 store 可能未初始化）。
 * 若读取失败或字段缺失，回退到 zh-CN。
 */
function getInitialLocale(): string {
  try {
    const stored = localStorage.getItem('generalSettings')
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.language === 'zh-CN' || parsed.language === 'en-US') {
        return parsed.language
      }
    }
  } catch {
    // 静默忽略解析错误，使用默认值
  }
  return 'zh-CN'
}

const locale = getInitialLocale()

// 创建 i18n 实例
export const i18n = createI18n({
  legacy: false, // 使用组合式 API
  locale,
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})

// 仅供单测使用:暴露纯函数 getInitialLocale 以便直接验证 localStorage 恢复逻辑
export const __getInitialLocaleForTest = getInitialLocale

// [2026-05-18] force rebuild
export default i18n
