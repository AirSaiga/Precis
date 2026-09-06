<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<template>
  <div class="composite-constraint-node">
    <NodeShell
      :node-id="id"
      :title="
        data.configName || t('customNodes.constraintRules.compositeConstraintNode.defaultName')
      "
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
              {{
                t('customNodes.constraintRules.compositeConstraintNode.subCount', {
                  count: subConstraintCount,
                })
              }}
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
      all: t('customNodes.constraintRules.compositeConstraintNode.logicAll'),
      any: t('customNodes.constraintRules.compositeConstraintNode.logicAny'),
      none: t('customNodes.constraintRules.compositeConstraintNode.logicNone'),
    }
    return labels[props.data.logic || 'all'] || ''
  })

  const subConstraintCount = computed(() => {
    return props.data.includedNodeIds?.length || 0 || props.data.subGraph?.nodes?.length || 0
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
    font-size: var(--node-text-size);
    font-weight: 600;
    color: var(--ui-text-secondary);
  }

  .sub-count {
    font-size: var(--node-muted-size);
    color: var(--ui-text-muted);
  }

  .composite-desc {
    margin-top: 4px;
    font-size: var(--node-muted-size);
    color: var(--ui-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
