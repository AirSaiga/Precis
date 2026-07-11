/**
 * @file renderText.ts
 * @description i18n 渲染助手（纯函数）
 *
 * 统一"有 key 走 t()、无 key 走 fallback"的渲染模式，供组件层与服务层共用。
 *
 * 为什么需要它：vue-i18n 的 `t` 来自 `useI18n()`（组件）或 `i18n.global.t`（服务），
 * 不同调用上下文拿到的是不同的 `t`。本模块不直接依赖 Vue 响应式，而是接收调用方
 * 传入的 `t`，保持纯函数，便于在服务层、组合式函数、组件中统一使用，也便于单测。
 *
 * 使用方式：
 * ```typescript
 * // 组件内
 * import { useI18n } from 'vue-i18n'
 * import { renderText } from '@/core/i18n/renderText'
 * const { t } = useI18n()
 * renderText(t, issue.title_key, issue.title, issue.message_params)
 *
 * // 服务层 / Pinia store（无 setup 上下文）
 * import { i18n } from '@/i18n'
 * import { renderText } from '@/core/i18n/renderText'
 * renderText(i18n.global.t, err.messageKey, err.message, err.params)
 * ```
 */

/**
 * vue-i18n 的翻译函数签名（与 VueI18nTranslation 的可调用形式兼容）。
 * 仅声明我们依赖的子集，避免引入完整的 vue-i18n 类型耦合。
 */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string

/**
 * i18n 渲染 helper
 * - 有 key 时用 t(key, params)
 * - key 为空/undefined 时 fallback 到原字符串
 *
 * @param t        调用方注入的翻译函数（组件用 useI18n().t，服务用 i18n.global.t）
 * @param key      i18n key，缺失（undefined/空串）则走 fallback
 * @param fallback key 缺失时的兜底文案（通常是原始本地化字符串）
 * @param params   插值参数，如 { row: 3 }，可选
 */
export function renderText(
  t: TranslateFn,
  key: string | undefined,
  fallback: string,
  params?: Record<string, unknown>
): string {
  if (key) {
    return t(key, params ?? {})
  }
  return fallback
}
