/**
 * @file graph.ts
 * @description 图形类型统一导出模块
 *
 * 该模块作为图形相关类型的统一导出入口，提供向后兼容性。
 * 大部分具体类型已迁移到专门的模块，此文件负责重新导出。
 *
 * 类型模块组织：
 * - common: 通用类型（DataType、BindingSource 等）
 * - nodes: 节点相关类型（SchemaNode、SourcePreviewNode 等）
 * - constraints: 约束节点类型（ForeignKey、Unique、NotNull 等）
 * - regex: 正则表达式节点类型
 * - datasource: 数据源类型
 * - drag: 拖拽相关类型
 *
 * 架构说明：
 * - 此文件作为类型系统的入口点
 * - 使用 barrel pattern 统一导出
 * - 保持向后兼容性，支持旧的导入方式
 *
 * 推荐导入方式：
 * ```typescript
 * // 新项目推荐：从具体模块导入
 * import type { SchemaNodeData } from '@/types/nodes';
 * import type { RegexNodeData } from '@/features/regex/types';
 *
 * // 兼容旧代码：从 graph 导入
 * import type { SchemaNodeData, RegexNodeData } from '@/types/graph';
 * ```
 */

import type { Edge } from '@vue-flow/core'

// 重新导出所有类型以保持向后兼容
export * from './common'
export * from './nodes'
export * from './constraints'
export * from '@/features/regex/types'
export * from './datasource'
export * from './drag'

// 导入需要的类型用于SubGraphData
import type { CustomNode } from './nodes'

/**
 * 子图数据结构（使用具体类型）
 */
export interface SubGraphData {
  nodes: CustomNode[]
  edges: Edge[]
}
