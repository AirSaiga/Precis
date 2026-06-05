<!--
  @file ManualDataNodeInspector.vue
  @description 手动数据节点属性检查器 - 单列版本

  功能：
  - 基础信息编辑（节点名称、列名）
  - 行数据编辑（添加、删除、复制、清空）
  - CSV/TSV 批量粘贴导入
-->
<template>
  <div class="manual-data-inspector">
    <!-- 1. 基础配置 -->
    <BaseInspector
      :title="t('inspector.manualDataNode.groups.config')"
      :badge="t('inspector.manualDataNode.badgeEditable')"
      badge-class="editable"
    >
      <InspectorField
        :label="t('inspector.manualDataNode.labels.configName')"
        :model-value="localConfigName"
        :editable="true"
        :placeholder="t('inspector.manualDataNode.placeholders.configName')"
        @update:model-value="updateConfigName"
      />
      <InspectorField
        :label="t('inspector.manualDataNode.labels.columnName')"
        :model-value="localColumnName"
        :editable="true"
        :placeholder="t('inspector.manualDataNode.placeholders.columnName')"
        @update:model-value="updateColumnName"
      />
    </BaseInspector>

    <!-- 2. 批量导入 -->
    <BaseInspector
      :title="t('inspector.manualDataNode.groups.import')"
      :badge="t('inspector.manualDataNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.manualDataNode.labels.pasteData') }}</label>
        <textarea
          v-model="pasteText"
          class="paste-textarea"
          rows="4"
          :placeholder="t('inspector.manualDataNode.placeholders.pasteData')"
        />
        <div class="paste-actions">
          <button class="paste-btn primary" @click="applyPaste">
            {{ t('inspector.manualDataNode.actions.replace') }}
          </button>
          <button class="paste-btn secondary" @click="appendPaste">
            {{ t('inspector.manualDataNode.actions.append') }}
          </button>
          <button class="paste-btn secondary" @click="pasteText = ''">
            {{ t('common.clear') }}
          </button>
        </div>
        <span class="field-hint">{{ t('inspector.manualDataNode.hints.pasteFormat') }}</span>
      </div>
    </BaseInspector>

    <!-- 3. 数据行编辑 -->
    <BaseInspector
      :title="t('inspector.manualDataNode.groups.rows')"
      :badge="t('inspector.manualDataNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="rows-toolbar">
        <button class="toolbar-btn" @click="addRow">
          <span>+</span> {{ t('inspector.manualDataNode.actions.addRow') }}
        </button>
        <button class="toolbar-btn" @click="clearAllRows">
          <span>🗑</span> {{ t('inspector.manualDataNode.actions.clear') }}
        </button>
      </div>

      <div class="data-table-editor">
        <div class="data-header">
          <div class="data-header-cell row-num">#</div>
          <div class="data-header-cell">
            {{ localColumnName || t('inspector.manualDataNode.defaultColumn') }}
          </div>
          <div class="data-header-cell action"></div>
        </div>
        <div
          v-for="(row, rIdx) in localRows"
          :key="rIdx"
          class="data-row"
          :class="{ 'is-zebra': rIdx % 2 === 1 }"
        >
          <div class="row-num">{{ rIdx + 1 }}</div>
          <input
            :value="localRows[rIdx]?.[0] ?? ''"
            @change="onRowInputChange(rIdx, 0, $event)"
            class="data-cell-input"
            type="text"
          />
          <div class="row-actions">
            <button
              class="row-action-btn"
              :title="t('inspector.manualDataNode.actions.duplicate')"
              @click="duplicateRow(rIdx)"
            >
              ⧉
            </button>
            <button
              class="row-action-btn danger"
              :title="t('inspector.manualDataNode.actions.remove')"
              @click="removeRow(rIdx)"
            >
              ×
            </button>
          </div>
        </div>
      </div>

      <div class="rows-info">
        {{ localRows.length }} {{ t('inspector.manualDataNode.rowsInfo') }}
      </div>
    </BaseInspector>

    <!-- 4. 状态 -->
    <BaseInspector
      :title="t('inspector.manualDataNode.groups.status')"
      :badge="t('inspector.manualDataNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.manualDataNode.labels.saveState')"
        :model-value="(data.saveState as string) || 'draft'"
        :editable="false"
      />
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { ManualDataNodeData } from '@/types/nodes'

  const { t } = useI18n()

  interface Props {
    data: ManualDataNodeData
    nodeType: string
    nodeId: string
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    'update:data': [data: Partial<ManualDataNodeData>]
  }>()

  const localConfigName = ref('')
  const localColumnName = ref('')
  const localRows = ref<string[][]>([])
  const pasteText = ref('')

  function syncFromProps() {
    localConfigName.value = (props.data.configName as string) || ''
    localColumnName.value = (props.data.columnName as string) || ''
    localRows.value = ((props.data.rows as string[][]) || []).map((r) => [...r])
  }

  watch(() => props.data, syncFromProps, { immediate: true, deep: true })

  function emitUpdate() {
    emit('update:data', {
      configName: localConfigName.value,
      columnName: localColumnName.value,
      rows: localRows.value.map((r) => [...r]),
    })
  }

  function updateConfigName(value: string) {
    localConfigName.value = value
    emitUpdate()
  }

  function updateColumnName(value: string) {
    localColumnName.value = value
    emitUpdate()
  }

  // ============================================================================
  // 行操作
  // ============================================================================

  function addRow() {
    localRows.value.push([''])
    emitUpdate()
  }

  function removeRow(idx: number) {
    if (localRows.value.length <= 1) {
      localRows.value[idx] = ['']
    } else {
      localRows.value.splice(idx, 1)
    }
    emitUpdate()
  }

  function duplicateRow(idx: number) {
    const row = localRows.value[idx]
    if (!row) return
    localRows.value.splice(idx + 1, 0, [...row])
    emitUpdate()
  }

  function handleRowChange(rIdx: number, cIdx: number, value: string) {
    const row = localRows.value[rIdx]
    if (!row) return
    row[cIdx] = value
    emitUpdate()
  }

  function onRowInputChange(rIdx: number, cIdx: number, event: Event) {
    const target = event.target as HTMLInputElement
    handleRowChange(rIdx, cIdx, target.value)
  }

  function clearAllRows() {
    localRows.value = [['']]
    emitUpdate()
  }

  // ============================================================================
  // CSV / TSV 粘贴导入
  // ============================================================================

  function parsePaste(text: string): string[] {
    if (!text.trim()) return []
    // 按行分割，支持 \n 和 \r\n
    const lines = text.split(/\r?\n/)
    // 过滤空行，取每行第一个值（单列模式）
    return lines
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        // 如果是 CSV 格式（含逗号），取第一个字段
        if (line.includes(',')) {
          return (line.split(',')[0] ?? '').trim()
        }
        // 如果是 TSV 格式（含制表符），取第一个字段
        if (line.includes('\t')) {
          return (line.split('\t')[0] ?? '').trim()
        }
        return line
      })
  }

  function applyPaste() {
    const values = parsePaste(pasteText.value)
    if (values.length === 0) return
    localRows.value = values.map((v) => [v])
    pasteText.value = ''
    emitUpdate()
  }

  function appendPaste() {
    const values = parsePaste(pasteText.value)
    if (values.length === 0) return
    values.forEach((v) => localRows.value.push([v]))
    pasteText.value = ''
    emitUpdate()
  }
