// DEAD CODE — dataSourceBinding 策略模式从未被任何生产代码引用，注释保留供参考。
/*
import { previewDataFetcher } from '../preview/PreviewDataFetcher'
import { tabularDataStrategy } from './strategies/TabularDataStrategy'
import { jsonDataStrategy } from './strategies/JsonDataStrategy'
import type { PreviewSource, PreviewDataFetcher } from '../preview/PreviewDataFetcher'
import type { DataSourceBindingStrategy, BindingOptions, BindingResult } from './strategies/DataSourceBindingStrategy'
import type { CustomNode } from '@/types/graph'

const strategyRegistry = new Map<string, DataSourceBindingStrategy>([
  ['schema', tabularDataStrategy],
  ['jsonSchema', jsonDataStrategy],
])

function getNodeType(node: CustomNode): string | undefined {
  return ((node.data || {}) as Record<string, unknown>).type as string | undefined
}

function getStrategyForNode(node: CustomNode): DataSourceBindingStrategy | null {
  const nodeType = getNodeType(node)
  if (!nodeType) return null

  return strategyRegistry.get(nodeType) || null
}

export interface OrchestratorResult {
  success: boolean
  stage: 'fetch' | 'validate' | 'bind' | 'complete'
  bindingResult?: BindingResult
  error?: string
}

export class DataSourceBindingOrchestrator {
  constructor(private fetcher: PreviewDataFetcher = previewDataFetcher) {}

  async execute(
    source: PreviewSource,
    targetNode: CustomNode,
    options?: BindingOptions
  ): Promise<OrchestratorResult> {
    const previewData = await this.fetcher.fetch(source)
    if (!previewData) {
      return { success: false, stage: 'fetch', error: 'Failed to fetch preview data' }
    }

    const strategy = getStrategyForNode(targetNode)
    if (!strategy) {
      return {
        success: false,
        stage: 'validate',
        error: `No binding strategy found for node type: ${getNodeType(targetNode)}`,
      }
    }

    if (!strategy.validateCompatibility(previewData, targetNode)) {
      return {
        success: false,
        stage: 'validate',
        error: 'Data source is not compatible with target node',
      }
    }

    const bindingResult = await strategy.bind(previewData, targetNode, options)

    if (!bindingResult.success) {
      return {
        success: false,
        stage: 'bind',
        error: bindingResult.error || 'Binding failed',
        bindingResult,
      }
    }

    return {
      success: true,
      stage: 'complete',
      bindingResult,
    }
  }

  async bindFromPreviewNode(
    previewNode: CustomNode,
    targetNode: CustomNode,
    options?: BindingOptions
  ): Promise<OrchestratorResult> {
    return this.execute({ type: 'node', node: previewNode }, targetNode, options)
  }

  async bindFromFilePath(
    filePath: string,
    targetNode: CustomNode,
    format?: string,
    options?: BindingOptions
  ): Promise<OrchestratorResult> {
    return this.execute({ type: 'filePath', filePath, format }, targetNode, options)
  }
}

export const dataSourceBindingOrchestrator = new DataSourceBindingOrchestrator()
*/
