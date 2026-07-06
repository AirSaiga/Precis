<!--
  @file ConstraintNodeFrame.vue
  @description 约束节点通用框架组件

  为各类约束节点提供统一的 UI 外壳，包含标题、图标、操作按钮和连接手柄等通用元素。
-->
<template>
  <NodeShell
    v-bind="attrs"
    class="constraint-node-frame"
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
        :icon-name="iconName"
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

  interface ConstraintHandleConfig {
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
    iconName?: string
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
    handles?: ConstraintHandleConfig[]
  }

  withDefaults(defineProps<Props>(), {
    selected: false,
    state: 'idle',
    subtitle: '',
    iconName: '',
    icon: '',
    helpText: '',
    shellTitle: '',
    errorCount: 0,
    showDelete: true,
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

<style scoped src="./ConstraintNodeFrame.styles.css"></style>
