<!--
  @file BaseInspector.vue
  @description 基础检查器布局组件
-->
<template>
  <div class="base-inspector">
    <div v-if="configTitle" class="base-title">{{ configTitle }}</div>

    <div v-for="section in visibleSections" :key="section.id" class="section">
      <div v-if="section.titleKey" class="section-title">{{ t(section.titleKey) }}</div>
      <div v-if="section.descriptionKey" class="section-desc">{{ t(section.descriptionKey) }}</div>

      <div class="fields">
        <component
          v-for="field in visibleFields(section)"
          :key="field.id"
          :is="rendererRegistry[field.kind]"
          :field="field"
          :ctx="ctx"
          :value="getFieldValue(field)"
          :label="t(field.labelKey)"
          :help="field.helpKey ? t(field.helpKey) : undefined"
          :placeholder="getPlaceholder(field)"
          :readonly="isReadonly(field)"
          @commit="(payload) => commitField(field, payload)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import type {
    InspectorCommitPayload,
    InspectorConfigV1,
    InspectorField,
    InspectorSection,
  } from './types'
  import {
    buildShallowCompatiblePatch,
    evaluateWhen,
    getSourceValue,
    type InspectorContext,
  } from './utils'
  import { rendererRegistry } from './rendererRegistry'

  const { t } = useI18n()
  const store = useGraphStore()

  const props = defineProps<{
    config: InspectorConfigV1
    data: Record<string, unknown>
    nodeId: string
    nodeType: string
  }>()

  const emit = defineEmits<{
    'update:data': [value: Record<string, unknown>]
  }>()

  const ctx = computed<InspectorContext>(() => ({
    data: props.data ?? {},
    nodeId: props.nodeId,
    nodeType: props.nodeType,
    nodes: store.nodes,
  }))

  const configTitle = computed(() => (props.config.titleKey ? t(props.config.titleKey) : ''))

  const visibleSections = computed(() =>
    props.config.sections.filter((s) => evaluateWhen(ctx.value, s.when))
  )

  function visibleFields(section: InspectorSection): InspectorField[] {
    return section.fields.filter((f) => evaluateWhen(ctx.value, f.when))
  }

  function isReadonly(field: InspectorField): boolean {
    if (field.readonly) return true
    if ('source' in field) {
      return field.source.source === 'meta'
    }
    return false
  }

  function getPlaceholder(field: InspectorField): string | undefined {
    if ('placeholderKey' in field) return field.placeholderKey ? t(field.placeholderKey) : undefined
    return undefined
  }

  function getFieldValue(field: InspectorField): unknown {
    if ('source' in field) {
      return getSourceValue(ctx.value, field.source)
    }
    return undefined
  }

  function isPatchPayload(
    payload: InspectorCommitPayload
  ): payload is { __patch: Record<string, unknown> } {
    return (
      Boolean(payload) &&
      typeof payload === 'object' &&
      '__patch' in (payload as Record<string, unknown>)
    )
  }

  function commitField(field: InspectorField, payload: InspectorCommitPayload) {
    if (isReadonly(field)) return
    if (isPatchPayload(payload)) {
      if (Object.keys(payload.__patch).length === 0) return
      emit('update:data', payload.__patch)
      return
    }
    if (!('source' in field)) return
    const patch = buildShallowCompatiblePatch(props.data ?? {}, field.source, payload)
    if (Object.keys(patch).length === 0) return
    emit('update:data', patch)
  }
</script>

<style scoped src="./BaseInspector.styles.css"></style>
