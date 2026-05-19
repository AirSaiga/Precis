<!--
  @file DynamicListRenderer.vue
  @description 动态列表字段渲染器（用于 FilterRows / Aggregate / ConditionalAssign / SortRows）
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <div v-for="(item, idx) in items" :key="idx" class="row">
      <template v-for="col in columns" :key="col.key">
        <input
          v-if="col.kind === 'text'"
          class="row-input"
          :style="{ flex: col.width === 'flex' ? '1' : undefined, width: col.width !== 'flex' ? col.width : undefined }"
          type="text"
          :value="(item as Record<string, unknown>)[col.key] ?? ''"
          :placeholder="col.placeholderKey ? t(col.placeholderKey) : ''"
          @change="updateItem(idx, col.key, ($event.target as HTMLInputElement).value)"
        />
        <select
          v-else-if="col.kind === 'select'"
          class="row-select"
          :style="{ flex: col.width === 'flex' ? '1' : undefined, width: col.width !== 'flex' ? col.width : undefined }"
          :value="(item as Record<string, unknown>)[col.key] ?? ''"
          @change="updateItem(idx, col.key, ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="opt in resolveOptions(col.options)"
            :key="opt.key"
            :value="opt.key"
          >
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
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import { getByPath } from '../utils'
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

  const items = computed<RowItem[]>(() => {
    const v = props.value
    if (Array.isArray(v) && v.length > 0) return v as RowItem[]
    if (props.field.minItems) return [{ ...props.field.emptyItem }]
    return []
  })

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
    emit('commit', next)
  }

  function addItem() {
    const next = [...items.value, { ...props.field.emptyItem }]
    emit('commit', next)
  }

  function removeItem(index: number) {
    const next = items.value.filter((_, i) => i !== index)
    if (props.field.minItems && next.length === 0) {
      emit('commit', [{ ...props.field.emptyItem }])
    } else {
      emit('commit', next)
    }
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
</style>
