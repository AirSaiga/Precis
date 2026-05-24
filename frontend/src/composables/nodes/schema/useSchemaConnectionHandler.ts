/**
 * @file useSchemaConnectionHandler.ts
 * @description Schema 节点连接事件处理器
 *
 * 功能概述：
 * - 处理 SourcePreview 到 Schema 节点的连接事件
 * - 同步数据源元数据并断开旧连接
 * - 触发智能列填充询问与自动生成列定义
 * - 管理虚拟锚点边的同步与滚动状态监听
 */

import { logger } from '@/core/utils/logger'
import { watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import type { Node, Edge, Connection } from '@vue-flow/core'
import type { SchemaColumn } from '@/types/graph'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { useToast } from '@/composables/shared/useToast'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { revalidateConstraintsReferencingSchema } from '@/services/constraints/validationRegistryCore'

/**
 * Schema 节点连接事件处理器
 * 专门处理 SourcePreview（数据源预览）→ Schema（表）节点的全局连接事件
 * 负责响应连线动作，处理数据同步和智能填充等功能
 */
export function useSchemaConnectionHandler() {
  // 国际化支持
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const toast = useToast()
  const success = toast.success
  const showError = toast.error
  const info = toast.info

  // 从 VueFlow 获取边的操作方法
  // getConnectedEdges: 获取连接指定节点的边
  // findNode: 根据 ID 查找节点
  // removeEdges: 移除边
  // addEdges: 添加边
  const { getConnectedEdges, findNode, removeEdges, addEdges, updateNodeInternals } = useVueFlow()
  // 获取全局图存储，用于访问和修改节点/边数据
  const store = useGraphStore()

  // 处理 SourcePreview 节点到 Schema 节点的连接
  // 这是数据源与表建立关联的核心方法
  //
  // 处理流程详细说明：
  // 1. 【断开旧连接】一个 Schema 只能连接一个数据源，如果之前连接了其他源，必须先断开。
  // 2. 【更新元数据】将数据源的文件名、路径、Sheet名等信息同步到 Schema 节点上。
  // 3. 【状态反馈】显示 Toast 提示连接成功，并在源节点上标记"已连接"。
  // 4. 【智能填充】延迟触发对话框，询问用户是否自动生成列定义。
  //
  // 注意：由于预览文件现在存储在 IndexedDB 中，filePath 存储的是 fileId 而非文件路径
  // @param sourcePreviewNodeId - 数据源预览节点 ID
  // @param schemaNodeId - Schema 节点 ID
  const handleSourceToSchemaConnection = async (
    sourcePreviewNodeId: string,
    schemaNodeId: string
  ) => {
    const sourcePreviewNode = store.nodes.find((n) => n.id === sourcePreviewNodeId)
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!sourcePreviewNode || !schemaNode) return

    try {
      // 记录方法开始执行的日志
      logger.debug('🔌 [handleSourceToSchemaConnection] 开始处理连接')
      // 输出当前 Schema 节点的列定义数量，用于调试
      logger.debug(
        '  - schemaNode 当前列定义数量:',
        ((schemaNode?.data as Record<string, unknown>)?.columns as unknown[])?.length || 0
      )
      logger.debug(
        '  - schemaNode 当前列定义:',
        (schemaNode?.data as Record<string, unknown>)?.columns
      )

      // ========== 步骤 0：检查是否需要断开旧的数据源连接 ==========
      // 一个 SchemaNode 只能连接一个 SourcePreviewNode，如果已有连接则需要断开

      // 从源节点中提取数据源数据
      const sourceData = sourcePreviewNode.data as Record<string, unknown>

      // 查找目标 SchemaNode 是否已有来自其他 SourcePreviewNode 的连接
      const existingEdges = store.edges.filter(
        (edge) =>
          edge.target === schemaNodeId &&
          edge.source !== sourcePreviewNodeId &&
          store.nodes.find((n) => n.id === edge.source)?.type === 'sourcePreview'
      )

      // 如果存在旧连接，需要先断开
      if (existingEdges.length > 0) {
        logger.debug(`🔄 断开目标SchemaNode的旧数据源连接，数量: ${existingEdges.length}`)

        // 遍历所有旧连接并删除
        for (const edge of existingEdges) {
          // 查找旧的源节点用于日志显示
          const oldSourceNode = store.nodes.find((n) => n.id === edge.source)
          if (oldSourceNode) {
            logger.debug(
              `  - 断开与 "${(oldSourceNode.data as Record<string, unknown>)?.sourceName || (oldSourceNode.data as Record<string, unknown>)?.fileName || oldSourceNode.id}" 的连接`
            )
          }
          // 使用 VueFlow 的 removeEdges 方法从视图中删除边
          removeEdges(edge.id)
          // 同时更新 store 中的 edges 数据
          store.deleteConnection(edge.id)
        }

        // 显示提示消息，告知用户已断开旧连接
        const displayFileName =
          (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'
        info(t('canvas.nodeCanvas.disconnectedOldSource', { sourceName: displayFileName }))
      }

      // ========== 步骤 1：更新 SchemaNode 的数据源信息 ==========
      // 记录更新前的列定义数量
      logger.debug('🔌 [handleSourceToSchemaConnection] 准备更新 SchemaNode 数据')
      logger.debug(
        '  - 更新前列定义数量:',
        ((schemaNode?.data as Record<string, unknown>)?.columns as unknown[])?.length || 0
      )

      // 获取显示用的文件名（人类可读的名称）
      const displayFileName =
        (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'

      // 生成表名
      const smartTableName =
        (sourceData.currentSheet as string) ||
        ((sourceData.sourceName as string) || (sourceData.fileName as string) || 'Table').replace(
          /\.[^/.]+$/,
          ''
        )

      // 来源路径
      const displaySourcePath = (sourceData.fileName as string) || displayFileName

      // 构建要更新的 Schema 节点数据对象
      const updatedSchemaData = {
        ...schemaNode.data,
        tableName: smartTableName,
        sourceFile: displayFileName,
        sourceFilePath: displaySourcePath,
        sourceType: sourceData.sourceType,
        headerRow: (sourceData.headerRow as number) || 0,
        sheetName:
          (sourceData.currentSheet as string) ||
          (sourceData.sourceName as string) ||
          (sourceData.fileName as string),
        sourceNodeId: sourcePreviewNodeId,
        sourceMode: sourceData.sourceMode,
        localPath: sourceData.localPath,
      }

      // 调用 store 方法更新节点数据
      store.updateNodeData(schemaNodeId, updatedSchemaData)

      // 记录更新完成日志
      logger.debug('🔌 [handleSourceToSchemaConnection] 已更新 SchemaNode 元数据')
      const currentColumns =
        ((schemaNode?.data as Record<string, unknown>)?.columns as unknown[]) || []
      logger.debug('  - 当前列定义数量:', currentColumns.length)

      // ========== 步骤 2：显示成功提示 ==========
      const schemaName = smartTableName
      success(
        t('canvas.nodeCanvas.connectionSuccess', {
          source: displayFileName,
          target: schemaName,
        })
      )

      // ========== 步骤 3：标记连接状态 ==========
      // 标记源节点的输出端口已连接
      store.updateNodeData(sourcePreviewNodeId, {
        ...sourceData,
        outputPortConnected: true,
      })

      logger.debug('🔌 [handleSourceToSchemaConnection] 连接处理完成，准备弹出确认对话框')

      // ========== 步骤 4：触发智能填充逻辑询问 ==========
      const schemaNodeIdForDialog = schemaNodeId
      const sourceNodeIdForDialog = sourcePreviewNodeId

      // 使用 nextTick 确保 Vue 响应式更新完成后再弹出对话框
      await nextTick()
      // 重新从 store 获取最新的节点数据
      const latestSchemaNode = store.nodes.find((n) => n.id === schemaNodeIdForDialog)
      const latestSourceNode = store.nodes.find((n) => n.id === sourceNodeIdForDialog)

      if (latestSchemaNode && latestSourceNode) {
        // 创建数据快照
        const sourceDataSnapshot = JSON.parse(JSON.stringify(latestSourceNode.data)) as Record<
          string,
          unknown
        >
        const schemaDataSnapshot = JSON.parse(JSON.stringify(latestSchemaNode.data)) as Record<
          string,
          unknown
        >

        // 调用对话框显示方法
        await showSmartFillDialog(
          { id: sourceNodeIdForDialog, data: sourceDataSnapshot },
          { id: schemaNodeIdForDialog, data: schemaDataSnapshot }
        )
        const currentSchemaNode = store.nodes.find((n) => n.id === schemaNodeIdForDialog)
        const hasColumns =
          (((currentSchemaNode?.data as Record<string, unknown>)?.columns as unknown[])?.length ||
            0) > 0
        if (currentSchemaNode && hasColumns) {
          triggerValidationForNode(
            schemaNodeIdForDialog,
            store.nodes,
            store.edges,
            (nodeId: string, data: Record<string, unknown>) => store.updateNodeData(nodeId, data)
          )
        }

        // 重新触发引用本 Schema 为目标的约束验证
        // 通用机制：任何约束类型只要注册了 targetRefResolver，都会自动被触发
        await revalidateConstraintsReferencingSchema({
          schemaNodeId: schemaNodeIdForDialog,
          nodes: store.nodes,
          edges: store.edges,
          updateNodeData: (nodeId: string, data: Record<string, unknown>) =>
            store.updateNodeData(nodeId, data),
        })
        document.dispatchEvent(
          new CustomEvent('sourcePreviewDataChanged', {
            detail: {
              nodeId: sourceNodeIdForDialog,
              data: latestSourceNode.data,
            },
          })
        )
      }
    } catch (error) {
      // 捕获并记录错误，显示失败提示
      logger.error('处理 SourcePreview 到 Schema 连线失败:', error)
      showError(t('canvas.nodeCanvas.connectionFailed'))
    }
  }

  /**
   * 显示智能填充询问对话框
   * 询问用户是否要根据数据源自动生成列定义
   * 使用同步的 confirm 对话框，确保用户必须明确选择后才会执行列生成
   *
   * 设计考量：使用同步对话框可以避免异步代码执行顺序问题
   * 同时让用户对列生成操作有完全的控制权
   * @param source - 数据源节点，格式为 { id: string; data: any }
   * @param schema - Schema 节点，格式为 { id: string; data: any }
   */
  const showSmartFillDialog = async (
    source: { id: string; data: Record<string, unknown> } | Record<string, unknown>,
    schema?: { id: string; data: Record<string, unknown> } | Record<string, unknown>
  ) => {
    // 兼容性处理：支持旧格式（完整节点对象）
    const sourceData = ('data' in source ? source.data : source) as Record<string, unknown>
    const schemaData = (schema && 'data' in schema ? schema.data : schema) as Record<
      string,
      unknown
    >

    // 从节点数据中提取显示名称，用于对话框展示
    const sourceName =
      (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'
    const schemaName = (schemaData.tableName as string) || 'Schema'
    const currentColumnsCount =
      ((schemaData as Record<string, unknown>).columns as unknown[])?.length || 0

    // 记录对话框即将弹出的日志
    logger.debug('🎯 [showSmartFillDialog] 弹出确认对话框')
    logger.debug('  - 数据源:', sourceName)
    logger.debug('  - 目标Schema:', schemaName)
    logger.debug('  - 当前已有列数量:', currentColumnsCount)

    // 使用全局确认对话框（异步）
    const userConfirmed = await showConfirm({
      title: t('canvas.nodeCanvas.smartFill.title'),
      message: t('canvas.nodeCanvas.smartFill.message', {
        sourceName,
        schemaName,
        currentColumnsCount,
      }),
      confirmText: t('canvas.nodeCanvas.smartFill.confirm'),
      cancelText: t('common.cancel'),
    })

    // 记录用户的选择结果
    logger.debug('🎯 [showSmartFillDialog] 用户选择:', userConfirmed ? '✅ 确认生成' : '❌ 取消')

    if (userConfirmed) {
      // 只有在用户明确点击"确定"后，才执行列生成
      logger.debug('🎯 [showSmartFillDialog] 开始生成列定义...')
      generateColumnsFromDataSource(
        source as unknown as { id: string; data: Record<string, unknown> },
        schema as unknown as { id: string; data: Record<string, unknown> }
      )
    } else {
      logger.debug('🎯 [showSmartFillDialog] 用户取消，保持现有列定义')
      // 检查列名匹配情况，如果缺失列则发出警告
      checkColumnMismatch(
        source as unknown as { data: Record<string, unknown> },
        schema as unknown as { data: Record<string, unknown> }
      )
    }
  }

  /**
   * 检查数据源列名与 Schema 定义是否匹配
   * 如果 Schema 中定义的列在数据源中不存在，弹出警告提示
   * @param sourcePreviewNode - 数据源预览节点
   * @param schemaNode - Schema 节点
   */
  const checkColumnMismatch = async (
    sourcePreviewNode: { data: Record<string, unknown> },
    schemaNode: { data: Record<string, unknown> }
  ) => {
    const sourceData = sourcePreviewNode.data
    const tableData = sourceData.data as unknown[][]
    if (!tableData || tableData.length === 0) return

    const headerRowIndex = (sourceData.headerRow as number) ?? 0
    const headerRow = tableData[headerRowIndex]
    if (!headerRow) return

    // 获取源数据列名（转为字符串并去除空白）
    const sourceColumns = (headerRow as unknown[]).map((h) => String(h).trim())
    // 获取 Schema 现有列名
    const schemaColumns = (schemaNode.data as Record<string, unknown>).columns || []

    if ((schemaColumns as unknown[]).length === 0) return

    // 找出缺失的列
    const missingColumns = (schemaColumns as unknown[])
      .map((c) => (c as Record<string, unknown>).columnName as string)
      .filter((name) => !sourceColumns.includes(name))

    if (missingColumns.length > 0) {
      const missingCount = missingColumns.length
      const previewMissing = missingColumns.slice(0, 5).join(', ')
      const suffix = missingColumns.length > 5 ? '...' : ''

      logger.warn(`⚠️ 列不匹配警告: 缺少 ${missingCount} 列`, missingColumns)

      await showConfirm({
        title: t('canvas.nodeCanvas.columnMismatch.title'),
        message: t('canvas.nodeCanvas.columnMismatch.message', {
          schemaCount: (schemaColumns as unknown[]).length,
          missingCount: missingCount,
          missingColumns: `${previewMissing}${suffix}`,
        }),
        confirmText: t('canvas.nodeCanvas.columnMismatch.confirm'),
        cancelText: t('common.cancel'),
      })
    }
  }

  /**
   * 从数据源自动生成列定义
   *
   * 核心功能：
   * 1. 【表头读取】读取数据源的第一行（或指定行）作为列名
   * 2. 【类型推断】分析数据样例，自动识别 Integer/Float/Date/Boolean/String
   * 3. 【约束保留】如果新列名与旧列名一致，自动继承旧列的约束配置（如非空、唯一性等）
   * 4. 【连接迁移】如果列ID发生变化，自动更新连接到这些列的 Edge，保持连线不丢失
   *
   * @param sourcePreviewNode - 数据源预览节点
   * @param schemaNode - Schema 节点
   */
  const generateColumnsFromDataSource = (
    sourcePreviewNode: { id: string; data: Record<string, unknown> },
    schemaNode: { id: string; data: Record<string, unknown> }
  ) => {
    try {
      // 记录开始生成列定义的日志
      logger.debug('🎯 [generateColumnsFromDataSource] 开始生成列定义！')
      logger.debug('  - sourceNodeId:', sourcePreviewNode.id)
      logger.debug('  - schemaNodeId:', schemaNode.id)
      logger.debug(
        '  - 生成前列定义数量:',
        ((schemaNode.data as Record<string, unknown>)?.columns as unknown[])?.length || 0
      )

      // 从源节点提取数据
      const sourceData = sourcePreviewNode.data
      const tableData = sourceData.data as unknown[][]

      // 检查数据是否存在
      if (!tableData || tableData.length === 0) {
        showError('数据源为空，无法生成列定义')
        return
      }

      // ========== 准备阶段：保存旧状态 ==========
      // 保存原有列数据和约束连接
      const originalColumns =
        ((schemaNode.data as Record<string, unknown>).columns as unknown[]) || []

      // 获取与当前 Schema 节点相关的所有约束连接
      const relatedEdges = getConnectedEdges([schemaNode as unknown as Node])

      // 获取表头行数据
      const headerRowIndex = (sourceData.headerRow as number) ?? 0
      const headerRow = tableData[headerRowIndex]

      if (!headerRow) {
        showError('表头行数据不存在，无法生成列定义')
        return
      }

      logger.debug('📊 表头数据:', headerRow)
      logger.debug('📈 样例数据行:', tableData[(headerRowIndex as number) + 1])

      // 获取样本数据行（下一行）
      const sampleDataRow =
        (headerRowIndex as number) + 1 < tableData.length
          ? tableData[(headerRowIndex as number) + 1]
          : undefined

      // 调用统一的列生成工具
      // 这里会智能处理：
      // 1. 保留现有列的 ID 和约束（如果列名匹配）
      // 2. 移除默认的未修改 column_1
      // 3. 保留用户添加的额外列（计算列等）
      // 4. forceReinferTypes: true 表示强制重新推断所有列的类型
      const columns = generateColumnsFromSource(headerRow, originalColumns, sampleDataRow, {
        forceReinferTypes: true,
      })

      logger.debug('生成的列定义:', columns)

      // ========== 应用阶段：更新 Store ==========
      // 更新 Schema 节点的列数据
      const updatedSchemaData = {
        ...schemaNode.data,
        columns: columns,
      }

      logger.debug('更新 Schema 节点数据:', updatedSchemaData)

      store.updateNodeData(schemaNode.id, updatedSchemaData)

      success(`成功生成 ${columns.length} 个列定义！`)
    } catch (error) {
      logger.error('自动生成列定义失败:', error)
      showError('自动生成列定义失败，请手动配置')
    }
  }

  const VIRTUAL_ANCHOR_TOP_ID = 'virtual-anchor-top'
  const VIRTUAL_ANCHOR_BOTTOM_ID = 'virtual-anchor-bottom'

  const syncVirtualAnchorEdges = (
    nodeId: string,
    scrolledOutBySide: { top: SchemaColumn[]; bottom: SchemaColumn[] }
  ) => {
    const topSet = new Set((scrolledOutBySide.top || []).map((c) => c.id))
    const bottomSet = new Set((scrolledOutBySide.bottom || []).map((c) => c.id))

    const currentEdges = (store.edges || []) as Edge[]

    const isProxyEdge = (edge: Edge) =>
      (edge?.data as Record<string, unknown>)?.virtualAnchorProxy === true
    const isSemanticEdge = (edge: Edge) => {
      if (!edge) return false
      if (edge.source !== nodeId) return false
      if (typeof edge.sourceHandle !== 'string') return false
      if (!edge.sourceHandle.startsWith('source-right-')) return false
      if (isProxyEdge(edge)) return false
      return true
    }

    const proxyIdTop = (semanticEdgeId: string) => `${semanticEdgeId}__vaTop`
    const proxyIdBottom = (semanticEdgeId: string) => `${semanticEdgeId}__vaBottom`

    const proxyMap = new Map<string, Edge>()
    const baseEdges: Edge[] = []
    let didChange = false

    for (const edge of currentEdges) {
      if (isProxyEdge(edge) && edge.source === nodeId) {
        const originalId = edge?.data?.virtualOf
        const side = edge?.data?.side
        if (typeof originalId === 'string' && (side === 'top' || side === 'bottom')) {
          proxyMap.set(`${originalId}:${side}`, edge)
        } else {
          didChange = true
        }
        continue
      }
      baseEdges.push(edge)
    }

    const semanticEdges = baseEdges.filter(isSemanticEdge)
    if (semanticEdges.length === 0 && proxyMap.size === 0) return

    const applyHiddenToSemantic = (edge: Edge, hidden: boolean) => {
      const currentlyHidden = edge?.data?.hiddenByVirtualAnchorProxy === true
      if (hidden && !currentlyHidden) {
        didChange = true
        const prevOpacity = ((edge.style || {}) as Record<string, unknown>)?.opacity
        const prevPointerEvents = ((edge.style || {}) as Record<string, unknown>)?.pointerEvents
        return {
          ...edge,
          hidden: true,
          style: { ...(edge.style || {}), opacity: 0, pointerEvents: 'none' },
          data: {
            ...(edge.data || {}),
            hiddenByVirtualAnchorProxy: true,
            virtualAnchorPrevStyle: { opacity: prevOpacity, pointerEvents: prevPointerEvents },
          },
        } as unknown as Edge
      }
      if (!hidden && currentlyHidden) {
        didChange = true
        const prev = edge.data?.virtualAnchorPrevStyle || {}
        const restoredStyle = { ...((edge.style || {}) as Record<string, unknown>) }
        if (prev.opacity === undefined) delete restoredStyle.opacity
        else restoredStyle.opacity = prev.opacity
        if (prev.pointerEvents === undefined) delete restoredStyle.pointerEvents
        else restoredStyle.pointerEvents = prev.pointerEvents
        const { hiddenByVirtualAnchorProxy, virtualAnchorPrevStyle, ...restData } = (edge.data ||
          {}) as Record<string, unknown>
        return {
          ...edge,
          hidden: false,
          style: restoredStyle as unknown as Edge['style'],
          data: restData,
        }
      }
      if (hidden && edge.hidden !== true) {
        didChange = true
        return { ...edge, hidden: true } as unknown as Edge
      }
      if (!hidden && edge.hidden === true && !currentlyHidden) {
        didChange = true
        return { ...edge, hidden: false } as unknown as Edge
      }
      return edge
    }

    const getVisibleStyleFromSemanticEdge = (edge: Edge) => {
      const prev = edge?.data?.virtualAnchorPrevStyle || {}
      const style = { ...((edge?.style || {}) as Record<string, unknown>) }
      if (prev.opacity === undefined) delete style.opacity
      else style.opacity = prev.opacity
      if (prev.pointerEvents === undefined) delete style.pointerEvents
      else style.pointerEvents = prev.pointerEvents
      return style as unknown as Edge['style']
    }

    const buildOrUpdateProxy = (semanticEdge: Edge, side: 'top' | 'bottom', hidden: boolean) => {
      const key = `${semanticEdge.id}:${side}`
      const existing = proxyMap.get(key)
      const id = side === 'top' ? proxyIdTop(semanticEdge.id) : proxyIdBottom(semanticEdge.id)
      const anchorId = side === 'top' ? VIRTUAL_ANCHOR_TOP_ID : VIRTUAL_ANCHOR_BOTTOM_ID
      const style = getVisibleStyleFromSemanticEdge(semanticEdge)

      const base = {
        ...semanticEdge,
        id,
        sourceHandle: anchorId,
        hidden,
        style,
        data: {
          ...(semanticEdge.data || {}),
          transient: true,
          virtualAnchorProxy: true,
          virtualOf: semanticEdge.id,
          side,
          originalSourceHandle: semanticEdge.sourceHandle,
        },
      }

      if (!existing) {
        didChange = true
        proxyMap.set(key, base as unknown as Edge)
        return
      }

      const needsReplace =
        existing.id !== id ||
        existing.sourceHandle !== anchorId ||
        existing.hidden !== hidden ||
        existing.target !== semanticEdge.target ||
        existing.targetHandle !== semanticEdge.targetHandle ||
        existing.type !== semanticEdge.type

      if (needsReplace) {
        didChange = true
        proxyMap.set(key, { ...existing, ...base } as unknown as Edge)
        return
      }

      proxyMap.set(key, existing)
    }

    const nextBaseEdges = baseEdges.map((edge) => {
      if (!isSemanticEdge(edge)) return edge
      const columnId = edge.sourceHandle.replace('source-right-', '')
      const shouldTop = topSet.has(columnId)
      const shouldBottom = bottomSet.has(columnId)
      const hideSemantic = shouldTop || shouldBottom

      buildOrUpdateProxy(edge, 'top', !shouldTop)
      buildOrUpdateProxy(edge, 'bottom', !shouldBottom)

      return applyHiddenToSemantic(edge, hideSemantic)
    })

    const semanticEdgeIdSet = new Set(semanticEdges.map((e) => e.id))
    for (const [key, proxy] of proxyMap.entries()) {
      const originalId = key.split(':')[0]
      if (!semanticEdgeIdSet.has(originalId)) {
        proxyMap.delete(key)
        didChange = true
      } else if (
        proxy &&
        (proxy.id.endsWith('__virtualAnchorProxy') || proxy.id.includes('__virtualAnchorProxy'))
      ) {
        proxyMap.delete(key)
        didChange = true
      }
    }

    const rebuilt: Edge[] = []
    for (const edge of nextBaseEdges) {
      rebuilt.push(edge)
    }
    for (const proxy of proxyMap.values()) {
      rebuilt.push(proxy)
    }

    if (!didChange) return
    store.edges = rebuilt
  }

  /**
   * 监听滚动状态变化，管理虚拟锚点的边
   * @param nodeId - Schema节点ID
   * @param hasScrolledOut - 是否有列滚动出面板
   * @param getScrolledOutColumns - 获取滚动出列的函数
   */
  const watchVirtualAnchorState = (
    nodeId: string,
    hasScrolledOut: () => boolean,
    getScrolledOutColumnsBySide: () => { top: SchemaColumn[]; bottom: SchemaColumn[] },
    getScrollVersion?: () => number
  ) => {
    const getSemanticSignature = () => {
      const edges = (store.edges || []) as Edge[]
      return edges
        .filter(
          (e) =>
            e.source === nodeId &&
            typeof e.sourceHandle === 'string' &&
            e.sourceHandle.startsWith('source-right-')
        )
        .map((e) => `${e.id}:${e.sourceHandle}:${e.target}:${e.targetHandle || ''}`)
        .join('|')
    }

    watch(
      [hasScrolledOut, () => (getScrollVersion ? getScrollVersion() : 0), getSemanticSignature],
      async ([hasOut]) => {
        await nextTick()
        const bySide = hasOut ? getScrolledOutColumnsBySide() : { top: [], bottom: [] }
        syncVirtualAnchorEdges(nodeId, bySide)
        updateNodeInternals([nodeId])
      },
      { immediate: true }
    )
  }

  return {
    handleSourceToSchemaConnection,
    showSmartFillDialog,
    generateColumnsFromDataSource,
    syncVirtualAnchorEdges,
    watchVirtualAnchorState,
  }
}
