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
 * toastSuccess('操作成功', '提示')
 * toastError('操作失败', '错误')
 * ```
 */

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
 * 显示成功消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：'提示'）
 */
export function toastSuccess(message: string, title: string = '提示'): void {
  if (window.$toast) {
    window.$toast.success(title, message)
  }
}

/**
 * 显示错误消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：'错误'）
 */
export function toastError(message: string, title: string = '错误'): void {
  if (window.$toast) {
    window.$toast.error(title, message)
  }
}

/**
 * 显示警告消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：'警告'）
 */
export function toastWarning(message: string, title: string = '警告'): void {
  if (window.$toast) {
    window.$toast.warning(title, message)
  }
}

/**
 * 显示信息消息
 *
 * @param message - 消息内容
 * @param title - 标题（默认：'信息'）
 */
export function toastInfo(message: string, title: string = '信息'): void {
  if (window.$toast) {
    window.$toast.info(title, message)
  }
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
