<!--
  @file InspectorPanel.vue
  @description 属性检查器面板容器组件

  这是一个容器组件，负责根据当前选中的节点类型动态加载对应的属性面板组件。
  它不包含具体的属性编辑逻辑，而是将属性编辑委托给专门的 Inspector 组件。

  功能概述：
  - 接收来自 GraphStore 的当前选中节点
  - 根据节点类型动态加载对应的属性面板
  - 接收属性更新事件并同步到 GraphStore
  - 支持面板折叠/展开
-->
<template>
  <!-- 主面板容器，支持折叠状态 -->
  <div class="panel" :class="{ collapsed: collapsed }">
    <!-- 面板头部 -->
    <div class="panel-header">
      <h3>
        <!-- 根据折叠状态显示完整标题或缩写 -->
        <span v-if="!collapsed">{{ t('inspector.title') }}</span>
        <span v-else class="collapsed-text">{{ t('inspector.collapsedTitle') }}</span>
      </h3>
    </div>

    <!-- 面板内容区域 -->
    <div v-if="!collapsed" class="panel-content">
      <!-- 如果有选中节点，显示对应的属性面板 -->
      <div v-if="node" :key="node.id" class="node-content">
        <BaseInspector
          v-if="inspectorConfig"
          :config="inspectorConfig"
          :data="node.data as unknown as Record<string, unknown>"
          :node-type="node.type ?? ''"
          :node-id="node.id"
          @update:data="handleDataUpdate"
        />
        <component
          v-else
          :is="currentInspectorComponent"
          :data="node.data as unknown as Record<string, unknown>"
          :node-type="node.type"
          :node-id="node.id"
          @update:data="handleDataUpdate"
          @open:subCanvas="openSubCanvas"
        />
      </div>

      <!-- 如果没有选中节点，显示占位提示 -->
      <div v-else class="placeholder">
        <div class="placeholder-content">
          <div class="placeholder-icon">⬜</div>
          <div class="placeholder-text">{{ t('inspector.placeholder') }}</div>
        </div>
      </div>
    </div>

    <!-- 复合约束子画布弹窗 -->
    <SubCanvasModal
      v-if="node?.type === 'compositeConstraint'"
      :visible="showSubCanvas"
      :title="(node.data as any)?.configName || 'Composite Constraint'"
      :initial-nodes="(node.data as any)?.subGraph?.nodes || []"
      :initial-edges="(node.data as any)?.subGraph?.edges || []"
      @save="saveSubCanvas"
      @close="closeSubCanvas"
    />
  </div>
</template>

<script setup lang="ts">
  import { computed, defineAsyncComponent, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import type { CustomNodeData } from '@/types/nodes'
  import BaseInspector from './inspectors/configDriven/BaseInspector.vue'
  import { getInspectorConfig } from './inspectors/configDriven/configLoader'
  import SubCanvasModal from '@/components/canvas/SubCanvasModal.vue'

  const { t } = useI18n()

  /**
   * 获取 GraphStore 实例
   * GraphStore 包含当前选中的节点信息
   */
  const store = useGraphStore()

  const showSubCanvas = ref(false)
  const subCanvasNodeId = ref<string | null>(null)

  function openSubCanvas(nodeId: string) {
    subCanvasNodeId.value = nodeId
    showSubCanvas.value = true
  }

  function closeSubCanvas() {
    showSubCanvas.value = false
    subCanvasNodeId.value = null
  }

  function saveSubCanvas(state: { nodes: any[]; edges: any[] }) {
    if (subCanvasNodeId.value) {
      store.updateNodeData(subCanvasNodeId.value, { subGraph: state })
    }
  }

  /**
   * 组件属性定义
   * @param collapsed - 控制面板是否折叠
   */
  const props = defineProps<{
    collapsed?: boolean
  }>()

  /**
   * 计算属性：获取当前选中的节点
   * 从 GraphStore 中获取 selectedNode
   */
  const node = computed(() => store.selectedNode)

  const inspectorConfig = computed(() => getInspectorConfig(node.value?.type))

  /**
   * 计算属性：获取当前应该显示的 Inspector 组件
   * 根据节点类型动态加载对应的属性面板组件（JSON 驱动检查器优先，此处为旧版回退）
   *
   * 尚未迁移到 JSON 驱动的节点类型：
   * - schema: Schema 节点
   * - pattern / patternToolbox: 模式节点
   * - compositeConstraint: 复合约束
   * - manualData: 手动数据
   * - templateInstance: 模板实例
   */
  const currentInspectorComponent = computed(() => {
    // 如果没有选中节点，返回 null
    if (!node.value) return null

    // 根据节点类型返回对应的 Inspector 组件
    switch (node.value.type) {
      case 'schema':
        return defineAsyncComponent(() => import('./inspectors/SchemaNodeInspector.vue'))
      case 'pattern':
        return defineAsyncComponent(() => import('./inspectors/PatternNodeInspector.vue'))
      case 'patternToolbox':
        return defineAsyncComponent(() => import('./inspectors/PatternToolboxNodeInspector.vue'))
      case 'compositeConstraint':
        return defineAsyncComponent(() => import('./inspectors/CompositeConstraintInspector.vue'))
      case 'manualData':
        return defineAsyncComponent(() => import('./inspectors/ManualDataNodeInspector.vue'))
      case 'templateInstance':
        return defineAsyncComponent(() => import('./inspectors/TemplateInstanceInspector.vue'))
      default:
        return defineAsyncComponent(() => import('./inspectors/FallbackInspector.vue'))
    }
  })

  /**
   * 处理属性数据更新事件
   * 当 Inspector 组件触发 update:data 事件时调用
   * 将更新后的数据同步到 GraphStore
   *
   * @param newData - 更新的属性数据
   */
  function handleDataUpdate(newData: Partial<CustomNodeData>) {
    // 如果没有选中节点，不执行任何操作
    if (!node.value) return
    // 调用 GraphStore 的 updateNodeData 方法更新节点数据
    store.updateNodeData(node.value.id, newData)
  }
</script>

<script lang="ts">
  export default {
    inheritAttrs: false,
  }
</script>

<style scoped src="./InspectorPanel.styles.css"></style>
