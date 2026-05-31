<!--
  @file JsonSchemaTree.vue
  @description JSON Schema 树形列渲染组件
  使用 JsonSchemaNodeColumnRow 组件 + 左侧边框分组
-->
<template>
  <div class="json-tree">
    <div class="tree-body">
      <template v-for="(item, index) in visibleItems" :key="item.id">
        <!-- 树行包装器（包含 Handle 和分组样式） -->
        <div
          class="tree-row-wrapper"
          :class="{
            'is-parent': item.canHaveChildren,
            'is-expanded': item.isExpanded,
            'is-last-child': isLastChild(index),
          }"
          :data-level="item.level"
          :data-column-id="item.id"
          @mouseenter="hoveredColumnId = item.id"
          @mouseleave="hoveredColumnId = null"
        >
          <!-- 使用 JsonSchemaNodeColumnRow 组件 -->
          <JsonSchemaNodeColumnRow
            :column="item.column"
            :index="index"
            :depth="item.level"
            :is-editing="editingId === item.id"
            :is-hovered="hoveredColumnId === item.id"
            :show-constraint-menu="constraintMenuColumnId === item.id"
            @start-edit="startEdit"
            @confirm-edit="confirmEdit"
            @cancel-edit="cancelEdit"
            @delete="remove"
            @hover="hoveredColumnId = $event"
            @unhover="hoveredColumnId = null"
            @hover-error="hoveredErrorColumn = $event"
            @unhover-error="hoveredErrorColumn = null"
            @toggle-constraint-menu="toggleConstraintMenu"
            @toggle-type-dropdown="toggleTypeDropdown"
            @toggle-expand="toggle"
            @enter="handleEnter"
            @tab="handleTab"
          />

          <!-- Vue Flow 连接点 Handle -->
          <Handle
            :id="'source-right-' + item.id"
            type="source"
            :position="Position.Right"
            :class="['column-handle', { 'is-connected': connectedColumnIds.has(item.id) }]"
          />
        </div>
      </template>
    </div>

    <!-- 类型选择下拉菜单（Teleport） -->
    <Teleport to="body">
      <div
        v-if="activeTypeDropdown"
        class="type-dropdown-menu"
        :style="{ top: dropdownPosition.top + 'px', left: dropdownPosition.left + 'px' }"
        @click.stop
      >
        <div
          v-for="opt in typeOptions"
          :key="opt"
          class="type-option"
          :class="'type-' + opt"
          @click="selectType(activeTypeDropdown, opt)"
        >
          {{ opt }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { Handle, Position } from '@vue-flow/core'
  import type { JsonSchemaColumn } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import JsonSchemaNodeColumnRow from './components/JsonSchemaNodeColumnRow.vue'
  import '@/components/nodes/json/JsonSchemaTree.styles.css'

  const props = defineProps<{
    columns: JsonSchemaColumn[]
  }>()

  const emit = defineEmits<{
    update: [columns: JsonSchemaColumn[]]
  }>()

  // ==================== 状态 ====================

  const editingId = ref<string | null>(null)
  const hoveredColumnId = ref<string | null>(null)
  const hoveredErrorColumn = ref<string | null>(null)
  const constraintMenuColumnId = ref<string | null>(null)
  const activeTypeDropdown = ref<string | null>(null)
  const dropdownPosition = ref({ top: 0, left: 0 })
  const typeOptions = ['string', 'number', 'boolean', 'object', 'array', 'null']

  // ==================== 计算属性 ====================

  // 展平的可见列列表
  const visibleItems = computed(() => {
    const items: Array<{
      id: string
      column: JsonSchemaColumn
      index: number
      level: number
      hasChildren: boolean
      isExpanded: boolean
      canHaveChildren: boolean
    }> = []
    let index = 0

    const walk = (cols: JsonSchemaColumn[], level: number) => {
      for (const col of cols) {
        const hasChildren = col.children && col.children.length > 0
        items.push({
          id: col.id,
          column: col,
          index,
          level,
          hasChildren,
          isExpanded: col.isExpanded ?? false,
          canHaveChildren: col.dataType === 'object' || col.dataType === 'array',
        })
        index++
        if (col.isExpanded && hasChildren) {
          walk(col.children!, level + 1)
        }
      }
    }

    if (props.columns) {
      walk(props.columns, 0)
    }
    return items
  })

  // 判断是否为同级最后一个子节点
  const isLastChild = (index: number): boolean => {
    if (index === visibleItems.value.length - 1) return true
    const currentLevel = visibleItems.value[index].level
    const nextLevel = visibleItems.value[index + 1].level
    return nextLevel < currentLevel
  }

  // 已连接的列 ID 集合
  const connectedColumnIds = computed(() => {
    const store = useGraphStore()
    const ids = new Set<string>()
    for (const edge of store.edges) {
      if (edge.sourceHandle && edge.sourceHandle.startsWith('source-right-')) {
        ids.add(edge.sourceHandle.replace('source-right-', ''))
      }
    }
    return ids
  })

  // ==================== 列操作 ====================

  // 递归更新列
  const updateColumn = (
    cols: JsonSchemaColumn[],
    id: string,
    updater: (c: JsonSchemaColumn) => JsonSchemaColumn
  ): JsonSchemaColumn[] => {
    return cols.map((c) => {
      if (c.id === id) return updater({ ...c })
      if (c.children) return { ...c, children: updateColumn(c.children, id, updater) }
      return c
    })
  }

  // 展开/折叠
  const toggle = (id: string) => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      isExpanded: !c.isExpanded,
    }))
    emit('update', cols)
  }

  // 编辑
  const startEdit = (columnId: string) => {
    editingId.value = columnId
  }

  const confirmEdit = (columnId: string, name: string) => {
    editingId.value = null
    if (name) {
      const cols = updateColumn(props.columns, columnId, (c) => {
        const oldPath = c.jsonPath
        const lastDot = oldPath.lastIndexOf('.')
        const newPath = lastDot > 0 ? oldPath.substring(0, lastDot) + '.' + name : '$.' + name
        return { ...c, columnName: name, jsonPath: newPath }
      })
      emit('update', cols)
    }
  }

  const cancelEdit = () => {
    editingId.value = null
  }

  // 删除
  const remove = (id: string) => {
    const del = (cols: JsonSchemaColumn[]): JsonSchemaColumn[] =>
      cols
        .filter((c) => c.id !== id)
        .map((c) => ({
          ...c,
          children: c.children ? del(c.children) : undefined,
        }))
    emit('update', del(props.columns))
  }

  // 键盘事件
  const handleEnter = () => {
    // Tab 到下一个字段（可扩展）
  }

  const handleTab = () => {
    // Tab 到下一个字段（可扩展）
  }

  // ==================== 菜单操作 ====================

  const toggleConstraintMenu = (columnId: string, event: MouseEvent) => {
    constraintMenuColumnId.value = columnId
    const rect = (event.target as HTMLElement).getBoundingClientRect()
    dropdownPosition.value = { top: rect.bottom + 4, left: rect.left }
    activeTypeDropdown.value = null
  }

  const toggleTypeDropdown = (columnId: string, event: MouseEvent) => {
    activeTypeDropdown.value = columnId
    const rect = (event.target as HTMLElement).getBoundingClientRect()
    dropdownPosition.value = { top: rect.bottom + 4, left: rect.left }
    constraintMenuColumnId.value = null
  }

  const selectType = (id: string, type: string) => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      dataType: type as JsonSchemaColumn['dataType'],
    }))
    emit('update', cols)
    activeTypeDropdown.value = null
  }

  // 点击外部关闭下拉
  const closeDropdown = () => {
    activeTypeDropdown.value = null
    constraintMenuColumnId.value = null
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeDropdown)
  }

  // ==================== 暴露方法 ====================

  // 展开全部
  const expandAll = () => {
    const setExpanded = (cols: JsonSchemaColumn[], expanded: boolean): JsonSchemaColumn[] =>
      cols.map((c) => ({
        ...c,
        isExpanded: expanded,
        children: c.children ? setExpanded(c.children, expanded) : undefined,
      }))
    emit('update', setExpanded(props.columns, true))
  }

  // 折叠全部
  const collapseAll = () => {
    const setExpanded = (cols: JsonSchemaColumn[], expanded: boolean): JsonSchemaColumn[] =>
      cols.map((c) => ({
        ...c,
        isExpanded: expanded,
        children: c.children ? setExpanded(c.children, expanded) : undefined,
      }))
    emit('update', setExpanded(props.columns, false))
  }

  defineExpose({ expandAll, collapseAll })
</script>
