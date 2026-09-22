<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<!--
  @file CommandPalette.vue
  @description Ctrl+K 命令面板：模态搜索定位 + 快捷命令入口

  交互契约：
  - 打开：eventBus 'open-command-palette'（features/keyboard 的 palette.open 命令发射）
  - 搜索输入自动聚焦；↑↓ 在"节点 / 命令"两组结果的扁平列表上移动，Enter 确认，Esc 关闭
  - 点遮罩关闭；对话框内点击回焦输入框（防焦点落到 body 后全局快捷键误触画布）
  - 节点结果：可见节点直接发 'focus-canvas-nodes'（既有被动定位通道）；
    隐藏节点（坞聚合 / 视图筛选）先 updateNodeData 揭示再聚焦（选中豁免语义
    与约束坞 L1 一致，重聚合不会立即收回）
  - 命令结果：执行体经 paletteCommandRegistry 依赖注入（eventBus / store action /
    既有快捷键 handler），带绑定的命令显示用户实际快捷键（自定义优先）

  键盘守卫关系：全局 keyboardListener 对 input 目标一律放行（isIgnoredElement），
  面板输入框的 Esc/Enter/方向键由本组件自身的 keydown 处理，不依赖全局监听。
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="cp-overlay"
        data-testid="command-palette-overlay"
        @click.self="close"
      >
        <div
          class="cp-dialog"
          role="dialog"
          aria-modal="true"
          data-testid="command-palette"
          @click="focusInput"
          @keydown="handleKeydown"
        >
          <div class="cp-search">
            <svg
              class="cp-search-icon"
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
              ref="inputRef"
              v-model="query"
              type="text"
              class="cp-input"
              :placeholder="t('commandPalette.placeholder')"
              data-testid="command-palette-input"
            />
            <kbd class="cp-kbd">Esc</kbd>
          </div>

          <div ref="listRef" class="cp-results ui-scrollbar">
            <template v-if="filteredNodes.length > 0">
              <div class="cp-group-label">{{ t('commandPalette.groups.nodes') }}</div>
              <button
                v-for="(item, i) in filteredNodes"
                :key="item.nodeId"
                type="button"
                class="cp-item"
                :data-active="i === activeIndex"
                @mousemove="setActive(i)"
                @click="select(i)"
              >
                <span class="cp-glyph" :style="{ color: nodeVisual(item.nodeType).color }">{{
                  nodeVisual(item.nodeType).glyph
                }}</span>
                <span class="cp-main">
                  <span class="cp-primary">{{ item.primaryLabel }}</span>
                  <span v-if="item.secondaryLabel" class="cp-secondary">{{
                    item.secondaryLabel
                  }}</span>
                </span>
                <span v-if="item.hidden" class="cp-hidden-hint">{{
                  t('commandPalette.hiddenHint')
                }}</span>
              </button>
            </template>

            <template v-if="filteredCommandRows.length > 0">
              <div class="cp-group-label">{{ t('commandPalette.groups.commands') }}</div>
              <button
                v-for="(row, j) in filteredCommandRows"
                :key="row.entry.id"
                type="button"
                class="cp-item"
                :data-active="filteredNodes.length + j === activeIndex"
                @mousemove="setActive(filteredNodes.length + j)"
                @click="select(filteredNodes.length + j)"
              >
                <span class="cp-glyph cp-glyph-cmd">›</span>
                <span class="cp-main">
                  <span class="cp-primary">{{ t(row.entry.labelKey) }}</span>
                </span>
                <kbd v-if="shortcutHintFor(row.entry.shortcutCommandId)" class="cp-kbd">{{
                  shortcutHintFor(row.entry.shortcutCommandId)
                }}</kbd>
              </button>
            </template>

            <div v-if="flatItems.length === 0" class="cp-empty">
              {{ t('commandPalette.empty') }}
            </div>
          </div>

          <div class="cp-footer">
            <span><kbd class="cp-kbd">↑↓</kbd> {{ t('commandPalette.footer.navigate') }}</span>
            <span><kbd class="cp-kbd">Enter</kbd> {{ t('commandPalette.footer.confirm') }}</span>
            <span><kbd class="cp-kbd">Esc</kbd> {{ t('commandPalette.footer.dismiss') }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { eventBus } from '@/core/eventBus'
  import { logger } from '@/core/utils/logger'
  import { useGraphStore } from '@/stores/graphStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import { CONSTRAINT_TYPES, isConstraintNodeType } from '@/services/constraints/constraintMeta'
  import { shortcuts, platformDetector } from '@/features/keyboard'
  import { useShortcutStore } from '@/features/keyboard/stores/shortcutStore'
  import { getBaseCommands } from '@/features/keyboard/commands/baseCommands'
  import { getCanvasCommands } from '@/features/keyboard/commands/canvasCommands'
  import { getPaletteShortcutCommands } from '@/features/keyboard/commands/paletteCommands'
  import { showFeedback } from '@/features/keyboard/commands/feedback'
  import { save as saveHandler } from '@/features/keyboard/handlers/editor'
  import { focusToProjectRoot as focusProjectRootHandler } from '@/features/keyboard/handlers/canvas'
  import type { Command, Shortcut } from '@/features/keyboard/types'
  import type { CustomNodeData } from '@/types/graph'
  import { findNode, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
  import {
    MAX_NODE_RESULTS,
    buildNodeSearchEntries,
    filterPaletteEntries,
    revealAndFocusNode,
    type RevealFocusDeps,
  } from '../services/paletteSearch'
  import { buildPaletteCommands, type PaletteCommandDeps } from '../services/paletteCommandRegistry'
  import type { PaletteCommandEntry, PaletteEntry } from '../types'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const validationTaskStore = useValidationTaskStore()
  const shortcutStore = useShortcutStore()

  // ============================================================================
  // 显隐与输入状态
  // ============================================================================

  const visible = ref(false)
  const query = ref('')
  const activeIndex = ref(0)
  const inputRef = ref<HTMLInputElement | null>(null)
  const listRef = ref<HTMLElement | null>(null)

  function openPalette(): void {
    visible.value = true
    query.value = ''
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  }

  function close(): void {
    visible.value = false
  }

  function focusInput(): void {
    if (visible.value) inputRef.value?.focus()
  }

  /** 输入变化后回到首项（新结果集的旧高亮索引可能越界或错位） */
  watch(query, () => {
    activeIndex.value = 0
  })

  // ============================================================================
  // 节点搜索源
  // ============================================================================

  /** 约束类型 → 本地化显示名（constraintMeta 单一事实源 + i18n） */
  const constraintTypeLabels = computed<Record<string, string>>(() => {
    const labels: Record<string, string> = {}
    for (const meta of CONSTRAINT_TYPES) {
      // constraintTypes 是顶层命名空间（zh-CN/index.ts 解构铺开挂载，
      // 无 constraints. 前缀——错误前缀会命中缺失回退为 key 串）
      labels[meta.nodeType] = t(`constraintTypes.${meta.kind}.name`)
    }
    return labels
  })

  const nodeEntries = computed(() =>
    buildNodeSearchEntries(graphStore.nodes, { typeLabels: constraintTypeLabels.value })
  )

  /** 空查询不倾倒节点列表（大项目数百条无意义），仅在输入过滤词后检索 */
  const filteredNodes = computed(() => {
    if (!query.value.trim()) return []
    return filterPaletteEntries(nodeEntries.value, query.value).slice(0, MAX_NODE_RESULTS)
  })

  const revealDeps: RevealFocusDeps = {
    nodes: () => graphStore.nodes,
    updateNodeData: (nodeId, newData: Partial<CustomNodeData & { hidden?: boolean }>) => {
      graphStore.updateNodeData(nodeId, newData)
    },
    focusNodes: (nodeIds) => {
      eventBus.emit('focus-canvas-nodes', { nodeIds })
    },
    markSelected: (nodeId) => {
      // 双选择模型一致性（镜像约束坞 L1 的 markVueFlowSelected）：
      // setSelection 只写 Store 侧，VF 侧不标记则节点无高亮
      try {
        const vfNode = findNode(nodeId)
        if (vfNode && vfNode.selected !== true) {
          vfNode.selected = true
        }
      } catch (error) {
        // 画布未挂载（vueFlowApi 未初始化）时跳过 VF 侧同步，仅保留 Store 选中
        if (!(error instanceof VueFlowApiNotInitializedError)) {
          throw error
        }
      }
    },
  }

  // ============================================================================
  // 命令源（依赖注入执行体）
  // ============================================================================

  async function runSave(): Promise<void> {
    const result = await saveHandler()
    if (result.message) showFeedback(result.message)
  }

  async function runFocusProjectRoot(): Promise<void> {
    const result = await focusProjectRootHandler()
    if (result.message) showFeedback(result.message)
  }

  const commandDeps: PaletteCommandDeps = {
    quickOrganize: () => eventBus.emit('request-quick-organize'),
    save: runSave,
    openFullValidation: () => validationTaskStore.openFullProject(),
    focusProjectRoot: runFocusProjectRoot,
    setViewMode: (mode) => graphStore.setViewFilterMode(mode),
    toggleErrorsOnly: () => graphStore.toggleViewFilterErrorsOnly(),
    isProjectLoaded: () => graphStore.isProjectLoaded,
    hasCanvasNodes: () => graphStore.nodes.length > 0,
  }

  const availableCommands = computed<PaletteCommandEntry[]>(() =>
    buildPaletteCommands(commandDeps).filter((cmd) => cmd.isAvailable())
  )

  interface CommandSearchRow {
    entry: PaletteCommandEntry
    searchText: string
  }

  const filteredCommandRows = computed<CommandSearchRow[]>(() => {
    const rows = availableCommands.value.map((entry) => ({
      entry,
      searchText: t(entry.labelKey).toLowerCase(),
    }))
    return filterPaletteEntries(rows, query.value)
  })

  /** 键盘导航的扁平结果集（节点组在前、命令组在后，与渲染顺序一致） */
  const flatItems = computed<PaletteEntry[]>(() => [
    ...filteredNodes.value,
    ...filteredCommandRows.value.map((row) => row.entry),
  ])

  // ============================================================================
  // 快捷键提示（shortcutStore 自定义绑定优先，回退命令默认平台快捷键）
  // ============================================================================

  const commandById = computed(() => {
    const map = new Map<string, Command>()
    for (const cmd of [
      ...getBaseCommands(),
      ...getCanvasCommands(),
      ...getPaletteShortcutCommands(),
    ]) {
      map.set(cmd.id, cmd)
    }
    return map
  })

  function shortcutHintFor(commandId: string | undefined): string {
    if (!commandId) return ''
    const custom = shortcutStore.getCustomShortcut(commandId)
    if (custom) {
      const normalized: Shortcut = {
        key: custom.key,
        ctrl: Boolean(custom.ctrl),
        meta: Boolean(custom.meta),
        shift: Boolean(custom.shift),
        alt: Boolean(custom.alt),
      }
      return shortcuts.formatShortcut(normalized, platformDetector.isMac())
    }
    const cmd = commandById.value.get(commandId)
    if (!cmd) return ''
    return shortcuts.formatShortcut(
      shortcuts.getPlatformShortcut(cmd.defaultShortcut, cmd.platformVariants),
      platformDetector.isMac()
    )
  }

  // ============================================================================
  // 节点类型图标（glyph + node-tokens 类型色）
  // ============================================================================

  interface NodeTypeVisual {
    glyph: string
    color: string
  }

  const NODE_TYPE_VISUALS: Record<string, NodeTypeVisual> = {
    projectRoot: { glyph: '⌂', color: 'var(--node-special-project-accent)' },
    schema: { glyph: '▦', color: 'var(--node-type-schema)' },
    jsonSchema: { glyph: '▦', color: 'var(--node-type-schema)' },
    sourcePreview: { glyph: '▤', color: 'var(--node-type-source)' },
    jsonSourcePreview: { glyph: '▤', color: 'var(--node-type-source)' },
    regex: { glyph: '⁂', color: 'var(--node-type-regex)' },
    regexExtract: { glyph: '⁂', color: 'var(--node-type-regex)' },
    transform: { glyph: '⇄', color: 'var(--ui-text-secondary)' },
    transformOutput: { glyph: '⇄', color: 'var(--ui-text-secondary)' },
    manualData: { glyph: '✎', color: 'var(--ui-text-secondary)' },
    templateInstance: { glyph: '▣', color: 'var(--ui-text-secondary)' },
    pattern: { glyph: '⁂', color: 'var(--node-type-pattern)' },
  }

  const CONSTRAINT_VISUAL: NodeTypeVisual = {
    glyph: '✓',
    color: 'var(--node-type-constraint)',
  }

  const FALLBACK_VISUAL: NodeTypeVisual = {
    glyph: '●',
    color: 'var(--ui-text-secondary)',
  }

  function nodeVisual(nodeType: string): NodeTypeVisual {
    if (isConstraintNodeType(nodeType)) return CONSTRAINT_VISUAL
    return NODE_TYPE_VISUALS[nodeType] ?? FALLBACK_VISUAL
  }

  // ============================================================================
  // 键盘导航与确认
  // ============================================================================

  function setActive(index: number): void {
    if (activeIndex.value !== index) activeIndex.value = index
  }

  function moveActive(delta: 1 | -1): void {
    const total = flatItems.value.length
    if (total === 0) return
    activeIndex.value = (activeIndex.value + delta + total) % total
    scrollActiveIntoView()
  }

  function scrollActiveIntoView(): void {
    void nextTick(() => {
      listRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
    })
  }

  async function select(index: number): Promise<void> {
    const item = flatItems.value[index]
    if (!item) return
    close()
    if (item.kind === 'node') {
      revealAndFocusNode(item.nodeId, revealDeps)
      return
    }
    try {
      await item.run()
    } catch (error) {
      logger.warn('[CommandPalette] 命令执行失败:', item.id, error)
    }
  }

  /** 对话框级 keydown：输入框事件冒泡至此统一处理（Esc/Enter/方向键） */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void select(activeIndex.value)
    }
  }

  // ============================================================================
  // 生命周期：监听打开请求（无条件成对清理）
  // ============================================================================

  function handleOpenRequest(): void {
    openPalette()
  }

  onMounted(() => {
    eventBus.on('open-command-palette', handleOpenRequest)
  })

  onUnmounted(() => {
    eventBus.off('open-command-palette', handleOpenRequest)
  })
