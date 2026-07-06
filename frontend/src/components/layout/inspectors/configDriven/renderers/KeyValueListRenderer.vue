<!--
  @file KeyValueListRenderer.vue
  @description 键值对列表字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <div v-for="(pair, idx) in pairs" :key="idx" class="row">
      <input
        class="row-input key-input"
        type="text"
        :value="pair.key"
        :placeholder="keyPlaceholder"
        @change="updateKey(idx, ($event.target as HTMLInputElement).value)"
      />
      <span class="separator">→</span>
      <input
        class="row-input value-input"
        type="text"
        :value="pair.value"
        :placeholder="valuePlaceholder"
        @change="updateValue(idx, ($event.target as HTMLInputElement).value)"
      />
      <button class="row-remove" type="button" @click="removeItem(idx)">
        <AppIcon name="x" :size="12" />
      </button>
    </div>
    <button class="add-btn" type="button" @click="addItem">{{ t('common.addMapping') }}</button>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorKeyValueListField } from '../types'

  const { t, te } = useI18n()

  const props = defineProps<{
    field: InspectorKeyValueListField
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

  /** 解析占位符：优先 i18n key，其次原始字符串，最后回退 */
  function resolvePlaceholder(key?: string, fallbackKey?: string, fallback?: string): string {
    if (key && te(key)) return t(key)
    if (fallback) return fallback
    return t(fallbackKey ?? '')
  }

  const keyPlaceholder = computed(() =>
    resolvePlaceholder(props.field.keyPlaceholderKey, 'common.key', props.field.keyPlaceholder)
  )
  const valuePlaceholder = computed(() =>
    resolvePlaceholder(
      props.field.valuePlaceholderKey,
      'common.value',
      props.field.valuePlaceholder
    )
  )

  type Pair = { key: string; value: string }

  function valueToList(v: unknown): Pair[] {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.entries(v as Record<string, string>).map(([key, value]) => ({
        key,
        value: String(value ?? ''),
      }))
    }
    return []
  }

  const pairs = ref<Pair[]>(valueToList(props.value))

  let ignoreWatch = false

  watch(
    () => props.value,
    (v) => {
      if (ignoreWatch) {
        ignoreWatch = false
        return
      }
      pairs.value = valueToList(v)
    }
  )

  function toObject(list: Pair[]): Record<string, string> {
    const obj: Record<string, string> = {}
    for (const { key, value } of list) {
      if (key.trim() !== '') {
        obj[key] = value
      }
    }
    return obj
  }

  function emitChange(next: Pair[]) {
    pairs.value = next
    const obj = toObject(next)
    if (next.length > Object.keys(obj).length) {
      ignoreWatch = true
    }
    emit('commit', obj)
  }

  function updateKey(index: number, newKey: string) {
    emitChange(pairs.value.map((p, i) => (i === index ? { ...p, key: newKey } : { ...p })))
  }

  function updateValue(index: number, newValue: string) {
    emitChange(pairs.value.map((p, i) => (i === index ? { ...p, value: newValue } : { ...p })))
  }

  function addItem() {
    emitChange([...pairs.value, { key: '', value: '' }])
  }

  function removeItem(index: number) {
    emitChange(pairs.value.filter((_, i) => i !== index))
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

  .key-input {
    flex: 1;
    font-weight: 500;
  }

  .value-input {
    flex: 1;
  }

  .separator {
    color: var(--ui-text-muted);
    font-size: 12px;
    flex: 0 0 16px;
    text-align: center;
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
