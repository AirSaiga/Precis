/**
 * @fileoverview NodeDataBuilder 统一导出
 *
 * 导入本模块即触发各 builder 的自注册。
 * 使用方只需导入 buildNodeData 即可。
 */

export { buildNodeData, registerBuilder } from './registry'
export type {
  BuildInput,
  BuildResult,
  EdgeDescriptor,
  BuildMode,
  ColumnRef,
  FKRefs,
  ConditionalIfItem,
} from './types'

// 触发各 builder 的自注册
import './simpleConstraint'
import './foreignKey'
import './conditional'
import './regex'
