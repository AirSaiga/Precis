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
  @file SchemaConstraintOverview.vue
  @description Schema 约束概览弹层（三层表达方案①索引层）

  约束坞退役后，把"按列一览"价值以 Schema 头部弹层重建：
  - 头部：标题（约束概览 · 表名）+ 总数 + ✓/✗/◌ 状态聚合
  - 主体：按列分组的 chips（列序 = Schema 列序，表级沉底）；
    chip = 类型图标（状态着色）+ 类型名 + 错误计数角标 + tooltip；
    内嵌约束（无卡片）虚线描边区分
  - 底部：全部展开 / 全部紧凑（对该家族卡片批量写 density，经 updateNodeData）

  交互契约：
  - 定位：Teleport 到 body 的 fixed 浮层，rAF 逐帧跟随锚定 Schema 节点
    （拖拽/平移/缩放期间保持锚定，不改变节点几何、不碰虚拟滚动）
  - 关闭：Esc / 点击弹层外部 / 再点头部按钮（互斥开关见 constraintOverviewStore）
  - chip 点击：standalone → setSelection + focus-canvas-nodes（紧凑卡片选中即临时展开）；
    embedded → 聚焦 Schema（当前降级行为：Inspector 列定位通道属另一条未合入线，
    待其合入后可经 errorColumnFocus 信箱 + expand-inspector-panel /
    inspector-focus-column 事件恢复列定位）
  - 弹层打开期间校验状态变化经 computed 直读实时反映（chips 变色）
