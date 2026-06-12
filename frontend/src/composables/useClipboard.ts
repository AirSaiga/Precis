/**
 * @file useClipboard.ts
 * @description 剪贴板组合式函数
 *
 * 封装 navigator.clipboard API 的调用，提供统一、健壮的复制体验：
 * - 自动降级到 document.execCommand('copy') 兼容非安全上下文（HTTPS 之外）
 * - 复制失败时抛出明确错误，由调用方决定是否 toast 提示
 * - 成功时静默返回，调用方决定是否 toast 提示
 *
 * 使用方式：
 * const { copy } = useClipboard()
 * try {
 *   await copy('hello')
 *   toastSuccess(t('inspection.toast.copied'), '')
 * } catch (e) {
 *   toastError(t('messages.error.unknownError'), e instanceof Error ? e.message : String(e))
 * }
 */

/**
 * 复制文本到剪贴板
 *
 * 实现策略：
 * 1. 优先使用 navigator.clipboard.writeText（现代 API，要求安全上下文）
 * 2. 降级：构造临时 <textarea> + document.execCommand('copy')（兼容 HTTP / 老浏览器）
 * 3. 都失败时抛出 Error
 *
 * @param text 要复制的文本
 * @returns 复制成功时 resolve；失败时 reject
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (!text) return

  // 策略 1：现代 API
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (err) {
      // 安全上下文外（HTTPS 之外）会失败，降级到策略 2
      console.warn('[useClipboard] navigator.clipboard.writeText 失败，降级到 execCommand:', err)
    }
  }

  // 策略 2：降级方案
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!success) {
      throw new Error('execCommand 返回 false')
    }
  } catch (err) {
    throw new Error(`复制失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 剪贴板组合式函数
 *
 * 当前直接暴露 copyToClipboard 函数，保留 composable 形式便于未来扩展
 * （如批量复制、历史记录等）。
 */
export function useClipboard() {
  return {
    copy: copyToClipboard,
  }
}
