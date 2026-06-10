/**
 * @file index.ts
 * @description Toast 消息系统
 *
 * 提供全局 Toast 消息的统一接口和类型定义。
 *
 * 使用方式：
 * ```typescript
 * import { toastSuccess, toastError } from '@/core/toast'
 *
 * toastSuccess('操作成功')                // 使用 i18n 默认标题（common.success）
 * toastError('操作失败', '保存失败')        // 显式指定标题
 * ```
 */

import { i18n } from '@/i18n'
import type { ToastType } from '@/composables/shared/useToast'

/**
 * Toast API 接口定义
 *
 * 用于在应用全局范围内显示临时消息提示的接口。
 * 实现由 UI 框架提供，绑定到 window.$toast。
 */
export interface ToastAPI {
  success: (title: string, message: string) => void
  error: (title: string, message: string) => void
  warning: (title: string, message: string) => void
  info: (title: string, message: string) => void
}

/**
 * 根据 Toast 类型解析默认标题。
 * 使用全局 vue-i18n 实例解析 `common.${type}` 键，
 * 解析失败时回退到空字符串（避免显示原始键名）。
 */
function resolveDefaultTitle(type: ToastType): string {
  const translated = i18n.global.t(`common.${type}`)
  if (translated && translated !== `common.${type}`) {
    return translated
  }
  return ''
}

function showToast(type: ToastType, message: string, title?: string): void {
  if (!window.$toast) return
  const displayTitle = title && title.length > 0 ? title : resolveDefaultTitle(type)
  window.$toast[type](displayTitle, message)
}

/**
 * 显示成功消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：通过 i18n 解析 `common.success`，未传则使用解析结果或空标题）
 */
export function toastSuccess(message: string, title?: string): void {
  showToast('success', message, title)
}

/**
 * 显示错误消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：通过 i18n 解析 `common.error`）
 */
export function toastError(message: string, title?: string): void {
  showToast('error', message, title)
}

/**
 * 显示警告消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：通过 i18n 解析 `common.warning`）
 */
export function toastWarning(message: string, title?: string): void {
  showToast('warning', message, title)
}

/**
 * 显示信息消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：通过 i18n 解析 `common.info`）
 */
export function toastInfo(message: string, title?: string): void {
  showToast('info', message, title)
}

/**
 * 扩展 Window 类型声明
 *
 * 在全局 Window 接口上添加 $toast 属性，
 * 用于访问全局的 Toast API。
 */
declare global {
  interface Window {
    $toast?: ToastAPI
  }
}
