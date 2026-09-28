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
<!--
  @file ConstraintNodeFrame.vue
  @description 约束节点通用框架组件（密度两态）

  为全部 10 种约束节点提供统一 UI 外壳：标题、图标、操作按钮、连接手柄，
  以及紧凑条密度档（240×36 一行式）。

  密度两态（数据在 BaseConstraintNodeData.density / densityPinned，由
  constraintDensity 管理器按"每 Schema 家族约束数 > 阈值"写入）：
  - 全卡（density ≠ 'compact'）：现状渲染——NodeShell + 类型组件插槽，零变化
  - 紧凑条（density === 'compact' 且未选中）：240×36 一行——类型图标 + 类型名 +
    列名 + 状态点 + 错误计数；handles 保留为真实边锚点（左缘均布/居中，
    Conditional 的 if/then 双 handle 左缘纵向排列）
  - 原地展开：点击紧凑条 → 节点选中（Vue Flow elevateNodesOnSelect 自动
    上浮 z-index，不推挤邻居）→ 渲染全卡；失焦（取消选中）自动收回紧凑条
  - 钉住：双击紧凑条 或 全卡右上角"钉住展开"按钮 → density: 'full' +
    densityPinned: true（密度管理器不再覆写）；"取消钉住"回到家族默认

  密度/选中/列名经 useNodeId + graphStore 自取（类型组件零改动）；
  density 切换后 nextTick 调 updateNodeInternals 刷新 handleBounds
  （边随紧凑/全卡尺寸变化重路由）。
