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
  ConstraintDockNode.vue — 约束坞节点组件

  Schema 右侧的紧凑坞（纯 UI 派生节点，数据由 dockSync 同步器维护）：
  - 标题栏：坞名 + 约束总数 + 错误总计徽标 + L2 展开全部/收回钮 +
    L1 展开/收起钮（expanded / expandedAll 均不持久化）
  - 行列表：按 Schema 列序分组（列名 + 徽标组），纵向与 Schema 列行 DOM 实测对齐，
    滚出可见区的行 clamp 到坞内可见带上下缘
  - 徽标：约束类型图标（复用 ConstraintNodeLibrary 的 icon 映射）+ 状态色点
    （pass 绿 / error 红 / missing 橙 / idle 灰，语义同 ConstraintNodeLayout 色板）+ 错误计数
  - 校验状态组件内 computed 直读约束节点 data（不入坞 data，零写回风暴）
  - L1 交互：点击徽标 → 取消该约束 hidden 浮出 + setSelection + focus-canvas-nodes；
    L2 展开态下卡片已可见，退化为纯聚焦（不重复 un-hide 也不回藏）；
    内嵌行点击 → 聚焦宿主 Schema；再点/选中离开 → 恢复聚合态
  - L2 交互：展开全部 → 坞聚合的全部独立卡片 un-hide 并栅格落在坞右侧
    （dockSync.expandDockAll）；收回 → 重新聚合隐藏（跳过选中卡片）
  - 展示边：根节点左侧隐藏 target handle（target-dock），承接 dockSync 创建的
    schema-to-dock-display 展示边（虚线弱视觉，见 dockSync.ts）；handle 不可见、
    不响应指针，用户无法手工连到坞
