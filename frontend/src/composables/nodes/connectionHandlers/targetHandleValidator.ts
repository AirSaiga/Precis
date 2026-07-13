/**
 * @file targetHandleValidator.ts
 * @description 约束目标端口合法性校验（纯函数，从 useConnections B1 抽出）
 *
 * 校验"源（Schema/ManualData/TransformOutput 等）→ 约束"连接的目标端口是否合法：
 * - 非约束目标：直接放行
 * - 需要 input handle 的约束类型（如 scripted）：必须命中 target-input
 * - conditional 约束：必须命中 if 或 then（含 legacy input）handle
 * - 其他约束：放行（默认 target-left）
 *
 * 特征：纯函数，无副作用。便于单元测试覆盖每种约束类型的端口规则。
 *
 * 依赖方向：→ constraintMeta（类型/handle 元数据查询）
 */

import {
  getConstraintKindByNodeType,
  requiresInputHandle,
} from '@/services/constraints/validationRegistry'

/**
 * 校验约束目标端口是否合法
 *
 * 迁移自 useConnections.ts handleConnectionCompleted 内的 isValidConstraintTargetHandle。
 *
 * @param targetNodeId - 目标节点 ID（conditional 的 if/then handle 名含节点 ID）
 * @param targetNodeType - 目标节点类型，如 'notNullConstraint' / 'conditionalConstraint'
 * @param targetHandle - 目标 handle ID
 * @returns true 表示端口合法（或目标非约束类型）；false 表示端口不匹配
 */
export function isValidConstraintTargetHandle(
  targetNodeId: string,
  targetNodeType: string | undefined,
  targetHandle: string | null | undefined
): boolean {
  const constraintType = getConstraintKindByNodeType(targetNodeType)
  if (!constraintType) return true
  if (requiresInputHandle(targetNodeType)) {
    return !!targetHandle && targetHandle.includes('target-input')
  }
  if (constraintType === 'conditional') {
    if (!targetHandle) return false
    const isIfHandle =
      targetHandle === `target-if-${targetNodeId}` ||
      targetHandle.startsWith(`target-if-${targetNodeId}:`)
    const isThenHandle =
      targetHandle.includes(`target-then-${targetNodeId}`) ||
      targetHandle.includes(`target-input-${targetNodeId}`)
    return isIfHandle || isThenHandle
  }
  return true
}
