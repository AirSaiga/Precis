/**
 * @fileoverview Save Orchestrator
 *
 * 保存操作的统一入口，负责：
 * 1. 构建 SavePlan
 * 2. 执行 Pre-Validation
 * 3. 调用 API 持久化
 * 4. 更新节点 saveState
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/nodes'
import type { FullConfigV2Request, ProjectManifestV2 } from '@/types/projectV2'
import {
  getV2Manifest,
  isProjectNotFound,
  putV2FullConfig,
  putV2ProjectView,
} from '@/api/projectV2Api'
import { logger } from '@/core/utils/logger'
import { buildV2ProjectView } from '@/services/builders'
import { buildSavePlan, buildIncrementalSavePlan } from './planBuilder'
import { isIncompleteDraftNode } from './utils'
import { PreValidator } from './preValidator'
import type { SavePlan, SaveResult, AutoFixRecord } from './types'
export interface OrchestratorDeps {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  projectName: Ref<string>
  getEffectiveProjectConfigPath: () => string | undefined
  updateNodeData: (nodeId: string, patch: Partial<CustomNodeData>) => void
}

/** 引用去重所需的最小形状（各资源引用类型均有 id） */
interface IdentifiableRef {
  id: string
}

/**
 * 按 id 并集两个引用列表：canvas 引用在前，disk 独有的引用追加在后。
 */
function unionRefsById<T extends IdentifiableRef>(canvasRefs: T[], diskRefs: T[]): T[] {
  const ids = new Set(canvasRefs.map((r) => r.id))
  return [...canvasRefs, ...diskRefs.filter((r) => !ids.has(r.id))]
}

export class SaveOrchestrator {
  constructor(private deps: OrchestratorDeps) {}

