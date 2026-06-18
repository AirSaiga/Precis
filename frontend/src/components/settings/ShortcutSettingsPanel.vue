<!--
  @file ShortcutSettingsPanel.vue
  @description 快捷键设置面板（macOS 风格）

  配置和管理键盘快捷键：
  - 启用/禁用快捷键系统
  - 显示操作反馈开关
  - 自定义快捷键绑定
  - 按命令分类查看和编辑快捷键
-->

<template>
  <div class="settings-page">
    <!-- 全局设置 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('shortcuts.settings.globalTitle') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('shortcuts.settings.enabled') }}</div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control">
          <label class="ui-switch ui-switch--compact">
            <input v-model="shortcutStore.enabled" type="checkbox" class="ui-switch__input" />
            <span class="ui-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('shortcuts.settings.showFeedback') }}</div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control">
          <label class="ui-switch ui-switch--compact">
            <input
              v-model="shortcutStore.showFeedback"
              type="checkbox"
              class="ui-switch__input"
            />
            <span class="ui-switch__track"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- 搜索与重置 -->
    <div class="settings-row">
      <div class="settings-row__control settings-row__control--wide">
        <input
          v-model="searchQuery"
          class="ui-input ui-input--compact"
          type="text"
          :placeholder="t('shortcuts.settings.searchPlaceholder')"
        />
      </div>
      <div class="settings-row__control">
        <button class="ui-btn ui-btn--ghost ui-btn--sm" type="button" @click="handleResetAll">
          {{ t('shortcuts.settings.resetAll') }}
        </button>
      </div>
    </div>

    <!-- 命令列表 -->
    <div v-if="filteredCommands.length === 0" class="ui-empty">
      <p class="ui-empty__description">{{ t('shortcuts.settings.noResults') }}</p>
    </div>

    <div v-else class="settings-section">
      <div v-for="group in groupedCommands" :key="group.category" class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__title">{{ getCategoryLabel(group.category) }}</div>
        </div>
        <div class="settings-list">
          <div v-for="cmd in group.commands" :key="cmd.id" class="settings-list__item">
            <div
              style="
                font-size: var(--ui-font-size-sm);
                font-weight: var(--ui-font-weight-medium);
                color: var(--ui-text-body);
                flex: 1;
                min-width: 0;
              "
            >
              {{ getCommandLabel(cmd) }}
            </div>

            <div style="display: flex; align-items: center; gap: var(--ui-space-sm)">
              <span
                class="settings-code"
                :class="{
                  'settings-pill--danger': (conflictMap[getCommandKeyCombo(cmd)] ?? 0) > 1,
                }"
                :style="
                  isCommandDisabled(cmd.id) ? 'opacity: 0.4; text-decoration: line-through' : ''
                "
              >
                {{ formatShortcutForDisplay(getEffectiveShortcut(cmd)) }}
              </span>
              <span v-if="isCustom(cmd.id)" class="settings-pill settings-pill--info">{{
                t('shortcuts.tips.custom')
              }}</span>
              <span
                v-if="(conflictMap[getCommandKeyCombo(cmd)] ?? 0) > 1"
                class="settings-pill settings-pill--danger"
                >{{ t('shortcuts.tips.conflict') }}</span
              >
            </div>

            <div style="display: flex; align-items: center; gap: var(--ui-space-sm)">
              <label class="ui-switch ui-switch--compact">
                <input
                  :checked="!isCommandDisabled(cmd.id)"
                  type="checkbox"
                  class="ui-switch__input"
                  @change="toggleCommand(cmd.id)"
                />
                <span class="ui-switch__track"></span>
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

            <!-- 捕获编辑器 -->
            <div
              v-if="editingCommandId === cmd.id"
              class="settings-alert settings-alert--info"
              style="width: 100%; margin-top: var(--ui-space-sm)"
            >
              <span class="settings-alert__icon">⌨️</span>
              <div class="settings-alert__content" style="flex: 1">
                <div class="settings-alert__title">{{ capturePreview }}</div>
                <div
                  v-if="captureConflictWith"
                  class="settings-alert__text"
                  style="color: var(--ui-danger)"
                >
                  {{ t('shortcuts.tips.conflict') }}: {{ captureConflictWith }}
                </div>
                <div style="display: flex; gap: var(--ui-space-sm); margin-top: var(--ui-space-sm)">
                  <button
                    class="ui-btn ui-btn--primary ui-btn--sm"
                    type="button"
                    :disabled="!canSaveCapture"
                    @click="saveCapture"
                  >
                    {{ t('common.save') }}
                  </button>
                  <button
                    class="ui-btn ui-btn--ghost ui-btn--sm"
                    type="button"
                    @click="cancelCapture"
                  >
                    {{ t('common.cancel') }}
                  </button>
                </div>
              </div>
              <input
                ref="captureInput"
                type="text"
                style="position: absolute; opacity: 0; width: 0; height: 0"
                @keydown.stop.prevent="handleCaptureKeydown"
              />
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

  const { t } = useI18n()
  const shortcutStore = useShortcutStore()
  const { showConfirm } = useGlobalConfirm()

  const searchQuery = ref('')
  const editingCommandId = ref<string | null>(null)
  const capturedShortcut = ref<Shortcut | null>(null)
  const captureInput = ref<HTMLInputElement | null>(null)

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

  function getCommandLabel(cmd: Command): string {
    return t(cmd.name)
  }

  function getCategoryLabel(category?: string): string {
    if (!category) {
      return '-'
    }
    return t(`shortcuts.category.${category}`)
  }

  function isCustom(commandId: string): boolean {
    return Boolean(shortcutStore.getCustomShortcut(commandId))
  }

  function isCommandDisabled(commandId: string): boolean {
    return shortcutStore.isCommandDisabled(commandId)
  }

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

  function formatShortcutForDisplay(shortcut: Shortcut): string {
    return shortcuts.formatShortcut(shortcut, platformDetector.isMac())
  }

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

  function getCommandKeyCombo(cmd: Command): string {
    return shortcuts.formatShortcut(getEffectiveShortcut(cmd)).toLowerCase()
  }

  const conflictMap = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const cmd of allCommands.value) {
      const combo = getCommandKeyCombo(cmd)
      counts[combo] = (counts[combo] ?? 0) + 1
    }
    return counts
  })

  async function startCapture(commandId: string): Promise<void> {
    editingCommandId.value = commandId
    capturedShortcut.value = null
    await nextTick()
    captureInput.value?.focus()
  }

  function cancelCapture(): void {
    editingCommandId.value = null
    capturedShortcut.value = null
  }

  const capturePreview = computed(() => {
    if (!capturedShortcut.value) {
      return platformDetector.isMac() ? '按下快捷键…（Esc 取消）' : '按下快捷键…（Esc 取消）'
    }
    return formatShortcutForDisplay(capturedShortcut.value)
  })

  const canSaveCapture = computed(() => {
    return Boolean(editingCommandId.value && capturedShortcut.value && capturedShortcut.value.key)
  })

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

  function toggleCommand(commandId: string): void {
    if (shortcutStore.isCommandDisabled(commandId)) {
      shortcutStore.enableCommand(commandId)
    } else {
      shortcutStore.disableCommand(commandId)
    }
  }

  function resetOne(commandId: string): void {
    shortcutStore.deleteCustomShortcut(commandId)
  }

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
