import { i18n } from '@/i18n'

export function showFeedback(key: string, detail?: string): void {
  const translatedText = i18n.global.t(key)
  const toast = (window as unknown as { $toast?: { info: (msg: string, detail: string) => void } })
    .$toast
  if (typeof window !== 'undefined' && toast) {
    toast.info(translatedText, detail || '')
  }
}
