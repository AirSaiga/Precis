/**
 * @file useRegexConnection.ts
 * @description Regex 节点连接处理组合式函数
 *
 * 功能概述：
 * - 处理 Schema 列到 Regex 节点的连接建立
 * - 从数据源获取样例数据用于正则设计和预览
 * - 管理连接确认对话框的显示和隐藏
 * - 维护正则节点的源数据信息（sourceRef）
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import type { CustomNode, RegexNodeData } from '@/types/graph'
import { useRegexValidation } from './useRegexValidation'
import { resolveRegexSource } from '@/services/regex/regexEdgeResolver'

/**
 * Regex 节点连接处理 Composable
 * 专门处理 Schema 列 → Regex 节点的连接逻辑
 * 负责正则表达式的连接建立、样例数据获取和确认对话框管理
 *
 * 核心功能：
 * 1. 处理 Schema 列到 Regex 节点的连接建立
 * 2. 从数据源获取样例数据用于正则设计和预览
 * 3. 管理连接确认对话框的显示和隐藏
 * 4. 维护正则节点的源数据信息（sourceNodeId, sourceColumnName）
 *
 * 数据流：
 * SourcePreview(原始数据) → Schema(表结构) → Regex(正则规则)
 *
 * 状态管理：
 * - pendingRegexConnection: 保存待确认的连接信息
 * - showRegexConnectionDialog: 控制确认对话框显示
 * - regexEditSampleData: 缓存当前正则编辑的样例数据
 */
