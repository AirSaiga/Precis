/**
 * @file useSchemaDataSource.ts
 * @description Schema 节点外部数据源连接 + 智能填充入口
 *
 * 从 SchemaNode.vue 提取的两段业务逻辑：
 * - connectToDataSource：用户从数据源 dropdown 选择 → 创建 sourcePreview 节点 → 建边 → 委托 handleSourceConnection
 * - handleSmartFillClick：智能填充按钮 → 查找已连接 source → showSmartFillDialog + 全表校验
 *
 * 设计说明：
 * connectToDataSource 原来在组件内重复实现了断旧连/提元数据/触发 smartFill，
 * 这些已被 useNodeSourceManager.handleSourceConnection 实现。
 * 本 composable 只保留 connectToDataSource 独有的"创建节点 + 建边 + Excel sheets"部分，
 * 其余委托 handleSourceConnection，消除重复。
 */

import { type Ref } from 'vue'

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useI18n } from 'vue-i18n'
import { addEdges, updateNodeInternals } from '@/services/canvas/vueFlowApi'
import { usePreviewCreation } from '@/composables/nodes/sourcePreview/usePreviewCreation'
import type { FilePreviewResult } from '@/composables/nodes/sourcePreview/usePreviewCreation'
import type { SchemaNodeData } from '@/types/graph'
import type { CustomNode } from '@/types/nodes'
import type { ExternalDataSource, SourceMode } from '@/types/datasource'

export interface UseSchemaDataSourceOptions {
  /** 组件持有的 localData ref */
  localData: Ref<SchemaNodeData>
  /** 来自 useNodeSourceManager 的智能列生成函数 */
  autoGenerateColumns: (sourceNode: CustomNode) => void
  /** 来自 useNodeSourceManager 的 handleSourceConnection（断旧连 + 提元数据 + 触发 smartFill） */
  handleSourceConnection: (sourceNodeId: string) => void
  /** 来自 useNodeSourceManager 的 showSmartFillDialog */
  showSmartFillDialog: (sourceNode: CustomNode) => Promise<void>
  /** 来自 useSchemaValidation 的全表校验 */
  handleValidate: () => Promise<void> | void
  /** 来自 useSchemaUI 的关闭 dropdown */
  closeSourceDropdown: () => void
}

/**
 * Schema 节点数据源连接 composable
 *
 * 提取自 SchemaNode.vue 的 connectToDataSource + handleSmartFillClick。
 * 内部委托 handleSourceConnection 复用已有基础设施，消除重复代码。
 */
