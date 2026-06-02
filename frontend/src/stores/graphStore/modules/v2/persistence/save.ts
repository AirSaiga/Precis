/**
 * @file save.ts
 * @description V2 配置持久化保存模块 - 负责将画布节点数据保存到文件系统
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. saveProject: 保存整个项目（所有 Schema、Constraint、Regex 节点）
 * 2. saveSchemaNode: 保存单个 Schema 节点（支持冲突检测）
 * 3. saveConstraintNode: 保存单个约束节点
 * 4. saveRegexNode: 保存单个正则节点
 *
 * ====================================================================
 * 持久化架构
 * ====================================================================
 * - V2 配置采用 YAML 文件格式存储在项目目录
 * - project.precis.yaml: 项目清单文件，索引所有资源
 * - schemas/*.schema.yaml: 各表结构定义
 * - constraints/*.constraint.yaml: 各约束定义
 * - regex/*.regex.yaml: 各正则定义
 *
 * ====================================================================
 * 保存策略
 * ====================================================================
 * 【saveProject】
 * - 构建完整配置：buildV2FullConfig
 * - 保存清单文件：putV2FullConfig
 * - 保存视图位置：putV2ProjectView
 * - 更新节点 saveState：saved
 *
 * 【saveSchemaNode】
 * - 支持冲突检测：checkSchemaConflict
 * - 三种保存模式：create（新建）/ overwrite（覆盖）/ merge（合并）
 * - 自动更新 manifest 中的 schema 引用
 * - 处理 409 冲突错误，提供用户交互
 *
 * ====================================================================
 * 冲突处理机制
 * ====================================================================
 * - 检测同名 Schema 是否已存在
 * - 检测配置文件内容是否有差异
 * - 用户可选择：覆盖（overwrite）/ 合并（merge）/ 取消（cancel）
 * - 合并模式会保留现有配置，只更新差异字段
 *
 * ====================================================================
 * API 调用说明
 * ====================================================================
 * - putV2FullConfig: 保存完整配置（清单 + 所有资源）
 * - putV2Schema: 保存单个 Schema 文件
 * - putV2Constraint: 保存单个约束文件
 * - putV2RegexNode: 保存单个正则文件
 * - putV2ProjectView: 保存画布视图（节点位置）
 * - updateV2Manifest*: 更新清单中的资源引用
 *
 * ====================================================================
 * 错误处理
 * ====================================================================
 * - 所有保存操作都包装在 try-catch 中
 * - 失败时显示 toast 错误提示
 * - saveSchemaNode 支持用户取消操作，返回 'cancelled'
 * - 部分失败时提供回滚提示
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 保存后更新节点的 saveState 为 'saved'
 * - 保存后更新节点的 lastSaved 时间戳
 * - 可能触发 toast 通知
 *
 * @module graphStore/modules/v2/persistence
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, SchemaNodeData, JsonSchemaNodeData, TemplateInstanceNodeData } from '@/types/graph'
import { toastError, toastSuccess } from '@/core/toast'
import { useI18n } from 'vue-i18n'
import {
  putV2Constraint,
  putV2FullConfig,
  putV2Manifest,
  putV2ProjectView,
  putV2RegexNode,
  putV2TransformNode,
  putV2Schema,
  checkSchemaConflict,
  updateV2ManifestSchemaRef,
  updateV2ManifestConstraintRef,
  updateV2ManifestRegexRef,
  updateV2ManifestTransformRef,
  updateV2ManifestTemplateInstanceRef,
} from '@/api/projectV2Api'
import {
  buildV2ConstraintFile,
  buildV2FullConfig,
  buildV2Manifest,
  buildV2ProjectView,
  buildV2RegexNodeFile,
  buildV2TransformFile,
  buildV2SchemaFile,
} from '@/services/builders'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import type { SchemaSaveMode } from '@/types/projectV2'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { platformDetector } from '@/features/keyboard/platform'

export function createV2SaveOps(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  projectName: Ref<string>
  getEffectiveProjectConfigPath: () => string | undefined
  updateNodeData: (nodeId: string, newData: Partial<CustomNode['data']>) => void
}) {
  const { nodes, projectName, getEffectiveProjectConfigPath, updateNodeData } = params
  const { t } = useI18n()

  async function saveProject(): Promise<boolean> {
    try {
      const payload = buildV2FullConfig(
        nodes.value,
        projectName.value,
        getEffectiveProjectConfigPath() || ''
      )
      const configPath = getEffectiveProjectConfigPath()

      logger.debug('[saveProject] payload.manifest.schemas:', payload.manifest.schemas)

      if (
        payload.manifest.schemas.length === 0 &&
        payload.manifest.constraints.length === 0 &&
        (payload.manifest.regex_nodes?.length || 0) === 0 &&
        (payload.manifest.transforms?.length || 0) === 0
      ) {
        logger.debug(
          '[saveProject] 没有需要保存的 schema/constraint/regex/transform 节点，跳过保存'
        )
        return true
      }

      await putV2FullConfig(payload, configPath)

      // 视图保存失败视为整体保存失败，阻止 saveState 更新（F2）
      // 否则用户看到"保存成功"但下次 reload 节点位置全部丢失
      await putV2ProjectView(buildV2ProjectView(nodes.value), configPath)

      const now = new Date().toISOString()
      const updatedNodes = nodes.value.map((node) => {
        if (node.type === 'schema' || node.type === 'jsonSchema') {
          return {
            ...node,
            data: { ...(node.data as SchemaNodeData), saveState: 'saved' as const, lastSaved: now },
          } as CustomNode
        } else if (
          isConstraintNodeType(node.type) ||
          node.type === 'regex' ||
          node.type === 'transform' ||
          node.type === 'templateInstance'
        ) {
          const d = node.data as unknown as Record<string, unknown>
          return { ...node, data: { ...d, saveState: 'saved', lastSaved: now } } as CustomNode
        }
        return node
      })
      nodes.value = updatedNodes

      toastSuccess(`项目 "${projectName.value || 'untitled'}" 已保存`, '保存成功')
      return true
    } catch (error) {
      logger.error('保存项目失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveFailed')
      )
      return false
    }
  }

  async function saveSchemaNode(nodeId: string): Promise<boolean | 'cancelled'> {
    try {
      // 支持普通 schema 和 jsonSchema 节点
      const node = nodes.value.find(
        (n) => n.id === nodeId && (n.type === 'schema' || n.type === 'jsonSchema')
      )
      if (!node) throw new Error('未找到Schema节点')

      const isJsonSchema = node.type === 'jsonSchema'
      const schemaData = node.data as SchemaNodeData | JsonSchemaNodeData
      const configPath = getEffectiveProjectConfigPath()
      const { showConfirm } = useGlobalConfirm()

      if (!schemaData.sourceFilePath && !schemaData.sourceFile) {
        toastError('请先选择数据源再保存', '保存失败')
        return false
      }

      const schemaFile = buildV2SchemaFile(nodes.value, nodeId)
      const tableName = schemaData.tableName
      const schemaId = schemaFile.id

      const effectiveTableId = schemaId
      let saveMode: SchemaSaveMode = 'create'
      // 用于保存冲突检测返回的实际文件路径
      let existingFilePath: string | undefined

      try {
        const conflictInfo = await checkSchemaConflict(schemaId, schemaFile, configPath)

        if (conflictInfo.exists) {
          // 保存实际存在的文件路径，后续 manifest 更新需要使用
          existingFilePath = conflictInfo.file_path

          const existingId = conflictInfo.existing_schema?.id as string | undefined

          if (existingId && existingId !== schemaId) {
            // 获取已存在文件的表名
            const existingTableName = (conflictInfo.existing_schema?.name as string) || existingId

            const confirmed = await showConfirm({
              title: t('common.confirmDialog.schemaConflict.idDuplicateTitle'),
              message: t('common.confirmDialog.schemaConflict.idDuplicateMessage', {
                filePath: conflictInfo.file_path,
                existingTableName,
                tableName,
              }),
              confirmText: t('common.confirmDialog.schemaConflict.overwrite'),
              cancelText: t('common.cancel'),
              type: 'warning',
              allowHtml: true,
            })
            if (!confirmed) {
              return 'cancelled'
            }
            saveMode = 'overwrite'
          } else if (conflictInfo.has_conflict) {
            const result = await showConfirm({
              title: t('common.confirmDialog.schemaConflict.configDiffTitle'),
              message: t('common.confirmDialog.schemaConflict.configDiffMessage', {
                filePath: conflictInfo.file_path,
                diff: conflictInfo.conflict_fields.join(', '),
              }),
              confirmText: t('common.confirmDialog.schemaConflict.overwrite'),
              alternativeText: t('common.confirmDialog.schemaConflict.merge'),
              cancelText: t('common.cancel'),
              type: 'warning',
              allowHtml: true,
            })

            if (result === true) {
              saveMode = 'overwrite'
            } else if (result === 'alternative') {
              saveMode = 'merge'
            } else {
              return 'cancelled'
            }
          } else {
            const result = await showConfirm({
              title: t('common.confirmDialog.schemaConflict.existsTitle'),
              message: t('common.confirmDialog.schemaConflict.existsMessage', {
                filePath: conflictInfo.file_path,
                tableName: tableName,
              }),
              confirmText: t('common.confirmDialog.schemaConflict.overwrite'),
              alternativeText: t('common.confirmDialog.schemaConflict.merge'),
              cancelText: t('common.cancel'),
              type: 'warning',
              allowHtml: true,
            })

            if (result === true) {
              saveMode = 'overwrite'
            } else if (result === 'alternative') {
              saveMode = 'merge'
            } else {
              return 'cancelled'
            }
          }
        } else {
          saveMode = 'create'
        }
      } catch (checkError) {
        logger.warn('检查冲突失败，将直接保存:', checkError)
        saveMode = 'create'
      }

      if (effectiveTableId !== nodeId) {
        schemaFile.id = effectiveTableId
      }

      // 如果检测到冲突文件，使用实际的文件路径；否则使用生成的路径
      const schemaFilePath = existingFilePath || `schemas/${schemaFile.name}.schema.yaml`

      try {
        await putV2Schema(effectiveTableId, schemaFile, configPath, saveMode)
      } catch (error: unknown) {
        // 处理 409 冲突错误 - manifest 和实际文件状态不一致
        const err = error as { response?: { status?: number } }
        if (err?.response?.status === 409) {
          logger.warn('保存Schema时遇到 409 冲突，提示用户选择覆盖或合并:', error)

          const result = await showConfirm({
            title: t('common.confirmDialog.schemaConflict.existsTitle'),
            message: t('common.confirmDialog.schemaConflict.existsMessage', {
              filePath: schemaFilePath,
              tableName: tableName,
            }),
            confirmText: t('common.confirmDialog.schemaConflict.overwrite'),
            alternativeText: t('common.confirmDialog.schemaConflict.merge'),
            cancelText: t('common.cancel'),
            type: 'warning',
            allowHtml: true,
          })

          if (result === true) {
            await putV2Schema(effectiveTableId, schemaFile, configPath, 'overwrite')
          } else if (result === 'alternative') {
            await putV2Schema(effectiveTableId, schemaFile, configPath, 'merge')
          } else {
            return 'cancelled'
          }
        } else {
          throw error
        }
      }

      updateNodeData(nodeId, {
        ...schemaData,
        saveState: 'saved',
        lastSaved: new Date().toISOString(),
      })

      toastSuccess(`Schema "${tableName}" 已保存`, '保存成功')
      return true
    } catch (error) {
      logger.error('保存Schema失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveFailed')
      )
      return false
    }
  }

  async function saveConstraintNode(nodeId: string): Promise<boolean> {
    try {
      const node = nodes.value.find((n) => n.id === nodeId && isConstraintNodeType(n.type))
      if (!node) throw new Error('未找到约束节点')

      const configPath = getEffectiveProjectConfigPath()
      await putV2Constraint(nodeId, buildV2ConstraintFile(nodes.value, nodeId), configPath)
      await updateV2ManifestConstraintRef(
        { id: nodeId, path: `constraints/${nodeId}.constraint.yaml` },
        configPath
      )
      updateNodeData(nodeId, {
        ...node.data,
        saveState: 'saved',
        lastSaved: new Date().toISOString(),
      })

      toastSuccess(
        `约束 "${(node.data as unknown as Record<string, unknown>).configName || nodeId}" 已保存`,
        '保存成功'
      )
      return true
    } catch (error) {
      logger.error('保存约束失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveFailed')
      )
      return false
    }
  }

  async function saveRegexNode(nodeId: string): Promise<boolean> {
    try {
      const node = nodes.value.find((n) => n.id === nodeId && n.type === 'regex')
      if (!node) throw new Error('未找到Regex节点')

      const configPath = getEffectiveProjectConfigPath()
      await putV2RegexNode(nodeId, buildV2RegexNodeFile(nodes.value, nodeId), configPath)
      await updateV2ManifestRegexRef({ id: nodeId, path: `regex/${nodeId}.regex.yaml` }, configPath)
      updateNodeData(nodeId, {
        ...node.data,
        saveState: 'saved',
        lastSaved: new Date().toISOString(),
      })

      const base = String((node.data as unknown as Record<string, unknown>).configName || nodeId)
      if (configPath) {
        const sep = platformDetector.isWindows() ? '\\' : '/'
        const prefix = configPath.replace(/[\\/]+$/, '')
        const manifestPath = `${prefix}${sep}project.precis.yaml`
        const regexPath = `${prefix}${sep}regex${sep}${nodeId}.regex.yaml`
        toastSuccess(`正则 "${base}" 已保存到：${regexPath}（清单：${manifestPath}）`, '保存成功')
      } else {
        toastSuccess(`正则 "${base}" 已保存`, '保存成功')
      }
      return true
    } catch (error) {
      logger.error('保存Regex失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveFailed')
      )
      return false
    }
  }

  async function saveTransformNode(nodeId: string): Promise<boolean> {
    try {
      const node = nodes.value.find((n) => n.id === nodeId && n.type === 'transform')
      if (!node) throw new Error('未找到Transform节点')

      const configPath = getEffectiveProjectConfigPath()
      await putV2TransformNode(nodeId, buildV2TransformFile(nodes.value, nodeId), configPath)
      await updateV2ManifestTransformRef(
        { id: nodeId, path: `transforms/${nodeId}.transform.yaml` },
        configPath
      )
      updateNodeData(nodeId, {
        ...node.data,
        saveState: 'saved',
        lastSaved: new Date().toISOString(),
      })

      const base = String((node.data as unknown as Record<string, unknown>).configName || nodeId)
      toastSuccess(`转换节点 "${base}" 已保存`, '保存成功')
      return true
    } catch (error) {
      logger.error('保存Transform失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveFailed')
      )
      return false
    }
  }

  async function saveTemplateInstanceNode(nodeId: string): Promise<boolean> {
    try {
      const node = nodes.value.find((n) => n.id === nodeId && n.type === 'templateInstance')
      if (!node) throw new Error('未找到模板实例节点')

      // 使用强类型替代双重断言，恢复编译时类型保护
      const data = node.data as TemplateInstanceNodeData
      const configPath = getEffectiveProjectConfigPath()

      await updateV2ManifestTemplateInstanceRef(
        {
          id: nodeId,
          template_id: data.templateId || '',
          enabled: data.enabled !== false,
          input_from_node: data.inputFromNode || '',
          params: data.parameters || {},
        },
        configPath
      )
      updateNodeData(nodeId, {
        ...data,
        saveState: 'saved',
        lastSaved: new Date().toISOString(),
      })

      const base = data.configName || nodeId
      toastSuccess(`模板实例 "${base}" 已保存`, '保存成功')
      return true
    } catch (error) {
      logger.error('保存模板实例失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.saveFailed')
      )
      return false
    }
  }

  return {
    saveProject,
    saveSchemaNode,
    saveConstraintNode,
    saveRegexNode,
    saveTransformNode,
    saveTemplateInstanceNode,
  }
}