  /**
   * 保存整个项目
   */
  async saveProject(): Promise<SaveResult> {
    const configPath = this.deps.getEffectiveProjectConfigPath()
    if (!configPath) {
      return {
        success: false,
        errors: [
          {
            severity: 'BLOCKER',
            nodeId: '',
            message: '未找到项目配置路径',
          },
        ],
      }
    }

    const plan = buildSavePlan(this.deps.nodes.value, {
      projectName: this.deps.projectName.value,
      projectPath: configPath,
    })

    if (plan.errors.length > 0) {
      const blockers = plan.errors.filter((e) => e.severity === 'BLOCKER')
      if (blockers.length > 0) {
        return { success: false, errors: plan.errors }
      }
    }

    const validator = new PreValidator(plan, this.deps.nodes.value)
    let validationErrors = validator.validate()

    // 自动修复：尝试修复可修复的 BLOCKER
    let fixedRecords: AutoFixRecord[] = []
    if (validator.hasBlocker()) {
      const fixRecords = validator.applyAutoFixes()
      if (fixRecords.length > 0) {
        fixedRecords = fixRecords.map((r) => ({
          nodeId: r.nodeId,
          field: r.field,
          from: '', // autoFix 不记录 from/to 的精确值
          to: '',
          description: r.description,
        }))
        // autoFix 后重新校验
        validationErrors = validator.validate()
      }
    }

    if (validator.hasBlocker()) {
      return { success: false, errors: validationErrors, fixed: fixedRecords }
    }

    const fullConfig = this.planToFullConfig(plan)
    try {
      await this.mergeDiskManifestRefs(fullConfig, configPath)
    } catch (error) {
      // 读盘失败且非 404（超时/网络/后端异常）：无法确认磁盘引用状态，继续 PUT
      // 会以画布子集的显式字段清空未入画布的磁盘引用（fail-open 数据丢失），
      // fail-closed 中止本次保存，交由上层向用户报错。
      return {
        success: false,
        errors: [
          {
            severity: 'BLOCKER',
            nodeId: '',
            message:
              `保存前读取磁盘清单失败，已中止保存以避免清空未入画布的资源引用: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        fixed: fixedRecords,
      }
    }

    try {
      await putV2FullConfig(fullConfig, configPath)
      await putV2ProjectView(buildV2ProjectView(this.deps.nodes.value), configPath!)

      this.markNodesSaved()

      return { success: true, errors: validationErrors, fixed: fixedRecords }
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            severity: 'BLOCKER',
            nodeId: '',
            message: error instanceof Error ? error.message : '保存失败',
          },
        ],
        fixed: fixedRecords,
      }
    }
  }

  /**
   * 将磁盘 manifest 中画布未承载的资源引用并入保存 payload（按 id 并集，画布优先）。
   *
   * 画布是工作区而非全量资源集——加载不自动水合资源，直接以画布节点构建的
   * manifest 会把磁盘上未入画布的资源引用清掉（后端 _merge_manifest_references
   * 依赖 model_fields_set，而 default_factory 字段恒在 fields_set 内，合并防线
   * 对这些字段实际失效，2026-09-03 实测）。因此在前端按 id 并集合并。
   *
   * 与删除级联契约一致：画布删除不删引用，引用由资源树删除接口单独维护，
   * 故保存时以"保存时刻的磁盘 manifest"为保留基准不会复活已删除资源。
   *
   * settings 以磁盘为准：设置面板走独立端点实时写盘，payload 中的默认值
   * 不应回退用户配置。
   */
  private async mergeDiskManifestRefs(
    fullConfig: FullConfigV2Request,
    configPath: string
  ): Promise<void> {
    let diskManifest: Partial<ProjectManifestV2>
    try {
      diskManifest = await getV2Manifest(configPath)
    } catch (e) {
      if (isProjectNotFound(e)) {
        // manifest 不存在（首次保存/空项目）：磁盘上没有引用可合并，保持 payload 原样
        logger.info('[SaveOrchestrator] 磁盘 manifest 不存在（404），跳过引用合并')
        return
      }
      // 非 404 失败无法区分"磁盘无清单"与"磁盘有引用但读取失败"——静默继续
      // 会以画布子集清空未入画布的磁盘引用，向上抛出由 saveProject fail-closed 中止
      logger.warn('[SaveOrchestrator] 保存前读取磁盘 manifest 失败，中止保存:', e)
      throw e instanceof Error ? e : new Error(String(e))
    }

    const m = fullConfig.manifest
    m.schemas = unionRefsById(m.schemas, diskManifest.schemas ?? [])
    m.constraints = unionRefsById(m.constraints, diskManifest.constraints ?? [])
    m.regex_nodes = unionRefsById(m.regex_nodes, diskManifest.regex_nodes ?? [])
    m.transforms = unionRefsById(m.transforms, diskManifest.transforms ?? [])
    m.manual_data = unionRefsById(m.manual_data ?? [], diskManifest.manual_data ?? [])
    m.template_instances = unionRefsById(
      m.template_instances ?? [],
      diskManifest.template_instances ?? []
    )
    m.data_sources = unionRefsById(m.data_sources ?? [], diskManifest.data_sources ?? [])
    m.templates = unionRefsById(m.templates ?? [], diskManifest.templates ?? [])
    // project.description 保全：构造器只发 {id, name}，手写描述以磁盘为准透传
    //（与后端 _merge_manifest_references 的嵌套字段防线互为冗余；payload 显式
    // 提供新值时不覆盖，遵从客户端改描述意图）
    const diskDescription = diskManifest.project?.description
    if (diskDescription && m.project && m.project.description === undefined) {
      m.project = { ...m.project, description: diskDescription }
    }
    if (diskManifest.settings) {
      m.settings = diskManifest.settings
    }
  }

  /**
   * 保存单个节点（增量保存）
   *
   * 只序列化目标节点及其依赖，减少 API 负载。
   * manifest 保持完整（避免丢失其他资源引用）。
   */
  async saveNode(nodeId: string): Promise<SaveResult> {
    const configPath = this.deps.getEffectiveProjectConfigPath()
    if (!configPath) {
      return {
        success: false,
        errors: [
          {
            severity: 'BLOCKER',
            nodeId: '',
            message: '未找到项目配置路径',
          },
        ],
      }
    }

    const plan = buildIncrementalSavePlan(
      this.deps.nodes.value,
      {
        projectName: this.deps.projectName.value,
        projectPath: configPath,
      },
      nodeId
    )

    if (plan.errors.length > 0) {
      const blockers = plan.errors.filter((e) => e.severity === 'BLOCKER')
      if (blockers.length > 0) {
        return { success: false, errors: plan.errors }
      }
    }

    const validator = new PreValidator(plan, this.deps.nodes.value)
    let validationErrors = validator.validate()

    // 自动修复
    let fixedRecords: AutoFixRecord[] = []
    if (validator.hasBlocker()) {
      const fixRecords = validator.applyAutoFixes()
      if (fixRecords.length > 0) {
        fixedRecords = fixRecords.map((r) => ({
          nodeId: r.nodeId,
          field: r.field,
          from: '',
          to: '',
          description: r.description,
        }))
        validationErrors = validator.validate()
      }
    }

    if (validator.hasBlocker()) {
      return { success: false, errors: validationErrors, fixed: fixedRecords }
    }

    const fullConfig = this.planToFullConfig(plan)

    try {
      await putV2FullConfig(fullConfig, configPath)
      await putV2ProjectView(buildV2ProjectView(this.deps.nodes.value), configPath!)

      const savedNodeIds = this.collectPlanNodeIds(plan)
      this.markNodesSaved(savedNodeIds)

      return { success: true, errors: validationErrors, fixed: fixedRecords }
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            severity: 'BLOCKER',
            nodeId: '',
            message: error instanceof Error ? error.message : '保存失败',
          },
        ],
        fixed: fixedRecords,
      }
    }
  }

  /**
   * 从 SavePlan 中收集所有被持久化的节点 ID
   */
  private collectPlanNodeIds(plan: SavePlan): Set<string> {
    const ids = new Set<string>()
    for (const id of plan.schemas.keys()) ids.add(id)
    for (const id of plan.constraints.keys()) ids.add(id)
    for (const id of plan.regexes.keys()) ids.add(id)
    for (const id of plan.transforms.keys()) ids.add(id)
    for (const id of plan.templateInstances.keys()) ids.add(id)
    for (const schemaPlan of plan.schemas.values()) {
      for (const cid of schemaPlan.embeddedConstraintIds) ids.add(cid)
    }
    return ids
  }

  /**
   * 获取当前 SavePlan（用于调试和预览）
   */
  getCurrentPlan(): SavePlan {
    const configPath = this.deps.getEffectiveProjectConfigPath() || ''
    return buildSavePlan(this.deps.nodes.value, {
      projectName: this.deps.projectName.value,
      projectPath: configPath,
    })
  }

  /**
   * 将 SavePlan 转换为 FullConfigV2Request
   *
   * 注意：此处 manifest 仅含画布承载的资源引用；磁盘上未入画布的引用由
   * mergeDiskManifestRefs 在发送前按 id 并集补齐。
   */
  private planToFullConfig(plan: SavePlan): FullConfigV2Request {
    return {
      manifest: plan.manifest,
      schemas: Object.fromEntries(
        Array.from(plan.schemas.entries()).map(([id, p]) => [id, p.schemaFile])
      ),
      constraints: Object.fromEntries(plan.constraints),
      regex_nodes: Object.fromEntries(plan.regexes),
      transforms: Object.fromEntries(plan.transforms),
      manual_data: Object.fromEntries(plan.manualData),
    }
  }

  /**
   * 标记可持久化节点为 saved
   *
   * @param scope - 'all' 标记全部可持久化节点（全量保存）；
   *                传入 Set<string> 则只标记集合内的节点（增量保存）
   */
  private markNodesSaved(scope: 'all' | Set<string> = 'all'): void {
    const now = new Date().toISOString()
    const persistableTypes = new Set([
      'schema',
      'jsonSchema',
      'regex',
      'regexExtract',
      'transform',
      'manualData',
      'templateInstance',
      'notNullConstraint',
      'uniqueConstraint',
      'foreignKeyConstraint',
      'allowedValuesConstraint',
      'rangeConstraint',
      'conditionalConstraint',
      'scriptedConstraint',
      'charsetConstraint',
      'dateLogicConstraint',
      'compositeConstraint',
    ])

    for (const node of this.deps.nodes.value) {
      if (!node.type || !persistableTypes.has(node.type)) continue
      if (scope instanceof Set && !scope.has(node.id)) continue
      // D-1 方案 B：未完成的草稿节点未进保存 payload，保持 draft 状态（误标 saved 会让
      // 下次保存重新进 payload 并再次触发 BLOCKER）
      if (isIncompleteDraftNode(node)) continue
      this.deps.updateNodeData(node.id, {
        saveState: 'saved',
        lastSaved: now,
      } as Partial<CustomNodeData>)
    }
  }
}
