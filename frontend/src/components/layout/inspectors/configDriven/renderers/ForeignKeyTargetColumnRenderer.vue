<!--
  @file ForeignKeyTargetColumnRenderer.vue
  @description 外键目标列字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <select
      v-if="hasTargetConnection && targetColumns.length > 0"
      class="select"
      :value="selectedColumnId"
      :disabled="readonly"
      @change="onChange"
    >
      <option value="">
        {{ placeholder || t('inspector.constraint.foreignKey.selectTargetColumn') }}
      </option>
      <option v-for="col in targetColumns" :key="col.id" :value="col.id">
        {{ col.columnName }}
      </option>
    </select>
    <div v-else-if="hasTargetConnection && targetColumns.length === 0" class="readonly-value">
      {{ t('inspector.constraint.foreignKey.noColumnsAvailable') }}
    </div>
    <div v-else class="readonly-value">
      {{ t('inspector.constraint.foreignKey.targetNotConnected') }}
    </div>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import type { InspectorFieldBase } from '../types'

  const { t } = useI18n()

  const props = defineProps<{
    field: InspectorFieldBase
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

  // 从 ctx.data 中获取目标节点引用
  const targetRef = computed(() => {
    const data = props.ctx.data as unknown as Record<string, unknown>
    const config = (data?.config || {}) as Record<string, unknown>
    return (data?.targetRef as Record<string, unknown>)?.nodeId || config?.targetNodeId
  })

  const targetNodeId = computed(() => {
    if (typeof targetRef.value === 'string') {
      return targetRef.value
    }
    return (targetRef.value as Record<string, unknown>)?.nodeId as string
  })

  // 获取目标节点
  const targetNode = computed(() => {
    if (!targetNodeId.value || !props.ctx.nodes) return null
    return props.ctx.nodes.find((n) => n.id === targetNodeId.value) || null
  })

  // 获取目标表的列列表
  const targetColumns = computed(() => {
    if (!targetNode.value) return []
    const nodeData = targetNode.value.data as unknown as Record<string, unknown>
    return (nodeData?.columns || []) as Array<{ id: string; columnName: string }>
  })

  // 是否有目标表连接
  const hasTargetConnection = computed(() => {
    return !!targetNode.value
  })

  // 当前选中的列ID
  const selectedColumnId = computed(() => {
    const data = props.ctx.data as unknown as Record<string, unknown>
    return ((data?.targetRef as Record<string, unknown>)?.columnId as string) || ''
  })

  function onChange(e: Event) {
    const target = e.target as HTMLSelectElement
    const columnId = target.value
    if (!columnId) return

    const selectedColumn = targetColumns.value.find((c: any) => c.id === columnId)
    if (selectedColumn) {
      // 提交一个 patch 对象，同时更新多个字段
      emit('commit', {
        __patch: {
          targetColumn: selectedColumn.columnName,
          targetRef: {
            ...((props.ctx.data as unknown as Record<string, unknown>)?.targetRef as Record<
              string,
              unknown
            >),
            columnId: columnId,
          },
          config: {
            ...(((props.ctx.data as unknown as Record<string, unknown>)?.config as Record<
              string,
              unknown
            >) || { ruleType: 'EXIST_IN' }),
            targetColumn: selectedColumn.columnName,
          },
        },
      })
    }
  }
</script>

<style scoped src="./ForeignKeyTargetColumnRenderer.styles.css"></style>
