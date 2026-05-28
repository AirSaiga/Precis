<template>
  <div class="lineage-panel">
    <!-- 顶部工具栏 -->
    <div class="lineage-toolbar">
      <input
        v-model="searchQuery"
        class="search-input"
        :placeholder="t('lineage.search', '搜索节点...')"
        type="text"
      />
      <div class="filter-chips">
        <button
          v-for="ft in filterTypes"
          :key="ft.type"
          class="filter-chip"
          :class="{ active: activeFilters.has(ft.type) }"
          @click="toggleFilter(ft.type)"
        >
          {{ ft.label }}
        </button>
      </div>
    </div>

    <!-- 主体：图形视图 -->
    <div class="lineage-canvas" ref="canvasRef">
      <svg
        v-if="layout.nodes.length > 0"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        class="lineage-svg"
      >
        <!-- 连线 -->
        <g v-for="(edge, i) in layout.edges" :key="'e' + i">
          <line
            :x1="getNodeCenter(edge.from).x"
            :y1="getNodeCenter(edge.from).y"
            :x2="getNodeCenter(edge.to).x"
            :y2="getNodeCenter(edge.to).y"
            :stroke="getEdgeColor(edge.kind)"
            :stroke-width="isEdgeHighlighted(edge) ? 2.5 : 1.5"
            :stroke-dasharray="edge.kind === 'fk' ? '4 2' : 'none'"
            :opacity="isEdgeHighlighted(edge) ? 1 : 0.4"
          />
          <polygon
            :points="getArrowPoints(edge)"
            :fill="getEdgeColor(edge.kind)"
            :opacity="isEdgeHighlighted(edge) ? 1 : 0.4"
          />
        </g>

        <!-- 节点 -->
        <g
          v-for="node in layout.nodes"
          :key="node.id"
          :transform="`translate(${node.x}, ${node.y})`"
          class="lineage-node"
          :class="{
            selected: selectedNode === node.id,
            dimmed: selectedNode && !isNodeHighlighted(node.id),
          }"
          @click="selectNode(node.id === selectedNode ? undefined : node.id)"
        >
          <rect
            x="0"
            y="0"
            :width="NODE_W"
            :height="NODE_H"
            rx="6"
            :fill="getNodeFill(node.type)"
            :stroke="selectedNode === node.id ? 'var(--ui-accent)' : getNodeStroke(node.type)"
            stroke-width="1.5"
          />
          <text
            :x="12"
            :y="NODE_H / 2 - 6"
            font-size="11"
            font-weight="600"
            :fill="getNodeTextColor(node.type)"
          >
            {{ getNodeIcon(node.type) }} {{ node.name }}
          </text>
          <text
            v-if="node.constraintType"
            :x="12"
            :y="NODE_H / 2 + 8"
            font-size="10"
            fill="var(--ui-text-tertiary)"
          >
            {{ node.constraintType }}
          </text>
          <!-- 状态指示 -->
          <circle
            v-if="node.status"
            :cx="NODE_W - 12"
            :cy="NODE_H / 2"
            r="4"
            :fill="getStatusColor(node.status)"
          />
        </g>
      </svg>

      <div v-else class="lineage-empty">
        {{ t('lineage.empty', '画布上暂无节点可展示血缘关系') }}
      </div>
    </div>

    <!-- 右侧详情面板 -->
    <div v-if="selectedNode" class="lineage-detail">
      <div class="detail-header">
        <span class="detail-title">{{ selectedNodeData?.name }}</span>
        <span class="detail-type">{{ selectedNodeData?.type }}</span>
      </div>

      <div v-if="upstreamNodes.length > 0" class="detail-section">
        <div class="detail-subtitle">
          {{ t('lineage.upstream', '上游依赖') }} ({{ upstreamNodes.length }})
        </div>
        <div class="dep-list">
          <div v-for="n in upstreamNodes" :key="n.id" class="dep-item" @click="selectNode(n.id)">
            <span class="dep-icon">{{ getNodeIcon(n.type) }}</span>
            <span class="dep-name">{{ n.name }}</span>
          </div>
        </div>
      </div>

      <div v-if="downstreamNodes.length > 0" class="detail-section">
        <div class="detail-subtitle">
          {{ t('lineage.downstream', '下游影响') }} ({{ downstreamNodes.length }})
        </div>
        <div class="dep-list">
          <div v-for="n in downstreamNodes" :key="n.id" class="dep-item" @click="selectNode(n.id)">
            <span class="dep-icon">{{ getNodeIcon(n.type) }}</span>
            <span class="dep-name">{{ n.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, type Ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { storeToRefs } from 'pinia'
  import { useGraphStore } from '@/stores/graphStore'
  import { useLineageGraph, getNodeType, getNodeLabel } from '@/composables/lineage/useLineageGraph'
  import type { LineageNodeType, LineageEdge, LineageEdgeKind, LineageLayoutNode } from '@/types/lineage'
  import type { CustomNode } from '@/types/graph'
  import type { Edge } from '@vue-flow/core'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const { nodes, edges } = storeToRefs(graphStore) as {
    nodes: Ref<CustomNode[]>
    edges: Ref<Edge[]>
  }

  const NODE_W = 160
  const NODE_H = 48

  const searchQuery = ref('')
  const activeFilters = ref(new Set<LineageNodeType>())
  const canvasRef = ref<HTMLElement | null>(null)

  const filterTypes = [
    { type: 'sourcePreview' as LineageNodeType, label: t('lineage.filterSource') },
    { type: 'schema' as LineageNodeType, label: t('lineage.filterSchema') },
    { type: 'constraint' as LineageNodeType, label: t('lineage.filterConstraint') },
    { type: 'regex' as LineageNodeType, label: t('lineage.filterRegex') },
    { type: 'transform' as LineageNodeType, label: t('lineage.filterTransform') },
  ]

  const toggleFilter = (type: LineageNodeType) => {
    const s = new Set(activeFilters.value)
    if (s.has(type)) s.delete(type)
    else s.add(type)
    activeFilters.value = s
  }

  const filteredNodes = computed(() => {
    let ns = nodes.value
    if (activeFilters.value.size > 0) {
      ns = ns.filter((n: CustomNode) => {
        const lt = getNodeType(n.type)
        return lt && activeFilters.value.has(lt)
      })
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      ns = ns.filter((n: CustomNode) => {
        const name = getNodeLabel(n.data)
        return name.toLowerCase().includes(q)
      })
    }
    return ns
  })

  const { lineageGraph, layoutGraph, selectedNode, selectNode, upstreamNodes, downstreamNodes } =
    useLineageGraph(filteredNodes, edges)

  const layout = computed(() => layoutGraph('horizontal'))

  const selectedNodeData = computed(() =>
    lineageGraph.value.nodes.find((n) => n.id === selectedNode.value)
  )

  const getNodeCenter = (nodeId: string) => {
    const node = layout.value.nodes.find((n) => n.id === nodeId)
    if (!node) return { x: 0, y: 0 }
    return { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 }
  }

  const isNodeHighlighted = (nodeId: string) => {
    if (!selectedNode.value) return true
    if (nodeId === selectedNode.value) return true
    return (
      upstreamNodes.value.some((n) => n.id === nodeId) ||
      downstreamNodes.value.some((n) => n.id === nodeId)
    )
  }

  const isEdgeHighlighted = (edge: LineageEdge) => {
    if (!selectedNode.value) return true
    return edge.from === selectedNode.value || edge.to === selectedNode.value
  }

  const getEdgeColor = (kind: LineageEdgeKind) => {
    const colors: Record<string, string> = {
      data: '#94a3b8',
      constraint: '#f59e0b',
      regex: '#a855f7',
      fk: '#ef4444',
      transform: '#06b6d4',
    }
    return colors[kind] || '#94a3b8'
  }

  const getArrowPoints = (edge: LineageEdge) => {
    const from = getNodeCenter(edge.from)
    const to = getNodeCenter(edge.to)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const ux = dx / len
    const uy = dy / len
    const tipX = to.x - ux * (NODE_W / 2 + 4)
    const tipY = to.y - uy * (NODE_H / 2 + 4)
    const px = -uy * 4
    const py = ux * 4
    return `${tipX},${tipY} ${tipX - ux * 8 + px},${tipY - uy * 8 + py} ${tipX - ux * 8 - px},${tipY - uy * 8 - py}`
  }

  const getNodeFill = (type: LineageNodeType) => {
    const fills: Record<string, string> = {
      sourcePreview: '#dbeafe',
      schema: '#dcfce7',
      constraint: '#fef3c7',
      regex: '#f3e8ff',
      transform: '#cffafe',
      transformOutput: '#cffafe',
      manualData: '#fce7f3',
    }
    return fills[type] || '#f1f5f9'
  }

  const getNodeStroke = (type: LineageNodeType) => {
    const strokes: Record<string, string> = {
      sourcePreview: '#93c5fd',
      schema: '#86efac',
      constraint: '#fcd34d',
      regex: '#c084fc',
      transform: '#67e8f9',
      transformOutput: '#67e8f9',
      manualData: '#f9a8d4',
    }
    return strokes[type] || '#cbd5e1'
  }

  const getNodeTextColor = (type: LineageNodeType) => {
    return 'var(--ui-text-primary)'
  }

  const getNodeIcon = (type: LineageNodeType) => {
    const icons: Record<string, string> = {
      sourcePreview: '📊',
      schema: '📋',
      constraint: '🛡️',
      regex: '🔍',
      transform: '⚙️',
      transformOutput: '📤',
      manualData: '✏️',
    }
    return icons[type] || '📄'
  }

  const getStatusColor = (status: string) => {
    if (status === 'pass') return 'var(--ui-success, #22c55e)'
    if (status === 'error') return 'var(--ui-error, #ef4444)'
    return 'var(--ui-text-tertiary)'
  }
</script>

<style scoped>
.lineage-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ui-bg-base);
}

