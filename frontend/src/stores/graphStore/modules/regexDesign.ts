/**
 * @file regexDesign.ts
 * @description 正则表达式设计器模块 - 管理正则表达式的交互式编辑和预览
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. openRegexDesignModal: 打开正则设计器弹窗
 * 2. closeRegexDesignModal: 关闭正则设计器弹窗
 * 3. setRegexEditSampleData: 设置示例数据用于预览
 * 4. saveRegexDesign: 保存正则表达式设计
 *
 * ====================================================================
 * 正则设计器交互流程
 * ====================================================================
 * 1. 用户双击正则节点或点击编辑按钮
 * 2. openRegexDesignModal 记录当前节点 ID
 * 3. 显示正则设计器弹窗（RegexDesignModal）
 * 4. 用户在弹窗中编辑正则表达式和参数
 * 5. 点击保存时调用 saveRegexDesign
 * 6. 自动触发关联的校验更新（如有数据源连接）
 *
 * ====================================================================
 * saveRegexDesign 核心逻辑
 * ====================================================================
 * 1. 合并更新数据到节点
 * 2. 处理正则表达式变更检测
 * 3. 检测 output mapping 变更
 * 4. 检测 matchMode 变更
 * 5. 如果有变更且有数据源，触发自动重校验
 * 6. 更新 saveState 为 'draft'
 *
 * ====================================================================
 * 自动重校验触发机制
 * ====================================================================
 * 当正则表达式有重要变更时，会触发关联的校验重新运行：
 * - 触发条件：pattern/outputMapping/matchMode 任一变更
 * - 前置条件：节点已连接到数据源（sourceNodeId + sourceColumnName）
 * - 实现方式：派发 'regex-pattern-updated' 自定义事件
 * - 监听方：useRegexValidation 等 composable
 *
 * ====================================================================
 * matchMode 自动切换
 * ====================================================================
 * - 如果 output mapping 有实际内容，自动设置 matchMode 为 'extract'
 * - 'extract' 模式用于数据提取场景
 * - 'full' 模式用于完全匹配场景
 *
 * ====================================================================
 * 状态管理
 * ====================================================================
 * - designModalVisible: 弹窗可见性
 * - activeRegexNodeId: 当前编辑的节点 ID
 * - regexEditSampleData: 示例数据（用于预览）
 *
 * ====================================================================
 * 错误处理
 * ====================================================================
 * - 节点不存在时打印错误日志
 * - 保存失败显示 toast 错误提示
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - saveRegexDesign 会更新节点数据
 * - 可能触发 'regex-pattern-updated' 事件
 * - 关闭弹窗会清空 activeRegexNodeId 和 regexEditSampleData
 *
 * @module graphStore/modules
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  CustomNode,
  CustomNodeData,
  RegexDesignUpdateData,
  RegexNodeData,
} from '@/types/graph'
import { toastError, toastSuccess } from '@/core/toast'

export function createRegexDesignModule(params: {
  nodes: Ref<CustomNode[]>
  designModalVisible: Ref<boolean>
  activeRegexNodeId: Ref<string | null>
  regexEditSampleData: Ref<string>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
}) {
  const { nodes, designModalVisible, activeRegexNodeId, regexEditSampleData, updateNodeData } =
    params
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

      const mergedData: any = {
        ...currentNode.data,
        ...updatedData,
        saveState: 'draft',
      }

      if (updatedData.rules && updatedData.rules.length > 0) {
        const activeRule = updatedData.rules[0]
        if (activeRule?.regex) {
          mergedData.pattern = activeRule.regex
          logger.debug('✅ 正则表达式已更新:', activeRule.regex)
        }
      }

      let originalPattern = ''
      let patternChanged = false
      let outputMappingChanged = false
      let matchModeChanged = false

      if (currentNode.type === 'regex') {
        const nextOutput = (mergedData as RegexNodeData).rules?.[0]?.output ?? {}
        const hasOutputMapping = Object.keys(nextOutput).some((k) => String(k ?? '').trim() !== '')
        if (hasOutputMapping) {
          ;(mergedData as RegexNodeData).matchMode = 'extract'
        }

        const currentRegexData = currentNode.data as RegexNodeData
        originalPattern = currentRegexData.pattern || ''
        patternChanged = originalPattern !== mergedData.pattern

        const prevMatchMode = currentRegexData.matchMode
        const nextMatchMode = (mergedData as RegexNodeData).matchMode
        matchModeChanged = prevMatchMode !== nextMatchMode

        const safeStringify = (v: unknown) => {
          try {
            return JSON.stringify(v ?? {})
          } catch {
            return ''
          }
        }
        const prevOutput = currentRegexData.rules?.[0]?.output ?? {}
        outputMappingChanged = safeStringify(prevOutput) !== safeStringify(nextOutput)
      }

      updateNodeData(nodeId, mergedData)

      if (
        (patternChanged || outputMappingChanged || matchModeChanged) &&
        mergedData.sourceRef?.nodeId
      ) {
        const reason = patternChanged ? 'pattern' : outputMappingChanged ? 'output' : 'matchMode'
        logger.debug('🔄 正则表达式设计已更新，触发自动刷新:', { nodeId, reason })

        eventBus.emit('regex-pattern-updated', { nodeId, reason })
      }

      logger.debug('💾 正则表达式设计已保存:', {
        nodeId,
        configName: mergedData.configName,
        pattern: mergedData.pattern,
        rules: updatedData.rules,
        patternChanged,
        hasSourceConnection: !!mergedData.sourceRef?.nodeId,
      })

      const toastMessage =
        patternChanged && mergedData.sourceRef?.nodeId
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

  return {
    openRegexDesignModal,
    closeRegexDesignModal,
    setRegexEditSampleData,
    saveRegexDesign,
  }
}
