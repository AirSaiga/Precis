<!--
  @file SettingsModal.vue
  @description 应用设置工作台模态框（UX 重做版）

  布局：
  - 左侧 200px 扁平导航栏（分组标题 + 导航项列表，不可折叠）
  - 右侧内容区：顶部标题栏（panel 标题 + 描述）+ 可滚动主体
  - 右下角浮动保存状态 badge

  交互：
  - 键盘 ↑↓ 切换面板
  - Esc 关闭（搜索非空时先清空搜索）
  - 点击遮罩关闭
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="settingsStore.visible" class="settings-overlay" @click.self="handleClose">
        <div class="settings-workbench ui-panel" role="dialog" aria-modal="true">
          <!-- Header -->
          <header class="settings-workbench__header">
            <div class="settings-workbench__brand">
              <h1 class="settings-workbench__title">{{ t('settings.title') }}</h1>
            </div>
            <div class="settings-workbench__actions">
              <Transition name="badge-slide">
                <div
                  v-if="settingsStore.saveStatus !== 'idle'"
                  class="save-status-badge"
                  :class="`is-${settingsStore.saveStatus}`"
                >
                  <span
                    v-if="settingsStore.saveStatus === 'saving'"
                    class="save-status-badge__spinner"
                  ></span>
                  <span v-else-if="settingsStore.saveStatus === 'saved'" class="save-status-badge__icon">✓</span>
                  <span v-else-if="settingsStore.saveStatus === 'error'" class="save-status-badge__icon">✕</span>
                  {{ saveStatusText }}
                </div>
              </Transition>
              <div
                class="settings-project-pill"
                :class="{ 'settings-project-pill--inactive': !projectStore.isProjectActive }"
              >
                <span class="settings-project-pill__dot"></span>
                <span class="settings-project-pill__text">{{ projectSummaryText }}</span>
              </div>
              <button class="ui-icon-btn" type="button" @click="handleClose">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </header>

          <div class="settings-workbench__main">
            <!-- Left Sidebar -->
            <aside class="settings-sidebar">
              <!-- Search -->
              <div class="settings-sidebar__search">
                <svg
                  class="settings-sidebar__search-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  ref="searchInputRef"
                  v-model="settingsStore.searchQuery"
                  type="search"
                  class="settings-sidebar__search-input"
                  :placeholder="t('settings.searchPlaceholder')"
                  @keydown="handleSearchKeydown"
                />
                <span v-if="settingsStore.searchQuery" class="settings-sidebar__search-shortcut">Esc</span>
              </div>

              <!-- Navigation -->
              <nav class="settings-sidebar__nav" role="tablist">
                <template v-for="group in filteredNavigation" :key="group.id">
                  <div class="nav-section">
                    <div class="nav-section__label">{{ group.label }}</div>
                    <div class="nav-section__items">
                      <button
                        v-for="item in group.items"
                        :key="item.id"
                        ref="navItemRefs"
                        class="nav-item"
                        :class="{ 'is-active': settingsStore.activeNavItem === item.id }"
                        role="tab"
                        :aria-selected="settingsStore.activeNavItem === item.id"
                        type="button"
                        @click="settingsStore.setActiveNavItem(item.id)"
                      >
                        <span class="nav-item__icon" v-html="item.icon" />
                        <span class="nav-item__label">{{ item.label }}</span>
                      </button>
                    </div>
                  </div>
                </template>
              </nav>
            </aside>

            <!-- Right Content -->
            <div class="settings-content">
              <!-- Panel Header (统一标题区) -->
              <div class="settings-content__header">
                <div class="settings-content__header-main">
                  <h2 class="settings-content__title">{{ currentPanelTitle }}</h2>
                  <p class="settings-content__desc">{{ currentPanelDesc }}</p>
                </div>
              </div>

              <!-- Panel Body -->
              <div class="settings-content__body ui-scrollbar">
                <GeneralSettingsPanel v-if="settingsStore.activeNavItem === 'general'" />
                <ShortcutSettingsPanel v-else-if="settingsStore.activeNavItem === 'shortcuts'" />
                <ProjectInfoPanel v-else-if="settingsStore.activeNavItem === 'project-overview'" />
                <ProjectSettingsPanel v-else-if="settingsStore.activeNavItem === 'validation-params'" />
                <DataSourcesSettingsPanel v-else-if="settingsStore.activeNavItem === 'data-sources'" />
                <ScriptSettingsPanel v-else-if="settingsStore.activeNavItem === 'script-security'" />
                <AIAssistantSettingsPanel v-else-if="settingsStore.activeNavItem === 'ai-assistant'" />
                <UpdateSettingsPanel v-else-if="settingsStore.activeNavItem === 'update'" />
              </div>

            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useGraphStore } from '@/stores/graphStore'
  import ProjectSettingsPanel from '@/components/settings/ProjectSettingsPanel.vue'
  import AIAssistantSettingsPanel from '@/components/settings/AIAssistantSettingsPanel.vue'
  import DataSourcesSettingsPanel from '@/components/settings/DataSourcesSettingsPanel.vue'
  import GeneralSettingsPanel from '@/components/settings/GeneralSettingsPanel.vue'
  import ProjectInfoPanel from '@/components/settings/ProjectInfoPanel.vue'
  import ScriptSettingsPanel from '@/components/settings/ScriptSettingsPanel.vue'
  import ShortcutSettingsPanel from '@/components/settings/ShortcutSettingsPanel.vue'
  import UpdateSettingsPanel from '@/components/settings/UpdateSettingsPanel.vue'
  import type { SettingsNavGroup } from '@/stores/settingsStore'

  const { t } = useI18n()
  const settingsStore = useSettingsStore()
  const projectStore = useProjectStore()
  const graphStore = useGraphStore()

  const navItemRefs = ref<HTMLButtonElement[]>([])
  const searchInputRef = ref<HTMLInputElement | null>(null)

  // ============================================================================
  // 导航配置（新分组：工作区 / 项目 / 集成 / 系统）
  // ============================================================================

  const navigationConfig = computed(
    () =>
      [
        {
          id: 'workspace',
          label: t('settings.workspace.groups.workspace'),
          items: [
            {
              id: 'general',
              label: t('settings.general.tab'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
              tab: 'general',
            },
            {
              id: 'shortcuts',
              label: t('shortcuts.settings.title'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M7 16h10"/></svg>',
              tab: 'shortcuts',
            },
          ],
        },
        {
          id: 'project',
          label: t('settings.workspace.groups.project'),
          items: [
            {
              id: 'project-overview',
              label: t('settings.projectInfo.tab'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
              tab: 'project-info',
            },
            {
              id: 'validation-params',
              label: t('settings.project.tab'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
              tab: 'project',
            },
            {
              id: 'data-sources',
              label: t('settings.dataSources.title'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
              tab: 'project-info',
            },
          ],
        },
        {
          id: 'integrations',
          label: t('settings.workspace.groups.integrations'),
          items: [
            {
              id: 'ai-assistant',
              label: t('settings.aiAssistant.tab'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
              tab: 'ai-assistant',
            },
            {
              id: 'script-security',
              label: t('settings.script.tab'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
              tab: 'script',
            },
          ],
        },
        {
          id: 'system',
          label: t('settings.workspace.groups.system'),
          items: [
            {
              id: 'update',
              label: t('settings.update.tab'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
              tab: 'update',
            },
          ],
        },
      ] as SettingsNavGroup[]
  )

  // ============================================================================
  // 搜索过滤（保留分组结构，只过滤 items）
  // ============================================================================

  const filteredNavigation = computed<SettingsNavGroup[]>(() => {
    const query = settingsStore.searchQuery.trim().toLowerCase()
    if (!query) {
      return navigationConfig.value
    }
    const result: SettingsNavGroup[] = []
    for (const group of navigationConfig.value) {
      const matchedItems = group.items.filter((item) => item.label.toLowerCase().includes(query))
      if (matchedItems.length > 0) {
        result.push({ ...group, items: matchedItems })
      }
    }
    return result
  })

  // ============================================================================
  // 当前面板标题与描述
  // ============================================================================

  const currentPanelMeta = computed(() => {
    for (const group of navigationConfig.value) {
      const item = group.items.find((i) => i.id === settingsStore.activeNavItem)
      if (item) {
        const titleKeyMap: Record<string, string> = {
          general: 'settings.general.title',
          shortcuts: 'shortcuts.settings.title',
          'project-overview': 'settings.projectInfo.title',
          'validation-params': 'settings.project.title',
          'data-sources': 'settings.dataSources.title',
          'script-security': 'settings.script.title',
          'ai-assistant': 'settings.aiAssistant.title',
          update: 'settings.update.title',
        }
        const descKeyMap: Record<string, string> = {
          general: 'settings.general.description',
          shortcuts: 'shortcuts.settings.description',
          'project-overview': 'settings.projectInfo.description',
          'validation-params': 'settings.project.description',
          'data-sources': 'settings.dataSources.desc',
          'script-security': 'settings.script.description',
          'ai-assistant': 'settings.aiAssistant.description',
          update: 'settings.update.description',
        }
        return {
          title: t(titleKeyMap[item.id] || ''),
          desc: t(descKeyMap[item.id] || ''),
        }
      }
    }
    return { title: '', desc: '' }
  })

  const currentPanelTitle = computed(() => currentPanelMeta.value.title)
  const currentPanelDesc = computed(() => currentPanelMeta.value.desc)

  // ============================================================================
  // 保存状态
  // ============================================================================

  const saveStatusText = computed(() => {
    switch (settingsStore.saveStatus) {
      case 'saving':
        return t('settings.saving')
      case 'saved':
        return t('settings.saved')
      case 'error':
        return t('settings.saveError')
      default:
        return ''
    }
  })

  // ============================================================================
  // 项目状态
  // ============================================================================

  const projectSummaryText = computed(() => {
    if (!projectStore.isProjectActive) {
      return t('settings.workspace.noProject')
    }
    return graphStore.projectName || t('settings.projectInfo.unnamed')
  })

  // ============================================================================
  // 键盘导航
  // ============================================================================

  function getAllVisibleItemIds(): string[] {
    const ids: string[] = []
    for (const group of filteredNavigation.value) {
      for (const item of group.items) {
        ids.push(item.id)
      }
    }
    return ids
  }

  function focusActiveNavItem(): void {
    nextTick(() => {
      const activeId = settingsStore.activeNavItem
      const idx = getAllVisibleItemIds().indexOf(activeId)
      if (idx >= 0 && navItemRefs.value[idx]) {
        navItemRefs.value[idx].focus()
      }
    })
  }

  function navigatePanel(direction: 'prev' | 'next'): void {
    const ids = getAllVisibleItemIds()
    const currentIdx = ids.indexOf(settingsStore.activeNavItem)
    if (currentIdx < 0) return
    const nextIdx = direction === 'next'
      ? Math.min(currentIdx + 1, ids.length - 1)
      : Math.max(currentIdx - 1, 0)
    if (nextIdx !== currentIdx) {
      const nextId = ids[nextIdx]
      if (nextId !== undefined) {
        settingsStore.setActiveNavItem(nextId)
        focusActiveNavItem()
      }
    }
  }

  // ============================================================================
  // 事件处理
  // ============================================================================

  function handleClose(): void {
    settingsStore.close()
  }

  function handleKeydown(e: KeyboardEvent): void {
    // 全局快捷键（仅在模态框打开时生效）
    if (!settingsStore.visible) return

    if (e.key === 'Escape') {
      if (settingsStore.searchQuery) {
        settingsStore.searchQuery = ''
        e.preventDefault()
      } else {
        handleClose()
      }
      return
    }

    if (e.key === '/') {
      // 聚焦搜索框
      searchInputRef.value?.focus()
      e.preventDefault()
      return
    }

    // ↑↓ 导航（当焦点不在 input/textarea 内时）
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return

    if (e.key === 'ArrowDown') {
      navigatePanel('next')
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      navigatePanel('prev')
      e.preventDefault()
    }
  }

  function handleSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      settingsStore.searchQuery = ''
      // 把焦点还给当前 nav item
      focusActiveNavItem()
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusActiveNavItem()
    }
  }

  // ============================================================================
  // 生命周期
  // ============================================================================

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
  })

  // 搜索变化后，如果当前 active 项被过滤掉了，自动选中第一个可见项
  watch(
    () => settingsStore.searchQuery,
    () => {
      const ids = getAllVisibleItemIds()
      if (ids.length > 0 && !ids.includes(settingsStore.activeNavItem)) {
        const firstId = ids[0]
        if (firstId !== undefined) {
          settingsStore.setActiveNavItem(firstId)
        }
      }
    }
  )
</script>

<style scoped src="./SettingsModal.styles.css" />
