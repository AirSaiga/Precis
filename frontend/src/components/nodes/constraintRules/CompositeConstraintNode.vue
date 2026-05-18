<template>
  <div class="composite-constraint-node">
    <NodeShell
      :node-id="id"
      :title="data.configName || t('compositeConstraint.defaultName')"
      :badge="logicBadge"
      :badge-color="badgeColor"
      :status="data.validationStatus"
      @delete="handleDelete"
    >
      <template #handles>
        <Handle type="target" :position="Position.Left" id="target-left" />
      </template>

      <template #default>
        <div class="composite-content">
          <div class="composite-summary">
            <span class="logic-label">{{ logicLabel }}</span>
            <span class="sub-count">
              {{ t('compositeConstraint.subCount', { count: subConstraintCount }) }}
            </span>
          </div>
          <div v-if="data.description" class="composite-desc">
            {{ data.description }}
          </div>
        </div>
      </template>
    </NodeShell>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { Handle, Position } from '@vue-flow/core'
  import { useI18n } from 'vue-i18n'
  import NodeShell from '@/components/ui/NodeShell.vue'
  import type { CompositeConstraintNodeData } from '@/types/constraints'

  const { t } = useI18n()

  interface Props {
    id: string
    data: CompositeConstraintNodeData
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    delete: [nodeId: string]
  }>()

  const logicBadge = computed(() => {
    const logic = props.data.logic || 'all'
    return logic.toUpperCase()
  })

  const badgeColor = computed(() => {
    const colors: Record<string, string> = {
      all: '#4CAF50',
      any: '#2196F3',
      none: '#FF9800',
    }
    return colors[props.data.logic || 'all'] || '#999'
  })

  const logicLabel = computed(() => {
    const labels: Record<string, string> = {
      all: t('compositeConstraint.logic.all'),
      any: t('compositeConstraint.logic.any'),
      none: t('compositeConstraint.logic.none'),
    }
    return labels[props.data.logic || 'all'] || ''
  })

  const subConstraintCount = computed(() => {
    return props.data.subGraph?.nodes?.length || 0
  })

  function handleDelete() {
    emit('delete', props.id)
  }
</script>

<style scoped>
  .composite-constraint-node {
    width: 200px;
  }

  .composite-content {
    padding: 8px 12px;
  }

  .composite-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .logic-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-secondary);
  }

  .sub-count {
    font-size: 11px;
    color: var(--ui-text-muted);
  }

  .composite-desc {
    margin-top: 4px;
    font-size: 11px;
    color: var(--ui-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
