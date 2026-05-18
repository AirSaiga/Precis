/**
 * @file index.ts
 * @description 国际化（i18n）配置
 *
 * 使用 vue-i18n 提供 zh-CN / en-US 双语支持。
 * 默认语言为 zh-CN，fallback 为 en-US。
 */

import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

// 默认语言
const locale = 'zh-CN'

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

// [2026-05-18] force rebuild
export default i18n
