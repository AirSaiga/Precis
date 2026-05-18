/**
 * @file index.ts
 * @description 正则表达式节点相关组合式函数的统一导出入口
 *
 * 导出说明：
 * - useRegexValidation: 用于提供正则表达式校验功能
 * - useRegexConnections: 用于提供正则节点连接管理功能
 * - useRegexPattern: 用于提供正则模式编辑功能
 * - useRegexConnection: 用于提供正则连接操作功能
 * - useRegexNode: 用于聚合正则节点相关的组合式逻辑
 */

export { useRegexValidation } from './useRegexValidation'
export { useRegexConnections } from './useRegexConnections'
export { useRegexPattern } from './useRegexPattern'
export { useRegexConnection } from './useRegexConnection'

import { useRegexValidation } from './useRegexValidation'
import { useRegexConnections } from './useRegexConnections'
import { useRegexPattern } from './useRegexPattern'
import { useRegexConnection } from './useRegexConnection'
import type { RegexNodeData } from '@/features/regex/types'

export function useRegexNode(props: { id: string; data: RegexNodeData }, emit: any) {
  const validation = useRegexValidation()
  const connections = useRegexConnections(props, emit)
  const pattern = useRegexPattern(props, emit)
  const connection = useRegexConnection()

  return {
    ...validation,
    ...connections,
    ...pattern,
    ...connection,
  }
}
