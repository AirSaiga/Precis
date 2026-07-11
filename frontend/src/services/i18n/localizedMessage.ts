/**
 * @file localizedMessage.ts
 * @description 服务/校验层错误消息的 key 化结构
 *
 * 背景：服务层与校验器（constraints/validators、preValidator、columnValidation 等）
 * 运行在非组件上下文，无法直接调用 useI18n() 的 t()。历史上这些层把中文字符串
 * 直接写进 message 字段，导致错误消息无法随 locale 切换。
 *
 * 本模块定义贯穿"服务 → UI"的统一消息结构：
 *   - key：i18n key（如 'validation.notNull.valueEmpty'）
 *   - fallback：key 缺失时的兜底文案（通常是原始中文/英文，保证总有显示）
 *   - params：插值参数（如 { row: 3 }）
 *
 * UI 层渲染时用 @/core/i18n/renderText 的 renderText(t, key, fallback, params) 解析。
 * 这是既有的"先例 B1（code→message）+ 先例 B2（key+fallback+params）"的泛化统一形态。
 */

/**
 * key 化的可本地化消息。
 *
 * 约束：
 *   - key 必须是已在 zh-CN/en-US 语言包中定义的点路径，否则降级到 fallback。
 *   - fallback 不得为空，确保 key 缺失时仍有可见文本。
 */
export interface LocalizedMessage {
  /** i18n key，如 'validation.notNull.valueEmpty' */
  key: string
  /** key 缺失时的兜底文案（原始本地化字符串） */
  fallback: string
  /** 插值参数，如 { row: 3, column: 'name' }，可选 */
  params?: Record<string, unknown>
}

/**
 * 构造一条 LocalizedMessage 的便捷工厂，集中校验 fallback 非空。
 * @param key       i18n key
 * @param fallback  key 缺失时的兜底文案（必填）
 * @param params    插值参数（可选）
 */
export function loc(
  key: string,
  fallback: string,
  params?: Record<string, unknown>
): LocalizedMessage {
  if (!fallback) {
    // fallback 是最后的显示保障，为空会导致 UI 空白；开发期尽早暴露
    throw new Error(`loc(): fallback 不能为空（key=${key}）`)
  }
  return { key, fallback, params }
}

/**
 * 将 LocalizedMessage 渲染为最终展示字符串。
 *
 * 供无法拿到响应式 t 的调用方使用（导入全局 i18n 实例）。组件内应优先用
 * renderText(useI18n().t, ...)，仅在纯服务/工具上下文用本函数。
 */
export { renderText } from '@/core/i18n/renderText'
