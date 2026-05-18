/**
 * @file useConnectionValidator.ts
 * @description 连接验证组合式函数
 *
 * 核心功能：
 * - 验证节点之间的连接是否符合规则
 * - 检查源节点类型和目标节点类型的兼容性
 * - 验证连接 Handle 的有效性
 * - 提供国际化错误消息支持
 *
 * 验证规则：
 * - INCOMPATIBLE_SOURCE_TYPE: 源节点类型不支持此连接
 * - INCOMPATIBLE_TARGET_TYPE: 目标节点类型不支持此连接
 * - SOURCE_HANDLE_NOT_ALLOWED: 源 Handle 不允许此连接
 *
 * 使用方式：
 * const { validateConnection, canConnect } = useConnectionValidator();
 * const result = validateConnection(connection, context);
 */
import { logger } from '@/core/utils/logger'
import { computed } from 'vue'
import type { Node, Connection } from '@vue-flow/core'
import {
  connectionRules,
  getRulesForSourceNodeType,
  type ConnectionRule,
  type ValidationResult,
  type ValidationErrorCode,
  type ConnectionValidationContext,
} from '@/services/rules'

export interface UseConnectionValidatorOptions {
  existingConnections?: Connection[]
  enableI18n?: boolean
}

const ERROR_MESSAGES: Record<ValidationErrorCode, string> = {
  INCOMPATIBLE_SOURCE_TYPE: 'Source node type does not support this connection',
  INCOMPATIBLE_TARGET_TYPE: 'Target node type does not support this connection',
  SOURCE_HANDLE_NOT_ALLOWED: 'Source handle does not allow this connection',
  TARGET_HANDLE_NOT_ALLOWED: 'Target handle does not allow this connection',
  HANDLE_MISMATCH: 'Handle mismatch',
  MULTIPLE_CONNECTIONS_NOT_ALLOWED: 'This connection type does not support multiple connections',
  NO_MATCHING_RULE: 'No matching connection rule found',
}

