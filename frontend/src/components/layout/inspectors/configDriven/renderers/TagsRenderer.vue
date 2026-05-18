<!--
  @file TagsRenderer.vue
  @description 标签字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <div class="tags">
      <div v-for="(tag, idx) in tags" :key="`${tag}-${idx}`" class="tag">
        <span class="tag-text">{{ tag }}</span>
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
  import { computed, ref } from 'vue'
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

  const draft = ref('')

  const tags = computed<string[]>(() => {
    const v = props.value as unknown
    if (v instanceof Set) return Array.from(v).map(String)
    if (Array.isArray(v)) return v.map((x) => String(x))
    return []
  })

  function commitNext(next: string[]) {
    const trimmed = next.map((s) => s.trim()).filter(Boolean)
    const unique = Array.from(new Set(trimmed))
    const current = props.value
    if (current instanceof Set) {
      emit('commit', new Set(unique))
      return
    }
    emit('commit', unique)
  }

  function addTag() {
    const v = draft.value.trim()
    if (!v) return
    commitNext([...tags.value, v])
    draft.value = ''
  }

  function removeTag(index: number) {
    const next = tags.value.slice()
    next.splice(index, 1)
    commitNext(next)
  }
</script>

<style scoped src="./TagsRenderer.styles.css"></style>
