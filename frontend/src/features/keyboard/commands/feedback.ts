/**
 * @file feedback.ts
 * @description 键盘快捷键反馈
 *
 * 执行快捷键命令后展示 i18n 翻译后的 Toast 提示。
 */
import { i18n } from '@/i18n'

// window 上挂载的 Toast 句柄（由 Toast.vue 挂载）；交叉类型单断言即可取用
type ToastGlobal = Window & {
  $toast?: {
    info: (msg: string, detail: string) => void
    error: (msg: string, detail: string) => void
  }
}

/** 展示快捷键命令反馈（type='error' 时以错误级别提示，如命令执行异常） */
export function showFeedback(key: string, detail?: string, type?: 'info' | 'error'): void {
  const translatedText = i18n.global.t(key)
  const toast = (window as ToastGlobal).$toast
  if (typeof window !== 'undefined' && toast) {
    if (type === 'error') {
      toast.error(translatedText, detail || '')
    } else {
      toast.info(translatedText, detail || '')
    }
  }
}