export function useSchemaDataSource(
  props: { id: string; data: SchemaNodeData },
  options: UseSchemaDataSourceOptions
) {
  const store = useGraphStore()
  const { showConfirm } = useGlobalConfirm()
  const { t } = useI18n()
  const { createSourcePreviewNode, fetchPreviewData } = usePreviewCreation()

  // ============================================================================
  // connectToDataSource：外部数据源 dropdown 选择 → 创建节点 → 建边 → 委托连接
  // ============================================================================

  const connectToDataSource = async (dataSource: ExternalDataSource) => {
    logger.debug('🔄 [connectToDataSource] 开始切换数据源:', dataSource.name)

    try {
      // 1. 创建新的 source 预览节点
      const schemaNode = store.nodes.find((n) => n.id === props.id)
      if (!schemaNode) {
        logger.error('❌ 未找到 Schema 节点')
        return
      }

      // 计算新 source 节点的位置（放在 schema 节点左侧）
      const sourceNodePosition = {
        x: schemaNode.position.x - 450,
        y: schemaNode.position.y,
      }

      // 构建 meta 数据
      const meta = {
        fileId: dataSource.fileId,
        fileName: dataSource.name,
        name: dataSource.name,
        fileType: dataSource.type,
        sourceType: dataSource.type,
        sourceName: dataSource.name,
        sourceMode: (dataSource.sourceMode as SourceMode) || 'localfile',
        localPath: dataSource.localPath,
      }

      logger.debug('  - 创建新 source 节点:', meta)
      const newNode = await createSourcePreviewNode(meta, sourceNodePosition)

      if (!newNode) {
        logger.error('❌ 创建 source 节点失败')
        return
      }

      const sourceNodeId = newNode.id
      logger.debug('  - 新 source 节点 ID:', sourceNodeId)

      // 2. 如果是 Excel 文件，获取预览数据并解析 sheets
      let currentSheet: string | undefined = undefined
      const schemaData = schemaNode.data as SchemaNodeData
      const preferredSheet = schemaData.sheetName

      if (dataSource.type === 'excel') {
        try {
          const previewData: FilePreviewResult | null = await fetchPreviewData(
            dataSource.fileId,
            65535,
            65535,
            (dataSource.sourceMode as SourceMode) || 'localfile',
            preferredSheet
          )

          if (previewData?.sheets && previewData.sheets.length > 0) {
            currentSheet = previewData.currentSheet || previewData.sheets[0]
            logger.debug('  - Excel 文件，使用 sheet:', currentSheet, '配置偏好:', preferredSheet)
          }
        } catch (error) {
          logger.warn('⚠️ 获取 Excel sheets 失败:', error)
        }
      }

      // 3. 创建 schema 节点到新 source 节点的连接边
      // 使用 setTimeout 确保 DOM 更新，等待节点完全挂载（SourcePreviewNode 可能含大量数据）
      setTimeout(() => {
        try {
          const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
          if (!sourceNode) {
            logger.warn('⚠️ 尝试连接时未找到 Source 节点:', sourceNodeId)
          }

          const newEdge = {
            id: `edge-${Date.now()}`,
            source: sourceNodeId,
            target: props.id,
            sourceHandle: `${sourceNodeId}-output`,
            targetHandle: 'target-left',
            type: 'smoothstep',
            animated: true,
            style: { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 },
            label: 'Data Source',
          }

          addEdges([newEdge])
          logger.debug('✅ 创建边连接成功:', {
            source: sourceNodeId,
            target: props.id,
            edgeId: newEdge.id,
            sourceHandle: newEdge.sourceHandle,
          })

          // 强制刷新节点状态
          updateNodeInternals([sourceNodeId, props.id])
        } catch (err) {
          logger.error('❌ 创建边连接失败:', err)
        }
      }, 1000)

      // 4. 更新 Schema 节点数据（localData + store）
      const smartTableName = currentSheet || dataSource.name.replace(/\.[^/.]+$/, '')

      options.localData.value = {
        ...options.localData.value,
        sourceFile: dataSource.name,
        sourceFilePath: dataSource.name,
        sheetName: currentSheet,
        sourceType: dataSource.type,
        sourceNodeId: sourceNodeId,
        tableName: smartTableName,
        saveState: 'draft' as const,
        updatedAt: new Date().toISOString(),
      }

      store.updateNodeData(props.id, options.localData.value)

      // 5. 委托 handleSourceConnection 完成断旧连 + 提元数据 + 触发 smartFill
      // 过去这些逻辑在组件内重复实现，现在复用 useNodeSourceManager 的基础设施
      setTimeout(() => {
        options.handleSourceConnection(sourceNodeId)
      }, 100)

      logger.debug('✅ [connectToDataSource] 数据源切换完成')
    } catch (error) {
      logger.error('❌ [connectToDataSource] 切换数据源失败:', error)
    }

    options.closeSourceDropdown()
  }

  // ============================================================================
  // handleSmartFillClick：智能填充按钮入口
  // ============================================================================

  const handleSmartFillClick = async () => {
    const schemaData = props.data as SchemaNodeData

    let sourceNode: ReturnType<typeof store.nodes.find> | null = null

    // 优先通过 sourceNodeId 查找
    if (schemaData.sourceNodeId) {
      sourceNode =
        store.nodes.find((n) => n.id === schemaData.sourceNodeId && n.type === 'sourcePreview') ??
        null
    }

    // 回退：通过边查找已连接的 sourcePreview 节点
    if (!sourceNode) {
      const edge = store.edges.find(
        (e) =>
          e.target === props.id &&
          store.nodes.find((n) => n.id === e.source)?.type === 'sourcePreview'
      )

      if (edge) {
        sourceNode = store.nodes.find((n) => n.id === edge.source) ?? null
      }
    }

    if (sourceNode) {
      await options.showSmartFillDialog(sourceNode)

      // 自动执行全表校验（延迟执行，确保列生成完成）
      setTimeout(() => {
        logger.debug('🔄 [handleSmartFillClick] 触发全表自动校验')
        options.handleValidate()
      }, 500)
      return
    }

    // 未连接数据源时提示
    await showConfirm({
      title: t('customNodes.schemaNode.source.notConnected'),
      message: t('customNodes.schemaNode.source.smartFillWarning'),
      confirmText: t('common.confirm'),
      type: 'warning',
    })
  }

  return {
    connectToDataSource,
    handleSmartFillClick,
  }
}
