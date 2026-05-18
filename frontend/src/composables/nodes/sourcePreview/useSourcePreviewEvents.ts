/**
 * @file useSourcePreviewEvents.ts
 * @description SourcePreview节点事件处理
 * 处理 SourcePreview 节点相关的全局事件
 * 包括表头行变更、数据变更等事件的监听和处理
 */

import { logger } from '@/core/utils/logger'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { validateConstraintNodesForSchema } from '@/services/constraints/validationRegistry'
import type { SourcePreviewNodeData, SchemaNodeData, JsonSchemaColumn } from '../types'

/**
 * SourcePreview节点事件处理
 * 管理 SourcePreview 节点的事件监听和处理逻辑
 * 包括表头行变更、数据变更等事件的处理
 *
 * @param props - 组件属性，包含节点 ID 和数据
 * @param emit - Vue 的 emit 函数，用于向上层组件通知事件
 * @returns 包含事件处理方法的对象
 */
export function useSourcePreviewEvents(
  props: { id: string; data: SourcePreviewNodeData },
  emit: (event: string, ...args: unknown[]) => void
) {
  // 国际化支持
  const { t } = useI18n()
  // 获取全局图存储，用于访问和修改节点数据
  const store = useGraphStore()

  // 标记是否是第一次触发表头变更（用于区分初始连接和用户手动修改）
  // 初始连接时不触发验证，用户手动修改时才触发
  let isFirstHeaderChange = true

  /**
   * Toast 消息提示函数
   * 在页面右上角显示临时消息，3秒后自动消失
   * 使用原生 DOM 操作创建消息提示元素
   *
   * @param message - 消息内容，要显示的文本信息
   * @param type - 消息类型，success=成功绿色，error=错误红色，info=信息蓝色
   */
  const showToastMessage = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    // 创建消息容器 DOM 元素
    const messageEl = document.createElement('div')
    messageEl.textContent = message

    // 动态创建 CSS 样式，定义消息提示的视觉效果
    const style = document.createElement('style')
    style.textContent = `
      .toast-message {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: var(--ui-radius-sm); /* was 4px */
        color: var(--ui-text-on-accent); /* was white */
        font-size: 14px;
        z-index: 10000;
        box-shadow: var(--ui-shadow-md); /* was rgba(0,0,0,0.15) */
        animation: slideIn 0.3s ease;
      }
      .toast-success { background-color: var(--ui-success); } /* was #28a745 */
      .toast-error { background-color: var(--ui-danger); } /* was #dc3545 */
      .toast-info { background-color: var(--ui-info); } /* was #17a2b8 */
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `

    // 根据消息类型设置 CSS 类名
    messageEl.className = `toast-message toast-${type}`
    // 将样式添加到 head，消息元素添加到 body
    document.head.appendChild(style)
    document.body.appendChild(messageEl)

    // 设置 3 秒定时器，到期后移除消息元素和样式，避免 DOM 泄漏
    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.remove()
        style.remove()
      }
    }, 3000)
  }

  /**
   * 处理表头行变更事件
   * 当用户修改表头行设置时调用
   * 更新节点的 headerRow 属性，并根据是否为首次变更决定是否触发验证
   *
   * @param event - 自定义事件对象，包含 nodeId、headerRow 和 data
   */
  const handleHeaderRowChanged = (event: Event) => {
    // 记录接收到事件的日志
    logger.debug('📥 SourcePreview收到headerRowChanged事件:', event)

    // 将 Event 转换为 CustomEvent 以获取 detail 数据
    const customEvent = event as CustomEvent

    // 验证事件数据是否存在
    if (!event || !customEvent.detail) {
      logger.warn('⚠️ headerRowChanged事件数据格式不正确:', event)
      return
    }

    // 解构获取事件数据
    const { nodeId, headerRow, data } = customEvent.detail

    // 验证必要参数的有效性
    if (!nodeId || typeof headerRow !== 'number' || !data) {
      logger.warn('⚠️ 表头行变更事件数据不完整:', customEvent.detail)
      return
    }

    // 记录解析后的事件数据
    logger.debug('📥 接收表头行变更事件:', { nodeId, headerRow, data })

    // 更新 SourcePreviewNode 的 headerRow
    // 在 store 的 nodes 数组中查找目标 SourcePreview 节点
    const sourcePreviewNode = store.nodes.find((n) => n.id === nodeId && n.type === 'sourcePreview')

    // 如果找到对应节点，更新其数据
    if (sourcePreviewNode) {
      store.updateNodeData(nodeId, {
        ...sourcePreviewNode.data,
        headerRow: headerRow,
      })
      logger.debug('✅ 已更新 SourcePreviewNode 的 headerRow:', headerRow)
    } else {
      logger.warn('⚠️ 未找到 SourcePreviewNode:', nodeId)
    }

    // 核心修正：只有在非第一次变更（即非初始连接）时，才更新关联的 SchemaNode
    if (!isFirstHeaderChange) {
      logger.debug('🔄 非初始连接，触发关联 SchemaNode 的自动更新')
      updateConnectedSchemaNodes(nodeId, headerRow, data)
    } else {
      logger.debug('⏭️ 初始连接触发，跳过关联 SchemaNode 更新，等待弹窗确认')
      isFirstHeaderChange = false
    }
  }

  /**
   * 更新连接到该SourcePreviewNode的所有SchemaNode
   * @param nodeId - SourcePreviewNode ID
   * headerRow - 新的表头行索引
   * @param data - 完整数据
   */
  const updateConnectedSchemaNodes = async (
    nodeId: string,
    headerRow: number,
    data: Record<string, unknown>
  ) => {
    // 调试日志：查看完整数据
    logger.debug('🔍 updateConnectedSchemaNodes 收到 data:', {
      hasSourceName: 'sourceName' in data,
      sourceName: data.sourceName,
      hasFileName: 'fileName' in data,
      fileName: data.fileName,
      hasCurrentSheet: 'currentSheet' in data,
      currentSheet: data.currentSheet,
      allKeys: Object.keys(data),
    })

    // 方式1：通过路径匹配查找SchemaNode
    const sourceFilePath = data.fileName || data.localPath
    let schemaNodes = store.nodes.filter(
      (n) =>
        n.type === 'schema' &&
        ((n.data as Record<string, unknown>)?.sourceFilePath === sourceFilePath ||
          (n.data as Record<string, unknown>)?.sourceFilePath === data.fileName ||
          (n.data as Record<string, unknown>)?.sourceFilePath === data.localPath)
    )

    // 方式2：如果路径匹配失败，通过边连接查找SchemaNode
    if (schemaNodes.length === 0) {
      logger.debug('⚠️ 路径匹配未找到SchemaNode，尝试通过边连接查找...')

      const sourceEdges = store.edges.filter(
        (e) => e.source === nodeId && e.sourceHandle?.endsWith('-output')
      )

      logger.debug(`🔍 找到 ${sourceEdges.length} 条从SourcePreviewNode出发的边`)

      if (sourceEdges.length > 0) {
        const schemaNodeIds = sourceEdges.map((e) => e.target)
        schemaNodes = store.nodes.filter((n) => schemaNodeIds.includes(n.id) && n.type === 'schema')

        logger.debug(`🎯 通过边连接找到 ${schemaNodes.length} 个SchemaNode`)
      }
    }

    if (schemaNodes.length > 0) {
      const headerRowData = data.data?.[headerRow] || []
      const tableData = data.data

      for (const schemaNode of schemaNodes) {
        // 保存旧的列ID列表
        const oldColumnIds =
          ((schemaNode.data as Record<string, unknown>)?.columns as unknown[])?.map(
            (c) => (c as Record<string, unknown>).id as string
          ) || []

        // 获取显示用的文件名（人类可读）
        const displayFileName =
          (data.sourceName as string) || (data.fileName as string) || 'Unknown'
        const displaySourcePath = (data.fileName as string) || displayFileName

        // 生成表名：优先使用当前Sheet名
        const smartTableName =
          (data.currentSheet as string) ||
          ((data.sourceName as string) || (data.fileName as string) || 'Table').replace(
            /\.[^/.]+$/,
            ''
          )

        // 调试日志：查看文件名计算过程
        logger.debug('🔍 更新SchemaNode文件名计算:', {
          'data.sourceName': data.sourceName,
          'data.fileName': data.fileName,
          'data.currentSheet': data.currentSheet,
          displayFileName: displayFileName,
          smartTableName: smartTableName,
        })

        // 更新SchemaNode的表名、源文件等信息
        const updatedSchemaData = {
          ...schemaNode.data,
          tableName: smartTableName,
          sourceFile: displayFileName, // 使用可读的文件名
          sourceFilePath: displaySourcePath, // 使用原始路径
          sourceType: data.sourceType,
          headerRow: headerRow,
          // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
          sheetName: data.currentSheet,
        }

        logger.debug('🔄 更新SchemaNode数据:', {
          nodeId: schemaNode.id,
          tableName: updatedSchemaData.tableName,
          sourceFile: updatedSchemaData.sourceFile,
          sheetName: updatedSchemaData.sheetName,
        })

        store.updateNodeData(schemaNode.id, updatedSchemaData)

        // 重新生成列定义
        if (headerRowData.length > 0) {
          generateColumnsWithTypeInference(
            headerRowData,
            schemaNode as { id: string; data: Record<string, unknown> },
            tableData as unknown[][] | undefined,
            headerRow
          )
        }

        // 检测列变化并断开无效的约束连接
        await disconnectInvalidConstraints(schemaNode.id, oldColumnIds)

        // 查找连接到该SchemaNode的所有约束节点并触发重新校验
        await triggerConstraintValidation(schemaNode.id)
        await triggerConstraintNodeValidation(schemaNode.id)
      }

      // 只有在确实更新了列定义时才显示此消息
      // showToastMessage(`已更新 ${schemaNodes.length} 个Schema节点的元数据`, 'success');
    }
  }

  /**
   * 检测列变化并断开无效的约束连接
   * 当SourcePreview数据变化导致SchemaNode的列定义变化时，
   * 已移除列的约束连接需要自动断开
   * @param schemaNodeId - SchemaNode ID
   * @param oldColumnIds - 旧的列ID列表
   */
  const disconnectInvalidConstraints = async (schemaNodeId: string, oldColumnIds: string[]) => {
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId && n.type === 'schema')
    if (!schemaNode) return

    const newColumnIds =
      ((schemaNode.data as Record<string, unknown>)?.columns as unknown[])?.map(
        (c) => (c as Record<string, unknown>).id as string
      ) || []
    const removedColumnIds = oldColumnIds.filter((id) => !newColumnIds.includes(id))

    if (removedColumnIds.length === 0) {
      return
    }

    logger.debug(`🔄 检测到列变化，移除列数: ${removedColumnIds.length}`)

    // 查找连接到已移除列的约束边
    for (const removedColumnId of removedColumnIds) {
      const connectedConstraintEdges = store.edges.filter(
        (e) => e.target === schemaNodeId && e.targetHandle === `target-${removedColumnId}`
      )

      for (const edge of connectedConstraintEdges) {
        const constraintNode = store.nodes.find((n) => n.id === edge.source)
        const constraintType =
          ((constraintNode?.data as Record<string, unknown>)?.constraintType as string) ||
          '未知约束'

        logger.debug(`  - 断开 ${constraintType} 约束: ${edge.source} (连接到已移除的列)`)
        store.deleteConnection(edge.id)
      }
    }

    // 同时清除已移除列的约束标记
    const updatedColumns =
      ((schemaNode.data as Record<string, unknown>)?.columns as unknown[])?.map((col) => {
        const colRec = col as Record<string, unknown>
        if (removedColumnIds.includes(colRec.id as string)) {
          return { ...colRec, constraints: {} } as unknown as JsonSchemaColumn
        }
        return colRec as unknown as JsonSchemaColumn
      }) || []

    if (updatedColumns.length > 0) {
      store.updateNodeData(schemaNodeId, {
        ...schemaNode.data,
        columns: updatedColumns,
      })
    }

    logger.debug(`✅ 已断开 ${removedColumnIds.length} 个已移除列的约束连接`)
  }

  /**
   * 生成列定义并推断数据类型
   * @param headerData - 表头数据
   * @param schemaNode - Schema 节点
   * @param tableData - 完整表格数据
   * @param headerRowIndex - 表头行索引
   */
  const generateColumnsWithTypeInference = (
    headerData: unknown[],
    schemaNode: { id: string; data: Record<string, unknown> },
    tableData?: unknown[][],
    headerRowIndex?: number
  ) => {
    if (!headerData || headerData.length === 0) {
      logger.warn('表头数据为空')
      return
    }

    const columns = headerData.map((header, index: number) => {
      const headerText = String(header).trim()
      const columnName = headerText || `column_${index + 1}`

      let dataType = 'String'

      if (tableData && typeof headerRowIndex === 'number') {
        if (headerRowIndex + 1 < tableData.length) {
          const sampleData = tableData[headerRowIndex + 1]
          if (sampleData && sampleData[index] !== undefined) {
            const sampleValue = String(sampleData[index]).trim()
            if (/^\d+$/.test(sampleValue)) {
              dataType = 'Integer'
            } else if (/^\d*\.\d+$/.test(sampleValue)) {
              dataType = 'Float'
            } else if (/^(true|false|是|否)$/i.test(sampleValue)) {
              dataType = 'Boolean'
            } else if (/^\d{4}-\d{2}-\d{2}/.test(sampleValue)) {
              dataType = 'Date'
            }
          }
        }
      }

      return {
        id: columnName,
        columnName: columnName,
        dataType: dataType,
        expressionType: 'none',
        constraints: {},
        validationErrors: [],
        jsonPath: '',
      } as unknown as JsonSchemaColumn
    })

    store.updateNodeData(schemaNode.id, { ...schemaNode.data, columns: columns })
  }

  /**
   * 触发连接到SchemaNode的所有约束节点的重新校验
   * @param schemaNodeId - SchemaNode ID
   */
  const triggerConstraintValidation = (schemaNodeId: string) => {
    triggerValidationForNode(
      schemaNodeId,
      store.nodes,
      store.edges,
      (nodeId: string, data: Record<string, unknown>) => store.updateNodeData(nodeId, data)
    )
  }

  const triggerConstraintNodeValidation = async (schemaNodeId: string) => {
    await validateConstraintNodesForSchema({
      schemaNodeId,
      nodes: store.nodes,
      edges: store.edges,
      updateNodeData: (nodeId: string, data: Record<string, unknown>) =>
        store.updateNodeData(nodeId, data),
    })
  }

  /**
   * 处理SourcePreviewNode数据变更事件
   * 当数据源数据变更时，更新连接的SchemaNode并重新校验非空约束
   * @param event - 自定义事件
   */
  const handleSourcePreviewDataChanged = async (event: CustomEvent) => {
    try {
      const { nodeId, data } = event.detail

      if (!nodeId || !data) {
        logger.warn('⚠️ SourcePreview数据变更事件数据不完整:', event.detail)
        return
      }

      logger.debug('📥 接收SourcePreview数据变更事件:', {
        nodeId,
        currentSheet: data.currentSheet,
        localPath: data.localPath,
      })

      // 调试日志：查看传递的数据
      logger.debug('🔍 handleSourcePreviewDataChanged 收到数据:', {
        nodeId,
        hasSourceName: 'sourceName' in data,
        sourceName: data.sourceName,
        hasFileName: 'fileName' in data,
        fileName: data.fileName,
        hasCurrentSheet: 'currentSheet' in data,
        currentSheet: data.currentSheet,
        dataKeys: Object.keys(data),
      })

      // 尝试多种路径匹配方式
      const sourceFilePath = data.fileName || data.localPath
      const fileName = data.fileName || ''

      // 方式1：通过路径匹配查找SchemaNode
      let schemaNodes = store.nodes.filter(
        (n) =>
          n.type === 'schema' &&
          ((n.data as Record<string, unknown>)?.sourceFilePath === sourceFilePath ||
            (n.data as Record<string, unknown>)?.sourceFilePath === data.fileName ||
            (n.data as Record<string, unknown>)?.sourceFilePath === data.localPath)
      )

      // 方式2：如果路径匹配失败，通过边连接查找SchemaNode
      if (schemaNodes.length === 0) {
        logger.debug('⚠️ 路径匹配未找到SchemaNode，尝试通过边连接查找...')

        const sourceEdges = store.edges.filter(
          (e) => e.source === nodeId && e.sourceHandle?.endsWith('-output')
        )

        logger.debug(`🔍 找到 ${sourceEdges.length} 条从SourcePreviewNode出发的边`)

        if (sourceEdges.length > 0) {
          const schemaNodeIds = sourceEdges.map((e) => e.target)
          schemaNodes = store.nodes.filter(
            (n) => schemaNodeIds.includes(n.id) && n.type === 'schema'
          )

          logger.debug(`🎯 通过边连接找到 ${schemaNodes.length} 个SchemaNode`)
        }
      }

      logger.debug('🔍 查找SchemaNode结果:', {
        sourceFilePath,
        foundCount: schemaNodes.length,
      })

      // 如果仍然没有找到SchemaNode，尝试基于连接关系回溯
      if (schemaNodes.length === 0) {
        logger.debug('⚠️ 未找到SchemaNode，尝试基于连接关系回溯SchemaNode...')
        const edgesFromSource = store.edges.filter((e) => e.source === nodeId)
        const connectedSchemaIds = new Set(edgesFromSource.map((e) => e.target))
        const fallbackSchemaNodes = store.nodes.filter(
          (n) => connectedSchemaIds.has(n.id) && n.type === 'schema'
        )

        if (fallbackSchemaNodes.length > 0) {
          logger.debug(`🎯 回溯找到 ${fallbackSchemaNodes.length} 个SchemaNode`)
          for (const fallbackSchema of fallbackSchemaNodes) {
            const hasColumns =
              (((fallbackSchema.data as Record<string, unknown>)?.columns || []) as unknown[])
                .length > 0
            if (!hasColumns) continue
            await triggerConstraintValidation(fallbackSchema.id)
            await triggerConstraintNodeValidation(fallbackSchema.id)
          }
        }
      } else {
        logger.debug(`🔄 更新 ${schemaNodes.length} 个SchemaNode的元数据`)

        for (const schemaNode of schemaNodes) {
          // 使用 sourceName 作为首选的文件名（人类可读）
          const displayFileName = data.sourceName || data.fileName || 'Unknown'
          const displaySourcePath = data.fileName || displayFileName

          // 生成表名：优先使用当前Sheet名，然后是文件名（不含扩展名）
          const smartTableName =
            data.currentSheet ||
            (data.sourceName || data.fileName || 'Table').replace(/\.[^/.]+$/, '')

          // 检查是否已有列定义
          const existingColumns = ((schemaNode.data as Record<string, unknown>)?.columns ||
            []) as unknown[]
          const hasExistingColumns = existingColumns.length > 0

          logger.debug(`🔍 [handleSourcePreviewDataChanged] 检查节点 ${schemaNode.id}:`, {
            hasExistingColumns,
            columnsCount: existingColumns.length,
          })

          // 只更新元数据（表名、来源等），不自动生成列定义
          // 列定义的生成需要用户通过弹窗确认
          const updatedSchemaData = {
            ...schemaNode.data,
            tableName: smartTableName,
            sourceFile: displayFileName,
            sourceFilePath: displaySourcePath,
            sourceType: data.sourceType,
            headerRow: data.headerRow || 0,
            // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
            sheetName: data.currentSheet,
          }

          store.updateNodeData(schemaNode.id, updatedSchemaData)

          logger.debug(`✅ 已更新SchemaNode元数据: ${displayFileName} -> ${smartTableName}`)

          // 只有在已经存在列定义的情况下才触发校验
          if (hasExistingColumns) {
            await triggerConstraintValidation(schemaNode.id)
            await triggerConstraintNodeValidation(schemaNode.id)
          } else {
            logger.debug('⏭️ [handleSourcePreviewDataChanged] 列定义为空，跳过校验触发')
          }
        }

        showToastMessage(`已更新 ${schemaNodes.length} 个Schema节点`, 'success')
      }

      logger.debug('✅ SourcePreview数据变更处理完成')
    } catch (error) {
      logger.error('处理SourcePreview数据变更失败:', error)
    }
  }

  return {
    handleHeaderRowChanged,
    handleSourcePreviewDataChanged,
    generateColumnsWithTypeInference,
    showToastMessage,
  }
}