-->
<template>
  <div class="constraint-dock-node graph-node" :style="dockStyle">
    <Handle id="target-dock" type="target" :position="Position.Left" class="dock-target-handle" />
    <div class="dock-header">
      <span class="dock-title">{{ t('customNodes.constraintDockNode.title') }}</span>
      <span class="dock-schema-name" :title="data.configName">{{ data.configName }}</span>
      <span class="dock-count">{{ data.rows.length }}</span>
      <span
        v-if="errorTotal > 0"
        class="dock-error-total"
        :title="t('customNodes.constraintDockNode.errorCount', { count: errorTotal })"
      >
        {{ errorTotal }}
      </span>
      <button
        class="dock-expand-all"
        type="button"
        :title="
          data.expandedAll
            ? t('customNodes.constraintDockNode.collapseAll')
            : t('customNodes.constraintDockNode.expandAll')
        "
        @click.stop="toggleExpandAll"
      >
        {{
          data.expandedAll
            ? t('customNodes.constraintDockNode.collapseAll')
            : t('customNodes.constraintDockNode.expandAll')
        }}
      </button>
      <button
        class="dock-toggle"
        type="button"
        :title="
          data.expanded
            ? t('customNodes.constraintDockNode.collapse')
            : t('customNodes.constraintDockNode.expand')
        "
        @click.stop="toggleExpanded"
      >
        {{ data.expanded ? '▲' : '▼' }}
      </button>
    </div>

    <div class="dock-rows">
      <div v-if="groups.length === 0" class="dock-empty">
        {{ t('customNodes.constraintDockNode.empty') }}
      </div>

      <div
        v-for="(group, index) in groups"
        :key="group.key"
        class="dock-row"
        :class="{ 'is-table-level': !group.columnId }"
        :style="{ top: `${groupTops[index]}px` }"
      >
        <span class="dock-col-name" :title="group.columnName">{{ group.columnName }}</span>
        <span class="dock-badges">
          <template v-if="!data.expanded">
            <button
              v-for="row in group.rows"
              :key="row.constraintId"
              type="button"
              class="dock-badge"
              :class="[`is-${statusOf(row).status}`, { 'is-embedded': row.embedded }]"
              :title="badgeTitle(row)"
              @click.stop="handleRowClick(row)"
            >
              <AppIcon :name="iconOf(row)" :size="12" :stroke-width="2.2" />
              <span v-if="statusOf(row).errorCount > 0" class="dock-badge-count">
                {{ statusOf(row).errorCount }}
              </span>
            </button>
          </template>
        </span>
        <template v-if="data.expanded">
          <div
            v-for="row in group.rows"
            :key="row.constraintId"
            class="dock-detail"
            :class="[`is-${statusOf(row).status}`, { 'is-embedded': row.embedded }]"
            role="button"
            tabindex="0"
            @click.stop="handleRowClick(row)"
            @keydown.enter="!$event.isComposing && handleRowClick(row)"
          >
            <AppIcon :name="iconOf(row)" :size="12" :stroke-width="2.2" />
            <span class="dock-detail-label" :title="badgeTitle(row)">{{ displayLabel(row) }}</span>
            <span class="dock-detail-dot" :class="`dot-${statusOf(row).status}`" />
            <span v-if="statusOf(row).errorCount > 0" class="dock-badge-count">
              {{ statusOf(row).errorCount }}
            </span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Handle, Position } from '@vue-flow/core'
  import type { ConstraintDockNodeData, ConstraintDockRow } from '@/types/graph'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { CONSTRAINT_ICON_NAMES } from '@/components/icons/iconRegistry'
  import { eventBus } from '@/core/eventBus'
  import { findNode, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
  import { useGraphStore } from '@/stores/graphStore'

  const { t } = useI18n()
  const graphStore = useGraphStore()

  interface Props {
    /** 节点 id（constraint-dock-{schemaNodeId}） */
    id: string
    data: ConstraintDockNodeData
    selected?: boolean
  }

  const props = defineProps<Props>()

  // ============================================================================
  // 分组与状态（校验状态直读约束节点，不写入坞 data）
  // ============================================================================

  interface RowGroup {
    key: string
    columnId?: string
    columnName: string
    rows: ConstraintDockRow[]
  }

  /** 行按 columnId 分组（保持 rows 既有列序；无 columnId 的表级约束沉底为一组） */
  const groups = computed<RowGroup[]>(() => {
    const result: RowGroup[] = []
    let tableLevel: RowGroup | null = null
    const columnNameById = new Map<string, string>()
    const schema = graphStore.nodes.find((n) => n.id === props.data.schemaNodeId)
    if (schema && (schema.type === 'schema' || schema.type === 'jsonSchema')) {
      const columns = (schema.data as { columns?: Array<{ id: string; columnName: string }> })
        .columns
      for (const column of columns || []) {
        columnNameById.set(column.id, column.columnName)
      }
    }
    for (const row of props.data.rows) {
      if (!row.columnId) {
        if (!tableLevel) {
          tableLevel = {
            key: '__table-level__',
            columnName: t('customNodes.constraintDockNode.tableLevel'),
            rows: [],
          }
          result.push(tableLevel)
        }
        tableLevel.rows.push(row)
        continue
      }
      let group = result.find((g) => g.columnId === row.columnId)
      if (!group) {
        group = {
          key: row.columnId,
          columnId: row.columnId,
          columnName: columnNameById.get(row.columnId) || row.columnId,
          rows: [],
        }
        result.push(group)
      }
      group.rows.push(row)
    }
    return result
  })

  interface RowStatusInfo {
    status: 'idle' | 'pass' | 'error' | 'missing'
    errorCount: number
  }

  const statusByConstraintId = computed(() => {
    const map = new Map<string, RowStatusInfo>()
    for (const row of props.data.rows) {
      if (row.embedded) {
        // 内嵌约束无画布节点：idle 兜底，UI 以描边样式区分
        map.set(row.constraintId, { status: 'idle', errorCount: 0 })
        continue
      }
      const node = graphStore.nodes.find((n) => n.id === row.constraintId)
      const d = (node?.data ?? {}) as {
        validationStatus?: RowStatusInfo['status']
        lastValidation?: { errorCount?: number }
      }
      map.set(row.constraintId, {
        status: d.validationStatus ?? 'idle',
        errorCount: d.lastValidation?.errorCount ?? 0,
      })
    }
    return map
  })

  function statusOf(row: ConstraintDockRow): RowStatusInfo {
    return statusByConstraintId.value.get(row.constraintId) ?? { status: 'idle', errorCount: 0 }
  }

  const errorTotal = computed(() =>
    props.data.rows.reduce((sum, row) => sum + statusOf(row).errorCount, 0)
  )

  function iconOf(row: ConstraintDockRow): string {
    return CONSTRAINT_ICON_NAMES[row.kind as keyof typeof CONSTRAINT_ICON_NAMES] ?? 'clipboard'
  }

  /** 内嵌行显示类型名（i18n），独立行显示约束名 */
  function displayLabel(row: ConstraintDockRow): string {
    if (row.embedded) {
      return t(`constraintTypes.${row.kind}.name`)
    }
    return row.label || t(`constraintTypes.${row.kind}.name`)
  }

  function badgeTitle(row: ConstraintDockRow): string {
    const status = statusOf(row)
    const statusText = t(`customNodes.constraintDockNode.status.${status.status}`)
    const suffix = row.embedded ? ` · ${t('customNodes.constraintDockNode.embeddedHint')}` : ''
    return `${displayLabel(row)} · ${statusText}${suffix}`
  }

  // ============================================================================
  // L1 交互：徽标点击揭示 / 再点恢复；选中离开恢复聚合态
  // ============================================================================

  /** 本坞 L1 揭示（un-hide）过的约束卡片，选中离开时恢复隐藏 */
  const revealedIds = new Set<string>()

  /**
   * 同步标记 Vue Flow 内部选中集（双选择模型一致性，同 selection.selectAllNodes 模式）：
   * setSelection 只写 Store 侧，VF 侧不标记则节点无高亮且下一次 VF→Store 同步可能覆写。
   */
  function markVueFlowSelected(nodeId: string, selected: boolean) {
    try {
      const vfNode = findNode(nodeId)
      if (vfNode && vfNode.selected !== selected) {
        vfNode.selected = selected
      }
    } catch (error) {
      // 画布未挂载（vueFlowApi 未初始化）时跳过 VF 侧同步，仅保留 Store 选中
      if (!(error instanceof VueFlowApiNotInitializedError)) {
        throw error
      }
    }
  }

  function handleRowClick(row: ConstraintDockRow) {
    if (row.embedded) {
      // 内嵌行点击 → 聚焦宿主 Schema（Inspector 打开列约束页签）
      graphStore.setSelection([props.data.schemaNodeId])
      markVueFlowSelected(props.data.schemaNodeId, true)
      eventBus.emit('focus-canvas-nodes', { nodeIds: [props.data.schemaNodeId] })
      return
    }
    const target = graphStore.nodes.find((n) => n.id === row.constraintId)
    if (!target) return
    if (target.hidden === true) {
      graphStore.updateNodeData(row.constraintId, { hidden: false })
      revealedIds.add(row.constraintId)
      graphStore.setSelection([row.constraintId])
      markVueFlowSelected(row.constraintId, true)
      eventBus.emit('focus-canvas-nodes', { nodeIds: [row.constraintId] })
    } else if (props.data.expandedAll) {
      // L2 展开态：卡片已可见，单卡揭示退化为纯聚焦（不重复 un-hide、不回藏）
      graphStore.setSelection([row.constraintId])
      markVueFlowSelected(row.constraintId, true)
      eventBus.emit('focus-canvas-nodes', { nodeIds: [row.constraintId] })
    } else {
      // 再点同一徽标 → 恢复聚合态
      graphStore.updateNodeData(row.constraintId, { hidden: true })
      revealedIds.delete(row.constraintId)
      markVueFlowSelected(row.constraintId, false)
      graphStore.clearSelection()
    }
  }

  const selectionKey = computed(
    () => `${graphStore.selectedNodeId ?? ''}|${graphStore.selectedNodeIds.join(',')}`
  )

  watch(selectionKey, () => {
    if (revealedIds.size === 0) return
    const related = new Set<string>([props.data.schemaNodeId])
    for (const row of props.data.rows) {
      if (!row.embedded) related.add(row.constraintId)
    }
    const stillRelated =
      (graphStore.selectedNodeId !== null && related.has(graphStore.selectedNodeId)) ||
      graphStore.selectedNodeIds.some((id) => related.has(id))
    if (stillRelated) return
    for (const id of revealedIds) {
      graphStore.updateNodeData(id, { hidden: true })
    }
    revealedIds.clear()
  })

  function toggleExpanded() {
    graphStore.updateNodeData(props.id, { expanded: !props.data.expanded })
  }

  /** L2 全部展开/收回（布局与聚合隐藏语义由 dockSync 模块统一实现） */
  function toggleExpandAll() {
    // L1 已揭示的卡片记录一并清空：收回后聚合态以 expandedAll 为准
    revealedIds.clear()
    if (props.data.expandedAll) {
      graphStore.collapseDockAll(props.id)
    } else {
      graphStore.expandDockAll(props.id)
    }
  }

  // ============================================================================
  // 行 y 对齐：Schema 列行 DOM 实测 + 可见带 clamp
  // ============================================================================

  const HEADER_BAND_PX = 34
  const FALLBACK_GROUP_H_PX = 26
  const ROW_PAD_PX = 4
  /** 紧凑态每行估容徽标数（200px 宽 − 列名区），超出换行抬升行高 */
  const BADGES_PER_ROW = 4
  /** 相邻行最小间距（防重叠） */
  const ROW_GAP_PX = 4

  interface SchemaMeasure {
    /** columnId → 行顶相对 Schema 元素顶部的偏移（已扣除滚动） */
    offsets: Record<string, number>
    /** Schema 元素高度（坞高度对齐用） */
    height: number
    /** 首个列行顶部（可见带上缘基准） */
    bandTop: number
    /** 可见带下缘（滚动容器可视高度；无滚动信息时 Infinity） */
    bandBottom: number
  }

  const schemaMeasure = ref<SchemaMeasure | null>(null)

  let observedSchemaEl: HTMLElement | null = null
  let observedScrollEl: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let scrollFrame: number | null = null

  function detachObservers() {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (observedScrollEl) {
      observedScrollEl.removeEventListener('scroll', handleSchemaScroll)
      observedScrollEl = null
    }
    observedSchemaEl = null
  }

  function handleSchemaScroll() {
    if (scrollFrame !== null) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null
      measureSchema()
    })
  }

  function measureSchema() {
    const schemaNodeId = props.data.schemaNodeId
    const columnIds = new Set(props.data.rows.map((r) => r.columnId).filter(Boolean) as string[])
    const schemaEl =
      document.querySelector<HTMLElement>(`.vue-flow__node[data-id="${schemaNodeId}"]`) ||
      document.querySelector<HTMLElement>(`[data-id="${schemaNodeId}"]`)
    if (!schemaEl) {
      schemaMeasure.value = null
      detachObservers()
      return
    }

    const scrollEl = schemaEl.querySelector<HTMLElement>('.columns-section-scroll')
    const scrollTop = scrollEl?.scrollTop ?? 0
    const viewHeight = scrollEl?.clientHeight ?? 0

    const offsets: Record<string, number> = {}
    let bandTop = Number.POSITIVE_INFINITY
    for (const columnId of columnIds) {
      const row = schemaEl.querySelector<HTMLElement>(`.column-row[data-column-id="${columnId}"]`)
      if (!row) continue
      offsets[columnId] = row.offsetTop - scrollTop
      bandTop = Math.min(bandTop, offsets[columnId])
    }
    const resolvedBandTop = Number.isFinite(bandTop) ? bandTop : HEADER_BAND_PX
    schemaMeasure.value = {
      offsets,
      height: schemaEl.offsetHeight,
      bandTop: resolvedBandTop,
      bandBottom: viewHeight > 0 ? resolvedBandTop + viewHeight : Number.POSITIVE_INFINITY,
    }

    // 观察宿主：尺寸变化 / 列区滚动 → 重算（实例切换时重复挂载幂等）
    if (observedSchemaEl !== schemaEl) {
      detachObservers()
      observedSchemaEl = schemaEl
      resizeObserver = new ResizeObserver(() => measureSchema())
      resizeObserver.observe(schemaEl)
    }
    if (scrollEl && observedScrollEl !== scrollEl) {
      observedScrollEl?.removeEventListener('scroll', handleSchemaScroll)
      observedScrollEl = scrollEl
      scrollEl.addEventListener('scroll', handleSchemaScroll, { passive: true })
    }
  }

  const dockStyle = computed(() => {
    const height = schemaMeasure.value?.height
    return height && height > 0 ? { height: `${height}px` } : undefined
  })

  /** 估算单行高度：徽标换行（每组超过 BADGES_PER_ROW 个）时按行数抬升 */
  function groupRowHeight(group: RowGroup): number {
    const lines = Math.max(1, Math.ceil(group.rows.length / BADGES_PER_ROW))
    return Math.max(22, lines * 20 + 4)
  }

  /**
   * 各组行纵向落点（单调不重叠）：
   * 实测列行偏移优先 → clamp 到坞内可见带 → 与上一行底部保持最小间距。
   * 徽标组换行会让行高超过 Schema 列行高，直接对齐会行行重叠
   * （上层行覆盖下层行的点击），故以"对齐意图 + 单调堆叠"折中。
   */
  const groupTops = computed(() => {
    const measure = schemaMeasure.value
    const gs = groups.value
    const tops: number[] = []
    let lastBottom = HEADER_BAND_PX
    for (let i = 0; i < gs.length; i++) {
      const group = gs[i]!
      const measured = group.columnId ? measure?.offsets[group.columnId] : undefined
      let top =
        typeof measured === 'number'
          ? measured
          : HEADER_BAND_PX + ROW_PAD_PX + i * FALLBACK_GROUP_H_PX
      const bandTop = Math.max(measure?.bandTop ?? HEADER_BAND_PX, HEADER_BAND_PX)
      if (top < bandTop) top = bandTop
      if (measure && Number.isFinite(measure.bandBottom)) {
        const max = measure.bandBottom - FALLBACK_GROUP_H_PX
        if (max > bandTop && top > max) top = max
      }
      const rowH = groupRowHeight(group)
      if (top < lastBottom + ROW_GAP_PX) top = lastBottom + ROW_GAP_PX
      tops.push(Math.round(top))
      lastBottom = top + rowH
    }
    return tops
  })

  onMounted(() => {
    void nextTick(measureSchema)
  })

  watch(
    () => props.data.rows,
    () => {
      void nextTick(measureSchema)
    },
    { deep: false }
  )

  onUnmounted(() => {
    detachObservers()
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
    revealedIds.clear()
  })
</script>

<style scoped src="./ConstraintDockNode.styles.css"></style>
