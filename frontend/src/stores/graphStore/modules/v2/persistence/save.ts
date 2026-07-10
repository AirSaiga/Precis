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
import type {
  CustomNode,
  SchemaNodeData,
  JsonSchemaNodeData,
  TemplateInstanceNodeData,
} from '@/types/graph'
import type { CustomNodeData } from '@/types/nodes'
import type {
  ConstraintFileV2,
  RegexNodeFileV2,
  TableSchemaFileV2,
  TemplateInstanceRefV2,
  TransformFileV2,
} from '@/types/projectV2'
import { toastError, toastSuccess } from '@/core/toast'
import { useI18n } from 'vue-i18n'
import { useInspectionStore } from '@/stores/inspectionStore'
import {
  putV2Constraint,
  putV2RegexNode,
  putV2TransformNode,
  putV2Schema,
  updateV2ManifestConstraintRef,
  updateV2ManifestRegexRef,
  updateV2ManifestTransformRef,
  updateV2ManifestTemplateInstanceRef,
} from '@/api/projectV2Api'
import {
  buildV2ConstraintFile,
  buildV2Manifest,
  buildV2RegexNodeFile,
  buildV2TransformFile,
  buildV2SchemaFile,
} from '@/services/builders'
import { SaveOrchestrator, buildNodeFile, SchemaConflictResolver } from '@/services/persistence'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { platformDetector } from '@/features/keyboard/platform'
export function createV2SaveOps(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  projectName: Ref<string>
  getEffectiveProjectConfigPath: () => string | undefined
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
}) {
  const { nodes, projectName, getEffectiveProjectConfigPath, updateNodeData } = params
  // edges 由 SaveOrchestrator 通过 params.edges 读取，本层直接逻辑中不使用
  const { t } = useI18n()

  async function saveProject(): Promise<boolean> {
    const configPath = getEffectiveProjectConfigPath()

    // 空节点检查：避免不必要的 API 调用
    const manifestPreview = buildV2Manifest(nodes.value, projectName.value, configPath || '')
    if (
      manifestPreview.schemas.length === 0 &&
      manifestPreview.constraints.length === 0 &&
      (manifestPreview.regex_nodes?.length || 0) === 0 &&
      (manifestPreview.transforms?.length || 0) === 0
    ) {
      logger.debug('[saveProject] 没有需要保存的 schema/constraint/regex/transform 节点，跳过保存')
      return true
    }

    // 使用新版 SaveOrchestrator 执行保存
    const orchestrator = new SaveOrchestrator({
      nodes,
      edges: params.edges,
      projectName,
      getEffectiveProjectConfigPath,
      updateNodeData,
    })

    const result = await orchestrator.saveProject()

    if (result.success) {
      const warningCount = result.errors?.filter((e) => e.severity === 'WARNING').length || 0
      if (warningCount > 0) {
        toastSuccess(
          t('messages.persistence.projectSavedWithWarnings', {
            name: projectName.value || 'untitled',
            count: warningCount,
          }),
          t('messages.persistence.saveSuccess')
        )
      } else {
        toastSuccess(
          t('messages.persistence.projectSaved', { name: projectName.value || 'untitled' }),
          t('messages.persistence.saveSuccess')
        )
      }
      return true
    } else {
      const blockers = result.errors?.filter((e) => e.severity === 'BLOCKER') || []
      const messages = blockers.map((e) => e.message).join('; ')
      logger.error('保存项目失败:', messages || result.errors)
      toastError(messages || t('messages.error.unknownError'), t('messages.persistence.saveFailed'))

      // 将保存前的 BLOCKER 写入 inspectionStore，方便用户在抽屉中统一查看/跳转
      if (blockers.length > 0) {
        const inspectionStore = useInspectionStore()
        const now = new Date().toISOString()
        inspectionStore.setResult(
          {
            inspected_at: now,
            errors: blockers.map((e) => ({
              id: `save-blocker:${e.nodeId || 'global'}:${e.field || 'unknown'}:${now}`,
              severity: 'blocker' as const,
              title: '',
              title_key: 'inspection.issues.saveBlocked.title',
              description: e.message,
              description_key: 'inspection.issues.saveBlocked.description',
              fix_hint: '',
              fix_hint_key: e.field
                ? 'inspection.issues.saveBlocked.fixHintWithField'
                : 'inspection.issues.saveBlocked.fixHint',
              error_type: 'SavePreValidationBlocked',
              file_path: '',
              ref_id: e.nodeId || null,
              message: e.message,
              suggestion: '',
              actions: e.nodeId
                ? [
                    {
                      type: 'navigate' as const,
                      label: '',
                      label_key: 'inspection.actions.navigateToNode',
                      target: e.nodeId,
                    },
                  ]
                : [],
              context: {
                field: e.field || null,
                nodeId: e.nodeId || null,
                description: e.message,
              },
              message_params: {
                description: e.message,
                field: e.field || '',
                nodeId: e.nodeId || '',
              },
            })),
          },
          { autoOpen: true }
        )
      }

      return false
    }
  }

  async function saveSchemaNode(nodeId: string): Promise<boolean | 'cancelled'> {
    try {
      // 支持普通 schema 和 jsonSchema 节点
      const node = nodes.value.find(
        (n) => n.id === nodeId && (n.type === 'schema' || n.type === 'jsonSchema')
      )
      if (!node) throw new Error(t('messages.builder.schemaNodeNotFound'))

      const schemaData = node.data as SchemaNodeData | JsonSchemaNodeData
      const configPath = getEffectiveProjectConfigPath()
      const { showConfirm } = useGlobalConfirm()

      if (!schemaData.sourceFilePath && !schemaData.sourceFile) {
        toastError(
          t('messages.persistence.pleaseSelectDataSourceFirst'),
          t('messages.persistence.saveFailed')
        )
        return false
      }

      // 收尾: 优先使用新 persistence builder，fallback 旧 builder
      // 注意:用 ??(空值合并)而非 || —— buildNodeFile 可能返回 undefined(无注册 builder),
      // 此时才 fallback。|| 会因对象恒 truthy 让 fallback 永不执行(曾为 bug)。
      const schemaFile =
        (buildNodeFile(node, nodes.value, configPath || '') as TableSchemaFileV2 | undefined) ??
        buildV2SchemaFile(nodes.value, nodeId)
      const tableName = schemaData.tableName
      const schemaId = schemaFile.id

      const effectiveTableId = schemaId

      // Phase 9: 使用 SchemaConflictResolver 处理冲突检测
      const resolver = new SchemaConflictResolver(showConfirm)
      const resolution = await resolver.resolve({
        schemaId,
        schemaFile,
        tableName,
        configPath,
      })

      if (resolution.cancelled) {
        return 'cancelled'
      }

      const saveMode = resolution.saveMode
      const schemaFilePath = resolution.filePath

      if (effectiveTableId !== nodeId) {
        schemaFile.id = effectiveTableId
      }

      try {
        await putV2Schema(effectiveTableId, schemaFile, configPath, saveMode)
      } catch (error: unknown) {
        // 处理 409 冲突错误 - manifest 和实际文件状态不一致
        const err = error as { response?: { status?: number } }
        if (err?.response?.status === 409) {
          logger.warn('保存Schema时遇到 409 冲突，提示用户选择覆盖或取消:', error)

          const result = await resolver.handle409Conflict(schemaFilePath, tableName)
          if (result === 'cancelled') {
            return 'cancelled'
          }
          await putV2Schema(effectiveTableId, schemaFile, configPath, result)
        } else {
          throw error
        }
      }

      updateNodeData(nodeId, {
        ...schemaData,
        saveState: 'saved',
        lastSaved: new Date().toISOString(),
      })

      toastSuccess(
        t('messages.persistence.schemaSaved', { name: tableName }),
        t('messages.persistence.saveSuccess')
      )
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
      if (!node) throw new Error(t('messages.builder.constraintNodeNotFound'))

      const configPath = getEffectiveProjectConfigPath()
      // Phase 8: 使用新 persistence builder 替代旧 builder
      const file: ConstraintFileV2 =
        (buildNodeFile(node, nodes.value, configPath || '') as ConstraintFileV2 | undefined) ??
        buildV2ConstraintFile(nodes.value, nodeId)
      await putV2Constraint(nodeId, file, configPath)
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
        t('messages.persistence.constraintSaved', {
          name: (node.data as unknown as Record<string, unknown>).configName || nodeId,
        }),
        t('messages.persistence.saveSuccess')
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
      if (!node) throw new Error(t('messages.builder.regexNodeNotFound'))

      const configPath = getEffectiveProjectConfigPath()
      // Phase 8: 使用新 persistence builder 替代旧 builder
      const file: RegexNodeFileV2 =
        (buildNodeFile(node, nodes.value, configPath || '') as RegexNodeFileV2 | undefined) ??
        buildV2RegexNodeFile(nodes.value, nodeId)
      await putV2RegexNode(nodeId, file, configPath)
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
        toastSuccess(
          t('messages.persistence.regexSavedWithPaths', {
            name: base,
            path: regexPath,
            manifest: manifestPath,
          }),
          t('messages.persistence.saveSuccess')
        )
      } else {
        toastSuccess(
          t('messages.persistence.regexSaved', { name: base }),
          t('messages.persistence.saveSuccess')
        )
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
      if (!node) throw new Error(t('messages.builder.transformNodeNotFound'))

      const configPath = getEffectiveProjectConfigPath()
      // Phase 8: 使用新 persistence builder 替代旧 builder
      const file: TransformFileV2 =
        (buildNodeFile(node, nodes.value, configPath || '') as TransformFileV2 | undefined) ??
        buildV2TransformFile(nodes.value, nodeId)
      await putV2TransformNode(nodeId, file, configPath)
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
      toastSuccess(
        t('messages.persistence.transformSaved', { name: base }),
        t('messages.persistence.saveSuccess')
      )
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
      if (!node) throw new Error(t('messages.builder.templateInstanceNodeNotFound'))

      const configPath = getEffectiveProjectConfigPath()
      // 收尾: 使用新 persistence builder 构建 ref
      const ref: TemplateInstanceRefV2 =
        (buildNodeFile(node, nodes.value, configPath || '') as TemplateInstanceRefV2 | undefined) ??
        (() => {
          const data = node.data as TemplateInstanceNodeData
          return {
            id: nodeId,
            template_id: data.templateId || '',
            enabled: data.enabled !== false,
          }
        })()

      await updateV2ManifestTemplateInstanceRef(ref, configPath)
      updateNodeData(nodeId, {
        ...(node.data as TemplateInstanceNodeData),
        saveState: 'saved',
        lastSaved: new Date().toISOString(),
      })

      const base = (node.data as TemplateInstanceNodeData).configName || nodeId
      toastSuccess(
        t('messages.persistence.templateInstanceSaved', { name: base }),
        t('messages.persistence.saveSuccess')
      )
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
