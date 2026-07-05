<!--
  @file JsonSchemaTree.vue
  @description JSON Schema 树形列渲染组件
  使用 JsonSchemaNodeColumnRow 组件 + 左侧边框分组
-->
<template>
  <div class="json-tree">
    <!--
      tree-body 是滚动容器
      - :ref 绑定到 scrollRef（由父节点 JsonSchemaNode 传入的 columnsSectionRef）
        使 useNodeUI 的 getScrolledOutColumnsBySide 能基于此 DOM 计算可视区
      - @scroll 透传给父节点的 handleColumnsScroll（rAF 节流 + updateNodeInternals）
    -->
    <div
      class="tree-body"
      :ref="(el) => assignScrollRef(el as HTMLElement | null)"
      @scroll="emit('scroll', $event)"
    >
      <template v-for="(item, index) in visibleItems" :key="item.id">
        <!--
          树行包装器
          - 同时挂 'column-row' 和 'tree-row-wrapper' 类：
            * 'column-row' 对齐 useNodeUI 的 DOM 选择器 .column-row[data-column-id]
            * 'tree-row-wrapper' 承载树形分组样式
        -->
        <div
          class="tree-row-wrapper column-row"
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
            :show-constraint-menu="
              activeMenuColumnId === item.id && activeMenuType === 'constraint'
            "
            @start-edit="startEdit"
            @confirm-edit="confirmEdit"
            @cancel-edit="cancelEdit"
            @delete="remove"
            @hover="hoveredColumnId = $event"
            @unhover="hoveredColumnId = null"
            @hover-error="(id) => ((hoveredErrorColumn = id), emit('hoverError', id))"
            @unhover-error="() => ((hoveredErrorColumn = null), emit('unhoverError'))"
            @toggle-constraint-menu="toggleConstraintMenu"
            @toggle-type-dropdown="toggleTypeDropdown"
            @toggle-items-type-dropdown="toggleItemsTypeDropdown"
            @toggle-expand="toggle"
            @add-child="handleAddChild"
            @enter="handleEnter"
            @tab="handleTab"
          />

          <!-- Vue Flow 连接点 Handle（前缀 source-right- 与虚拟锚点系统约定一致） -->
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
    /**
     * 父节点传入的滚动容器 ref（columnsSectionRef）。
     * 本组件的 .tree-body 会把它绑定到自身 DOM，使 useNodeUI 能基于此计算滚动出可视区的列。
     * 类型用 unknown 避免与 Vue 的 ref 函数签名产生协变冲突；运行时只是赋值给 DOM。
     */
    scrollRef?: unknown
  }>()

  const emit = defineEmits<{
    update: [columns: JsonSchemaColumn[]]
    /** 滚动事件透传（父节点接 handleColumnsScroll） */
    scroll: [event: Event]
    /** 添加子字段（object/array 列触发，父节点接 useJsonSchemaData.addChildColumn） */
    addChild: [parentId: string]
    /** 鼠标进入有错误的字段（父节点用于显示错误 popover） */
    hoverError: [columnId: string]
    /** 鼠标离开错误字段 */
    unhoverError: []
  }>()

  // ==================== 状态 ====================

  const editingId = ref<string | null>(null)
  const hoveredColumnId = ref<string | null>(null)
  const hoveredErrorColumn = ref<string | null>(null)
  const activeMenuColumnId = ref<string | null>(null)
  const activeMenuType = ref<'constraint' | 'type' | 'itemsType' | null>(null)
  const dropdownPosition = ref({ top: 0, left: 0 })

  /**
   * 把 .tree-body 的 DOM 元素绑定到父节点传入的 columnsSectionRef
   * （Vue 的函数式 ref 写法，元素挂载/卸载时都会调用）
   */
  const assignScrollRef = (el: HTMLElement | null) => {
    // useNodeUI.columnsSectionRef 是一个 Ref<HTMLElement | null>，
    // 父节点通过 props.scrollRef 透传过来；此处把它指向当前 .tree-body
    const refObj = props.scrollRef as { value: HTMLElement | null } | undefined
    if (refObj && 'value' in refObj) {
      refObj.value = el
    }
  }

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
  const findColumnById = (cols: JsonSchemaColumn[], id: string): JsonSchemaColumn | undefined => {
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

  /**
   * 切换"数组元素类型"下拉菜单（仅 array 类型列触发）
   * 走 'itemsType' 菜单分支（JsonSchemaNodeColumnMenuDropdown 已实现）
   */
  const toggleItemsTypeDropdown = (columnId: string, event: MouseEvent) => {
    if (activeMenuColumnId.value === columnId && activeMenuType.value === 'itemsType') {
      activeMenuColumnId.value = null
      activeMenuType.value = null
      return
    }
    activeMenuColumnId.value = columnId
    activeMenuType.value = 'itemsType'
    const rect = (event.target as HTMLElement).getBoundingClientRect()
    dropdownPosition.value = { top: rect.bottom + 4, left: rect.left }
  }

  /**
   * 为 object/array 列添加子字段（冒泡给父节点，由父节点调用 useJsonSchemaData.addChildColumn）
   */
  const handleAddChild = (parentId: string) => {
    emit('addChild', parentId)
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
