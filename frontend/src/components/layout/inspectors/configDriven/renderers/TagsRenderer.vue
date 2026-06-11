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

    <div v-if="computedTags.length > 0" class="tags computed">
      <div v-for="(tag, idx) in computedTags" :key="`computed-${idx}`" class="tag computed-tag">
        <span class="tag-text">{{ tag }}</span>
      </div>
      <span class="computed-hint">{{ t('inspector.transformNode.autoComputed') }}</span>
    </div>

    <template v-else>
      <div class="tags">
        <div v-for="(tag, idx) in editableTags" :key="`tag-${idx}`" class="tag">
          <template v-if="isEditable && !readonly">
            <input
              class="tag-edit-input"
              type="text"
              :value="tag"
              @blur="commitTagEdit(idx, ($event.target as HTMLInputElement).value)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
          </template>
          <span v-else class="tag-text">{{ tag }}</span>
          <button v-if="!readonly" class="tag-remove" type="button" @click="removeTag(idx)">×</button>
        </div>
        <div v-if="tags.length === 0" class="empty">-</div>
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
    </template>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import { getUpstreamColumns } from '../utils'
  import type { InspectorTagsField } from '../types'

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

  watch(
    () => props.value,
    () => {
      editableTags.value = [...tags.value]
    },
    { immediate: true, deep: true }
  )

  const computedTags = computed<string[]>(() => {
    const transformType = props.field.computedFromParams
    if (!transformType) return []

    const currentType = props.ctx.data.transformType as string
    if (currentType !== transformType) return []

    if (transformType === 'StringSplit') {
      return computeStringSplitColumns()
    }

    return []
  })

  function computeStringSplitColumns(): string[] {
    const params = props.ctx.data.params as Record<string, unknown> | undefined
    if (!params) return []

    const delimiter = String(params.delimiter ?? ',')
    const maxsplit = (params.maxsplit as number) ?? -1

    const upstreamCols = getUpstreamColumns(props.ctx)
    const sampleValue = upstreamCols.length > 0 ? 'sample' : 'a,b,c'

    let parts: string[]
    if (maxsplit === -1) {
      parts = sampleValue.split(delimiter)
    } else {
      parts = sampleValue.split(delimiter, maxsplit + 1)
    }

    const count = Math.max(parts.length, 1)
    return Array.from({ length: count }, (_, i) => `part${i + 1}`)
  }

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
    const next = [...tags.value, sug]
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
    const next = [...tags.value, v]
    editableTags.value = [...next]
    commitNext(next)
    draft.value = ''
    showSuggestions.value = false
  }

  function removeTag(index: number) {
    const next = tags.value.slice()
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