</script>

<style scoped>
  .manual-data-inspector {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ============================================================================
     通用表单样式
     ============================================================================ */

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 4px;
  }

  .form-group label {
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .field-hint {
    font-size: 11px;
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  /* ============================================================================
     粘贴区域
     ============================================================================ */

  .paste-textarea {
    width: 100%;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 8px;
    color: var(--ui-text-primary);
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
    resize: vertical;
    outline: none;
    min-height: 60px;
  }

  .paste-textarea:focus {
    border-color: var(--ui-accent);
  }

  .paste-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .paste-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid;
    transition: all 0.15s;
  }

  .paste-btn.primary {
    background: var(--ui-accent);
    border-color: var(--ui-accent);
    color: #fff;
  }

  .paste-btn.primary:hover {
    background: var(--ui-accent-primary);
    border-color: var(--ui-accent-primary);
  }

  .paste-btn.secondary {
    background: transparent;
    border-color: var(--ui-border-light);
    color: var(--ui-text-muted);
  }

  .paste-btn.secondary:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }

  /* ============================================================================
     行工具栏
     ============================================================================ */

  .rows-toolbar {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    border: 1px solid var(--ui-border-light);
    background: transparent;
    color: var(--ui-text-muted);
    transition: all 0.15s;
  }

  .toolbar-btn:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }

  /* ============================================================================
     数据表格编辑器
     ============================================================================ */

  .data-table-editor {
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    overflow: hidden;
  }

  .data-header {
    display: flex;
    background: var(--ui-bg-sidebar);
    border-bottom: 1px solid var(--ui-border-subtle);
  }

  .data-header-cell {
    padding: 5px 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--ui-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .data-header-cell.row-num {
    flex: 0 0 28px;
    text-align: center;
    border-right: 1px solid var(--ui-border-subtle);
  }

  .data-header-cell:not(.row-num):not(.action) {
    flex: 1;
    min-width: 50px;
  }

  .data-header-cell.action {
    flex: 0 0 56px;
  }

  .data-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--ui-border-subtle);
    transition: background-color 0.1s ease;
  }

  .data-row:last-child {
    border-bottom: none;
  }

  .data-row:hover {
    background: var(--ui-bg-hover);
  }

  .data-row.is-zebra {
    background: rgba(255, 255, 255, 0.02);
  }

  .data-row.is-zebra:hover {
    background: var(--ui-bg-hover);
  }

  .row-num {
    flex: 0 0 28px;
    text-align: center;
    padding: 5px 2px;
    font-size: 9px;
    color: var(--ui-text-muted);
    font-family: 'Consolas', 'Monaco', monospace;
    border-right: 1px solid var(--ui-border-subtle);
    background: var(--ui-bg-sidebar);
  }

  .data-cell-input {
    flex: 1;
    padding: 5px 6px;
    border: none;
    border-right: 1px solid var(--ui-border-subtle);
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 12px;
    outline: none;
    min-width: 50px;
  }

  .data-cell-input:focus {
    background: var(--ui-bg-sidebar);
  }

  .row-actions {
    flex: 0 0 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  .row-action-btn {
    background: transparent;
    border: none;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    padding: 0;
  }

  .row-action-btn:hover {
    background: var(--ui-bg-hover);
    color: var(--ui-accent);
  }

  .row-action-btn.danger:hover {
    color: var(--ui-danger);
  }

  /* ============================================================================
     行数信息
     ============================================================================ */

  .rows-info {
    font-size: 11px;
    color: var(--ui-text-muted);
    text-align: center;
    margin-top: 6px;
  }
</style>