export function useRegexConnection() {
  // 国际化支持
  const { t } = useI18n()
  // 从 VueFlow 获取边的操作方法
  const { addEdges } = useVueFlow()
  // 获取全局图存储，用于访问和修改节点数据
  const store = useGraphStore()

  // 获取正则校验功能模块
  // performRegexValidation: 执行正则验证的方法
  const { performRegexValidation } = useRegexValidation()

  /**
   * 待处理的正则连接信息
   * 在用户确认连接前，临时保存连接相关的信息
   *
   * 数据结构：
   * - schemaNode: Schema 节点对象，包含表结构信息
   * - regexNode: Regex 节点对象，包含正则规则信息
   * - sourceColumnId: 源列 ID，用于从 Schema 节点中定位具体列
   * - sourceColumnName: 源列名称，用于显示和匹配
   *
   * 使用场景：
   * 当 Schema 节点已连接数据源时，需要用户确认是否建立正则连接
   * 此时将连接信息保存到此变量，待用户确认后建立连接
   */
  const pendingRegexConnection = ref<{
    schemaNode: CustomNode // Schema 节点对象
    regexNode: CustomNode // Regex 节点对象
    sourceColumnId: string // 源列 ID
    sourceColumnName: string // 源列名称
  } | null>(null)

  /**
   * 正则连接确认对话框显示状态
   * true: 对话框显示，用户需要确认是否建立连接
   * false: 对话框隐藏
   *
   * 显示时机：
   * 当用户尝试将 Regex 节点连接到已包含数据源的 Schema 列时
   * 系统会显示确认对话框，询问用户是否继续建立连接
   */
  const showRegexConnectionDialog = ref(false)

  /**
   * 缓存正则编辑时的样例数据
   * 用于在正则设计弹窗中展示数据预览，帮助用户理解正则匹配效果
   *
   * 数据来源：
   * - 新连接时：从 SourcePreview 节点提取对应列的第一行数据
   * - 打开弹窗时：从 store.regexEditSampleData 获取已保存的数据
   *
   * 数据传递：
   * 1. extractSampleDataFromNode 提取数据
   * 2. 保存到 regexEditSampleData（本地缓存）
   * 3. 调用 store.setRegexEditSampleData() 保存到全局状态
   * 4. RegexDesignModal 通过 computed 属性获取数据
   * 5. 传递给 InteractiveBuilder 显示
   *
   * 清空时机：
   * - 建立连接完成后清空
   * - 用户取消连接时清空
   */
  const regexEditSampleData = ref('')

  /**
   * Toast 消息提示函数
   * 通过控制台输出带等级标记的消息，用于调试和用户反馈
   *
   * 消息等级：
   * - success: 成功消息，绿色标记
   * - error: 错误消息，红色标记
   * - info: 普通信息，蓝色标记
   *
   * 使用场景：
   * - 连接建立成功时显示 success
   * - 连接失败或参数错误时显示 error
   * - 调试信息和中途状态显示 info
   *
   * @param message - 要显示的消息内容
   * @param type - 消息类型，success=成功，error=错误，info=信息
   */
  const showToastMessage = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    logger.debug(`[${type.toUpperCase()}] ${message}`)
  }

  /**
   * 处理 Schema 列到 Regex 节点的连接
   * 这是正则表达式与数据列建立关联的核心方法
   *
   * 处理流程：
   * 1. 解析源列信息
   *    - 从 sourceHandle 中提取列 ID（格式：source-right-{columnId}）
   *    - 从 Schema 节点中查找对应的列信息
   *
   * 2. 检查 Schema 节点是否已连接数据源
   *    - 通过 schemaData.sourceFilePath 判断
   *    - 有数据源：显示确认对话框
   *    - 无数据源：直接建立连接
   *
   * 3. 有数据源时的处理
   *    - 保存待处理连接信息到 pendingRegexConnection
   *    - 调用 fetchSampleDataForRegexEdit 获取样例数据
   *    - 显示确认对话框，等待用户确认
   *
   * 4. 无数据源时的处理
   *    - 直接调用 establishRegexConnection 建立连接
   *
   * @param schemaNodeId - Schema 节点 ID
   * @param regexNodeId - Regex 节点 ID
   * @param sourceHandle - 源连接句柄 ID，格式为 'source-right-{columnId}'
   */
  const handleSchemaToRegexConnection = async (
    schemaNodeId: string,
    regexNodeId: string,
    sourceHandle: string
  ) => {
    try {
      // 记录开始处理连接的日志，用于调试和追踪
      logger.debug('🔤 处理Schema到Regex连接:', {
        schemaNodeId,
        regexNodeId,
        sourceHandle,
      })

      // =====================================================
      // 步骤 1：解析源列信息
      // =====================================================
      // 从 sourceHandle 中提取列 ID
      // sourceHandle 格式为 'source-right-{columnId}'，需要去除前缀得到纯列 ID
      const sourceColumnId = sourceHandle.replace('source-right-', '')

      // 获取 Schema 节点的数据对象，用于访问表结构和元信息
      const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
      const regexNode = store.nodes.find((n) => n.id === regexNodeId)
      if (!schemaNode || !regexNode) return

      const schemaData = schemaNode.data as Record<string, unknown>

      // 在 Schema 的 columns 数组中查找对应的列信息对象
      // columns 数组包含该表所有列的元数据（id、name、type 等）
      const sourceColumn = (schemaData.columns as unknown[]).find(
        (col) => (col as Record<string, unknown>).id === sourceColumnId
      ) as Record<string, unknown> | undefined

      // 验证源列是否存在，如果找不到说明连接句柄指定的列不存在
      if (!sourceColumn) {
        logger.error('❌ 未找到源列信息:', sourceColumnId)
        showToastMessage(t('canvas.nodeCanvas.connectionFailed'), 'error')
        return
      }

      // =====================================================
      // 步骤 2：检查 Schema 节点是否已连接数据源
      // =====================================================
      // sourceFilePath 字段存在表示该 Schema 节点已关联具体的数据文件
      // 这决定了后续是直接建立连接还是需要用户确认
      const hasDataSource = !!schemaData.sourceFilePath

      // 如果已有数据源连接，需要显示确认对话框让用户确认
      if (hasDataSource) {
        // =====================================================
        // 步骤 3：有数据源时的处理
        // =====================================================
        // 保存连接信息到 ref，供后续用户确认后使用
        // 这些信息包括：Schema节点、Regex节点、源列ID、源列名
        pendingRegexConnection.value = {
          schemaNode,
          regexNode,
          sourceColumnId,
          sourceColumnName: sourceColumn.columnName as string,
        }

        // 先写入 Regex 节点的源信息，确保后续编辑弹窗可获取列上下文
        store.updateNodeData(regexNode.id, {
          ...(regexNode.data as Record<string, unknown>),
          sourceRef: { nodeId: schemaNode.id, columnId: sourceColumnId },
          saveState: 'draft',
          validationStatus: 'idle',
          lastValidationTime: new Date().toISOString(),
        } as RegexNodeData)

        // =====================================================
        // 步骤 4：从数据源获取样例数据
        // =====================================================
        // 用于在确认对话框中展示数据预览，帮助用户了解要处理的数据
        await fetchSampleDataForRegexEdit()

        // =====================================================
        // 步骤 5：显示确认对话框
        // =====================================================
        // 等待用户点击"是"或"否"按钮来决定是否建立连接
        showRegexConnectionDialog.value = true

        return
      }

      // =====================================================
      // 步骤 6：无数据源时的处理
      // =====================================================
      // 如果 Schema 节点还没有关联数据源，直接建立连接
      // 这种情况下不需要用户确认，因为还没有实际数据可供预览
      await establishRegexConnection(schemaNode, regexNode, sourceColumn)
    } catch (error) {
      // 捕获并记录处理过程中的错误，防止程序崩溃
      logger.error('处理Schema到Regex连线失败:', error)
      showToastMessage(t('canvas.nodeCanvas.connectionFailed'), 'error')
    }
  }

  /**
   * 从数据源获取样例数据用于正则编辑
   * 读取数据源中对应列的第一行数据
   * 用于在正则编辑界面展示数据预览
   *
   * 支持两种调用场景：
   *
   * 场景1：打开已有正则节点的编辑弹窗
   * - 调用方式：fetchSampleDataForRegexEdit({ regexNodeId })
   * - 处理逻辑：
   *   1. 根据 regexNodeId 查找 Regex 节点
   *   2. 从 Regex 节点获取 sourceNodeId 和 sourceColumnName
   *   3. 查找 SourcePreview 节点（数据源）
   *   4. 查找与 Regex 节点连接的 Schema 节点
   *   5. 根据 sourceColumnName 找到对应的列 ID
   *   6. 调用 extractSampleDataFromNode 提取数据
   *
   * 场景2：新连接建立时获取样例数据
   * - 调用方式：fetchSampleDataForRegexEdit()
   * - 处理逻辑：
   *   1. 从 pendingRegexConnection 获取连接信息
   *   2. 从 Schema 节点获取 sourceNodeId
   *   3. 查找 SourcePreview 节点
   *   4. 调用 extractSampleDataFromNode 提取数据
   *
   * 数据获取流程：
   * SourcePreview.data.data[0] → 表头行
   * SourcePreview.data.data[1] → 第一行数据（用于正则设计）
   *
   * @param options - 可选参数，用于指定获取数据的来源
   * @param options.regexNodeId - 正则节点ID，用于从已有连接中获取数据
   * @param options.schemaNode - Schema节点，当有pending连接时使用
   * @param options.sourceColumnId - 源列ID，当有pending连接时使用
   */
  const fetchSampleDataForRegexEdit = async (options?: {
    regexNodeId?: string
    schemaNode?: any
    sourceColumnId?: string
  }) => {
    // 声明两个变量用于存储后续找到的节点和列ID
    // schemaNode: Schema 节点对象，用于访问列结构
    // sourceColumnId: 源列 ID，用于精确定位要提取的列
    let schemaNode: any
    let sourceColumnId: string

    // =====================================================
    // 场景1：打开已有正则节点的编辑弹窗
    // =====================================================
    // 当用户点击"编辑正则"按钮时，会传入 regexNodeId
    // 需要根据已保存的连接信息重新获取样例数据
    if (options?.regexNodeId) {
      // 从 store.nodes 中查找与传入 ID 匹配的 Regex 节点
      // store.nodes 包含图中的所有节点
      const regexNode = store.nodes.find((n) => n.id === options.regexNodeId)

      // 验证节点是否存在，如果找不到说明节点可能已被删除
      if (!regexNode) {
        logger.warn('未找到正则节点:', options.regexNodeId)
        return
      }

      // 从 Regex 节点的数据中获取源信息
      // 这些信息在建立连接时已经保存到这里
      const regexData = regexNode.data as Record<string, unknown>
      // 约定：Regex 与"表结构"绑定，数据源变化由 Schema 统一管理。
      // 通过 edges 解析上游绑定，不依赖 node data 中被删除的 sourceNodeId 字段。
      const source = resolveRegexSource(options.regexNodeId, store.nodes, store.edges as any)
      if (!source || (source.sourceType !== 'schema' && source.sourceType !== 'jsonSchema')) {
        logger.warn('正则节点没有关联的数据源信息（无可用的 schema 边）')
        return
      }

      // =====================================================
      // 1.2 使用从 edges 解析的 Schema 节点
      // =====================================================
      schemaNode = source.sourceNode
      sourceColumnId = source.columnId

      // 验证 Schema 节点是否存在
      if (!schemaNode) {
        logger.warn('未找到 Schema 节点')
        return
      }

      const schemaData = schemaNode.data as Record<string, unknown>
      const sourcePreviewNodeId = schemaData.sourceNodeId
      if (!sourcePreviewNodeId) {
        logger.warn('Schema 节点没有关联的数据源节点 ID')
        return
      }

      const sourcePreviewNode = store.nodes.find(
        (n) => n.id === sourcePreviewNodeId && n.type === 'sourcePreview'
      )
      if (!sourcePreviewNode) {
        logger.warn('未找到数据源预览节点 (sourceNodeId:', sourcePreviewNodeId, ')')
        return
      }

      // =====================================================
      // 1.3 直接从 edges 解析的列信息获取数据
      // =====================================================

      // 调用数据提取函数完成数据获取
      extractSampleDataFromNode(sourcePreviewNode, schemaNode, sourceColumnId)
      return
    }

    // =====================================================
    // 场景2：新连接建立时获取样例数据
    // =====================================================
    // 此时使用 pendingRegexConnection 中保存的连接信息
    // 检查是否有待处理的连接信息
    if (!pendingRegexConnection.value) return

    // 从 pendingRegexConnection 中解构出之前保存的连接信息
    const pending = pendingRegexConnection.value
    schemaNode = pending.schemaNode
    sourceColumnId = pending.sourceColumnId

    // 获取 Schema 节点的数据对象
    const schemaData = schemaNode.data as Record<string, unknown>

    // =====================================================
    // 2.1 从 Schema 节点获取数据源节点 ID
    // =====================================================
    // 直接从 Schema 节点的 data.sourceNodeId 获取
    // 这是建立 Schema 节点时就保存好的，指向对应的 SourcePreview 节点
    // 这种方式不依赖边的查找，更加稳定可靠
    const sourceNodeId = schemaData.sourceNodeId

    // 验证 sourceNodeId 是否存在
    if (!sourceNodeId) {
      logger.warn('Schema 节点没有关联的数据源节点 ID')
      regexEditSampleData.value = ''
      return
    }

    // =====================================================
    // 2.2 查找数据源节点
    // =====================================================
    // 根据 sourceNodeId 查找 SourcePreview 节点
    const sourcePreviewNode = store.nodes.find(
      (n: any) => n.id === sourceNodeId && n.type === 'sourcePreview'
    )

    // 验证 SourcePreview 节点是否存在
    if (!sourcePreviewNode) {
      logger.warn('未找到数据源预览节点 (sourceNodeId:', sourceNodeId, ')')
      regexEditSampleData.value = ''
      return
    }

    // =====================================================
    // 2.3 提取样例数据
    // =====================================================
    // 调用提取函数，传入 SourcePreview 节点、Schema 节点和列 ID
    extractSampleDataFromNode(sourcePreviewNode, schemaNode, sourceColumnId)
  }

  /**
   * 从 SourcePreview 节点提取样例数据
   * 只取第一行数据（跳过表头），用于正则设计框的默认输入文本
   *
   * 数据提取流程：
   * 1. 获取 SourcePreview 节点的 tableData
   * 2. tableData[0] 是表头行，用于查找列索引
   * 3. tableData[1] 是第一行数据，即我们要提取的数据
   *
   * 列定位流程：
   * 1. 根据 sourceColumnId 在 Schema.columns 中查找列信息
   * 2. 获取列名（columnName）
   * 3. 在表头行中查找列名对应的索引
   * 4. 从第一行数据中获取该索引的值
   *
   * 注意事项：
   * - 列名可能存在前后空格，需要 trim() 后再匹配
   * - 数据值可能是 undefined/null/空字符串，需要处理
   * - 成功提取后会将数据保存到 regexEditSampleData 和 store
   *
   * @param sourcePreviewNode - SourcePreview 节点，包含原始数据
   * @param schemaNode - Schema 节点，包含列结构信息
   * @param sourceColumnId - 源列 ID，用于定位具体列
   */
  const extractSampleDataFromNode = (
    sourcePreviewNode: any,
    schemaNode: any,
    sourceColumnId: string
  ) => {
    // =====================================================
    // 步骤 1：获取数据源节点的数据
    // =====================================================
    // 从 SourcePreview 节点中提取数据对象
    // sourcePreviewNode.data 包含节点的所有数据
    const sourceData = sourcePreviewNode.data as Record<string, unknown>

    // tableData 是实际的表格数据，二维数组结构
    // tableData[0] 是表头行（列名）
    // tableData[1] 及以后是数据行
    const tableData = (sourceData as unknown as Record<string, unknown>).data as
      | unknown[]
      | undefined

    // =====================================================
    // 步骤 2：验证数据是否存在且有效
    // =====================================================
    // 检查 tableData 是否存在且至少包含两行（表头+数据）
    // 如果数据不存在或只有表头没有数据，则无法提取样例
    if (!tableData || tableData.length < 2) {
      regexEditSampleData.value = ''
      return
    }

    // =====================================================
    // 步骤 3：根据列 ID 查找列信息
    // =====================================================
    // 从 Schema 节点获取列定义数组
    const schemaData = schemaNode.data as unknown as Record<string, unknown>

    // 在 columns 数组中查找与 sourceColumnId 匹配的列对象
    // 列对象包含列的元数据：id、columnName、dataType 等
    const targetColumn = (schemaData.columns as unknown[] | undefined)?.find(
      (col: any) => col.id === sourceColumnId
    ) as Record<string, unknown> | undefined

    // 如果找不到对应的列定义，说明列 ID 无效
    if (!targetColumn) {
      logger.warn('未找到目标列:', sourceColumnId)
      regexEditSampleData.value = ''
      return
    }

    // =====================================================
    // 步骤 4：在表头行中定位列索引
    // =====================================================
    // 获取表头行（第一行），包含所有列的名称
    const headerRow = tableData[0] as unknown[]

    // 在表头行中查找目标列名对应的位置索引
    // 使用 trim() 去除可能存在的前后空格，确保匹配准确
    const columnIndex = headerRow.findIndex(
      (header) => String(header).trim() === (targetColumn.columnName as string)
    )

    // 如果表头中找不到该列名，说明数据结构可能不匹配
    if (columnIndex === -1) {
      logger.warn('未在数据中找到列:', targetColumn.columnName as string)
      regexEditSampleData.value = ''
      return
    }

    // =====================================================
    // 步骤 5：提取第一行数据
    // =====================================================
    // 获取第一行数据（跳过表头，tableData[0] 是表头）
    // 使用可选链 ?. 避免越界访问
    const firstRowData = tableData[1]?.[columnIndex]

    // =====================================================
    // 步骤 6：验证数据值
    // =====================================================
    // 数据值可能是 undefined（不存在）、null（空值）或空字符串
    // 这些情况下都不适合作为正则设计的样例
    if (firstRowData === undefined || firstRowData === null || firstRowData === '') {
      logger.warn('第一行数据为空')
      regexEditSampleData.value = ''
      return
    }

    // =====================================================
    // 步骤 7：保存样例数据
    // =====================================================
    // 将数据转换为字符串，确保类型一致性
    regexEditSampleData.value = String(firstRowData)

    // 同时保存到全局 store，供正则设计弹窗使用
    // 这样即使组件销毁后重新打开，数据仍然可用
    store.setRegexEditSampleData(regexEditSampleData.value)
  }

  /**
   * 建立正则连接
   * 将 Regex 节点与 Schema 列进行关联
   *
   * 连接建立流程：
   * 1. 更新 Regex 节点数据
   *    - 保存 sourceNodeId：指向 SourcePreview 节点（数据源）
   *    - 保存 sourceColumnName：关联的列名
   *    - 设置 validationStatus 为 'idle'
   *    - 设置 lastValidationTime 为当前时间
   *
   * 2. 添加连接边（如果边不存在）
   *    - source: Schema 节点 ID
   *    - target: Regex 节点 ID
   *    - sourceHandle: source-right-{columnId}
   *    - targetHandle: regex-input
   *    - 类型: smoothstep（直角边）
   *    - 样式: 紫色边框， animated 动画效果
   *
   * 3. 执行正则校验（如果有回调函数）
   *
   * 4. 显示成功提示
   *
   * 注意事项：
   * - sourceNodeId 保存的是 Schema 节点 ID（表结构节点），而非 SourcePreview 节点 ID
   *   这样 Regex 与“字段定义/列结构”绑定，数据源变更统一由 Schema 处理，避免 Regex 直接持有数据源引用。
   * - SourcePreview 节点通过 schemaNode.data.sourceNodeId 间接获得，符合“用 id 间接引用节点数据”的原则。
   *
   * @param schemaNode - Schema 节点对象
   * @param regexNode - Regex 节点对象
   * @param sourceColumn - 源列信息对象，包含列 ID 和列名
   * @param performRegexValidationCb - 可选的校验回调函数
   */
  const establishRegexConnection = async (
    schemaNode: CustomNode,
    regexNode: CustomNode,
    sourceColumn: Record<string, unknown>,
    performRegexValidationCb?: (
      regexNodeId: string,
      schemaNodeId: string,
      columnName: string
    ) => Promise<void>
  ) => {
    // =====================================================
    // 步骤 2：构建更新的节点数据
    // =====================================================
    // 合并现有节点数据与新数据，避免丢失其他字段
    const updatedRegexData = {
      ...regexNode.data,
      sourceRef: { nodeId: schemaNode.id, columnId: sourceColumn.id as string },
      saveState: 'draft',
      // 设置校验状态为"空闲"，表示尚未执行校验
      validationStatus: 'idle' as const,
      // 记录最后一次操作时间
      lastValidationTime: new Date().toISOString(),
    } as unknown as RegexNodeData

    // =====================================================
    // 步骤 3：更新节点数据到 store
    // =====================================================
    // 调用 store 的方法更新节点数据，确保全局状态同步
    store.updateNodeData(regexNode.id, updatedRegexData)

    // =====================================================
    // 步骤 4：检查连接边是否已存在
    // =====================================================
    // 查找是否已存在从 Schema 到 Regex 的边
    // 边的匹配条件：源节点、目标节点、源句柄、目标句柄都必须匹配
    const existingEdge = store.edges.find(
      (edge) =>
        edge.source === schemaNode.id &&
        edge.target === regexNode.id &&
        edge.sourceHandle === `source-right-${sourceColumn.id}` &&
        edge.targetHandle === 'regex-input'
    )

    // =====================================================
    // 步骤 5：如果边不存在，则创建新边
    // =====================================================
    if (!existingEdge) {
      // 使用 VueFlow 的 addEdges 方法添加新边
      addEdges([
        {
          // 生成唯一边 ID，使用时间戳确保唯一性
          id: `regex-validation-${Date.now()}`,
          // 边从 Schema 节点指向 Regex 节点
          source: schemaNode.id,
          target: regexNode.id,
          // 源句柄：指向特定列的输出端口
          sourceHandle: `source-right-${sourceColumn.id}`,
          // 目标句柄：Regex 节点的输入端口
          targetHandle: 'regex-input',
          // 使用直角边样式
          type: 'smoothstep',
          // 启用动画效果
          animated: true,
          // 自定义样式：紫色边框
          style: {
            stroke: 'var(--edge-schema-to-regex)', // was #8b5cf6
            strokeWidth: 2,
          },
          // 边的标签
          label: 'Regex Validation',
        },
      ])
    }

    // =====================================================
    // 步骤 6：执行正则校验
    // =====================================================
    // 如果提供了回调函数，优先使用回调函数
    // 否则使用默认的 performRegexValidation 方法
    if (performRegexValidationCb) {
      await performRegexValidationCb(regexNode.id, schemaNode.id, sourceColumn.columnName as string)
    } else if (performRegexValidation) {
      await performRegexValidation(regexNode.id, schemaNode.id, sourceColumn.columnName as string)
    }

    // =====================================================
    // 步骤 7：显示成功提示
    // =====================================================
    // 使用国际化方法获取本地化的成功消息
    showToastMessage(
      t('canvas.nodeCanvas.regexConnectionSuccess', {
        column: sourceColumn.columnName,
        regex:
          ((regexNode.data as unknown as Record<string, unknown>).configName as string) || 'Regex',
      }),
      'success'
    )

    // 记录连接建立的详细信息，用于调试
    logger.debug('✅ 正则校验连接已建立:', {
      columnName: sourceColumn.columnName,
      regexName:
        ((regexNode.data as unknown as Record<string, unknown>).configName as string) || 'Regex',
    })
  }

  /**
   * 直接校验处理
   * 用户点击"是"按钮，确认建立连接并执行校验
   *
   * 处理流程：
   * 1. 隐藏确认对话框
   * 2. 调用 establishRegexConnection 建立连接
   * 3. 调用 performRegexValidation 执行正则校验
   * 4. 清空 pendingRegexConnection 和 regexEditSampleData
   *
   * 与 handleRegexEdit 的区别：
   * - handleRegexEdit: 打开正则设计弹窗进行编辑
   * - handleRegexValidateDirectly: 直接执行校验，不打开弹窗
   */
  const handleRegexValidateDirectly = async () => {
    // =====================================================
    // 步骤 1：验证待处理连接信息是否存在
    // =====================================================
    // 如果 pendingRegexConnection 为 null，说明没有待确认的连接
    // 直接返回，不执行任何操作
    if (!pendingRegexConnection.value) return

    // =====================================================
    // 步骤 2：获取连接相关信息
    // =====================================================
    // 从 pendingRegexConnection 中解构出保存的连接信息
    const { schemaNode, regexNode, sourceColumnId } = pendingRegexConnection.value

    // 获取 Schema 节点的数据，查找对应的列对象
    const schemaData = schemaNode.data as Record<string, unknown>
    const sourceColumn = (schemaData.columns as unknown[]).find(
      (col) => (col as Record<string, unknown>).id === sourceColumnId
    ) as Record<string, unknown> | undefined

    // 如果找不到对应的列，直接返回
    if (!sourceColumn) return

    // =====================================================
    // 步骤 3：隐藏确认对话框
    // =====================================================
    // 用户已做出选择，关闭对话框
    showRegexConnectionDialog.value = false

    // =====================================================
    // 步骤 4：建立正则连接
    // =====================================================
    // 调用 establishRegexConnection 完成连接建立
    // 这会更新节点数据、添加连接边
    await establishRegexConnection(schemaNode, regexNode, sourceColumn)

    // =====================================================
    // 步骤 5：执行正则校验
    // =====================================================
    // 对正则表达式进行校验，验证其有效性和匹配规则
    await performRegexValidation(regexNode.id, schemaNode.id, sourceColumn.columnName as string)

    // =====================================================
    // 步骤 6：清空临时状态
    // =====================================================
    // 清空 pendingRegexConnection，表示连接已处理完成
    pendingRegexConnection.value = null

    // 清空本地缓存的样例数据
    regexEditSampleData.value = ''
  }

  /**
   * 编辑正则处理
   * 用户点击"编辑正则"按钮，确认建立连接并打开正则设计弹窗
   *
   * 处理流程：
   * 1. 隐藏确认对话框
   * 2. 调用 establishRegexConnection 建立连接
   * 3. 将样例数据保存到 store（供弹窗使用）
   * 4. 等待 Vue 响应式更新完成（确保 store 值已更新）
   * 5. 打开正则设计弹窗
   * 6. 清空临时状态
   *
   * 数据传递：
   * - regexEditSampleData → store.setRegexEditSampleData()
   * - store.regexEditSampleData → RegexDesignModal.currentSampleText
   * - RegexDesignModal → RuleConfigPanel → InteractiveBuilder
   *
   * 与 handleRegexValidateDirectly 的区别：
   * - handleRegexValidateDirectly: 直接执行校验
   * - handleRegexEdit: 打开弹窗进行可视化编辑
   */
  const handleRegexEdit = async () => {
    // =====================================================
    // 步骤 1：验证待处理连接信息是否存在
    // =====================================================
    // 如果 pendingRegexConnection 为 null，说明没有待确认的连接
    // 直接返回，不执行任何操作
    if (!pendingRegexConnection.value) return

    // =====================================================
    // 步骤 2：获取连接相关信息
    // =====================================================
    // 从 pendingRegexConnection 中解构出保存的连接信息
    const { schemaNode, regexNode, sourceColumnId } = pendingRegexConnection.value

    // 获取 Schema 节点的数据，查找对应的列对象
    const schemaData = schemaNode.data as Record<string, unknown>
    const sourceColumn = (schemaData.columns as unknown[]).find(
      (col) => (col as Record<string, unknown>).id === sourceColumnId
    ) as Record<string, unknown> | undefined

    // 如果找不到对应的列，直接返回
    if (!sourceColumn) return

    // =====================================================
    // 步骤 3：隐藏确认对话框
    // =====================================================
    // 用户已选择编辑正则，关闭确认对话框
    showRegexConnectionDialog.value = false

    // =====================================================
    // 步骤 4：建立正则连接
    // =====================================================
    // 调用 establishRegexConnection 完成连接建立
    // 这会更新节点数据、添加连接边
    await establishRegexConnection(schemaNode, regexNode, sourceColumn)

    // =====================================================
    // 步骤 5：保存样例数据到全局 store
    // =====================================================
    // 在清空临时状态前，先将样例数据保存到 store
    // store 中的数据在整个应用生命周期内可用
    store.setRegexEditSampleData(regexEditSampleData.value)

    // =====================================================
    // 步骤 6：等待 Vue 响应式更新完成
    // =====================================================
    // 使用 setTimeout 确保 store 的值已被更新
    // 这样弹窗打开时就能获取到最新的样例数据
    await new Promise((resolve) => setTimeout(resolve, 10))

    // =====================================================
    // 步骤 7：打开正则设计弹窗
    // =====================================================
    // 调用 store 的方法打开弹窗
    // 传入正则节点 ID，用于加载该节点的规则数据
    store.openRegexDesignModal(regexNode.id)

    // =====================================================
    // 步骤 8：清空临时状态
    // =====================================================
    // 清空 pendingRegexConnection，表示连接已处理完成
    pendingRegexConnection.value = null

    // 清空本地缓存的样例数据（已保存到 store）
    regexEditSampleData.value = ''
  }

  return {
    /**
     * 待处理的正则连接信息
     * 用于在显示确认对话框前保存连接信息
     * 数据结构：{ schemaNode, regexNode, sourceColumnId, sourceColumnName } | null
     */
    pendingRegexConnection,

    /**
     * 正则连接确认对话框显示状态
     * true: 对话框显示，用户需要确认是否建立连接
     */
    showRegexConnectionDialog,

    /**
     * 缓存正则编辑时的样例数据
     * 用于在正则设计弹窗中展示数据预览
     */
    regexEditSampleData,

    /**
     * 处理 Schema 列到 Regex 节点的连接
     * 核心入口函数，由连接完成事件触发
     * @param schemaNode - Schema 节点对象
     * @param regexNode - Regex 节点对象
     * @param sourceHandle - 源连接句柄 ID
     */
    handleSchemaToRegexConnection,

    /**
     * 从数据源获取样例数据用于正则编辑
     * 支持新连接和已有连接两种场景
     * @param options - 可选参数，指定获取数据的来源
     */
    fetchSampleDataForRegexEdit,

    /**
     * 建立正则连接
     * 更新节点数据并添加连接边
     * @param schemaNode - Schema 节点对象
     * @param regexNode - Regex 节点对象
     * @param sourceColumn - 源列信息对象
     * @param performRegexValidationCb - 可选的校验回调函数
     */
    establishRegexConnection,

    /**
     * 直接校验处理
     * 用户确认连接后直接执行校验
     */
    handleRegexValidateDirectly,

    /**
     * 编辑正则处理
     * 用户确认连接后打开正则设计弹窗
     */
    handleRegexEdit,
  }
}
