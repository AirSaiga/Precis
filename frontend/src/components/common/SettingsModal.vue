<!--
  @file SettingsModal.vue
  @description 应用设置工作台模态框

  功能职责：
  - 提供应用全局设置的集中管理界面
  - 左侧导航分组展示设置分类，支持搜索过滤
  - 右侧动态渲染当前选中设置项的详细配置面板
  - 展示保存状态（保存中 / 已保存 / 出错）与当前项目信息

  关键特性：
  - 分组导航栏，支持展开/收起与快捷键跳转
  - 面包屑展示当前所在设置分组与具体项
  - 实时保存状态反馈（含加载动画与状态图标）
  - 项目信息胶囊展示当前激活项目状态
  - 搜索框支持快速定位设置项

  无外部 Props / Emits，状态完全由内部 Settings Store 驱动。
  模态框显隐通过 settingsStore.visible 控制。
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
              <span class="settings-workbench__subtitle">{{ t('settings.subtitle') }}</span>
            </div>

            <div class="settings-workbench__actions">
              <!-- Save status -->
              <span
                v-if="settingsStore.saveStatus !== 'idle'"
                class="save-status"
                :class="`is-${settingsStore.saveStatus}`"
              >
                <span
                  v-if="settingsStore.saveStatus === 'saving'"
                  class="save-status__spinner"
                ></span>
                <span v-else-if="settingsStore.saveStatus === 'saved'" class="save-status__icon"
                  >✓</span
                >
                <span v-else-if="settingsStore.saveStatus === 'error'" class="save-status__icon"
                  >✕</span
                >
                {{ saveStatusText }}
              </span>

              <div
                class="settings-project-pill"
                :class="{ 'settings-project-pill--inactive': !projectStore.isProjectActive }"
              >
                <span class="settings-project-pill__dot"></span>
                <span class="settings-project-pill__text">{{ projectSummaryText }}</span>
              </div>

              <button class="ui-icon-btn" type="button" @click="handleClose">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
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
                  v-model="settingsStore.searchQuery"
                  type="search"
                  class="settings-sidebar__search-input"
                  :placeholder="t('settings.searchPlaceholder')"
                  @keydown="handleSearchKeydown"
                />
                <span v-if="settingsStore.searchQuery" class="settings-sidebar__search-shortcut"
                  >Esc</span
                >
              </div>

              <!-- Navigation -->
              <nav class="settings-sidebar__nav">
                <div v-for="group in filteredNavigation" :key="group.id" class="nav-group">
                  <button
                    class="nav-group__header"
                    type="button"
                    @click="settingsStore.toggleGroup(group.id)"
                  >
                    <span class="nav-group__icon" v-html="group.icon" />
                    <span class="nav-group__label">{{ group.label }}</span>
                    <svg
                      class="nav-group__chevron"
                      :class="{ 'is-expanded': settingsStore.expandedGroups.includes(group.id) }"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  <Transition name="expand">
                    <div
                      v-show="settingsStore.expandedGroups.includes(group.id)"
                      class="nav-group__items"
                    >
                      <button
                        v-for="item in group.items"
                        :key="item.id"
                        class="nav-item"
                        :class="{ 'is-active': settingsStore.activeNavItem === item.id }"
                        type="button"
                        @click="settingsStore.setActiveNavItem(item.id)"
                      >
                        <span class="nav-item__icon" v-html="item.icon" />
                        <span class="nav-item__label">{{ item.label }}</span>
                      </button>
                    </div>
                  </Transition>
                </div>
              </nav>
            </aside>

            <!-- Right Content -->
            <div class="settings-content">
              <!-- Breadcrumb -->
              <div class="settings-breadcrumb">
                <span class="settings-breadcrumb__group">{{ currentGroupLabel }}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="settings-breadcrumb__item">{{ currentItemLabel }}</span>
              </div>

              <!-- Panel Body -->
              <div class="settings-content__body ui-scrollbar">
                <GeneralSettingsPanel v-if="settingsStore.activeNavItem === 'general'" />
                <ShortcutSettingsPanel v-else-if="settingsStore.activeNavItem === 'shortcuts'" />
                <ProjectInfoPanel v-else-if="settingsStore.activeNavItem === 'project-overview'" />
                <ProjectSettingsPanel
                  v-else-if="settingsStore.activeNavItem === 'validation-params'"
                />
                <DataSourcesSettingsPanel
                  v-else-if="settingsStore.activeNavItem === 'data-sources'"
                />
                <ConnectionRulesEditor
                  v-else-if="settingsStore.activeNavItem === 'connection-rules'"
                />
                <ScriptSettingsPanel
                  v-else-if="settingsStore.activeNavItem === 'script-security'"
                />
                <AIAssistantSettingsPanel
                  v-else-if="settingsStore.activeNavItem === 'ai-assistant'"
                />
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
  import { computed, onMounted, onUnmounted, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useGraphStore } from '@/stores/graphStore'
  import ProjectSettingsPanel from '@/components/settings/ProjectSettingsPanel.vue'
  import AIAssistantSettingsPanel from '@/components/settings/AIAssistantSettingsPanel.vue'
  import DataSourcesSettingsPanel from '@/components/settings/DataSourcesSettingsPanel.vue'
  import GeneralSettingsPanel from '@/components/settings/GeneralSettingsPanel.vue'
  import ProjectInfoPanel from '@/components/settings/ProjectInfoPanel.vue'
  import ConnectionRulesEditor from '@/components/settings/ConnectionRulesEditor.vue'
  import ScriptSettingsPanel from '@/components/settings/ScriptSettingsPanel.vue'
  import ShortcutSettingsPanel from '@/components/settings/ShortcutSettingsPanel.vue'
  import UpdateSettingsPanel from '@/components/settings/UpdateSettingsPanel.vue'
  import type { SettingsNavGroup } from '@/stores/settingsStore'

  const { t } = useI18n()
  const settingsStore = useSettingsStore()
  const projectStore = useProjectStore()
  const graphStore = useGraphStore()

  // ============================================================================
  // 导航配置
  // ============================================================================

  const navigationConfig = computed(
    () =>
      [
        {
          id: 'workspace',
          label: t('settings.workspace.groups.workspace'),
          icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
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
          icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
          condition: () => true, // 始终显示，但内部项可根据项目状态调整
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
            {
              id: 'connection-rules',
              label: t('connectionRules.title'),
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
              tab: 'connection-rules',
            },
          ],
        },
        {
          id: 'system',
          label: t('settings.workspace.groups.system'),
          icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4"/><path d="m5 5 2.83 2.83"/><path d="m19 5-2.83 2.83"/><path d="M12 22a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"/></svg>',
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
  // 搜索过滤
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

    // 展开包含搜索结果的分组
    result.forEach((g) => settingsStore.expandGroup(g.id))
    return result
  })

  // ============================================================================
  // 面包屑
  // ============================================================================

  const currentGroupLabel = computed(() => {
    for (const group of navigationConfig.value) {
      if (group.items.some((item) => item.id === settingsStore.activeNavItem)) {
        return group.label
      }
    }
    return ''
  })

  const currentItemLabel = computed(() => {
    for (const group of navigationConfig.value) {
      const item = group.items.find((i) => i.id === settingsStore.activeNavItem)
      if (item) return item.label
    }
    return ''
  })

  // ============================================================================
  // 保存状态文本
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
  // 事件处理
  // ============================================================================

  function handleClose(): void {
    settingsStore.close()
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (settingsStore.searchQuery) {
        settingsStore.searchQuery = ''
      } else {
        handleClose()
      }
    }
  }

  function handleSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      settingsStore.searchQuery = ''
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

  // 搜索时自动展开包含结果的分组
  watch(
    () => settingsStore.searchQuery,
    (query) => {
      if (query.trim()) {
        filteredNavigation.value.forEach((g) => settingsStore.expandGroup(g.id))
      }
    }
  )
</script>

<style scoped src="./SettingsModal.styles.css" />