</script>

<style scoped>
  .cp-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--ui-z-modal);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 12vh var(--ui-space-lg) var(--ui-space-lg);
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
  }

  .cp-dialog {
    display: flex;
    flex-direction: column;
    width: min(620px, 100%);
    max-height: min(560px, calc(100vh - 20vh - var(--ui-space-xl)));
    overflow: hidden;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-lg);
    background: var(--ui-bg-elevated);
    box-shadow: var(--ui-shadow-elevation-lg);
  }

  .cp-search {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    padding: var(--ui-space-md) var(--ui-space-lg);
    border-bottom: 1px solid var(--ui-border-light);
    flex-shrink: 0;
  }

  .cp-search-icon {
    color: var(--ui-text-muted);
    flex-shrink: 0;
  }

  .cp-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--ui-text-primary);
    font-size: var(--ui-font-size-md);
    font-family: inherit;
  }

  .cp-input::placeholder {
    color: var(--ui-text-muted);
  }

  .cp-kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-sm, 4px);
    background: var(--ui-bg-subtle);
    color: var(--ui-text-muted);
    font-size: 11px;
    line-height: 1;
    font-family: inherit;
    flex-shrink: 0;
  }

  .cp-results {
    flex: 1;
    min-height: 60px;
    overflow-y: auto;
    padding: var(--ui-space-xs, 4px);
  }

  .cp-group-label {
    padding: var(--ui-space-sm) var(--ui-space-md);
    color: var(--ui-text-muted);
    font-size: var(--ui-font-size-xs);
    font-weight: var(--ui-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .cp-item {
    display: flex;
    align-items: center;
    gap: var(--ui-space-md);
    width: 100%;
    padding: 7px var(--ui-space-md);
    background: transparent;
    border: none;
    border-radius: var(--ui-radius-sm, 4px);
    color: var(--ui-text-primary);
    font-size: var(--ui-font-size-sm);
    text-align: left;
    cursor: pointer;
  }

  .cp-item[data-active='true'] {
    background: var(--ui-bg-hover);
  }

  .cp-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-sm, 4px);
    background: var(--ui-bg-subtle);
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }

  .cp-glyph-cmd {
    color: var(--ui-accent);
  }

  .cp-main {
    display: flex;
    align-items: baseline;
    gap: var(--ui-space-sm);
    flex: 1;
    min-width: 0;
  }

  .cp-primary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cp-secondary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-muted);
    font-size: var(--ui-font-size-xs);
  }

  .cp-hidden-hint {
    padding: 1px 6px;
    border-radius: var(--ui-radius-sm, 4px);
    background: var(--ui-bg-subtle);
    color: var(--ui-text-muted);
    font-size: 10px;
    flex-shrink: 0;
  }

  .cp-empty {
    padding: var(--ui-space-xl) var(--ui-space-lg);
    color: var(--ui-text-muted);
    font-size: var(--ui-font-size-sm);
    text-align: center;
  }

  .cp-footer {
    display: flex;
    align-items: center;
    gap: var(--ui-space-lg);
    padding: var(--ui-space-sm) var(--ui-space-lg);
    border-top: 1px solid var(--ui-border-light);
    color: var(--ui-text-muted);
    font-size: 11px;
    flex-shrink: 0;
  }

  .cp-footer span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
