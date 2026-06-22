/**
 * @file useNodeUI.ts
 * @description 通用节点 UI 状态管理
 *
 * 功能概述:
 * - 下拉菜单状态管理（类型、约束、数据源）
 * - 悬停状态管理
 * - 节点样式类计算
 * - 错误信息格式化
 * - 滚动位置处理
 * - 数据源树构建
 * - 视口位置计算
 *
 * 架构设计:
 * - 抽象 Schema 节点和 JSON Schema 节点的公共 UI 逻辑
 * - 通过 options 参数注入差异点（类型选项、格式化方式、列查找方式等）
 * - 保持与 useSchemaUI / useJsonSchemaUI 的接口兼容性
 *
 * 输入示例:
 * ```typescript
 * const ui = useNodeUI({
 *   nodeId: 'node-1',
 *   nodeData: { columns: [...], saveState: 'saved', isDragOver: false },
 *   selected: true,
 *   typeOptions: [{ value: 'String', label: 'String' }],
 *   getTypeDisplayText: (type) => type,
 *   formatErrors: (errors) => ({ summary: '...', fullMessage: '...' }),
 *   findColumnById: (id, columns) => columns.find(c => c.id === id) || null,
 *   getVisibleColumns: (columns) => columns,
 *   onColumnsChange: () => void
 * });
 * ```
 *
 * 输出示例:
 * - hoveredColumn, activeDropdown, dropdownPosition 等 UI 状态
 * - dataSourceTree: 数据源树形结构
 * - nodeClasses: 节点样式类对象
 * - toggleTypeDropdown, toggleConstraintMenu 等交互方法
 */

import { ref, computed, watch, nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGraphStore } from '@/stores/graphStore'
import type { DataSourceTreeItem } from '@/components/nodes/core/SchemaNode/components/SchemaNodeDataSourceDropdown.vue'
export interface NodeUIOptions<TColumn extends { id: string; columnName: string }, TDataType> {
  /** 节点唯一标识 */
  nodeId: string
  /** 节点数据 */
  nodeData: { columns: TColumn[]; saveState?: string; isDragOver?: boolean }
  /** 是否选中 */
  selected?: boolean
  /** 数据类型选项 */
  typeOptions: { value: TDataType; label: string }[]
  /** 获取类型显示文本 */
  getTypeDisplayText: (type: TDataType) => string
  /** 自定义错误格式化 */
  formatErrors?: (errors: string[]) => { summary: string; fullMessage: string }
  /** 根据 ID 查找列（支持嵌套结构） */
  findColumnById?: (id: string, columns: TColumn[]) => TColumn | null
  /** 获取当前可见列列表（用于树形结构的展开/折叠） */
  getVisibleColumns?: (columns: TColumn[]) => TColumn[]
  /** 列数据变化时的回调 */
  onColumnsChange?: () => void
}