export function useConnectionValidator(options: UseConnectionValidatorOptions = {}) {
  const { enableI18n = false } = options

  // 将外部传入的连接数组转换为响应式计算属性
  // 目的：确保当外部连接数组变化时，验证结果会自动更新
  const existingConnections = computed(() => options.existingConnections || [])

  /**
   * 获取错误码对应的错误消息
   * @param errorCode - 验证错误代码
   * @returns 本地化的错误消息字符串
   */
  function getErrorMessage(errorCode: ValidationErrorCode): string {
    return ERROR_MESSAGES[errorCode] || 'Unknown connection validation error'
  }

  /**
   * 查找源节点和目标节点之间匹配连接规则
   *
   * 业务逻辑：
   * 1. 根据源节点类型获取所有可用的出站规则
   * 2. 遍历规则列表，查找目标节点类型匹配的规则
   * 3. 如果规则定义了 Handle 约束，则进一步检查 Handle 是否兼容
   *
   * @param sourceNode - 源节点（数据输出方）
   * @param sourceHandle - 源节点 Handle ID（可选）
   * @param targetNode - 目标节点（数据接收方）
   * @param targetHandle - 目标节点 Handle ID（可选）
   * @returns 匹配的连接规则，如果无匹配则返回 null
   */
  function findMatchingRule(
    sourceNode: Node,
    sourceHandle: string | undefined,
    targetNode: Node,
    targetHandle: string | undefined
  ): ConnectionRule | null {
    // Step 1: 获取源节点类型对应的所有出站规则
    // 目的：缩小搜索范围，避免遍历所有规则
    const sourceRules = getRulesForSourceNodeType(sourceNode.type)

    // Step 2: 遍历规则列表，查找匹配的规则
    for (const rule of sourceRules) {
      // 2.1: 检查目标节点类型是否在规则允许的范围内
      // 目的：确保只有兼容的节点类型才能连接
      if (!rule.target.nodeTypes.some((t) => t === targetNode.type)) {
        continue
      }

      // 2.2: 检查目标 Handle 是否符合规则约束
      // 场景：某些规则可能只允许连接到特定的 Handle（如 "regex-input"）
      if (rule.target.handles && rule.target.handles.length > 0) {
        // 如果规则定义了目标 Handle，但提供的 Handle 不在允许列表中，则跳过
        if (targetHandle && !rule.target.handles.includes(targetHandle)) {
          continue
        }
      }

      // 2.3: 检查源 Handle 是否符合规则约束
      // 场景：某些节点可能有多个输出 Handle，需要区分数据类型
      if (rule.source.handles && rule.source.handles.length > 0) {
        if (sourceHandle && !rule.source.handles.includes(sourceHandle)) {
          continue
        }
      }

      // 找到匹配的规则，立即返回
      // 优化：使用第一个匹配规则，符合直觉（先定义的规则优先）
      return rule
    }

    // 无匹配规则
    return null
  }

  /**
   * 检查连接是否违反"单连接"约束
   *
   * 架构决策：
   * 某些连接类型不允许一对多（如一个 Source 只能连接一个 Schema）
   * 这是数据流的单向性决定的，避免数据分叉导致的复杂度和歧义
   *
   * @param rule - 连接规则
   * @param sourceNode - 源节点
   * @param targetNode - 目标节点
   * @returns 如果允许连接返回 true，否则返回 false
   */
  function checkMultipleConnectionConstraint(
    rule: ConnectionRule,
    sourceNode: Node,
    targetNode: Node
  ): boolean {
    // 检查规则是否禁止多重连接
    if (rule.config?.allowMultiple === false) {
      // 遍历现有连接，检查是否已存在相同的源-目标对
      // 副作用：O(n) 时间复杂度，但 n 通常较小（画布连接数 < 1000）
      const hasExistingConnection = existingConnections.value.some(
        (conn) => conn.source === sourceNode.id && conn.target === targetNode.id
      )
      if (hasExistingConnection) {
        return false
      }
    }
    return true
  }

  /**
   * 验证源节点类型是否符合规则要求
   *
   * @param sourceNode - 源节点
   * @param rule - 连接规则
   * @returns 验证结果对象
   */
  function validateSourceNodeType(
    sourceNode: Node,
    rule: ConnectionRule
  ): { valid: boolean; errorCode?: ValidationErrorCode } {
    // 卫语句：确保源节点类型在规则允许的列表中
    if (!rule.source.nodeTypes.some((t) => t === sourceNode.type)) {
      return { valid: false, errorCode: 'INCOMPATIBLE_SOURCE_TYPE' }
    }
    return { valid: true }
  }

  /**
   * 验证目标节点类型是否符合规则要求
   *
   * @param targetNode - 目标节点
   * @param rule - 连接规则
   * @returns 验证结果对象
   */
  function validateTargetNodeType(
    targetNode: Node,
    rule: ConnectionRule
  ): { valid: boolean; errorCode?: ValidationErrorCode } {
    // 卫语句：确保目标节点类型在规则允许的列表中
    if (!rule.target.nodeTypes.some((t) => t === targetNode.type)) {
      return { valid: false, errorCode: 'INCOMPATIBLE_TARGET_TYPE' }
    }
    return { valid: true }
  }

  /**
   * 验证源 Handle 是否符合规则要求
   *
   * 业务逻辑：
   * 某些节点有多个输出 Handle，每个 Handle 代表不同的数据类型
   * 例如 Schema 节点可能有 "data-output" 和 "metadata-output" 两个 Handle
   *
   * @param sourceHandle - 源节点 Handle ID
   * @param rule - 连接规则
   * @returns 验证结果对象
   */
  function validateSourceHandle(
    sourceHandle: string | undefined,
    rule: ConnectionRule
  ): { valid: boolean; errorCode?: ValidationErrorCode } {
    // 如果规则定义了源 Handle 约束
    if (rule.source.handles && rule.source.handles.length > 0) {
      // 检查提供的 Handle 是否在允许列表中
      // 注意：sourceHandle 为 undefined 在某些场景下是合法的（如不关心具体 Handle）
      if (!sourceHandle || !rule.source.handles.includes(sourceHandle)) {
        return { valid: false, errorCode: 'SOURCE_HANDLE_NOT_ALLOWED' }
      }
    }
    return { valid: true }
  }

  /**
   * 验证目标 Handle 是否符合规则要求
   *
   * @param targetHandle - 目标节点 Handle ID
   * @param rule - 连接规则
   * @returns 验证结果对象
   */
  function validateTargetHandle(
    targetHandle: string | undefined,
    rule: ConnectionRule
  ): { valid: boolean; errorCode?: ValidationErrorCode } {
    // 如果规则定义了目标 Handle 约束
    if (rule.target.handles && rule.target.handles.length > 0) {
      if (!targetHandle || !rule.target.handles.includes(targetHandle)) {
        return { valid: false, errorCode: 'TARGET_HANDLE_NOT_ALLOWED' }
      }
    }
    return { valid: true }
  }

  /**
   * 验证连接是否合法的主入口函数
   *
   * 验证流程（按顺序执行，发现错误立即返回）：
   * 1. 前置检查：节点是否存在、是否自连接
   * 2. 规则匹配：查找源-目标节点类型对应的规则
   * 3. 节点类型验证：确保节点类型兼容
   * 4. Handle 验证：确保连接的端点兼容
   * 5. 多重连接约束：检查是否违反单连接限制
   *
   * 副作用：
   * - [Vue Flow] 验证结果会影响 UI 是否允许拖拽连接线
   * - 验证失败时，会显示错误提示 Tooltip
   *
   * @param sourceNode - 源节点（数据输出方）
   * @param sourceHandle - 源节点 Handle ID
   * @param targetNode - 目标节点（数据接收方）
   * @param targetHandle - 目标节点 Handle ID
   * @returns 验证结果，包含是否有效、错误代码和错误消息
   */
  function validateConnection(
    sourceNode: Node,
    sourceHandle: string | undefined,
    targetNode: Node,
    targetHandle: string | undefined
  ): ValidationResult {
    // ===== 前置检查阶段 =====

    // 调试日志
    logger.debug('[ConnectionValidator] validateConnection called:')
    logger.debug('  sourceNode.type:', sourceNode?.type, 'id:', sourceNode?.id)
    logger.debug('  sourceHandle:', sourceHandle)
    logger.debug('  targetNode.type:', targetNode?.type, 'id:', targetNode?.id)
    logger.debug('  targetHandle:', targetHandle)

    // 检查节点是否存在（防御性编程）
    if (!sourceNode || !targetNode) {
      logger.debug('[ConnectionValidator] Reject: nodes missing')
      return {
        isValid: false,
        errorCode: 'NO_MATCHING_RULE',
        message: getErrorMessage('NO_MATCHING_RULE'),
      }
    }

    // 检查是否自连接（禁止节点连接到自身）
    // 原因：自连接没有业务意义，且可能导致无限递归
    if (sourceNode.id === targetNode.id) {
      logger.debug('[ConnectionValidator] Reject: self-connection')
      return {
        isValid: false,
        errorCode: 'NO_MATCHING_RULE',
        message: getErrorMessage('NO_MATCHING_RULE'),
      }
    }

    // ===== 规则匹配阶段 =====

    // 查找源-目标节点类型对应的连接规则
    const rule = findMatchingRule(sourceNode, sourceHandle, targetNode, targetHandle)

    // 无匹配规则：说明这两个节点类型之间不允许连接
    if (!rule) {
      logger.debug('[ConnectionValidator] Reject: no matching rule')
      return {
        isValid: false,
        errorCode: 'NO_MATCHING_RULE',
        message: getErrorMessage('NO_MATCHING_RULE'),
      }
    }

    logger.debug('[ConnectionValidator] Matched rule:', rule.id)

    // ===== 节点类型验证阶段 =====

    // 验证源节点类型是否符合规则要求
    const sourceTypeResult = validateSourceNodeType(sourceNode, rule)
    if (!sourceTypeResult.valid) {
      logger.debug('[ConnectionValidator] Reject: source type validation failed', sourceTypeResult)
      return {
        isValid: false,
        rule,
        errorCode: sourceTypeResult.errorCode,
        message: getErrorMessage(sourceTypeResult.errorCode!),
      }
    }

    // 验证目标节点类型是否符合规则要求
    const targetTypeResult = validateTargetNodeType(targetNode, rule)
    if (!targetTypeResult.valid) {
      logger.debug('[ConnectionValidator] Reject: target type validation failed', targetTypeResult)
      return {
        isValid: false,
        rule,
        errorCode: targetTypeResult.errorCode,
        message: getErrorMessage(targetTypeResult.errorCode!),
      }
    }

    // ===== Handle 验证阶段 =====

    // 验证源 Handle 是否符合规则约束
    const sourceHandleResult = validateSourceHandle(sourceHandle, rule)
    if (!sourceHandleResult.valid) {
      logger.debug(
        '[ConnectionValidator] Reject: source handle validation failed',
        sourceHandleResult
      )
      return {
        isValid: false,
        rule,
        errorCode: sourceHandleResult.errorCode,
        message: getErrorMessage(sourceHandleResult.errorCode!),
      }
    }

    // 验证目标 Handle 是否符合规则约束
    const targetHandleResult = validateTargetHandle(targetHandle, rule)
    if (!targetHandleResult.valid) {
      logger.debug(
        '[ConnectionValidator] Reject: target handle validation failed',
        targetHandleResult
      )
      return {
        isValid: false,
        rule,
        errorCode: targetHandleResult.errorCode,
        message: getErrorMessage(targetHandleResult.errorCode!),
      }
    }

    // ===== 多重连接约束检查阶段 =====

    // 检查是否违反单连接限制
    if (!checkMultipleConnectionConstraint(rule, sourceNode, targetNode)) {
      logger.debug('[ConnectionValidator] Reject: multiple connection constraint failed')
      return {
        isValid: false,
        rule,
        errorCode: 'MULTIPLE_CONNECTIONS_NOT_ALLOWED',
        message: getErrorMessage('MULTIPLE_CONNECTIONS_NOT_ALLOWED'),
      }
    }

    // ===== 验证通过 =====
    return {
      isValid: true,
      rule,
    }

    logger.debug('[ConnectionValidator] Accept: connection is valid!')
  }

  function validateConnectionWithContext(context: ConnectionValidationContext): ValidationResult {
    return validateConnection(
      context.sourceNode,
      context.sourceHandle,
      context.targetNode,
      context.targetHandle
    )
  }

  function getAllowedTargetsForSource(
    sourceNode: Node,
    sourceHandle: string | undefined,
    allNodes: Node[]
  ): Array<{ node: Node; handle?: string; rule: ConnectionRule }> {
    const allowedTargets: Array<{ node: Node; handle?: string; rule: ConnectionRule }> = []
    const sourceRules = getRulesForSourceNodeType(sourceNode.type)

    for (const rule of sourceRules) {
      for (const targetNode of allNodes) {
        if (!rule.target.nodeTypes.some((t) => t === targetNode.type)) {
          continue
        }

        const isMatch =
          (!sourceHandle || !rule.source.handles || rule.source.handles.includes(sourceHandle)) &&
          (!rule.target.handles || rule.target.handles.length === 0)

        if (isMatch) {
          allowedTargets.push({ node: targetNode, rule })
        } else if (rule.target.handles && rule.target.handles.length > 0) {
          for (const handle of rule.target.handles) {
            allowedTargets.push({ node: targetNode, handle, rule })
          }
        }
      }
    }

    return allowedTargets
  }

  function sanitizeConnections(nodes: Node[], connections: Connection[]): Connection[] {
    const validConnections: Connection[] = []

    for (const conn of connections) {
      const sourceNode = nodes.find((n) => n.id === conn.source)
      const targetNode = nodes.find((n) => n.id === conn.target)

      if (!sourceNode || !targetNode) {
        continue
      }

      const result = validateConnection(
        sourceNode,
        conn.sourceHandle,
        targetNode,
        conn.targetHandle
      )

      if (result.isValid) {
        validConnections.push(conn)
      }
    }

    return validConnections
  }

  return {
    validateConnection,
    validateConnectionWithContext,
    getAllowedTargetsForSource,
    sanitizeConnections,
    getErrorMessage,
  }
}
