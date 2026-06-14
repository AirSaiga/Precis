<!--
  @file DynamicListRenderer.vue
  @description 动态列表字段渲染器（用于 FilterRows / Aggregate / ConditionalAssign / SortRows）

  扩展功能：
  - columnSource: 'upstream' 支持从上游节点列名提供下拉选择
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <div v-for="(item, idx) in items" :key="idx" class="row">
      <template v-for="col in columns" :key="col.key">
        <div
          v-if="col.kind === 'text' && 'columnSource' in col && col.columnSource === 'upstream'"
          class="row-combobox-wrapper"
          :style="{
            flex: col.width === 'flex' ? '1' : undefined,
            width: col.width !== 'flex' ? col.width : undefined,
          }"
        >
          <input
            class="row-input"
            type="text"
            :value="(item as Record<string, unknown>)[col.key] ?? ''"
            :placeholder="col.placeholderKey ? t(col.placeholderKey) : ''"
            @change="updateItem(idx, col.key, ($event.target as HTMLInputElement).value)"
            @focus="openDropdown(idx, col.key)"
            @blur="closeDropdown"
            @input="filterDropdown(idx, col.key, ($event.target as HTMLInputElement).value)"
          />
          <Transition name="dropdown">
            <ul
              v-if="
                isDropdownOpen(idx, col.key) && getFilteredUpstreamColumns(idx, col.key).length > 0
              "
              class="column-dropdown"
              @mousedown.prevent
            >
              <li
                v-for="colName in getFilteredUpstreamColumns(idx, col.key)"
                :key="colName"
                class="column-option"
                @mousedown.prevent="selectUpstreamColumn(idx, col.key, colName)"
              >
                {{ colName }}
              </li>
            </ul>
          </Transition>
        </div>
        <input
          v-else-if="col.kind === 'text'"
          class="row-input"
          :style="{
            flex: col.width === 'flex' ? '1' : undefined,
            width: col.width !== 'flex' ? col.width : undefined,
          }"
          type="text"
          :value="(item as Record<string, unknown>)[col.key] ?? ''"
          :placeholder="col.placeholderKey ? t(col.placeholderKey) : ''"
          @change="updateItem(idx, col.key, ($event.target as HTMLInputElement).value)"
        />
        <select
          v-else-if="col.kind === 'select'"
          class="row-select"
          :style="{
            flex: col.width === 'flex' ? '1' : undefined,
            width: col.width !== 'flex' ? col.width : undefined,
          }"
          :value="(item as Record<string, unknown>)[col.key] ?? ''"
          @change="updateItem(idx, col.key, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in resolveOptions(col.options)" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
      </template>
      <button class="row-remove" type="button" @click="removeItem(idx)">×</button>
    </div>
    <button class="add-btn" type="button" @click="addItem">{{ addButtonLabel }}</button>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import { getByPath, getUpstreamColumns } from '../utils'
  import type { InspectorDynamicListField, InspectorSelectOption } from '../types'

  const { t } = useI18n()

  const props = defineProps<{
    field: InspectorDynamicListField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: unknown]
  }>()

  const columns = computed(() => props.field.columns)
  const addButtonLabel = computed(() => t(props.field.addButtonLabelKey))

  type RowItem = Record<string, unknown>

  /**
   * 判断一行是否全字段为空（视为未填写的占位行）。
   * 用于避免把 {column:"", op:"eq", value:""} 这类空行提交到 store / 后端。
   */
  function isEmptyRow(row: RowItem): boolean {
    return columns.value.every((col) => {
      const v = row[col.key]
      return v === '' || v === null || v === undefined
    })
  }

  /** 过滤掉全空行，仅提交有效行 */
  function filterEmptyRows(rows: RowItem[]): RowItem[] {
    return rows.filter((r) => !isEmptyRow(r))
  }

  /**
   * 展示用的行列表：
   * - 先取 store 中已持久化的行
   * - 始终在末尾追加一个占位空行，作为下一个输入位置
   * 占位空行仅用于展示编辑，不会被提交（见 filterEmptyRows）
   */
  const items = computed<RowItem[]>(() => {
    const v = props.value
    const stored: RowItem[] = Array.isArray(v) ? (v as RowItem[]) : []
    const validStored = filterEmptyRows(stored)
    return [...validStored, { ...props.field.emptyItem }]
  })

  const upstreamColumns = computed(() => getUpstreamColumns(props.ctx))

  const openDropdownKey = ref<string | null>(null)
  const dropdownFilter = ref('')

  function openDropdown(idx: number, key: string) {
    openDropdownKey.value = `${idx}-${key}`
    dropdownFilter.value = ''
  }

  function closeDropdown() {
    setTimeout(() => {
      openDropdownKey.value = null
    }, 150)
  }

  function isDropdownOpen(idx: number, key: string): boolean {
    return openDropdownKey.value === `${idx}-${key}`
  }

  function filterDropdown(idx: number, key: string, value: string) {
    openDropdownKey.value = `${idx}-${key}`
    dropdownFilter.value = value
  }

  function getFilteredUpstreamColumns(_idx: number, _key: string): string[] {
    const query = dropdownFilter.value.toLowerCase().trim()
    if (!query) return upstreamColumns.value
    return upstreamColumns.value.filter((col) => col.toLowerCase().includes(query))
  }

  function selectUpstreamColumn(idx: number, key: string, colName: string) {
    updateItem(idx, key, colName)
    openDropdownKey.value = null
  }

  function resolveOptions(opt: InspectorSelectOption): Array<{ key: string; label: string }> {
    if (opt.type === 'static') {
      return opt.options.map((o) => ({
        key: String(o.value),
        label: t(o.labelKey),
      }))
    }
    const raw = getByPath(props.ctx.data, opt.path)
    if (!Array.isArray(raw)) return []
    return raw.map((item: unknown, idx: number) => {
      const labelVal = opt.labelPath ? getByPath(item, opt.labelPath) : item
      const valueVal = opt.valuePath ? getByPath(item, opt.valuePath) : item
      return { key: String(valueVal ?? idx), label: String(labelVal ?? valueVal ?? idx) }
    })
  }

  function updateItem(index: number, key: string, value: string) {
    const next = items.value.map((item, i) =>
      i === index ? { ...item, [key]: value } : { ...item }
    )
    // 过滤全空行后再提交，避免空行污染 store / 后端
    emit('commit', filterEmptyRows(next))
  }

  function addItem() {
    // 当前末尾已有占位空行；"添加"仅触发一次提交（含已填行，过滤空行）
    // 提交后 items 会重新计算并补出新的占位空行
    emit('commit', filterEmptyRows(items.value))
  }

  function removeItem(index: number) {
    const next = items.value.filter((_, i) => i !== index)
    emit('commit', filterEmptyRows(next))
  }
