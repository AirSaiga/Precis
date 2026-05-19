<!--
  @file TagsRenderer.vue
  @description 标签字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

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
      <input
        class="input"
        type="text"
        v-model="draft"
        :placeholder="placeholder"
        @keyup.enter="addTag"
      />
      <button class="add-btn" type="button" @click="addTag">+</button>
    </div>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorTagsField } from '../types'

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

  // 本地可编辑副本，仅在 editable 模式下使用
  const editableTags = ref<string[]>([])

  const tags = computed<string[]>(() => {
    const v = props.value as unknown
    if (v instanceof Set) return Array.from(v).map(String)
    if (Array.isArray(v)) return v.map((x) => String(x))
    return []
  })

  // 同步外部数据到本地可编辑副本
  watch(
    () => props.value,
    () => {
      editableTags.value = [...tags.value]
    },
    { immediate: true, deep: true }
  )

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
