/**
 * @file usePreviewCreation.ts
 * @description 数据源预览节点创建模块
 *
 * 【架构背景与设计决策】
 * 本模块负责从外部数据源创建数据源预览节点（SourcePreviewNode），是用户将文件导入工作区的入口点。
 *
 * 【数据读取模式】
 * 本地路径模式（Electron 环境专用）：
 * - 数据流：本地路径 -> /preview/file/path -> 后端直接读取文件
 * - 适用场景：Electron 桌面应用
 * - 优点：无需上传文件，支持大文件，文件修改后自动反映最新内容
 *
 * 注：IndexedDB 模式已在 2026年3月移除，不再支持 Web 浏览器环境
 *
 * 【核心组件】
 * - SourcePreviewNode: 在画布上显示数据源预览的节点组件
 * - Graph Store: 存储节点数据，管理节点生命周期
 * - Vue Flow: 节点渲染和拖拽交互库
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import type { SourcePreviewNodeData } from '../types'
import type { SourceMode } from '@/types/datasource'

/*
 * @deprecated 2026年3月：IndexedDB 模式已移除
 *
 * const fetchPreviewDataFromIndexedDB = async (fileId: string, maxRows: number, maxCols: number) => { ... };
 */

/**
 * JSON 文件特有的参数选项
 */
interface JsonOptions {
  jsonPath?: string
  jsonFormat?: string
  recordPath?: string
}

/**
 * 从本地路径读取文件预览数据（Electron 环境专用）
 *
 * 【实现原理】
 * 直接将文件路径发送给后端，后端使用 pandas 直接读取本地文件系统
 *
 * 【数据流】
 * filePath (字符串) -> /preview/file/path JSON 请求 -> 后端 pandas.read_* -> PreviewResponse
 *
 * 【平台兼容性】
 * - Windows: C:\path\to\file.xlsx
 * - Linux: /home/user/path/to/file.xlsx
 * - macOS: /Users/user/path/to/file.xlsx
 *
 * @param filePath - 本地文件绝对路径
 * @param maxRows - 最大返回行数
 * @param maxCols - 最大返回列数
 * @param sheetName - 可选，指定读取的工作表名称（仅 Excel 文件有效）
 * @param jsonOptions - 可选，JSON 文件特有参数（jsonPath, jsonFormat, recordPath）
 * @returns 预览数据对象，包含数据行、行列数、工作表列表、文件类型等信息
 * @throws {Error} 当 HTTP 请求失败或后端返回错误时抛出异常
 *
 * @example
 * const data = await fetchPreviewDataFromPath('C:/data/users.xlsx', 100, 50, 'Sheet1');
 * logger.debug(data.data); // 二维数组形式的数据
 * logger.debug(data.sheets); // ['Sheet1', 'Sheet2']
 *
 * @example
 * // JSON 文件示例
 * const data = await fetchPreviewDataFromPath('/data/users.json', 100, 50, undefined, {
 *   jsonPath: '$.data.items',
 *   jsonFormat: 'auto',
 *   recordPath: 'items'
 * });
 */
export const fetchPreviewDataFromPath = async (
  filePath: string,
  maxRows: number,
  maxCols: number,
  sheetName?: string,
  jsonOptions?: JsonOptions
) => {
  const requestBody: Record<string, unknown> = {
    file_path: filePath,
    max_rows: maxRows,
    max_cols: maxCols,
    sheet_name: sheetName || null,
  }

  // 附加 JSON 特有参数
  if (jsonOptions?.jsonPath) {
    requestBody.json_path = jsonOptions.jsonPath
  }
  if (jsonOptions?.jsonFormat) {
    requestBody.json_format = jsonOptions.jsonFormat
  }
  if (jsonOptions?.recordPath) {
    requestBody.record_path = jsonOptions.recordPath
  }

  let result: any
  try {
    const response = await apiClient.post('/preview/file/path', requestBody)
    result = response.data
  } catch (error: any) {
    const status = error?.response?.status
    const data = error?.response?.data
    const errorText =
      typeof data === 'string'
        ? data
        : (data?.error as string | undefined) ||
          (data?.message as string | undefined) ||
          (error?.message as string | undefined) ||
          '未知错误'
    throw new Error(`HTTP错误 ${status ?? ''}: ${errorText}`.trim())
  }
  if (!result.success) {
    throw new Error(result.error || '读取文件失败')
  }

  return {
    data: result.data || [],
    actualRowCount: result.total_rows || 0,
    actualColCount: result.total_cols || 0,
    previewRowCount: result.total_rows || 0,
    previewColCount: result.total_cols || 0,
    sheets: result.sheets || undefined,
    currentSheet: result.current_sheet || undefined,
    source_type: result.file_type || 'unknown',
    file_name: result.file_name || filePath.split(/[/\\]/).pop() || 'unknown',
    size_mb: 0,
    modified_time: Date.now(),
  }
}