</script>

<style scoped>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label {
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
  }

  .row-combobox-wrapper {
    position: relative;
  }

  .row-input {
    background: transparent;
    border: none;
    color: var(--ui-text-primary);
    font-size: 12px;
    outline: none;
    min-width: 40px;
    padding: 2px 4px;
    border-bottom: 1px solid var(--ui-border-subtle);
  }

  .row-input:focus {
    border-bottom-color: var(--ui-accent);
  }

  .row-select {
    padding: 2px 4px;
    border-radius: 3px;
    border: 1px solid var(--ui-border-subtle);
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 11px;
    cursor: pointer;
  }

  .column-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 120px;
    max-height: 160px;
    overflow-y: auto;
    margin: 2px 0 0;
    padding: 4px 0;
    background: var(--ui-bg-elevated, #2d2d30);
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 100;
    list-style: none;
  }

  .column-option {
    padding: 5px 8px;
    font-size: 11px;
    color: var(--ui-text-primary, #ccc);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .column-option:hover {
    background: var(--ui-accent-primary, #0e639c);
  }

  .row-remove {
    flex: 0 0 20px;
    background: transparent;
    border: none;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 14px;
    text-align: center;
    padding: 0;
  }

  .row-remove:hover {
    color: var(--ui-danger, #f44336);
  }

  .add-btn {
    background: transparent;
    border: 1px dashed var(--ui-border-light);
    color: var(--ui-text-muted);
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    transition: all 0.15s;
    margin-top: 2px;
  }

  .add-btn:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }

  .help {
    font-size: 11px;
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  .dropdown-enter-active,
  .dropdown-leave-active {
    transition: opacity 0.12s ease;
  }

  .dropdown-enter-from,
  .dropdown-leave-to {
    opacity: 0;
  }
</style>
