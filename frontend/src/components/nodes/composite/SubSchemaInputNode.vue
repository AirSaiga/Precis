<template>
  <div class="sub-schema-input-node">
    <NodeShell
      :node-id="id"
      :title="data.configName || t('customNodes.subSchemaInputNode.defaultTitle')"
      badge="IN"
      badge-color="#0e639c"
    >
      <template #handles>
        <Handle type="source" :position="Position.Right" id="source-right" />
      </template>
    </NodeShell>
  </div>
</template>

<script setup lang="ts">
  import { Handle, Position } from '@vue-flow/core'
  import { useI18n } from 'vue-i18n'
  import NodeShell from '@/components/ui/NodeShell.vue'

  interface Props {
    id: string
    data: Record<string, unknown>
  }

  defineProps<Props>()

  const { t } = useI18n()
</script>

<style scoped>
  .sub-schema-input-node {
    width: 140px;
  }
</style>
