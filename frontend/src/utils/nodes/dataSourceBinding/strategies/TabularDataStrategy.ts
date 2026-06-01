// DEAD CODE — dataSourceBinding 策略模式从未被任何生产代码引用，注释保留供参考。
/*
import { BaseDataBindingStrategy } from './DataSourceBindingStrategy'
import { tabularColumnGenerator } from '../../columnGeneration/TabularColumnGenerator'
import type { DataSourceBindingStrategy, BindingOptions, BindingResult } from './DataSourceBindingStrategy'
import type { ColumnGenerationStrategy } from '../../columnGeneration/types'
import type { CustomNode } from '@/types/graph'
import type { UnifiedPreviewData } from '../../preview/PreviewDataFetcher'

export class TabularDataStrategy extends BaseDataBindingStrategy implements DataSourceBindingStrategy {
  readonly name = 'tabular'
  readonly supportedNodeTypes = ['schema']
  readonly columnGenerator: ColumnGenerationStrategy = tabularColumnGenerator

  async bind(
    previewData: UnifiedPreviewData,
    targetNode: CustomNode,
    options?: BindingOptions
  ): Promise<BindingResult> {
    if (!this.validateCompatibility(previewData, targetNode)) {
      return { success: false, error: 'Incompatible data source or target node' }
    }

    const existingData = (targetNode.data || {}) as Record<string, unknown>
    const existingColumns = (existingData.columns as unknown[]) || []

    const newColumns = this.columnGenerator.generate(previewData.rawData, existingColumns)

    if (!newColumns || newColumns.length === 0) {
      return { success: false, error: 'Failed to generate columns from preview data' }
    }

    const sourceFields = previewData.fields || []
    const comparison = this.columnGenerator.compare(
      sourceFields,
      existingColumns
    )

    const updates = this.buildNodeDataUpdates(targetNode, {
      columns: newColumns,
      sourceFormat: previewData.format || 'csv',
      rowCount: previewData.rowCount,
      lastBoundAt: new Date().toISOString(),
    })

    return {
      success: true,
      columnsGenerated: newColumns.length,
      fieldsMatched: comparison.isMatch,
    }
  }
}

export const tabularDataStrategy = new TabularDataStrategy()
*/
