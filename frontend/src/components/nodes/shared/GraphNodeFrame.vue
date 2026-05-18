<!--
  @file GraphNodeFrame.vue
  @description 通用图节点框架组件

  为所有画布节点提供统一的外壳包装，包括：
  - 节点选中/悬停状态样式
  - 错误徽章（显示校验错误数量）
  - 保存/删除操作按钮
  - 连接句柄（Handle）渲染
  - 主题适配（light/dark）

  所有具体节点组件（SchemaNode、RegexNode、ConstraintNode 等）
  都通过此框架获得一致的外观和交互行为。
-->

<template>
  <NodeShell
    v-bind="attrs"
    class="graph-node-frame"
    :selected="selected"
    :theme="theme"
    :state="state"
    :has-error="errorCount > 0"
    :error-count="errorCount"
    :show-delete="showDelete"
    :show-save="showSave"
    :is-saving="isSaving"
    :delete-title="deleteTitle"
    :save-title="saveTitle"
    :save-text="saveText"
    :saving-text="savingText"
    :error-title="errorTitle"
    :title="shellTitle || undefined"
    @delete="$emit('delete')"
    @save="$emit('save')"
    @error-click="$emit('error-click')"
  >
    <template #overlay>
      <NodeHandle
        v-for="handle in handles"
        :id="handle.id"
        :key="handle.id"
        :type="handle.type"
        :position="handle.position"
        :title="handle.title"
        :color="handle.color"
        :connected="handle.connected"
        :snapping="handle.snapping"
        :top-offset="handle.topOffset"
        :side-offset="handle.sideOffset"
        :size="handle.size"
        :disabled="handle.disabled"
      />
    </template>

    <template #header>
      <NodeHeader
        :icon="icon"
        :title="title"
        :subtitle="subtitle"
        :theme="theme"
        :status="state"
        :show-help="Boolean(helpText)"
        :help-text="helpText"
      >
        <template v-if="$slots.actions" #actions>
          <slot name="actions" />
        </template>
      </NodeHeader>
      <NodeDivider :theme="theme" spacing="sm" />
    </template>

    <slot />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </NodeShell>
</template>

<script setup lang="ts">
  import { useAttrs } from 'vue'
  import { Position } from '@vue-flow/core'
  import NodeDivider from '@/components/ui/NodeDivider.vue'
  import NodeHandle from '@/components/ui/NodeHandle.vue'
  import NodeHeader from '@/components/ui/NodeHeader.vue'
  import NodeShell from '@/components/ui/NodeShell.vue'
  import type { NodeHandleSize, NodeState, NodeTheme } from '@/components/ui/nodeVariants'

  defineOptions({
    inheritAttrs: false,
  })

  interface GraphHandleConfig {
    id: string
    type: 'target' | 'source'
    position:
      | typeof Position.Left
      | typeof Position.Right
      | typeof Position.Top
      | typeof Position.Bottom
    color?: NodeTheme
    title?: string
    connected?: boolean
    snapping?: boolean
    topOffset?: string
    sideOffset?: string
    size?: NodeHandleSize
    disabled?: boolean
  }

  interface Props {
    selected?: boolean
    theme: NodeTheme
    state?: NodeState
    title: string
    subtitle?: string
    icon?: string
    helpText?: string
    shellTitle?: string
    errorCount?: number
    showDelete?: boolean
    showSave?: boolean
    isSaving?: boolean
    deleteTitle?: string
    errorTitle?: string
    saveTitle?: string
    saveText?: string
    savingText?: string
    handles?: GraphHandleConfig[]
  }

  withDefaults(defineProps<Props>(), {
    selected: false,
    state: 'idle',
    subtitle: '',
    icon: '',
    helpText: '',
    shellTitle: '',
    errorCount: 0,
    showDelete: false,
    showSave: false,
    isSaving: false,
    deleteTitle: '',
    errorTitle: '',
    saveTitle: '',
    saveText: '',
    savingText: '',
    handles: () => [],
  })

  defineEmits<{
    delete: []
    save: []
    'error-click': []
  }>()

  const attrs = useAttrs()
</script>

<style scoped src="./GraphNodeFrame.styles.css"></style>
