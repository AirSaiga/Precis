/**
 * @fileoverview Transform Builder
 *
 * 将 transform 节点转换为 TransformFileV2。
 */

import type { TransformNodeData } from '@/types/graph'
import type { TransformFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../types'
export const transformBuilder: NodeBuilder<TransformFileV2> = {
  kind: 'transform',
  matches: (node) => node.type === 'transform',
  build({ node }: BuilderContext): { consumed: boolean; file: TransformFileV2 } {
    const data = node.data as TransformNodeData

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: data.transformType,
        enabled: data.enabled !== false,
        description: data.description || undefined,
        input_from_node: data.inputFromNode || undefined,
        input_column: data.inputColumn || undefined,
        params: data.params || {},
        output_columns: data.outputColumns || [],
      },
    }
  },
}
