/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