/**
 * 数据源预览节点创建 Composable
 *
 * 【功能概述】
 * 提供创建数据源预览节点的完整功能，包括：
 * 1. 从本地文件路径获取预览数据
 * 2. 创建并配置 SourcePreviewNode 节点
 * 3. 处理重复数据源检测
 * 4. 集成 Vue Flow 和 Graph Store 管理节点生命周期
 *
 * 【使用场景】
 * - 用户从数据源侧边栏拖拽文件到画布时
 * - 通过 API 程序化创建数据源预览节点时
 *
 * @returns 包含节点创建方法的对象
 * @returns {Function} returns.fetchPreviewData - 获取预览数据的统一入口函数
 * @returns {Function} returns.createSourcePreviewNode - 创建数据源预览节点的主函数
 * @returns {Function} returns.handleDuplicateSourceNode - 处理重复数据源节点的回调函数
 *
 * @example
 * const { createSourcePreviewNode, fetchPreviewData } = usePreviewCreation();
 *
 * // 在拖拽事件处理器中使用
 * const handleDrop = async (event) => {
 *   const meta = JSON.parse(event.dataTransfer.getData('application/json'));
 *   const position = { x: event.clientX, y: event.clientY };
 *   const node = await createSourcePreviewNode(meta, position);
 * };
 */