-->
<template>
  <NodeShell
    v-if="!isCompactBar"
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
    @dblclick.stop="pinExpanded"
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

    <button
      v-if="showPinToggle"
      class="constraint-frame-pin-btn"
      type="button"
      :title="
        isPinned
          ? t('customNodes.constraintDensity.unpin')
          : t('customNodes.constraintDensity.pinExpand')
      "
      @mousedown.stop
      @click.stop="togglePin"
    >
      {{
        isPinned
          ? t('customNodes.constraintDensity.unpin')
          : t('customNodes.constraintDensity.pinExpand')
      }}
    </button>
  </NodeShell>

  <!-- 紧凑条：240×36 一行（密度档默认渲染；点击选中 → 上方全卡分支接管） -->
  <div
    v-else
    class="constraint-compact-bar"
    :class="[`state-${state}`, { 'is-selected': selected, 'is-pinned': isPinned }]"
    :data-density-node-id="nodeId || undefined"
    :title="compactTooltip"
    @dblclick.stop="pinExpanded"
  >
    <NodeHandle
      v-for="handle in compactHandles"
      :id="handle.id"
      :key="handle.id"
      :type="handle.type"
      :position="handle.position"
      :title="handle.title"
      :color="handle.color"
      :top-offset="handle.topOffset"
    />
    <AppIcon v-if="iconName" :name="iconName" :size="14" :stroke-width="2" class="compact-icon" />
    <span class="compact-title">{{ title }}</span>
    <span v-if="compactColumnName" class="compact-column">{{ compactColumnName }}</span>
    <span class="compact-dot" :class="`dot-${state}`" />
    <span v-if="errorCount > 0" class="compact-count">{{ errorCount }}</span>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, useAttrs, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position, useNodeId } from '@vue-flow/core'
  import NodeDivider from '@/components/ui/NodeDivider.vue'
  import NodeHandle from '@/components/ui/NodeHandle.vue'
  import NodeHeader from '@/components/ui/NodeHeader.vue'
  import NodeShell from '@/components/ui/NodeShell.vue'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { NodeHandleSize, NodeState, NodeTheme } from '@/components/ui/nodeVariants'
  import { updateNodeInternals, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
  import { useGraphStore } from '@/stores/graphStore'

  defineOptions({
    inheritAttrs: false,
  })

  interface ConstraintHandleConfig {
    id: string
    type: 'target' | 'source'
    position:
      typeof Position.Left | typeof Position.Right | typeof Position.Top | typeof Position.Bottom
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

  const props = withDefaults(defineProps<Props>(), {
    selected: false,
    state: 'idle',
    subtitle: '',
    iconName: '',
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
  const { t } = useI18n()

  // ============================================================================
  // 密度状态（自取：useNodeId 注入 + graphStore；类型组件零改动）
  // ============================================================================

  const graphStore = useGraphStore()
  const nodeId = useNodeId()

  const ownNode = computed(() =>
    nodeId ? graphStore.nodes.find((n) => n.id === nodeId) : undefined
  )
  const density = computed(() => {
    const data = (ownNode.value?.data ?? {}) as { density?: 'compact' | 'full' }
    return data.density
  })
  const isPinned = computed(() => {
    const data = (ownNode.value?.data ?? {}) as { densityPinned?: boolean }
    return data.densityPinned === true
  })
  /** 选中态从 store 双选择模型取（紧凑条点击 → 选中 → 临时展开全卡） */
  const isSelectedInStore = computed(
    () =>
      !!nodeId &&
      (graphStore.selectedNodeId === nodeId || graphStore.selectedNodeIds.includes(nodeId))
  )

  /** 紧凑条渲染条件：密度 compact 且未选中（选中 = 临时展开为全卡） */
  const isCompactBar = computed(() => density.value === 'compact' && !isSelectedInStore.value)

  /**
   * 钉住按钮可见性：仅在"密度被管理为紧凑"的节点上提供——
   * 自然全卡（家族 ≤ 阈值且未钉住）不需要钉住语义。
   * 展开态（含临时展开）显示在 NodeShell 右上角。
   */
  const showPinToggle = computed(() => density.value !== undefined || isPinned.value)

  /** 紧凑条的列名：sourceRef → 宿主 Schema 列 columnName */
  const compactColumnName = computed(() => {
    const data = (ownNode.value?.data ?? {}) as {
      sourceRef?: { nodeId?: string; columnId?: string }
    }
    const ref = data.sourceRef
    if (!ref?.nodeId || !ref.columnId) return ''
    const schema = graphStore.nodes.find((n) => n.id === ref.nodeId)
    if (!schema || (schema.type !== 'schema' && schema.type !== 'jsonSchema')) return ''
    const columns = (schema.data as { columns?: Array<{ id: string; columnName: string }> }).columns
    return columns?.find((c) => c.id === ref.columnId)?.columnName || ref.columnId
  })

  const compactTooltip = computed(() => {
    const parts = [props.title, compactColumnName.value].filter(Boolean)
    const hint = t('customNodes.constraintDensity.doubleClickHint')
    return `${parts.join(' · ')}（${hint}）`
  })

  /**
   * 紧凑条 handles：全部保留为真实边锚点（边不因密度切换断开）。
   * 左缘 target handles 纵向均布（单 handle 居中 50%；Conditional 的
   * if/then 双 handle 约 30%/70%），右缘 source handle 居中。
   */
  const compactHandles = computed<ConstraintHandleConfig[]>(() => {
    const lefts = props.handles.filter((h) => h.position === Position.Left)
    let leftIndex = 0
    return props.handles.map((h) => {
      if (h.position === Position.Left) {
        const topOffset =
          lefts.length > 1 ? `${Math.round(((leftIndex + 1) / (lefts.length + 1)) * 100)}%` : '50%'
        leftIndex++
        return { ...h, topOffset, sideOffset: undefined }
      }
      return { ...h, topOffset: '50%', sideOffset: undefined }
    })
  })

  // ============================================================================
  // 钉住交互
  // ============================================================================

  function pinExpanded(): void {
    if (!nodeId) return
    // 自然全卡（density 未被管理为紧凑）无钉住语义——双击不产生数据写入
    if (density.value !== 'compact' && !isPinned.value) return
    graphStore.updateNodeData(nodeId, { density: 'full', densityPinned: true })
  }

  function togglePin(): void {
    if (!nodeId) return
    if (isPinned.value) {
      // 取消钉住：清密度与钉住标记，交还家族阈值默认
      graphStore.updateNodeData(nodeId, { density: undefined, densityPinned: undefined })
    } else {
      pinExpanded()
    }
  }

  // 密度切换 / 紧凑条临时展开（选中）改变节点尺寸 → nextTick 后刷新
  // handleBounds（边随尺寸变化重路由）
  watch([density, isSelectedInStore], () => {
    void nextTick(() => {
      if (!nodeId) return
      try {
        updateNodeInternals([nodeId])
      } catch (error) {
        // 画布未挂载（IDE↔Agent 切换窗口期）时跳过，重新挂载后密度 watcher 会再触发
        if (!(error instanceof VueFlowApiNotInitializedError)) {
          throw error
        }
      }
    })
  })
</script>

<style scoped src="./ConstraintNodeFrame.styles.css"></style>