export function useNodeUI<TColumn extends { id: string; columnName: string }, TDataType>(
  options: NodeUIOptions<TColumn, TDataType>
) {
  const { updateNodeInternals } = useVueFlow()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const store = useGraphStore()

  /** 是否有列滚动出可视区域 */
  const hasScrolledOutColumns = ref(false)

  /** 当前悬停的列ID */
  const hoveredColumn = ref<string | null>(null)

  /** 当前悬停显示错误的列ID */
  const hoveredErrorColumn = ref<string | null>(null)

  /** 当前打开的下拉菜单对应的列ID */
  const activeDropdown = ref<string | null>(null)

  /** 下拉菜单位置 */
  const dropdownPosition = ref({ top: 0, left: 0 })

  /** 约束菜单列ID */
  const constraintMenuColumnId = ref<string | null>(null)

  /** 约束下拉菜单位置 */
  const constraintDropdownPosition = ref({ top: 0, left: 0 })

  /** 错误详情弹窗位置 */
  const errorPopoverPosition = ref({ top: 0, left: 0 })

  /** 数据源下拉菜单是否显示 */
  const showSourceDropdown = ref(false)

  /** 数据源下拉菜单位置 */
  const sourceDropdownPosition = ref({ top: 0, left: 0 })

  /**
   * 可用的数据源列表（树状结构）
   */
  const dataSourceTree = computed<DataSourceTreeItem[]>(() => {
    const workspaceStore = useWorkspaceStore()
    const dataSources = workspaceStore.getDataSources()

    if (dataSources.length === 0) {
      return []
    }

    const tree: DataSourceTreeItem[] = []
    const folderMap = new Map<string, DataSourceTreeItem>()
    const folderPaths = new Set<string>()

    // 收集所有文件夹路径
    for (const ds of dataSources) {
      if (ds.folderPath) {
        const parts = ds.folderPath.split(/[/\\]/)
        // 添加根文件夹
        if (parts.length >= 1) {
          const firstPart = parts[0]
          if (firstPart !== undefined) {
            folderPaths.add(firstPart)
          }
        }
        // 添加所有中间文件夹
        let currentPath = ''
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]
          if (part === undefined) continue
          currentPath = currentPath ? `${currentPath}/${part}` : part
          folderPaths.add(currentPath)
        }
      }
    }

    // 排序文件夹路径以确保正确顺序
    const sortedFolderPaths = Array.from(folderPaths).sort((a, b) => a.localeCompare(b))

    // 创建文件夹节点
    for (const folderPath of sortedFolderPaths) {
      const parts = folderPath.split(/[/\\]/)
      const folderName = parts[parts.length - 1] ?? folderPath
      const level = parts.length - 1

      const folderNode: DataSourceTreeItem = {
        type: 'folder',
        id: `folder_${folderPath}`,
        name: folderName,
        folderPath: folderPath,
        level: level,
      }

      folderMap.set(folderPath, folderNode)

      // 添加到父文件夹或根级别
      const parentPath = parts.slice(0, -1).join('/')
      if (parentPath && folderMap.has(parentPath)) {
        // 有父文件夹，暂不处理嵌套，扁平展示
        tree.push(folderNode)
      } else {
        tree.push(folderNode)
      }
    }

    // 创建文件节点
    for (const ds of dataSources) {
      let fileLevel = 0
      if (ds.folderPath) {
        const parts = ds.folderPath.split(/[/\\]/)
        fileLevel = parts.length
      }

      const fileNode: DataSourceTreeItem = {
        type: 'file',
        id: ds.id,
        name: ds.name,
        folderPath: ds.folderPath,
        dataSource: ds,
        level: fileLevel,
      }

      tree.push(fileNode)
    }

    // 按类型和名称排序：文件夹在前，文件在后
    tree.sort((a, b) => {
      if (a.type === 'folder' && b.type === 'file') return -1
      if (a.type === 'file' && b.type === 'folder') return 1
      return a.name.localeCompare(b.name)
    })

    return tree
  })

  /**
   * 列定义区域的DOM引用
   */
  const columnsSectionRef = ref<HTMLElement | null>(null)

  /**
   * 滚动更新动画帧ID，用于节流
   */
  let scrollUpdateFrame: number | null = null

  /** 滚动版本号 */
  const scrollVersion = ref(0)

  /**
   * 常量：错误信息最大显示数量
   */
  const MAX_ERROR_DISPLAY = 10

  /**
   * 计算固定的下拉菜单位置，确保菜单位于视口内
   *
   * @param anchorRect - 锚点元素的 DOMRect
   * @param menuSize - 菜单尺寸
   * @param offsets - 偏移量
   * @returns 计算后的位置
   */
  const computeFixedDropdownPosition = (
    anchorRect: DOMRect,
    menuSize: { width: number; height: number },
    offsets: { x: number; y: number } = { x: 0, y: 2 }
  ): { top: number; left: number } => {
    const padding = 8

    let left = anchorRect.left + offsets.x
    if (left + menuSize.width + padding > window.innerWidth) {
      left = window.innerWidth - menuSize.width - padding
    }
    left = Math.max(padding, left)

    const belowTop = anchorRect.bottom + offsets.y
    const aboveTop = anchorRect.top - menuSize.height - offsets.y

    let top = belowTop
    if (belowTop + menuSize.height + padding > window.innerHeight && aboveTop >= padding) {
      top = aboveTop
    }

    top = Math.max(padding, Math.min(top, window.innerHeight - menuSize.height - padding))

    return { top, left }
  }

  /**
   * 计算属性：节点样式类
   */
  const nodeClasses = computed(() => ({
    'is-selected': !!options.selected,
    'is-drag-over': options.nodeData.isDragOver,
    'is-draft': options.nodeData.saveState === 'draft',
    'has-error': options.nodeData.saveState === 'error',
    'is-hovered': false,
  }))

  /**
   * 格式化验证错误信息用于显示
   *
   * @param errors - 错误信息数组
   * @returns 格式化的错误摘要和完整消息
   */
  const formatValidationErrors = (errors: string[]): { summary: string; fullMessage: string } => {
    if (!errors || errors.length === 0) {
      return { summary: '', fullMessage: '' }
    }

    const total = errors.length
    const displayErrors = errors.slice(0, MAX_ERROR_DISPLAY)

    if (options.formatErrors) {
      return options.formatErrors(errors)
    }

    const nullErrors = errors.filter((e) => e.includes('为空'))
    const duplicateErrors = errors.filter((e) => e.includes('重复'))

    const parts: string[] = []
    if (nullErrors.length > 0) parts.push(`${nullErrors.length} 个空值错误`)
    if (duplicateErrors.length > 0) parts.push(`${duplicateErrors.length} 个重复值错误`)

    let summary: string
    let fullMessage: string

    if (parts.length > 0) {
      summary = parts.join(' + ')
    } else {
      summary = `${total} 个错误`
    }

    if (total <= MAX_ERROR_DISPLAY) {
      fullMessage = errors.join('\n')
    } else {
      fullMessage = `${displayErrors.join('\n')}\n... 共 ${total} 个错误`
    }

    return { summary, fullMessage }
  }

  /**
   * 计算错误详情弹窗位置
   *
   * @param columnId - 列ID
   * @returns 弹窗位置
   */
  const getErrorPopoverPosition = (columnId: string): { top: string; left: string } => {
    const schemaElement = document.querySelector(`[data-node-id="${options.nodeId}"]`)
    if (!schemaElement) {
      return { top: '0px', left: '0px' }
    }

    const columnRows = schemaElement.querySelectorAll('.column-row')
    let targetRow: Element | null = null

    for (const row of Array.from(columnRows)) {
      const rowElement = row as HTMLElement
      // 方式1：dataset 精确匹配
      if (rowElement.dataset.columnId === columnId) {
        targetRow = row
        break
      }
      // 方式2：内部 data-column-id 属性匹配
      if (row.querySelector(`[data-column-id="${columnId}"]`)) {
        targetRow = row
        break
      }
      // 方式3：文本内容回退匹配
      const nameText = row.querySelector('.column-name-text')
      if (nameText) {
        const col = options.findColumnById
          ? options.findColumnById(columnId, options.nodeData.columns)
          : options.nodeData.columns.find((c: TColumn) => c.id === columnId) || null
        if (col && nameText.textContent?.includes(col.columnName)) {
          targetRow = row
          break
        }
      }
    }

    if (!targetRow && columnRows.length > 0) {
      let foundIndex = -1
      options.nodeData.columns.forEach((col, index) => {
        if (col.id === columnId) foundIndex = index
      })

      if (foundIndex >= 0) {
        const foundRow = columnRows[foundIndex]
        if (foundRow) {
          targetRow = foundRow
        }
      }
    }

    if (!targetRow) {
      return { top: '0px', left: '0px' }
    }

    const rowRect = targetRow.getBoundingClientRect()

    return {
      top: `${rowRect.bottom + 4}px`,
      left: `${rowRect.left}px`,
    }
  }

  /**
   * 工具方法：验证列名是否合法
   *
   * @param name - 列名
   * @returns 是否合法
   */
  const validateColumnName = (name: string): boolean => {
    if (!name.trim()) return false
    if (/^\d/.test(name)) return false
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return false
    return name.length <= 50
  }

  /**
   * 切换数据类型下拉菜单
   *
   * @param columnId - 列ID
   * @param event - 鼠标事件
   */
  const toggleTypeDropdown = (columnId: string, event?: MouseEvent) => {
    if (activeDropdown.value === columnId) {
      activeDropdown.value = null
    } else {
      const menuHeight = options.typeOptions.length * 32
      if (event) {
        const target = event.currentTarget as HTMLElement
        const rect = target.getBoundingClientRect()
        dropdownPosition.value = computeFixedDropdownPosition(
          rect,
          { width: Math.max(110, rect.width), height: menuHeight },
          { x: 0, y: 2 }
        )
      } else {
        const schemaElement = document.querySelector(`[data-node-id="${options.nodeId}"]`)
        const columnRow = schemaElement?.querySelector(`.column-row[data-column-id="${columnId}"]`)
        const typeSelector = columnRow?.querySelector('.type-capsule') as HTMLElement | null

        if (typeSelector) {
          const rect = typeSelector.getBoundingClientRect()
          dropdownPosition.value = computeFixedDropdownPosition(
            rect,
            { width: Math.max(110, rect.width), height: menuHeight },
            { x: 0, y: 2 }
          )
        } else {
          dropdownPosition.value = { top: 0, left: 0 }
        }
      }
      activeDropdown.value = columnId
    }
  }

  /**
   * 切换约束菜单
   *
   * @param columnId - 列ID
   * @param event - 鼠标事件
   */
  const toggleConstraintMenu = (columnId: string, event: MouseEvent) => {
    if (constraintMenuColumnId.value === columnId) {
      closeConstraintMenu()
    } else {
      const target = event.currentTarget as HTMLElement
      const rect = target.getBoundingClientRect()
      constraintDropdownPosition.value = computeFixedDropdownPosition(
        rect,
        { width: 160, height: 160 },
        { x: -50, y: 4 }
      )
      constraintMenuColumnId.value = columnId
    }
  }

  /**
   * 关闭约束菜单
   */
  const closeConstraintMenu = () => {
    constraintMenuColumnId.value = null
  }

  /**
   * 处理数据源信息点击
   *
   * @param event - 鼠标事件
   */
  const handleSourceInfoClick = (event: MouseEvent) => {
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    sourceDropdownPosition.value = {
      top: rect.bottom + 2,
      left: rect.left,
    }

    showSourceDropdown.value = !showSourceDropdown.value
  }

  /**
   * 关闭数据源下拉菜单
   */
  const closeSourceDropdown = () => {
    showSourceDropdown.value = false
  }

  /**
   * 获取滚动出可视区域的列
   *
   * @returns 滚动出的列数组
   */
  const getScrolledOutColumns = (): TColumn[] => {
    if (!columnsSectionRef.value) return []

    const sectionEl = columnsSectionRef.value

    // 如果高度为0（未显示或未渲染），则不认为有滚动
    if (sectionEl.clientHeight === 0) {
      return []
    }

    const viewTop = sectionEl.scrollTop
    const viewBottom = viewTop + sectionEl.clientHeight

    const columnsToCheck = options.getVisibleColumns
      ? options.getVisibleColumns(options.nodeData.columns)
      : options.nodeData.columns

    return (columnsToCheck as TColumn[]).filter((column) => {
      const row = sectionEl.querySelector(
        `.column-row[data-column-id="${column.id}"]`
      ) as HTMLElement | null
      if (!row) return false

      const rowTopInScroll = row.offsetTop
      const rowBottomInScroll = rowTopInScroll + row.offsetHeight

      return rowBottomInScroll < viewTop || rowTopInScroll > viewBottom
    })
  }

  /**
   * 按上下侧获取滚动出可视区域的列
   *
   * @returns 上下侧滚出的列
   */
  const getScrolledOutColumnsBySide = (): { top: TColumn[]; bottom: TColumn[] } => {
    if (!columnsSectionRef.value) return { top: [], bottom: [] }

    const sectionEl = columnsSectionRef.value

    // 如果高度为0（未显示或未渲染），则不认为有滚动
    if (sectionEl.clientHeight === 0) {
      return { top: [], bottom: [] }
    }

    const viewTop = sectionEl.scrollTop
    const viewBottom = viewTop + sectionEl.clientHeight
    const top: TColumn[] = []
    const bottom: TColumn[] = []

    const columnsToCheck = options.getVisibleColumns
      ? options.getVisibleColumns(options.nodeData.columns)
      : options.nodeData.columns

    for (const column of columnsToCheck as TColumn[]) {
      const row = sectionEl.querySelector(
        `.column-row[data-column-id="${column.id}"]`
      ) as HTMLElement | null
      if (!row) continue

      const rowTopInScroll = row.offsetTop
      const rowBottomInScroll = rowTopInScroll + row.offsetHeight

      if (rowBottomInScroll < viewTop) {
        top.push(column)
        continue
      }
      if (rowTopInScroll > viewBottom) {
        bottom.push(column)
      }
    }

    return { top, bottom }
  }

  /**
   * 处理列定义区域滚动事件
   * 使用requestAnimationFrame节流，避免频繁更新
   */
  const handleColumnsScroll = () => {
    if (scrollUpdateFrame === null) {
      scrollUpdateFrame = requestAnimationFrame(() => {
        updateNodeInternals([options.nodeId])
        scrollVersion.value += 1
        scrollUpdateFrame = null
      })
    }
  }

  /**
   * 检测滚动状态的函数
   */
  const checkScrollStatus = () => {
    if (!columnsSectionRef.value) {
      hasScrolledOutColumns.value = false
      return
    }

    const sectionEl = columnsSectionRef.value

    // 如果高度为0（未显示或未渲染），则不认为有滚动
    if (sectionEl.clientHeight === 0) {
      hasScrolledOutColumns.value = false
      return
    }

    if (options.getVisibleColumns) {
      const viewTop = sectionEl.scrollTop
      const viewBottom = viewTop + sectionEl.clientHeight
      let hasOut = false

      const visibleColumns = options.getVisibleColumns(options.nodeData.columns)

      for (const column of visibleColumns) {
        const row = sectionEl.querySelector(
          `.column-row[data-column-id="${column.id}"]`
        ) as HTMLElement | null
        if (!row) continue

        const rowTopInScroll = row.offsetTop
        const rowBottomInScroll = rowTopInScroll + row.offsetHeight
        if (rowBottomInScroll < viewTop || rowTopInScroll > viewBottom) {
          hasOut = true
          break
        }
      }

      hasScrolledOutColumns.value = hasOut
    } else {
      const viewTop = sectionEl.scrollTop
      const viewBottom = viewTop + sectionEl.clientHeight
      const columnRows = sectionEl.querySelectorAll('.column-row')
      let hasOut = false

      for (const row of columnRows) {
        const rowEl = row as HTMLElement
        const rowTopInScroll = rowEl.offsetTop
        const rowBottomInScroll = rowTopInScroll + rowEl.offsetHeight
        if (rowBottomInScroll < viewTop || rowTopInScroll > viewBottom) {
          hasOut = true
          break
        }
      }

      hasScrolledOutColumns.value = hasOut
    }
  }

  /**
   * 取消待处理的滚动动画帧
   */
  const cancelScrollFrame = () => {
    if (scrollUpdateFrame !== null) {
      cancelAnimationFrame(scrollUpdateFrame)
      scrollUpdateFrame = null
    }
  }

  // ============================================================================
  // 监听
  // ============================================================================

  /**
   * 监听列数据变化，更新滚动状态
   */
  watch(
    () => options.nodeData.columns.length,
    () => {
      nextTick(() => {
        options.onColumnsChange?.()
        checkScrollStatus()
      })
    }
  )

  /**
   * 监听 DOM 引用变化，更新滚动状态
   */
  watch(
    () => columnsSectionRef.value,
    () => {
      nextTick(() => {
        checkScrollStatus()
      })
    }
  )

  /**
   * 监听滚动状态变化，更新节点内部状态
   * 当虚拟锚点显示/隐藏时，通知 VueFlow 更新句柄位置
   */
  watch(
    () => hasScrolledOutColumns.value,
    (newVal, oldVal) => {
      if (newVal !== oldVal) {
        nextTick(() => {
          updateNodeInternals([options.nodeId])
        })
      }
    }
  )

  return {
    // UI 状态
    hoveredColumn,
    hoveredErrorColumn,
    activeDropdown,
    dropdownPosition,
    constraintMenuColumnId,
    constraintDropdownPosition,
    errorPopoverPosition,
    showSourceDropdown,
    sourceDropdownPosition,
    dataSourceTree,
    columnsSectionRef,

    // 常量和配置
    typeOptions: options.typeOptions,
    MAX_ERROR_DISPLAY,
    availableDataSources: dataSourceTree,

    // 计算属性
    nodeClasses,
    hasScrolledOutColumns,
    scrollVersion,

    // 工具方法
    formatValidationErrors,
    getErrorPopoverPosition,
    getTypeDisplayText: options.getTypeDisplayText,
    validateColumnName,
    getScrolledOutColumns,
    getScrolledOutColumnsBySide,

    // 菜单方法
    toggleTypeDropdown,
    toggleConstraintMenu,
    closeConstraintMenu,
    handleSourceInfoClick,
    closeSourceDropdown,
    handleColumnsScroll,
    checkScrollStatus,
    cancelScrollFrame,
  }
}
