<!--
  @file TagsRenderer.vue
  @description 标签字段渲染器

  扩展功能：
  - computedFromParams: 当配置了 transformType 时，自动计算输出列名（不可手动编辑）
  - suggestionsFromUpstream: 从上游列名提供下拉建议
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <div class="tags">
      <div v-for="(tag, idx) in displayTags" :key="`tag-${idx}`" class="tag">
        <template v-if="isEditable && !readonly">
          <input
            class="tag-edit-input"
            type="text"
            :value="editableTags[idx] ?? tag"
            @blur="commitTagEdit(idx, ($event.target as HTMLInputElement).value)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
        </template>
        <span v-else class="tag-text">{{ tag }}</span>
        <button v-if="!readonly" class="tag-remove" type="button" @click="removeTag(idx)">×</button>
      </div>
      <div v-if="displayTags.length === 0" class="empty">-</div>
    </div>

    <div v-if="!readonly" class="add">
      <div v-if="suggestions.length > 0" class="combobox-wrapper">
        <input
          ref="suggestionInputRef"
          class="input"
          type="text"
          v-model="draft"
          :placeholder="placeholder"
          @keyup.enter="addTag"
          @focus="showSuggestions = true"
          @blur="onSuggestionBlur"
          @input="showSuggestions = true"
        />
        <Transition name="dropdown">
          <ul
            v-if="showSuggestions && filteredSuggestions.length > 0"
            class="suggestions-dropdown"
            @mousedown.prevent
          >
            <li
              v-for="sug in filteredSuggestions"
              :key="sug"
              class="suggestion-item"
              @mousedown.prevent="addSuggestion(sug)"
            >
              {{ sug }}
            </li>
          </ul>
        </Transition>
      </div>
      <template v-else>
        <input
          class="input"
          type="text"
          v-model="draft"
          :placeholder="placeholder"
          @keyup.enter="addTag"
        />
      </template>
      <button class="add-btn" type="button" @click="addTag">+</button>
    </div>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import { getUpstreamColumns, getUpstreamRows } from '../utils'
  import type { InspectorTagsField } from '../types'
  import { computeStringSplit } from '@/composables/nodes/transform/transformCalculations'
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const { t } = useI18n()

  const props = defineProps<{
    field: InspectorTagsField
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

  const isEditable = computed(() => props.field.editable === true)
  const draft = ref('')
  const editableTags = ref<string[]>([])
  const suggestionInputRef = ref<HTMLInputElement | null>(null)
  const showSuggestions = ref(false)

  const tags = computed<string[]>(() => {
    const v = props.value as unknown
    if (v instanceof Set) return Array.from(v).map(String)
    if (Array.isArray(v)) return v.map((x) => String(x))
    return []
  })

  /**
   * 根据真实上游数据计算 StringSplit 的建议输出列名。
   * 复用 save 路径的 computeStringSplit，保证预览与实际结果一致（R1 修复）。
   * 无上游数据时返回空数组（不预填）。
   */
  function computeStringSplitColumns(): string[] {
    const params = props.ctx.data.params as Record<string, unknown> | undefined
    if (!params) return []

    const delimiter = String(params.delimiter ?? ',')
    const maxsplit = (params.maxsplit as number) ?? -1

    const upstreamRows = getUpstreamRows(props.ctx)
    if (upstreamRows.length === 0) return []

    const result = computeStringSplit(upstreamRows, { delimiter, maxsplit })
    return result.columns
  }

  /**
   * StringSplit 场景下的展示标签：
   * - 用户已手动设置 outputColumns → 优先用用户值（可继续编辑）
   * - 未设置 → 用真实数据计算的 part1/part2... 作为默认值（可编辑改名）
   * 这样既保证预览准确，又允许用户重命名（R2 修复）。
   */
  const displayTags = computed<string[]>(() => {
    const transformType = props.field.computedFromParams
    if (!transformType) return tags.value

    const currentType = props.ctx.data.transformType as string
    if (currentType !== transformType) return tags.value

    if (transformType === 'StringSplit') {
      // 用户已设置则用用户的，否则用计算的默认值
      return tags.value.length > 0 ? tags.value : computeStringSplitColumns()
    }
    return tags.value
  })

  watch(
    () => displayTags.value,
    (next) => {
      editableTags.value = [...next]
    },
    { immediate: true, deep: true }
  )

  const suggestions = computed<string[]>(() => {
    if (!props.field.suggestionsFromUpstream) return []
    return getUpstreamColumns(props.ctx)
  })

  const filteredSuggestions = computed(() => {
    const query = draft.value.toLowerCase().trim()
    if (!query) return suggestions.value
    return suggestions.value.filter((s) => s.toLowerCase().includes(query))
  })

  function onSuggestionBlur() {
    setTimeout(() => {
      showSuggestions.value = false
    }, 150)
  }

  function addSuggestion(sug: string) {
    const next = [...displayTags.value, sug]
    editableTags.value = [...next]
    commitNext(next)
    draft.value = ''
    showSuggestions.value = false
  }

  function commitNext(next: string[]) {
    const trimmed = next.map((s) => s.trim()).filter(Boolean)
    const current = props.value
    if (current instanceof Set) {
      emit('commit', new Set(trimmed))
      return
    }
    emit('commit', trimmed)
  }

  function addTag() {
    const v = draft.value.trim()
    if (!v) return
    const next = [...displayTags.value, v]
    editableTags.value = [...next]
    commitNext(next)
    draft.value = ''
    showSuggestions.value = false
  }

  function removeTag(index: number) {
    const next = displayTags.value.slice()
    next.splice(index, 1)
    editableTags.value = [...next]
    commitNext(next)
  }

  function commitTagEdit(index: number, newValue: string) {
    const next = [...editableTags.value]
    next[index] = newValue.trim()
    editableTags.value = next
    commitNext(next)
  }
</script>

<style scoped src="./TagsRenderer.styles.css"></style>
