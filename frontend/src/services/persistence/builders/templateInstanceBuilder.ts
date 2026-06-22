/**
 * @fileoverview Template Instance Builder
 *
 * 将 templateInstance 节点转换为 TemplateInstanceRefV2。
 */

import type { TemplateInstanceNodeData } from '@/types/graph'
import type { TemplateInstanceRefV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../types'
export const templateInstanceBuilder: NodeBuilder<TemplateInstanceRefV2> = {
  kind: 'templateInstance',
  matches: (node) => node.type === 'templateInstance',
  build({ node }: BuilderContext): { consumed: boolean; file: TemplateInstanceRefV2 } {
    const data = node.data as TemplateInstanceNodeData

    return {
      consumed: true,
      file: {
        id: node.id,
        template_id: data.templateId || '',
        enabled: data.enabled !== false,
      },
    }
  },
}
