/**
 * @file useLanguageToggle.ts
 * @description 语言切换共享 composable
 *
 * 统一 AgentLayout(Header)与 AssetLibraryNav(ActivityBar)的语言切换逻辑,
 * 确保两处入口始终走同一套「切换 locale + 持久化」流程,避免一处改了另一处忘改的漂移。
 *
 * 行为:在 zh-CN / en-US 间来回切换,同时写入 settingsStore(由其 watch 持久化到 localStorage)。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { logger } from '@/core/utils/logger'

/** 当前语言(zh-CN / en-US) */
export function useLanguageToggle() {
  const { locale } = useI18n()
  const settingsStore = useSettingsStore()

  const currentLang = computed(() => locale.value)

  /** 切换语言(同时持久化到 settingsStore → localStorage) */
  function toggleLanguage(): void {
    const newLang = currentLang.value === 'zh-CN' ? 'en-US' : 'zh-CN'
    locale.value = newLang
    settingsStore.updateGeneralSettings({ language: newLang })
    logger.debug(`[Language] Switched to ${newLang}`)
  }

  return { currentLang, toggleLanguage }
}
