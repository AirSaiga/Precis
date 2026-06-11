<!--
  @file UpstreamColumnSelectRenderer.vue
  @description 上游列名字段渲染器 — 可搜索下拉 combobox

  功能：
  - 有上游连接时：从上游节点提取列名，提供下拉选择（支持搜索过滤）
  - 无上游连接时：降级为文本输入 + 提示信息
  - 保留手动输入能力
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <div v-if="upstreamColumns.length > 0" class="combobox-wrapper">
      <input
        ref="inputRef"
        type="text"
        class="combobox-input"
        :value="inputValue"
        :placeholder="placeholder"
        :disabled="readonly"
        @input="onInput"
        @focus="showDropdown = true"
        @blur="onBlur"
        @keydown.down.prevent="highlightNext"
        @keydown.up.prevent="highlightPrev"
        @keydown.enter.prevent="selectHighlighted"
        @keydown.esc="showDropdown = false"
      />
      <Transition name="dropdown">
        <ul
          v-if="showDropdown && filteredColumns.length > 0"
          class="combobox-dropdown"
          @mousedown.prevent
        >
          <li
            v-for="(col, idx) in filteredColumns"
            :key="col"
            class="combobox-option"
            :class="{ highlighted: idx === highlightedIndex }"
            @mouseenter="highlightedIndex = idx"
            @mousedown.prevent="selectColumn(col)"
          >
            {{ col }}
          </li>
        </ul>
      </Transition>
    </div>

    <div v-else class="readonly-value">
      {{ noUpstreamHint ? t('inspector.transformNode.noUpstreamConnected') : (value as string || placeholder || '-') }}
    </div>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import { getUpstreamColumns } from '../utils'
  import type { InspectorUpstreamColumnSelectField } from '../types'

  const { t } = useI18n()

  const props = defineProps<{
    field: InspectorUpstreamColumnSelectField
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

  const inputRef = ref<HTMLInputElement | null>(null)
  const showDropdown = ref(false)
  const highlightedIndex = ref(-1)
  const inputValue = ref(String(props.value ?? ''))

  watch(
    () => props.value,
    (v) => {
      inputValue.value = String(v ?? '')
    }
  )

  const upstreamColumns = computed(() => getUpstreamColumns(props.ctx))

  const noUpstreamHint = computed(() => {
    const inputFromNode = props.ctx.data.inputFromNode as string | undefined
    return !inputFromNode
  })

  const filteredColumns = computed(() => {
    const query = inputValue.value.toLowerCase().trim()
    if (!query) return upstreamColumns.value
    return upstreamColumns.value.filter((col) => col.toLowerCase().includes(query))
  })

  function onInput(e: Event) {
    const val = (e.target as HTMLInputElement).value
    inputValue.value = val
    showDropdown.value = true
    highlightedIndex.value = -1
    emit('commit', val)
  }

  function onBlur() {
    setTimeout(() => {
      showDropdown.value = false
    }, 150)
  }

  function selectColumn(col: string) {
    inputValue.value = col
    showDropdown.value = false
    highlightedIndex.value = -1
    emit('commit', col)
    inputRef.value?.blur()
  }

  function selectHighlighted() {
    if (highlightedIndex.value >= 0 && highlightedIndex.value < filteredColumns.value.length) {
      selectColumn(filteredColumns.value[highlightedIndex.value])
    } else {
      showDropdown.value = false
    }
  }

  function highlightNext() {
    if (highlightedIndex.value < filteredColumns.value.length - 1) {
      highlightedIndex.value++
    }
  }

  function highlightPrev() {
    if (highlightedIndex.value > 0) {
      highlightedIndex.value--
    }
  }
</script>

<style scoped>
  .field {
    margin-bottom: 8px;
  }

  .label {
    display: block;
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
    margin-bottom: 4px;
  }

  .combobox-wrapper {
    position: relative;
  }

  .combobox-input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border: 1px solid var(--ui-border-light, #3c3c3c);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  .combobox-input:focus {
    border-color: var(--ui-accent, #007acc);
  }

  .combobox-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 200px;
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

  .combobox-option {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--ui-text-primary, #ccc);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .combobox-option.highlighted {
    background: var(--ui-accent-primary, #0e639c);
  }

  .readonly-value {
    padding: 4px 0;
    font-size: 12px;
    color: var(--ui-text-muted, #858585);
  }

  .help {
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
    margin-top: 4px;
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