-->
<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="popoverRef"
      class="schema-constraint-overview"
      data-constraint-overview-popover
      :data-schema-id="props.schemaNodeId"
      @click.stop
      @keydown.stop
      @keydown.esc="handleEscapeKeydown"
    >
      <div class="ov-header">
        <span class="ov-title">
          {{ t('customNodes.constraintOverview.title') }} · {{ tableName }}
        </span>
        <span
          class="ov-total"
          :title="t('customNodes.constraintOverview.totalCount', { count: totalCount })"
        >
          {{ totalCount }}
        </span>
        <span class="ov-counts">
          <span
            class="ov-count ov-count-pass"
            :title="t('customNodes.constraintOverview.statusPass')"
            >✓{{ statusCounts.pass }}</span
          >
          <span
            class="ov-count ov-count-error"
            :title="t('customNodes.constraintOverview.statusError')"
            >✗{{ statusCounts.error }}</span
          >
          <span
            class="ov-count ov-count-pending"
            :title="t('customNodes.constraintOverview.statusIdle')"
            >◌{{ statusCounts.pending }}</span
          >
        </span>
        <button
          type="button"
          class="ov-close-btn"
          :title="t('customNodes.constraintOverview.close')"
          @click="close"
        >
          <AppIcon name="x" :size="14" />
        </button>
      </div>

      <div class="ov-body">
        <section v-for="section in sections" :key="section.key" class="ov-section">
          <div class="ov-section-title">
            {{
              section.isTableLevel ? t('customNodes.constraintOverview.tableLevel') : section.title
            }}
          </div>
          <div class="ov-chips">
            <button
              v-for="chip in section.chips"
              :key="chip.constraintId"
              type="button"
              class="ov-chip"
              :class="[
                `ov-state-${chipStateClass(chip)}`,
                { 'is-embedded': chip.embedded, 'has-error': chip.errorCount > 0 },
              ]"
              :data-constraint-id="chip.constraintId"
              :title="chipTooltip(chip)"
              @click="handleChipClick(chip)"
            >
              <AppIcon
                v-if="chipIconName(chip)"
                :name="chipIconName(chip)"
                :size="12"
                class="ov-chip-icon"
              />
              <span class="ov-chip-name">{{ chipTypeName(chip) }}</span>
              <span v-if="chip.errorCount > 0" class="ov-chip-count">{{ chip.errorCount }}</span>
            </button>
          </div>
        </section>

        <div v-if="sections.length === 0" class="ov-empty">
          {{ t('customNodes.constraintOverview.empty') }}
        </div>
      </div>

      <div class="ov-footer">
        <button type="button" class="ov-action ov-action-expand" @click="expandAll">
          {{ t('customNodes.constraintOverview.expandAll') }}
        </button>
        <button type="button" class="ov-action ov-action-compact" @click="compactAll">
          {{ t('customNodes.constraintOverview.compactAll') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file SchemaConstraintOverview.vue
   * @description Schema 约束概览弹层组件（schema 与 jsonSchema 双类型节点共用）
   *
   * 挂载于每个 Schema/jsonSchema 节点组件内（Teleport 到 body 渲染），
   * 仅当 constraintOverviewStore.activeSchemaId === 本节点 id 时可见——
   * 多弹层互斥由 store 单一事实源保证。
   */
  import { computed, onUnmounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { eventBus } from '@/core/eventBus'
  import { useGraphStore } from '@/stores/graphStore'
  import { useConstraintOverviewStore } from '@/stores/constraintOverviewStore'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import { findNode, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
  import {
    DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX,
    deriveConstraintFamilies,
    type ConstraintRowEntry,
  } from '@/stores/graphStore/modules/constraintDensity'
  import { CONSTRAINT_ICON_NAMES } from '@/components/icons/iconRegistry'
  import {
    aggregateStatusCounts,
    flattenSchemaColumnsForOverview,
    groupConstraintRowsByColumn,
    type ConstraintOverviewChip,
  } from '@/services/constraints/constraintOverview'

  interface Props {
    /** 锚定的 Schema 节点 id（schema / jsonSchema 通用） */
    schemaNodeId: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    (e: 'close'): void
  }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const overviewStore = useConstraintOverviewStore()

  const isOpen = computed(() => overviewStore.activeSchemaId === props.schemaNodeId)

  // ============================================================================
  // 数据派生（computed 直读 store：校验状态变化 chips 实时变色）
  // ============================================================================

  const family = computed(
    () =>
      deriveConstraintFamilies(
        graphStore.nodes,
        graphStore.edges,
        DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX
      ).get(props.schemaNodeId) ?? null
  )

  const tableName = computed(() => family.value?.configName ?? props.schemaNodeId)
  const totalCount = computed(() => family.value?.rows.length ?? 0)

  const constraintNodeDataById = computed(() => {
    const map = new Map<
      string,
      { validationStatus?: string; lastValidation?: { errorCount?: number } }
    >()
    for (const node of graphStore.nodes) {
      map.set(
        node.id,
        (node.data ?? {}) as { validationStatus?: string; lastValidation?: { errorCount?: number } }
      )
    }
    return map
  })

  /** 行运行态：standalone 读约束节点 validationStatus/lastValidation；内嵌无运行态 */
  function resolveChipStatus(row: ConstraintRowEntry): {
    status: 'idle' | 'pass' | 'error' | 'missing' | null
    errorCount: number
  } {
    if (row.embedded) return { status: null, errorCount: 0 }
    const data = constraintNodeDataById.value.get(row.constraintId)
    const status = data?.validationStatus
    if (status === 'pass' || status === 'error' || status === 'missing' || status === 'idle') {
      return { status, errorCount: data?.lastValidation?.errorCount ?? 0 }
    }
    return { status: 'idle', errorCount: data?.lastValidation?.errorCount ?? 0 }
  }

  const orderedColumns = computed(() => {
    const schemaNode = graphStore.nodes.find((n) => n.id === props.schemaNodeId)
    const data = (schemaNode?.data ?? { columns: [] }) as {
      columns?: Array<{ id: string; columnName: string; children?: unknown[] }>
    }
    return flattenSchemaColumnsForOverview(data.columns)
  })

  const sections = computed(() =>
    groupConstraintRowsByColumn(family.value?.rows ?? [], orderedColumns.value, resolveChipStatus)
  )

  const allChips = computed(() => sections.value.flatMap((s) => s.chips))
  const statusCounts = computed(() => aggregateStatusCounts(allChips.value))

  // ============================================================================
  // chip 展示辅助
  // ============================================================================

  const KIND_ICON_NAMES: Record<string, string> = CONSTRAINT_ICON_NAMES

  function chipIconName(chip: ConstraintOverviewChip): string {
    return KIND_ICON_NAMES[chip.kind] || ''
  }

  function chipTypeName(chip: ConstraintOverviewChip): string {
    return t(`constraintTypes.${chip.kind}.name`)
  }

  function chipStateClass(chip: ConstraintOverviewChip): string {
    return chip.status ? resolveNodeState(chip.status) : 'idle'
  }

  function chipTooltip(chip: ConstraintOverviewChip): string {
    const parts: string[] = []
    if (!chip.embedded && chip.label && chip.label !== chip.kind) parts.push(chip.label)
    parts.push(chipTypeName(chip))
    if (chip.embedded) {
      parts.push(t('customNodes.constraintOverview.embeddedHint'))
    } else if (chip.status === 'pass') {
      parts.push(t('customNodes.constraintOverview.statusPass'))
    } else if (chip.status === 'error') {
      parts.push(t('customNodes.constraintOverview.statusError'))
    } else if (chip.status === 'missing') {
      parts.push(t('customNodes.constraintOverview.statusMissing'))
    } else {
      parts.push(t('customNodes.constraintOverview.statusIdle'))
    }
    if (chip.errorCount > 0) {
      parts.push(t('customNodes.constraintOverview.errorCount', { count: chip.errorCount }))
    }
    return parts.join(' · ')
  }

  // ============================================================================
  // chip 点击：standalone 聚焦卡片（选中 → 紧凑卡临时展开）；embedded 聚焦 Schema
  // ============================================================================

  /** 同步 Vue Flow 选中标志（单选语义）：仅写 store 会被 VF→Store 同步覆写（focusNode 同款手法） */
  function syncVueFlowSelection(nodeId: string): void {
    try {
      for (const n of graphStore.nodes) {
        if (n.id === nodeId) continue
        const other = findNode(n.id)
        if (other?.selected) {
          other.selected = false
        }
      }
      const vfNode = findNode(nodeId)
      if (vfNode && !vfNode.selected) {
        vfNode.selected = true
      }
    } catch (error) {
      // 画布未挂载（vueFlowApi 未初始化）时跳过 VF 侧同步，仅保留 store 选中
      if (!(error instanceof VueFlowApiNotInitializedError)) {
        throw error
      }
    }
  }

  function handleChipClick(chip: ConstraintOverviewChip): void {
    if (!chip.embedded) {
      graphStore.setSelection([chip.constraintId])
      syncVueFlowSelection(chip.constraintId)
      eventBus.emit('focus-canvas-nodes', { nodeIds: [chip.constraintId] })
      return
    }
    // 内嵌约束无卡片：聚焦 Schema 本体即可定位（列在 Schema 节点上可见）。
    // 降级说明：本提交范围不含校验面板的列定位通道（errorColumnFocus 信箱 +
    // expand-inspector-panel / inspector-focus-column 事件，属另一条未合入线），
    // 故不再经其打开 Inspector 对应列；待该工作合入后可在此恢复列定位：
    // 写 pendingErrorColumnFocus + emit 上述两事件（columnId 已在手）。
    graphStore.setSelection([props.schemaNodeId])
    syncVueFlowSelection(props.schemaNodeId)
    eventBus.emit('focus-canvas-nodes', { nodeIds: [props.schemaNodeId] })
  }

  // ============================================================================
  // 底部操作：全部展开 / 全部紧凑（批量写 density，densityPinned 入指纹管理器尊重）
  // ============================================================================

  function expandAll(): void {
    for (const id of family.value?.standaloneIds ?? []) {
      graphStore.updateNodeData(id, { density: 'full', densityPinned: true })
    }
  }

  function compactAll(): void {
    for (const id of family.value?.standaloneIds ?? []) {
      graphStore.updateNodeData(id, { density: undefined, densityPinned: undefined })
    }
  }

  function close(): void {
    overviewStore.close()
    emit('close')
  }

  // ============================================================================
  // 锚定跟随：fixed 浮层逐帧贴住 Vue Flow 节点包裹元素（拖拽/平移/缩放均跟随）
  // ============================================================================

  const popoverRef = ref<HTMLElement | null>(null)
  let rafId = 0
  let cachedAnchor: HTMLElement | null = null

  function resolveAnchor(): HTMLElement | null {
    if (cachedAnchor && cachedAnchor.isConnected) return cachedAnchor
    cachedAnchor = document.querySelector<HTMLElement>(
      `.vue-flow__node[data-id="${props.schemaNodeId}"]`
    )
    return cachedAnchor
  }

  function positionPopover(): void {
    const el = popoverRef.value
    const anchor = resolveAnchor()
    if (!el || !anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const gap = 12
    const margin = 8
    // 默认放节点右侧（约束扇出方向）；右缘放不下翻到左侧
    let left = rect.right + gap
    if (left + width > window.innerWidth - margin) {
      left = rect.left - width - gap
    }
    // 锚点被平移/缩放出视口时（如 fitView 聚焦家族卡片），把弹层整体夹回视口内，
    // 保证底部操作行始终可点（只夹 top/left 方向会被高度/宽度顶出另一侧）
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin))
    // 顶部对齐节点，垂直整体夹进视口
    const top = Math.min(
      Math.max(margin, rect.top),
      Math.max(margin, window.innerHeight - height - margin)
    )
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  function tick(): void {
    positionPopover()
    rafId = requestAnimationFrame(tick)
  }

  function startTracking(): void {
    stopTracking()
    cachedAnchor = null
    positionPopover()
    rafId = requestAnimationFrame(tick)
  }

  function stopTracking(): void {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  watch(isOpen, (open) => {
    if (open) {
      startTracking()
    } else {
      stopTracking()
    }
  })

  // ============================================================================
  // 关闭通道：Esc / 点击外部（本组件 toggle 按钮除外——再点由 store.toggle 关闭）
  // ============================================================================

  function handleKeydown(event: KeyboardEvent): void {
    // IME 合成中放行（AGENTS.md 键盘纪律；Esc 本身不参与选词，防御性守卫）
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape' && isOpen.value) {
      close()
    }
  }

  /**
   * 弹层根上的 Esc 处理：焦点在弹层内部（chip/按钮点击后残留焦点）时，
   * keydown 在根元素被 @keydown.stop 截住、到不了 document 监听——
   * 同元素上的本处理器先于 stop 生效（stopPropagation 不拦截同元素监听器）。
   */
  function handleEscapeKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return
    close()
  }

  function handleDocumentClick(event: MouseEvent): void {
    if (!isOpen.value) return
    const target = event.target as HTMLElement | null
    if (!target) return
    if (popoverRef.value?.contains(target)) return
    // 自己的 toggle 按钮：跳过（toggle 处理器负责关闭）；其他 Schema 的 toggle
    // 交由其自身处理器切换（先关再开，净效果正确）
    const ownToggle = target.closest<HTMLElement>('[data-constraint-overview-toggle]')
    if (ownToggle && ownToggle.dataset.constraintOverviewToggle === props.schemaNodeId) return
    close()
  }

  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick, true)

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('click', handleDocumentClick, true)
    stopTracking()
    cachedAnchor = null
  })
</script>

<style scoped src="./SchemaConstraintOverview.styles.css"></style>