export function usePreviewCreation() {
  const { addNodes, project } = useVueFlow()
  const store = useGraphStore()

  /**
   * 获取预览数据（统一入口）
   *
   * 【职责说明】
   * 作为预览数据获取的统一入口，根据 sourceMode 决定使用哪种数据读取策略。
   * 当前仅支持 'localfile' 模式（Electron 环境）。
   *
   * 【调用关系】
   * - 被 createSourcePreviewNode 内部调用
   * - 委托给 fetchPreviewDataFromPath 执行实际数据读取
   *
   * @param fileId - 文件标识符，在 localfile 模式下为本地文件绝对路径
   * @param maxRows - 最大返回行数，默认 10。用于限制预览数据量
   * @param maxCols - 最大返回列数，默认 10。用于限制预览数据量
   * @param sourceMode - 数据来源模式（始终为 'localfile'）
   * @param sheetName - 可选，指定工作表名称（仅 Excel 文件有效）
   * @param jsonOptions - 可选，JSON 文件特有参数
   * @returns 预览数据对象，包含数据行、行列统计、文件元数据等
   * @throws {Error} 当文件读取失败或网络请求异常时抛出
   *
   * @example
   * // 获取前 100 行、50 列的预览数据
   * const preview = await fetchPreviewData('/path/to/file.xlsx', 100, 50, 'localfile', 'Sheet1');
   * logger.debug(preview.data); // 二维数组
   * logger.debug(preview.actualRowCount); // 文件总行数
   *
   * @example
   * // JSON 文件示例
   * const preview = await fetchPreviewData('/path/to/data.json', 100, 50, 'localfile', undefined, {
   *   jsonPath: '$.data',
   *   jsonFormat: 'auto'
   * });
   */
  const fetchPreviewData = async (
    fileId: string,
    maxRows: number = 10,
    maxCols: number = 10,
    sourceMode: SourceMode = 'localfile',
    sheetName?: string,
    jsonOptions?: JsonOptions
  ) => {
    logger.debug(`[PreviewCreation] 获取预览数据: fileId=${fileId}, mode=${sourceMode}`)

    // 只支持本地路径模式
    return await fetchPreviewDataFromPath(fileId, maxRows, maxCols, sheetName, jsonOptions)
  }

  /**
   * 创建数据源预览节点
   *
   * 【职责说明】
   * 这是创建 SourcePreviewNode 的核心函数，执行以下步骤：
   * 1. 提取并验证 fileId
   * 2. 检测重复数据源（避免同一文件创建多个节点）
   * 3. 提取文件元数据（文件名、数据源名、文件类型等）
   * 4. 调用后端 API 获取预览数据
   * 5. 推断并规范化文件类型
   * 6. 构建完整的节点数据对象
   * 7. 创建节点并添加到 Vue Flow 画布
   *
   * 【错误处理】
   * - 如果 fileId 缺失，抛出错误
   * - 如果数据源已存在，调用 handleDuplicateSourceNode 并返回现有节点
   * - 如果预览数据获取失败，使用降级数据（空数据 + 默认列头）
   *
   * @param meta - 拖拽事件传递的元数据对象，包含：
   *               - fileId: 文件路径标识符
   *               - fileName: 文件显示名称
   *               - sourceName: 数据源名称
   *               - fileType: 文件类型（可选）
   *               - localPath: 本地文件路径（可选）
   * @param position - 节点在画布上的位置坐标，包含 x 和 y
   * @returns 创建的节点对象，符合 Vue Flow Node 格式
   * @throws {Error} 当 fileId 不存在时抛出异常
   *
   * @example
   * const meta = {
   *   fileId: 'C:/data/users.xlsx',
   *   fileName: 'users.xlsx',
   *   sourceName: '用户数据',
   *   fileType: 'excel'
   * };
   * const node = await createSourcePreviewNode(meta, { x: 100, y: 200 });
   * // node.id 为新创建的节点 ID
   * // node.data 包含完整的 SourcePreviewNodeData
   */
  const createSourcePreviewNode = async (
    meta: Record<string, unknown>,
    position: { x: number; y: number },
    sheetName?: string
  ) => {
    // Step 1: 提取 fileId
    const fileId = typeof meta === 'object' && meta !== null ? (meta.fileId as string) : ''

    if (!fileId) {
      throw new Error('文件ID不存在')
    }

    // Step 2: 检查是否已存在相同数据源的节点
    const existingNode = store.nodes.find(
      (node) =>
        node.type === 'sourcePreview' &&
        node.data &&
        'fileId' in node.data &&
        node.data.fileId === fileId
    )

    if (existingNode) {
      const existingFileId =
        existingNode.data && typeof existingNode.data === 'object'
          ? ((existingNode.data as unknown as Record<string, unknown>).fileId as string)
          : undefined
      handleDuplicateSourceNode({ data: existingFileId ? { fileId: existingFileId } : undefined })
      return existingNode
    }

    // Step 3: 提取元数据
    const fileName =
      typeof meta === 'object' && meta !== null
        ? (meta.fileName as string) || (meta.name as string)
        : '未知文件'
    const sourceName =
      typeof meta === 'object' && meta !== null
        ? (meta.sourceName as string) || (meta.name as string) || '未知数据源'
        : '未知数据源'
    const fileTypeFromMeta =
      typeof meta === 'object' && meta !== null ? (meta.fileType as string) : ''
    // 2026年3月：始终使用 localfile 模式
    const sourceMode: SourceMode = 'localfile'
    const localPath =
      typeof meta === 'object' && meta !== null ? (meta.localPath as string | undefined) : undefined

    // Step 4: 获取预览数据
    let previewData: Record<string, unknown>
    let actualFileName = fileName

    try {
      previewData = await fetchPreviewData(fileId, 65535, 65535, sourceMode, sheetName)
      logger.debug('✅ 成功获取文件预览数据:', previewData)
      const fileInfo = previewData?.file_info as Record<string, unknown> | undefined
      if (fileInfo?.file_name) {
        actualFileName = fileInfo.file_name as string
      }
    } catch (error) {
      // 降级：使用空数据结构
      logger.warn('⚠️ 无法获取真实预览数据:', error)
      const fileExtension = (fileName || '').split('.').pop()?.toLowerCase() || 'csv'
      previewData = {
        headers: ['列1', '列2', '列3'],
        sampleRows: [],
        actualRowCount: 0,
        actualColCount: 0,
        previewRowCount: 0,
        previewColCount: 0,
        source_type: fileExtension,
        file_name: fileName || '未知文件',
        size_mb: 0,
        modified_time: Date.now(),
      }
      actualFileName = fileName || '未知文件'
    }

    // Step 5: 推断文件类型
    const fileExtension = (actualFileName || '').split('.').pop()?.toLowerCase() || ''
    const inferredFileType =
      fileExtension === 'csv'
        ? 'csv'
        : fileExtension === 'xlsx' || fileExtension === 'xls'
          ? 'excel'
          : fileExtension === 'json'
            ? 'json'
            : 'csv'
    const fileType = fileTypeFromMeta || inferredFileType
    const validFileType =
      fileType === 'excel' || fileType === 'csv' || fileType === 'json' ? fileType : 'csv'
    const displayFileType =
      validFileType === 'csv' ? 'CSV' : validFileType === 'json' ? 'JSON' : 'Excel'

    // Step 6: 构建节点数据
    const fileInfo = previewData?.file_info as Record<string, unknown> | undefined
    const sourceTypeFromApi = fileInfo?.source_type as string | undefined

    const nodeData: SourcePreviewNodeData = {
      id: `source-preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label: '数据源预览',
      sourceName: sourceName,
      localPath: localPath || fileId,
      fileName: fileName || '未知文件',
      fileType: displayFileType,
      sourceType: (sourceTypeFromApi || validFileType) as 'excel' | 'csv' | 'json',
      data: (previewData?.data as string[][] | undefined) || [],
      actualRowCount: (previewData?.actualRowCount as number | undefined) || 0,
      actualColCount: (previewData?.actualColCount as number | undefined) || 0,
      rowCount: (previewData?.actualRowCount as number | undefined) || 0,
      colCount: (previewData?.actualColCount as number | undefined) || 0,
      totalRows: (previewData?.actualRowCount as number | undefined) || 0,
      totalCols: (previewData?.actualColCount as number | undefined) || 0,
      previewRowCount: (previewData?.previewRowCount as number | undefined) || 0,
      previewColCount: (previewData?.previewColCount as number | undefined) || 0,
      sheets: (previewData?.sheets as string[] | undefined) || undefined,
      currentSheet: sheetName || (previewData?.currentSheet as string | undefined) || undefined,
      fileSize: (fileInfo?.size_mb as number | undefined) || 0,
      lastModified: (fileInfo?.modified_time as number | undefined) || Date.now(),
      isPreviewNode: true,
      createdAt: Date.now(),
      outputPortConnected: false,
      headerRow: 0,
      sourceMode: sourceMode,
    }

    // Step 7: 创建节点并添加到画布
    const node = {
      id: nodeData.id,
      type: 'sourcePreview',
      position,
      data: nodeData,
      selected: false,
      dragging: false,
    }

    addNodes([node])

    logger.debug('📊 数据源预览节点已创建:', nodeData)
    return node
  }

  /**
   * 处理重复数据源节点
   *
   * 【职责说明】
   * 当检测到用户尝试创建已存在的数据源预览节点时调用。
   * 当前实现仅记录警告日志，可扩展为：
   * - 高亮显示已存在的节点
   * - 自动定位到已存在的节点
   * - 显示通知提示用户
   *
   * @param existingNode - 已存在的节点信息对象
   * @param existingNode.data - 节点数据对象（可选）
   * @param existingNode.data.fileId - 文件标识符（可选）
   *
   * @example
   * handleDuplicateSourceNode({ data: { fileId: 'C:/data/users.xlsx' } });
   * // 控制台输出: 数据源已存在: C:/data/users.xlsx
   */
  const handleDuplicateSourceNode = (existingNode: { data?: { fileId?: string } }) => {
    logger.warn(`数据源已存在: ${existingNode.data?.fileId}`)
  }

  return {
    fetchPreviewData,
    createSourcePreviewNode,
    handleDuplicateSourceNode,
  }
}
