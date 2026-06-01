// DEAD CODE — dataSourceBinding 策略模式从未被任何生产代码引用，注释保留供参考。
// 如需启用，需重新设计以覆盖完整绑定生命周期（节点/边创建、UI 对话框、校验触发）。
/*
import type { CustomNode } from '@/types/graph'
import type { UnifiedPreviewData } from '../../preview/PreviewDataFetcher'
import type { ColumnGenerationStrategy } from '../../columnGeneration/types'

export interface BindingResult {
  success: boolean
  updatedNode?: CustomNode
  error?: string
  columnsGenerated?: number
  fieldsMatched?: boolean
}

export interface DataSourceBindingStrategy {
  readonly name: string
  readonly supportedNodeTypes: string[]
  readonly columnGenerator: ColumnGenerationStrategy

  bind(
    previewData: UnifiedPreviewData,
    targetNode: CustomNode,
    options?: BindingOptions
  ): Promise<BindingResult>

  validateCompatibility(previewData: UnifiedPreviewData, targetNode: CustomNode): boolean
}

export interface BindingOptions {
  forceRegenerateColumns?: boolean
  preserveExistingConfig?: boolean
  maxDepth?: number
}

export abstract class BaseDataBindingStrategy implements DataSourceBindingStrategy {
  abstract readonly name: string
  abstract readonly supportedNodeTypes: string[]
  abstract readonly columnGenerator: ColumnGenerationStrategy

  abstract bind(
    previewData: UnifiedPreviewData,
    targetNode: CustomNode,
    options?: BindingOptions
  ): Promise<BindingResult>

  validateCompatibility(previewData: UnifiedPreviewData, targetNode: CustomNode): boolean {
    if (!previewData.rawData) return false
    if (!targetNode.data) return false

    const nodeType = ((targetNode.data || {}) as Record<string, unknown>).type as string
    return this.supportedNodeTypes.includes(nodeType)
  }

  protected buildNodeDataUpdates(
    targetNode: CustomNode,
    updates: Record<string, unknown>
  ): Record<string, unknown> {
    const existingData = (targetNode.data || {}) as Record<string, unknown>
    return {
      ...existingData,
      ...updates,
      sourceNodeId: targetNode.id,
    }
  }
}
*/
