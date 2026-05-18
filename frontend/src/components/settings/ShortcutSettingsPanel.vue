<!--
  @file ShortcutSettingsPanel.vue
  @description 快捷键设置面板

  配置和管理键盘快捷键：
  - 启用/禁用快捷键系统
  - 显示操作反馈开关
  - 自定义快捷键绑定
  - 按命令分类查看和编辑快捷键
-->

<template>
  <div class="ui-workbench-page">
    <!-- Panel Header -->
    <div class="settings-panel-header">
      <h2 class="settings-panel-header__title">{{ t('shortcuts.settings.title') }}</h2>
      <p class="settings-panel-header__desc">{{ t('shortcuts.settings.description') }}</p>
    </div>

    <div class="global-toggles">
      <div class="ui-card toggle-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('shortcuts.settings.enabled') }}</label>
          <label class="ui-switch">
            <input v-model="shortcutStore.enabled" type="checkbox" class="ui-switch__input" />
            <span class="ui-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="ui-card toggle-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('shortcuts.settings.showFeedback') }}</label>
          <label class="ui-switch">
            <input v-model="shortcutStore.showFeedback" type="checkbox" class="ui-switch__input" />
            <span class="ui-switch__track"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="search-bar">
      <input
        v-model="searchQuery"
        class="ui-input"
        type="text"
        :placeholder="t('shortcuts.settings.searchPlaceholder')"
      />
      <button class="ui-btn ui-btn--secondary" type="button" @click="handleResetAll">
        {{ t('shortcuts.settings.resetAll') }}
      </button>
    </div>

    <div v-if="filteredCommands.length === 0" class="ui-empty">
      <p class="ui-empty__description">{{ t('shortcuts.settings.noResults') }}</p>
    </div>

    <div v-else class="category-list">
      <div
        v-for="group in groupedCommands"
        :key="group.category"
        class="ui-workbench-card category-card"
      >
        <div class="ui-workbench-section__header">
          <div class="ui-workbench-section__title">{{ getCategoryLabel(group.category) }}</div>
        </div>

        <div class="shortcut-table">
          <div class="shortcut-row shortcut-row-header">
            <div class="col-command">{{ t('shortcuts.headers.command') }}</div>
            <div class="col-shortcut">{{ t('shortcuts.headers.shortcut') }}</div>
            <div class="col-actions">{{ t('shortcuts.headers.actions') }}</div>
          </div>

          <div v-for="cmd in group.commands" :key="cmd.id" class="shortcut-row">
            <div class="col-command">
              <div class="command-name">{{ getCommandLabel(cmd) }}</div>
              <div class="command-meta">{{ cmd.id }}</div>
            </div>

            <div class="col-shortcut">
              <div class="shortcut-display">
                <span class="ui-badge" :class="{ 'is-disabled': isCommandDisabled(cmd.id) }">
                  {{ formatShortcutForDisplay(getEffectiveShortcut(cmd)) }}
                </span>
                <span v-if="isCustom(cmd.id)" class="ui-badge is-primary">{{
                  t('shortcuts.tips.custom')
                }}</span>
                <span v-else class="ui-badge">{{ t('shortcuts.tips.default') }}</span>
                <span v-if="conflictMap[getCommandKeyCombo(cmd)] > 1" class="ui-badge is-danger">
                  {{ t('shortcuts.tips.conflict') }}
                </span>
              </div>

              <div v-if="editingCommandId === cmd.id" class="ui-card capture-editor">
                <input
                  ref="captureInput"
                  class="ui-input"
                  type="text"
                  :value="capturePreview"
                  readonly
                  @keydown.stop.prevent="handleCaptureKeydown"
                />
                <div v-if="captureConflictWith" class="capture-warning">
                  {{ t('shortcuts.tips.conflict') }}: {{ captureConflictWith }}
                </div>
                <div class="editor-actions">
                  <button
                    class="ui-btn ui-btn--primary ui-btn--sm"
                    type="button"
                    :disabled="!canSaveCapture"
                    @click="saveCapture"
                  >
                    {{ t('common.save') }}
                  </button>
                  <button
                    class="ui-btn ui-btn--secondary ui-btn--sm"
                    type="button"
                    @click="cancelCapture"
                  >
                    {{ t('common.cancel') }}
                  </button>
                </div>
              </div>
            </div>

            <div class="col-actions">
              <label class="ui-switch">
                <input
                  :checked="!isCommandDisabled(cmd.id)"
                  type="checkbox"
                  class="ui-switch__input"
                  @change="toggleCommand(cmd.id)"
                />
                <span class="ui-switch__track"></span>
                <span class="switch-label">{{
                  isCommandDisabled(cmd.id) ? t('common.disabled') : t('common.enabled')
                }}</span>
              </label>

              <button
                class="ui-btn ui-btn--secondary ui-btn--sm"
                type="button"
                :disabled="editingCommandId !== null && editingCommandId !== cmd.id"
                @click="startCapture(cmd.id)"
              >
                {{ t('shortcuts.tips.customize') }}
              </button>

              <button
                class="ui-btn ui-btn--ghost ui-btn--sm"
                type="button"
                :disabled="!isCustom(cmd.id)"
                @click="resetOne(cmd.id)"
              >
                {{ t('shortcuts.tips.reset') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { Command, Shortcut } from '@/features/keyboard/types'
  import { shortcuts, platformDetector } from '@/features/keyboard'
  import { IGNORED_KEYS } from '@/features/keyboard/constants'
  import { getBaseCommands } from '@/features/keyboard/commands/baseCommands'
  import { getCanvasCommands } from '@/features/keyboard/commands/canvasCommands'
  import { getHelpCommands } from '@/features/keyboard/commands/helpCommands'
  import { useShortcutStore } from '@/features/keyboard/stores/shortcutStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'

  /**
   * i18n 工具
   */
  const { t } = useI18n()

  /**
   * 快捷键用户配置 store
   */
  const shortcutStore = useShortcutStore()

  /**
   * 全局确认弹窗
   */
  const { showConfirm } = useGlobalConfirm()

  /**
   * 搜索关键字
   */
  const searchQuery = ref('')

  /**
   * 当前处于捕获模式的命令 ID
   */
  const editingCommandId = ref<string | null>(null)

  /**
   * 捕获到的快捷键
   */
  const capturedShortcut = ref<Shortcut | null>(null)

  /**
   * 捕获输入框引用
   */
  const captureInput = ref<HTMLInputElement | null>(null)

  /**
   * 命令列表（去重后）——以当前代码库默认命令为基础
   * 注意：后续会由快捷键引擎接入时用"实际注册命令"覆盖
   */
  const allCommands = computed<Command[]>(() => {
    const list = [...getBaseCommands(), ...getCanvasCommands(), ...getHelpCommands()]
    const map = new Map<string, Command>()
    for (const cmd of list) {
      if (!map.has(cmd.id)) {
        map.set(cmd.id, cmd)
      }
    }
    return Array.from(map.values())
  })

  /**
   * 获取命令的显示名称
   *
   * @param cmd 命令
   */
  function getCommandLabel(cmd: Command): string {
    return t(cmd.name)
  }

  /**
   * 获取分类显示名
   *
   * @param category 分类 key
   */
  function getCategoryLabel(category?: string): string {
    if (!category) {
      return '-'
    }
    return t(`shortcuts.category.${category}`)
  }

  /**
   * 判断某命令是否存在自定义快捷键
   *
   * @param commandId 命令 ID
   */
  function isCustom(commandId: string): boolean {
    return Boolean(shortcutStore.getCustomShortcut(commandId))
  }

  /**
   * 判断某命令是否被禁用
   *
   * @param commandId 命令 ID
   */
  function isCommandDisabled(commandId: string): boolean {
    return shortcutStore.isCommandDisabled(commandId)
  }

  /**
   * 获取某命令当前生效的快捷键（自定义优先，否则使用默认）
   *
   * @param cmd 命令
   */
  function getEffectiveShortcut(cmd: Command): Shortcut {
    const custom = shortcutStore.getCustomShortcut(cmd.id)
    if (custom) {
      return {
        key: custom.key,
        ctrl: Boolean(custom.ctrl),
        meta: Boolean(custom.meta),
        shift: Boolean(custom.shift),
        alt: Boolean(custom.alt),
      }
    }
    return shortcuts.getPlatformShortcut(cmd.defaultShortcut, cmd.platformVariants)
  }

  /**
   * 将快捷键对象格式化为 UI 展示文本
   *
   * @param shortcut 快捷键对象
   */
  function formatShortcutForDisplay(shortcut: Shortcut): string {
    return shortcuts.formatShortcut(shortcut, platformDetector.isMac())
  }

  /**
   * 过滤后的命令列表
   */
  const filteredCommands = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) {
      return allCommands.value
    }
    return allCommands.value.filter((cmd) => {
      const label = getCommandLabel(cmd).toLowerCase()
      return label.includes(query) || cmd.id.toLowerCase().includes(query)
    })
  })

  /**
   * 按分类分组命令
   */
  const groupedCommands = computed(() => {
    const groups = new Map<string, Command[]>()
    for (const cmd of filteredCommands.value) {
      const category = cmd.category || 'other'
      if (!groups.has(category)) {
        groups.set(category, [])
      }
      groups.get(category)!.push(cmd)
    }
    return Array.from(groups.entries())
      .map(([category, commands]) => ({
        category,
        commands: [...commands].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category))
  })

  /**
   * 当前命令对应的格式化 keyCombo（用于冲突检测）
   *
   * @param cmd 命令
   */
  function getCommandKeyCombo(cmd: Command): string {
    return shortcuts.formatShortcut(getEffectiveShortcut(cmd)).toLowerCase()
  }

  /**
   * 计算当前配置下的冲突映射：keyCombo -> 冲突数量
   */
  const conflictMap = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const cmd of allCommands.value) {
      const combo = getCommandKeyCombo(cmd)
      counts[combo] = (counts[combo] ?? 0) + 1
    }
    return counts
  })

  /**
   * 开始捕获某命令的快捷键
   *
   * @param commandId 命令 ID
   */
  async function startCapture(commandId: string): Promise<void> {
    editingCommandId.value = commandId
    capturedShortcut.value = null
    await nextTick()
    captureInput.value?.focus()
  }

  /**
   * 取消捕获
   */
  function cancelCapture(): void {
    editingCommandId.value = null
    capturedShortcut.value = null
  }

  /**
   * 捕获输入框展示文本
   */
  const capturePreview = computed(() => {
    if (!capturedShortcut.value) {
      return platformDetector.isMac() ? '按下快捷键…（Esc 取消）' : '按下快捷键…（Esc 取消）'
    }
    return formatShortcutForDisplay(capturedShortcut.value)
  })

  /**
   * 当前捕获的快捷键是否可保存
   */
  const canSaveCapture = computed(() => {
    return Boolean(editingCommandId.value && capturedShortcut.value && capturedShortcut.value.key)
  })

  /**
   * 捕获冲突的命令 ID（如果有）
   */
  const captureConflictWith = computed(() => {
    if (!editingCommandId.value || !capturedShortcut.value) {
      return ''
    }
    const newCombo = shortcuts.formatShortcut(capturedShortcut.value).toLowerCase()
    const conflict = allCommands.value.find(
      (c) => c.id !== editingCommandId.value && getCommandKeyCombo(c) === newCombo
    )
    return conflict ? conflict.id : ''
  })

  /**
   * 捕获快捷键（keydown）
   *
   * @param event 键盘事件
   */
  function handleCaptureKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      cancelCapture()
      return
    }
    if (IGNORED_KEYS.has(event.key)) {
      return
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    capturedShortcut.value = {
      key,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
    }
  }

  /**
   * 保存捕获到的快捷键
   */
  function saveCapture(): void {
    if (!editingCommandId.value || !capturedShortcut.value) {
      return
    }
    if (captureConflictWith.value) {
      return
    }
    shortcutStore.setCustomShortcut(editingCommandId.value, capturedShortcut.value)
    cancelCapture()
  }

  /**
   * 切换命令启用/禁用
   *
   * @param commandId 命令 ID
   */
  function toggleCommand(commandId: string): void {
    if (shortcutStore.isCommandDisabled(commandId)) {
      shortcutStore.enableCommand(commandId)
    } else {
      shortcutStore.disableCommand(commandId)
    }
  }

  /**
   * 重置单个命令快捷键
   *
   * @param commandId 命令 ID
   */
  function resetOne(commandId: string): void {
    shortcutStore.deleteCustomShortcut(commandId)
  }

  /**
   * 重置所有快捷键为默认值（含确认）
   */
  async function handleResetAll(): Promise<void> {
    const confirmed = await showConfirm({
      message: t('shortcuts.settings.resetConfirm'),
      type: 'warning',
    })
    if (!confirmed) {
      return
    }
    shortcutStore.resetToDefaults()
  }
</script>

<style scoped src="./ShortcutSettingsPanel.styles.css"></style>