.lineage-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border);
  flex-shrink: 0;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  font-size: 12px;
  background: var(--ui-bg-base);
  color: var(--ui-text-primary);
  outline: none;
}

.search-input:focus {
  border-color: var(--ui-accent);
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.filter-chip {
  padding: 3px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  font-size: 11px;
  background: var(--ui-bg-base);
  color: var(--ui-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.filter-chip.active {
  background: var(--ui-accent);
  color: white;
  border-color: var(--ui-accent);
}

.lineage-canvas {
  flex: 1;
  overflow: auto;
  padding: 12px;
}

.lineage-svg {
  width: 100%;
  min-height: 300px;
}

.lineage-node {
  cursor: pointer;
  transition: opacity 0.2s;
}

.lineage-node.dimmed {
  opacity: 0.3;
}

.lineage-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 13px;
  color: var(--ui-text-tertiary);
}

/* Detail panel */
.lineage-detail {
  border-top: 1px solid var(--ui-border);
  padding: 10px 12px;
  max-height: 200px;
  overflow-y: auto;
  flex-shrink: 0;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.detail-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text-primary);
}

.detail-type {
  font-size: 11px;
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-elevated);
  padding: 1px 6px;
  border-radius: 4px;
}

.detail-section {
  margin-bottom: 8px;
}

.detail-subtitle {
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-text-secondary);
  margin-bottom: 4px;
}

.dep-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dep-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}

.dep-item:hover {
  background: var(--ui-bg-hover);
}

.dep-icon {
  font-size: 12px;
}

.dep-name {
  color: var(--ui-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
