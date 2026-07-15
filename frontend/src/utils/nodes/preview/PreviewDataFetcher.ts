/**
 * @file PreviewDataFetcher.ts
 * @description 预览数据获取抽象层
 *
 * 统一从不同来源获取预览数据的接口。
 */

import { fetchPreviewDataFromPath } from '@/services/preview/fetchPreviewFromPath'
import { logger } from '@/core/utils/logger'
import type { CustomNode } from '@/types/graph'

/** 预览数据来源 */
export type PreviewSource =
  | { type: 'node'; node: CustomNode }
  | {
      type: 'filePath'
      filePath: string
      format?: string
      sheetName?: string
      jsonOptions?: { jsonPath?: string; jsonFormat?: string; recordPath?: string }
    }

/** 统一预览数据结构 */
export interface UnifiedPreviewData {
  /** 原始数据 */
  rawData: unknown
  /** 数据行数 */
  rowCount: number
  /** 列名/字段列表 */
  fields?: string[]
  /** 格式信息 */
  format?: string
  /** 元数据 */
  metadata?: {
    typeInference?: Record<string, string>
    fieldCount?: number
    nestDepth?: number
  }
}

/** 预览数据获取器接口 */
export interface PreviewDataFetcher {
  /** 获取预览数据 */
  fetch(source: PreviewSource): Promise<UnifiedPreviewData | null>
}

/** 从节点获取预览数据 */
export class NodePreviewFetcher implements PreviewDataFetcher {
  async fetch(source: PreviewSource): Promise<UnifiedPreviewData | null> {
    if (source.type !== 'node') return null

    const node = source.node
    const nodeData = (node.data || {}) as Record<string, unknown>

    // 处理 JSON preview 节点
    if (node.type === 'jsonSourcePreview') {
      const rawData = nodeData.rawData as unknown[] | undefined
      if (!rawData || !Array.isArray(rawData)) return null

      const firstRecord = rawData[0]
      const fields =
        firstRecord && typeof firstRecord === 'object' && !Array.isArray(firstRecord)
          ? Object.keys(firstRecord as Record<string, unknown>)
          : undefined

      return {
        rawData,
        rowCount: rawData.length,
        fields,
        format: (nodeData.format as string) || 'auto',
        metadata: {
          typeInference: nodeData.typeInference as Record<string, string> | undefined,
          fieldCount: nodeData.fieldCount as number | undefined,
          nestDepth: nodeData.nestDepth as number | undefined,
        },
      }
    }

    // 处理 Tabular preview 节点 (sourcePreview)
    if (node.type === 'sourcePreview') {
      const rawData = nodeData.data as string[][] | undefined

      if (!rawData) return null

      const headerRow = nodeData.headerRow as number | undefined
      const firstRow = rawData[0]
      const hasHeaders =
        headerRow !== undefined && headerRow >= 0 && rawData.length > 0 && firstRow !== undefined
      const headers = hasHeaders && firstRow ? firstRow.map((h) => String(h)) : undefined

      return {
        rawData,
        rowCount: rawData.length,
        fields: headers,
        format: (nodeData.format as string) || 'csv',
      }
    }

    return null
  }
}

/** 从文件路径获取预览数据 */
export class FilePreviewFetcher implements PreviewDataFetcher {
  async fetch(source: PreviewSource): Promise<UnifiedPreviewData | null> {
    if (source.type !== 'filePath') return null

    try {
      const result = await fetchPreviewDataFromPath(
        source.filePath,
        65535,
        65535,
        source.sheetName,
        source.jsonOptions
      )

      if (!result) return null

      // 根据格式处理响应
      const isJson = source.format === 'json' || result.source_type === 'json'

      if (isJson) {
        // JSON 数据：result.data 可能包含 raw_data 等字段（后端 API 返回结构）
        const rawData = result.raw_data
        if (rawData && Array.isArray(rawData)) {
          const firstRecord = rawData[0]
          const fields =
            firstRecord && typeof firstRecord === 'object' && !Array.isArray(firstRecord)
              ? Object.keys(firstRecord as Record<string, unknown>)
              : undefined

          return {
            rawData,
            rowCount: rawData.length,
            fields,
            format: source.format || 'json',
            metadata: {
              typeInference: result.type_inference,
              fieldCount: result.field_count,
              nestDepth: result.nest_depth,
            },
          }
        }
      }

      // Tabular 格式
      const rawData = (result.data as string[][]) || []

      return {
        rawData,
        rowCount: result.actualRowCount || 0,
        fields: rawData.length > 0 ? rawData[0] : undefined,
        format: source.format || 'csv',
      }
    } catch (error) {
      logger.error('Failed to fetch file preview:', error)
      return null
    }
  }
}

/** 组合获取器：优先从节点获取，否则从文件路径 */
export class CompositePreviewFetcher implements PreviewDataFetcher {
  private nodeFetcher = new NodePreviewFetcher()
  private fileFetcher = new FilePreviewFetcher()

  async fetch(source: PreviewSource): Promise<UnifiedPreviewData | null> {
    if (source.type === 'node') {
      const result = await this.nodeFetcher.fetch(source)
      if (result) return result

      // 如果节点没有预览数据，尝试从节点的 localPath/filePath 获取
      const node = source.node
      const nodeData = (source.node.data || {}) as Record<string, unknown>
      const filePath =
        (nodeData?.localPath as string | undefined) || (nodeData?.filePath as string | undefined)

      if (filePath) {
        const isJsonSource = node.type === 'jsonSourcePreview'
        return this.fileFetcher.fetch({
          type: 'filePath',
          filePath,
          format: (nodeData?.format as string) || undefined,
          sheetName: (nodeData?.currentSheet as string) || undefined,
          jsonOptions: {
            jsonPath: (nodeData?.jsonPath as string) || undefined,
            jsonFormat: isJsonSource ? (nodeData?.format as string) || undefined : undefined,
            recordPath: (nodeData?.recordPath as string) || undefined,
          },
        })
      }
    }

    if (source.type === 'filePath') {
      return this.fileFetcher.fetch(source)
    }

    return null
  }
}

/** 默认组合获取器实例 */
export const previewDataFetcher: PreviewDataFetcher = new CompositePreviewFetcher()
