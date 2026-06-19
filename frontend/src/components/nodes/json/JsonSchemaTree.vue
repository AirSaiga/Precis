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
            :show-constraint-menu="activeMenuColumnId === item.id && activeMenuType === 'constraint'"
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

    <!-- 列操作下拉菜单（约束 / 类型 / 数组元素类型） -->
    <JsonSchemaNodeColumnMenuDropdown
      :show="!!activeMenuColumnId"
      :menu-type="activeMenuType || 'constraint'"
      :position="dropdownPosition"
      :column-id="activeMenuColumnId || ''"
      :constraints="activeColumn?.constraints"
      :current-type="activeColumn?.dataType"
      :current-items-type="activeColumn?.arrayItemType"
      @close="closeDropdown"
      @toggle-constraint="handleEnableConstraint"
      @remove-all-constraints="handleRemoveAllConstraints"
      @select-type="handleSelectType"
      @select-items-type="handleSelectItemsType"
    />
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
  import { Handle, Position } from '@vue-flow/core'
  import type { JsonSchemaColumn } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { findJsonSchemaColumnById } from '@/utils/nodes/json/columnFinder'
  import JsonSchemaNodeColumnRow from './components/JsonSchemaNodeColumnRow.vue'
  import JsonSchemaNodeColumnMenuDropdown from './components/JsonSchemaNodeColumnMenuDropdown.vue'
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
  const activeMenuColumnId = ref<string | null>(null)
  const activeMenuType = ref<'constraint' | 'type' | 'itemsType' | null>(null)
  const dropdownPosition = ref({ top: 0, left: 0 })

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
        const hasChildren = Boolean(col.children && col.children.length > 0)
        items.push({
          id: col.id,
          column: col,
          index,
          level,
          hasChildren,
          isExpanded: col.isExpanded !== undefined ? col.isExpanded : false,
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
    const currentItem = visibleItems.value[index]
    const nextItem = visibleItems.value[index + 1]
    if (!currentItem || !nextItem) return true
    const currentLevel = currentItem.level
    const nextLevel = nextItem.level
    return nextLevel < currentLevel
  }

  // 当前激活菜单对应的列
  const activeColumn = computed(() => {
    if (!activeMenuColumnId.value) return undefined
    return findColumnById(props.columns, activeMenuColumnId.value)
  })

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

  // 递归按 ID 查找列（委托给共享工具 columnFinder）
  const findColumnById = (
    cols: JsonSchemaColumn[],
    id: string
  ): JsonSchemaColumn | undefined => {
    return findJsonSchemaColumnById(cols, id)?.column
  }

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

  /**
   * 递归更新所有后代列的 JSONPath 前缀
   * 当父列名称变更时，子列路径前缀应同步更新
   */
  const updateDescendantPaths = (
    children: JsonSchemaColumn[] | undefined,
    oldPrefix: string,
    newPrefix: string
  ): JsonSchemaColumn[] | undefined => {
    if (!children || children.length === 0) return children
    return children.map((child) => {
      const updatedPath = child.jsonPath.startsWith(oldPrefix + '.')
        ? newPrefix + child.jsonPath.slice(oldPrefix.length)
        : child.jsonPath
      return {
        ...child,
        jsonPath: updatedPath,
        children: updateDescendantPaths(child.children, oldPrefix, newPrefix),
      }
    })
  }

  /**
   * 递归重命名列，并同步更新其所有后代列的 JSONPath
   */
  const renameColumnWithChildren = (
    cols: JsonSchemaColumn[],
    columnId: string,
    newName: string
  ): JsonSchemaColumn[] => {
    return cols.map((c) => {
      if (c.id === columnId) {
        const oldPath = c.jsonPath
        const lastDot = oldPath.lastIndexOf('.')
        const newPath = lastDot > 0 ? oldPath.substring(0, lastDot) + '.' + newName : '$.' + newName
        return {
          ...c,
          columnName: newName,
          jsonPath: newPath,
          children: updateDescendantPaths(c.children, oldPath, newPath),
        }
      }
      if (c.children) {
        return { ...c, children: renameColumnWithChildren(c.children, columnId, newName) }
      }
      return c
    })
  }

  const confirmEdit = (columnId: string, name: string) => {
    editingId.value = null
    if (name) {
      emit('update', renameColumnWithChildren(props.columns, columnId, name))
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
    if (activeMenuColumnId.value === columnId && activeMenuType.value === 'constraint') {
      activeMenuColumnId.value = null
      activeMenuType.value = null
      return
    }
    activeMenuColumnId.value = columnId
    activeMenuType.value = 'constraint'
    const rect = (event.target as HTMLElement).getBoundingClientRect()
    dropdownPosition.value = { top: rect.bottom + 4, left: rect.left }
  }

  const toggleTypeDropdown = (columnId: string, event: MouseEvent) => {
    if (activeMenuColumnId.value === columnId && activeMenuType.value === 'type') {
      activeMenuColumnId.value = null
      activeMenuType.value = null
      return
    }
    activeMenuColumnId.value = columnId
    activeMenuType.value = 'type'
    const rect = (event.target as HTMLElement).getBoundingClientRect()
    dropdownPosition.value = { top: rect.bottom + 4, left: rect.left }
  }

  const handleSelectType = (id: string, type: string) => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      dataType: type as JsonSchemaColumn['dataType'],
    }))
    emit('update', cols)
    activeMenuColumnId.value = null
    activeMenuType.value = null
  }

  const handleEnableConstraint = (id: string, constraintType: 'notNull' | 'unique') => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      constraints: {
        ...c.constraints,
        [constraintType]: true,
      },
    }))
    emit('update', cols)
    activeMenuColumnId.value = null
    activeMenuType.value = null
  }

  const handleRemoveAllConstraints = (id: string) => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      constraints: undefined,
    }))
    emit('update', cols)
    activeMenuColumnId.value = null
    activeMenuType.value = null
  }

  const handleSelectItemsType = (id: string, type: string) => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      arrayItemType: type as JsonSchemaColumn['arrayItemType'],
    }))
    emit('update', cols)
    activeMenuColumnId.value = null
    activeMenuType.value = null
  }

  // 点击外部关闭下拉
  const closeDropdown = () => {
    activeMenuColumnId.value = null
    activeMenuType.value = null
  }

  const onDocumentClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('.json-tree')) return
    closeDropdown()
  }

  onMounted(() => {
    document.addEventListener('click', onDocumentClick)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', onDocumentClick)
  })

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
