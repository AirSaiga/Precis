<!--
  @file RegexPatternRenderer.vue
  @description 正则表达式捕获组渲染器（用于 RegexExtract）
  支持捕获组解析、自动 outputColumns 同步、flags 复选框
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <!-- 正则表达式输入 -->
    <div class="pattern-input-wrapper">
      <input
        class="pattern-input"
        :class="{ 'pattern-invalid': !!validationError }"
        type="text"
        :value="patternValue"
        :placeholder="placeholder"
        :disabled="readonly"
        @input="onPatternInput(($event.target as HTMLInputElement).value)"
        @blur="onPatternBlur(($event.target as HTMLInputElement).value)"
      />
      <span v-if="validationError" class="validation-error">{{ validationError }}</span>
      <span v-else-if="patternValue && captureGroupCount > 0" class="validation-ok">
        {{ t('inspector.transformNode.params.regexExtract.captureGroups') }}:
        {{ captureGroupCount }}
      </span>
    </div>

    <!-- 忽略大小写复选框 -->
    <div class="flags-row">
      <label class="flags-label">{{
        t('inspector.transformNode.params.regexExtract.flags')
      }}</label>
      <input
        type="checkbox"
        :checked="flagsValue === 'i'"
        :disabled="readonly"
        @change="onFlagsChange(($event.target as HTMLInputElement).checked)"
      />
    </div>

    <!-- 捕获组配置 -->
    <div v-if="captureGroupCount > 0" class="capture-groups">
      <label class="groups-label">
        {{ t('inspector.transformNode.params.regexExtract.captureGroups') }}（{{
          captureGroupCount
        }}
        个）
      </label>
      <div class="groups-list">
        <div v-for="(name, idx) in groupNames" :key="idx" class="group-item">
          <span class="group-label"
            >{{ t('inspector.transformNode.params.regexExtract.groupLabel') }}{{ idx + 1 }}</span
          >
          <input
            class="group-input"
            type="text"
            :value="name"
            :placeholder="`${t('inspector.transformNode.params.regexExtract.columnName')}${idx + 1}`"
            @blur="onGroupBlur(idx, ($event.target as HTMLInputElement).value)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
        </div>
      </div>
    </div>
    <div v-else-if="patternValue && patternValue.length > 0" class="no-groups">
      <span class="hint">{{ t('inspector.transformNode.params.regexExtract.noCaptureHint') }}</span>
    </div>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import type { InspectorRegexPatternField } from '../types'

  const { t } = useI18n()

  const props = defineProps<{
    field: InspectorRegexPatternField
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

  const validationError = ref('')
  let validateTimer: ReturnType<typeof setTimeout> | null = null

  function validateRegex(pattern: string): string {
    if (!pattern) return ''
    try {
      new RegExp(pattern)
      return ''
    } catch (e) {
      return String((e as Error).message || 'Invalid regex')
    }
  }

  function onPatternInput(value: string) {
    if (validateTimer) clearTimeout(validateTimer)
    validateTimer = setTimeout(() => {
      validationError.value = validateRegex(value)
    }, 300)
    validationError.value = ''
  }

  // 从 ctx 读取关联数据
  const patternValue = computed(() => String(props.value ?? ''))
  const flagsValue = computed(() =>
    String((props.ctx.data.params as Record<string, unknown>)?.flags ?? '')
  )
  const outputColumnsValue = computed(() => {
    const cols = props.ctx.data.outputColumns
    return Array.isArray(cols) ? (cols as string[]) : []
  })

  // 捕获组列名本地副本
  const groupNames = ref<string[]>([...outputColumnsValue.value])
  watch(
    () => props.ctx.data.outputColumns,
    (cols) => {
      groupNames.value = Array.isArray(cols) ? [...cols] : []
    },
    { deep: true }
  )

  /**
   * 解析正则表达式中捕获组数量
   * 排除非捕获组 (?:...)、断言、字符类中的 (、转义的 \(
   */
  function countCaptureGroups(pattern: string): number {
    if (!pattern) return 0
    let count = 0
    let inCharClass = false
    let escaped = false
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '[' && !inCharClass) {
        inCharClass = true
        continue
      }
      if (ch === ']' && inCharClass) {
        inCharClass = false
        continue
      }
      if (inCharClass) continue
      if (ch === '(' && pattern[i + 1] !== '?') {
        count++
      }
    }
    return count
  }

  const captureGroupCount = computed(() => countCaptureGroups(patternValue.value))

  function emitPatch(patch: Record<string, unknown>) {
    emit('commit', { __patch: patch })
  }

  function onPatternBlur(newPattern: string) {
    const currentParams = (props.ctx.data.params ?? {}) as Record<string, unknown>
    const groupCount = countCaptureGroups(newPattern)
    const currentCols = [...outputColumnsValue.value]

    // 补齐默认列名
    if (groupCount > 0 && currentCols.length < groupCount) {
      for (let i = currentCols.length; i < groupCount; i++) {
        currentCols.push(`extract_${i + 1}`)
      }
    }

    // 截取到捕获组数量
    const nextCols = groupCount > 0 ? currentCols.slice(0, groupCount) : currentCols

    emitPatch({
      params: { ...currentParams, pattern: newPattern },
      outputColumns: nextCols,
    })
  }

  function onFlagsChange(checked: boolean) {
    const currentParams = (props.ctx.data.params ?? {}) as Record<string, unknown>
    emitPatch({
      params: { ...currentParams, flags: checked ? 'i' : '' },
    })
  }

  function onGroupBlur(index: number, newValue: string) {
    const groupCount = captureGroupCount.value
    const names = groupNames.value.map((n) => n.trim())
    // 补齐
    const nextCols: string[] = []
    for (let i = 0; i < groupCount; i++) {
      if (i === index) {
        nextCols.push(newValue.trim() || `extract_${i + 1}`)
      } else {
        nextCols.push(names[i] || `extract_${i + 1}`)
      }
    }
    emitPatch({ outputColumns: nextCols })
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

  .pattern-input-wrapper {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pattern-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--ui-border-subtle);
    color: var(--ui-text-primary);
    font-size: 12px;
    outline: none;
    padding: 4px 0;
    width: 100%;
    font-family: 'Consolas', 'Monaco', monospace;
  }

  .pattern-input:focus {
    border-bottom-color: var(--ui-accent);
  }

  .pattern-input.pattern-invalid {
    border-bottom-color: var(--ui-danger, #f44336);
  }

  .validation-error {
    font-size: 11px;
    color: var(--ui-danger, #f44336);
  }

  .validation-ok {
    font-size: 11px;
    color: var(--ui-success, #4caf50);
  }

  .flags-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .flags-label {
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .capture-groups {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .groups-label {
    font-size: 11px;
    color: var(--ui-text-secondary);
  }

  .groups-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .group-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 4px 8px;
  }

  .group-label {
    font-size: 11px;
    color: var(--ui-text-muted);
    min-width: 32px;
    flex-shrink: 0;
  }

  .group-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--ui-text-primary);
    font-size: 12px;
    outline: none;
    min-width: 60px;
  }

  .no-groups {
    padding: 4px 0;
  }

  .hint {
    font-size: 11px;
    color: var(--ui-text-muted);
  }

  .help {
    font-size: 11px;
    color: var(--ui-text-muted);
    margin-top: 2px;
  }
</style>
