/**
 * @file regexDesign.ts
 * @description 正则表达式设计器模块 - 管理正则表达式的交互式编辑和预览
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. openRegexDesignModal: 打开正则校验节点设计器弹窗
 * 2. openRegexExtractDesignModal: 打开正则提取节点设计器弹窗
 * 3. closeRegexDesignModal / closeRegexExtractDesignModal: 关闭弹窗
 * 4. setRegexEditSampleData: 设置示例数据用于预览
 * 5. saveRegexDesign: 保存正则校验节点设计
 * 6. saveRegexExtractDesign: 保存正则提取节点设计
 *
 * ====================================================================
 * 设计器交互流程
 * ====================================================================
 * 1. 用户双击正则节点或点击编辑按钮
 * 2. openRegex*DesignModal 记录当前节点 ID
 * 3. 显示对应设计器弹窗（RegexDesignModal / RegexExtractDesignModal）
 * 4. 用户在弹窗中编辑正则表达式和参数
 * 5. 点击保存时调用 saveRegex*Design
 * 6. 自动触发关联的校验更新（如有数据源连接）
 *
 * ====================================================================
 * saveRegex*Design 核心逻辑
 * ====================================================================
 * 1. 合并更新数据到节点
 * 2. 处理正则表达式变更检测
 * 3. 检测 output mapping 变更（extract 节点为 outputColumns）
 * 4. 检测 flags / caseSensitive 变化
 * 5. 如果有变更且有数据源，触发自动重校验
 * 6. 更新 saveState 为 'draft'
 *
 * ====================================================================
 * 自动重校验触发机制
 * ====================================================================
 * 当正则表达式有重要变更时，会触发关联的校验重新运行：
 * - 触发条件：pattern/output/matchMode/flags/caseSensitive 任一变更
 * - 前置条件：节点已连接到数据源（sourceRef.nodeId / inputFromNode）
 * - 实现方式：派发 'regex-pattern-updated' 自定义事件
 * - 监听方：useRegexValidation 等 composable
 *
 * ====================================================================
 * 状态管理
 * ====================================================================
 * - designModalVisible: 校验弹窗可见性
 * - activeRegexNodeId: 当前编辑的校验节点 ID
 * - extractDesignModalVisible: 提取弹窗可见性
 * - activeRegexExtractNodeId: 当前编辑的提取节点 ID
 * - regexEditSampleData: 示例数据（用于预览）
 *
 * ====================================================================
 * 错误处理
 * ====================================================================
 * - 节点不存在时打印错误日志
 * - 保存失败显示 toast 错误提示
 *
 * @module graphStore/modules
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import type { Ref } from 'vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  CustomNode,
  CustomNodeData,
  RegexDesignUpdateData,
  RegexNodeData,
  RegexExtractNodeData,
} from '@/types/graph'
import { toastError, toastSuccess } from '@/core/toast'
import { deepToRaw } from '@/utils/typeHelpers'

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? {})
  } catch {
    return ''
  }
}

function parseNamedGroups(pattern: string): string[] {
  if (!pattern) return []
  return [...pattern.matchAll(/\(\?P<(\w+)>/g)].map((m) => m[1] || '')
}

function deriveExtractMetadata(data: Partial<RegexExtractNodeData>): {
  captureGroups: RegexExtractNodeData['captureGroups']
  outputColumns: string[]
} {
  const output = data.rules?.[0]?.output ?? {}
  const outputColumns = Object.keys(output)
  const groupNames = parseNamedGroups(data.pattern || '')
  const seen = new Set<string>()
  const captureGroups: RegexExtractNodeData['captureGroups'] = []

  for (const value of Object.values(output)) {
    const str = String(value || '')
    const match = str.match(/^\{(\w+):(\w+)\}$/)
    if (!match) continue
    const name = match[1] || ''
    if (seen.has(name)) continue
    seen.add(name)
    const groupIndex = groupNames.indexOf(name)
    if (groupIndex >= 0) {
      captureGroups.push({ name, groupIndex: groupIndex + 1 })
    }
  }

  return { captureGroups, outputColumns }
}

export function createRegexDesignModule(params: {
  nodes: Ref<CustomNode[]>
  designModalVisible: Ref<boolean>
  activeRegexNodeId: Ref<string | null>
  regexEditSampleData: Ref<string>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
  extractDesignModalVisible?: Ref<boolean>
  activeRegexExtractNodeId?: Ref<string | null>
}) {
  const {
    nodes,
    designModalVisible,
    activeRegexNodeId,
    regexEditSampleData,
    updateNodeData,
    extractDesignModalVisible = ref(false),
    activeRegexExtractNodeId = ref<string | null>(null),
  } = params
  const { t } = useI18n()

  function openRegexDesignModal(nodeId: string) {
    designModalVisible.value = true
    activeRegexNodeId.value = nodeId
  }

  function closeRegexDesignModal() {
    designModalVisible.value = false
    activeRegexNodeId.value = null
    regexEditSampleData.value = ''
  }

  function openRegexExtractDesignModal(nodeId: string) {
    extractDesignModalVisible.value = true
    activeRegexExtractNodeId.value = nodeId
  }

  function closeRegexExtractDesignModal() {
    extractDesignModalVisible.value = false
    activeRegexExtractNodeId.value = null
    regexEditSampleData.value = ''
  }

  function setRegexEditSampleData(data: string) {
    regexEditSampleData.value = data
  }

  function saveRegexDesign(nodeId: string, updatedData: RegexDesignUpdateData) {
    try {
      const currentNode = nodes.value.find((n) => n.id === nodeId)
      if (!currentNode) {
        logger.error('❌ 找不到指定的正则表达式节点:', nodeId)
        return
      }

      if (currentNode.type !== 'regex') {
        logger.error('❌ saveRegexDesign 只能用于 regex 节点:', nodeId)
        return
      }

      const mergedData: Partial<RegexNodeData> & { saveState: 'draft' } = {
        ...(deepToRaw(currentNode.data) as RegexNodeData),
        ...updatedData,
        saveState: 'draft',
      } as Partial<RegexNodeData> & { saveState: 'draft' }

      if (updatedData.rules && updatedData.rules.length > 0) {
        const activeRule = updatedData.rules[0]
        if (activeRule?.regex) {
          mergedData.pattern = activeRule.regex
        }
      }

      const currentRegexData = currentNode.data as RegexNodeData
      const originalPattern = currentRegexData.pattern || ''
      const patternChanged = originalPattern !== mergedData.pattern

      const prevMatchMode = currentRegexData.matchMode
      const nextMatchMode = (mergedData as RegexNodeData).matchMode
      const matchModeChanged = prevMatchMode !== nextMatchMode

      const flagsChanged =
        (currentRegexData.flags || '') !== ((mergedData as RegexNodeData).flags || '')
      const caseSensitiveChanged = currentRegexData.caseSensitive !== mergedData.caseSensitive

      const prevOutput = currentRegexData.rules?.[0]?.output ?? {}
      const nextOutput = (mergedData.rules?.[0]?.output ?? {}) as Record<string, unknown>
      const outputMappingChanged = safeStringify(prevOutput) !== safeStringify(nextOutput)

      updateNodeData(nodeId, mergedData)

      if (
        (patternChanged ||
          outputMappingChanged ||
          matchModeChanged ||
          flagsChanged ||
          caseSensitiveChanged) &&
        (mergedData.sourceRef?.nodeId || mergedData.inputFromNode)
      ) {
        const reason = patternChanged
          ? 'pattern'
          : outputMappingChanged
            ? 'output'
            : matchModeChanged
              ? 'matchMode'
              : flagsChanged
                ? 'flags'
                : 'caseSensitive'
        logger.debug('🔄 正则表达式设计已更新，触发自动刷新:', { nodeId, reason })
        eventBus.emit('regex-pattern-updated', { nodeId, reason })
      }

      const toastMessage =
        patternChanged && (mergedData.sourceRef?.nodeId || mergedData.inputFromNode)
          ? t('regexDesignModal.savedWithRevalidation', { name: mergedData.configName })
          : t('regexDesignModal.saved', { name: mergedData.configName })
      toastSuccess(toastMessage, t('regexDesignModal.saveSuccess'))

      closeRegexDesignModal()
    } catch (error) {
      logger.error('❌ 保存正则表达式设计失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveRegexDesignFailed')
      )
    }
  }

  function saveRegexExtractDesign(nodeId: string, updatedData: Partial<RegexExtractNodeData>) {
    try {
      const currentNode = nodes.value.find((n) => n.id === nodeId)
      if (!currentNode) {
        logger.error('❌ 找不到指定的正则提取节点:', nodeId)
        return
      }

      if (currentNode.type !== 'regexExtract') {
        logger.error('❌ saveRegexExtractDesign 只能用于 regexExtract 节点:', nodeId)
        return
      }

      const mergedData: Partial<RegexExtractNodeData> & { saveState: 'draft' } = {
        ...(deepToRaw(currentNode.data) as RegexExtractNodeData),
        ...updatedData,
        saveState: 'draft',
      } as Partial<RegexExtractNodeData> & { saveState: 'draft' }

      if (updatedData.rules && updatedData.rules.length > 0) {
        const activeRule = updatedData.rules[0]
        if (activeRule?.regex) {
          mergedData.pattern = activeRule.regex
        }
      }

      const { captureGroups, outputColumns } = deriveExtractMetadata(mergedData)
      mergedData.captureGroups = captureGroups
      mergedData.outputColumns = outputColumns

      const currentData = currentNode.data as RegexExtractNodeData
      const patternChanged = (currentData.pattern || '') !== (mergedData.pattern || '')
      const outputChanged =
        safeStringify(currentData.outputColumns || []) !== safeStringify(outputColumns)
      const flagsChanged = (currentData.flags || '') !== (mergedData.flags || '')
      const caseSensitiveChanged = !!currentData.caseSensitive !== !!mergedData.caseSensitive

      updateNodeData(nodeId, mergedData)

      if (
        (patternChanged || outputChanged || flagsChanged || caseSensitiveChanged) &&
        (mergedData.sourceRef?.nodeId || mergedData.inputFromNode)
      ) {
        const reason = patternChanged
          ? 'pattern'
          : outputChanged
            ? 'output'
            : flagsChanged
              ? 'flags'
              : 'caseSensitive'
        logger.debug('🔄 正则提取设计已更新，触发自动刷新:', { nodeId, reason })
        eventBus.emit('regex-pattern-updated', { nodeId, reason })
      }

      const toastMessage =
        patternChanged && (mergedData.sourceRef?.nodeId || mergedData.inputFromNode)
          ? t('regexDesignModal.savedWithRevalidation', { name: mergedData.configName })
          : t('regexDesignModal.saved', { name: mergedData.configName })
      toastSuccess(toastMessage, t('regexDesignModal.saveSuccess'))

      closeRegexExtractDesignModal()
    } catch (error) {
      logger.error('❌ 保存正则提取设计失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveRegexDesignFailed')
      )
    }
  }

  return {
    openRegexDesignModal,
    closeRegexDesignModal,
    openRegexExtractDesignModal,
    closeRegexExtractDesignModal,
    setRegexEditSampleData,
    saveRegexDesign,
    saveRegexExtractDesign,
  }
}
