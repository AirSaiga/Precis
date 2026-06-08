/**
 * 键盘快捷键反馈
 *
 * 执行快捷键命令后展示 i18n 翻译后的 Toast 提示。
 */
import { i18n } from '@/i18n'

/** 展示快捷键命令反馈 */
export function showFeedback(key: string, detail?: string): void {
  const translatedText = i18n.global.t(key)
  const toast = (window as unknown as { $toast?: { info: (msg: string, detail: string) => void } })
    .$toast
  if (typeof window !== 'undefined' && toast) {
    toast.info(translatedText, detail || '')
  }
}
