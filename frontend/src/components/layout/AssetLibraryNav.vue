<!--
  @file AssetLibraryNav.vue
  @description 活动栏导航组件

  提供 Toolbox / Resources / Data 三个视图的切换按钮，位于左侧活动栏顶部。
  当前激活的视图按钮会高亮显示。
-->

<template>
  <nav class="activity-bar-nav">
    <!-- 三视图切换：工具箱 / 项目资源 / 数据源 -->
    <div class="view-switcher">
      <!-- 工具箱视图按钮 -->
      <button
        class="view-btn"
        :class="{ active: currentView === 'toolbox' }"
        @click="setCurrentView('toolbox')"
        :title="t('assetLibrary.activityBar.toolboxView')"
      >
        <div class="view-icon-wrapper">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
            <path
              d="M3 14a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7z"
            ></path>
          </svg>
        </div>
      </button>

      <!-- 项目资源视图按钮 -->
      <button
        class="view-btn"
        :class="{ active: currentView === 'resources' }"
        @click="setCurrentView('resources')"
        :title="t('assetLibrary.activityBar.resourcesView')"
      >
        <div class="view-icon-wrapper">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"
            ></path>
          </svg>
        </div>
      </button>

      <!-- AI 助手视图按钮 -->
      <button
        class="view-btn"
        :class="{ active: currentView === 'ai-chat' }"
        @click="setCurrentView('ai-chat')"
        :title="t('assetLibrary.activityBar.aiChatView')"
      >
        <div class="view-icon-wrapper">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
      </button>

      <!-- 校验历史视图按钮 -->
      <button
        class="view-btn"
        :class="{ active: currentView === 'validation-history' }"
        @click="setCurrentView('validation-history')"
        :title="t('assetLibrary.activityBar.validationHistoryView')"
      >
        <div class="view-icon-wrapper">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </div>
      </button>

      <!-- 数据源视图按钮 -->
      <button
        class="view-btn"
        :class="{ active: currentView === 'data' }"
        @click="setCurrentView('data')"
        :title="t('assetLibrary.activityBar.dataView')"
      >
        <div class="view-icon-wrapper">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
          </svg>
        </div>
      </button>
    </div>

    <!-- 底部设置区 -->
    <div class="settings-section">
      <!-- 语言切换按钮 -->
      <button
        class="language-btn"
        @click="toggleLanguage"
        :title="
          currentLang === 'zh-CN'
            ? t('navigation.languageSwitch.enUS')
            : t('navigation.languageSwitch.zhCN')
        "
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path
            d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
          ></path>
        </svg>
      </button>

      <button
        class="settings-btn"
        @click="handleSettingsClick"
        :title="t('assetLibrary.activityBar.settings')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          ></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, onMounted, onUnmounted, computed } from 'vue'
  import { useI18n } from 'vue-i18n'

  // 当前视图状态
  const currentView = ref<'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data'>('toolbox')
  const { t, locale } = useI18n()

  // 当前语言状态
  const currentLang = computed(() => locale.value)

  // 切换语言
  const toggleLanguage = () => {
    const newLang = currentLang.value === 'zh-CN' ? 'en-US' : 'zh-CN'
    locale.value = newLang
    logger.debug(`[Language] Switched to ${newLang}`)
  }

  // 设置当前视图
  const setCurrentView = (view: 'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data') => {
    if (currentView.value !== view) {
      logger.debug(`[AssetLibraryNav] 准备切换到${view}视图，当前视图: ${currentView.value}`)
      currentView.value = view
      // 向父组件发送视图切换事件
      window.dispatchEvent(
        new CustomEvent('viewchange', {
          detail: { view },
        })
      )
      logger.debug(`[AssetLibraryNav] 已发送视图切换事件: ${view}`)
    }
  }

  // 处理设置按钮点击
  const handleSettingsClick = () => {
    window.dispatchEvent(new CustomEvent('open-settings'))
  }

  // 监听全局视图切换事件（同步状态）
  const handleGlobalViewChange = (event: CustomEvent) => {
    const { view } = event.detail
    if (currentView.value !== view) {
      currentView.value = view
    }
  }

  onMounted(() => {
    window.addEventListener('viewchange', handleGlobalViewChange as EventListener)
  })

  onUnmounted(() => {
    window.removeEventListener('viewchange', handleGlobalViewChange as EventListener)
  })
</script>

<style scoped src="./AssetLibraryNav.styles.css"></style>
