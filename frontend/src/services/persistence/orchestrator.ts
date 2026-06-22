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
import type { FullConfigV2Request } from '@/types/projectV2'
import { putV2FullConfig, putV2ProjectView } from '@/api/projectV2Api'
import { buildV2ProjectView } from '@/services/builders'
import { buildSavePlan, buildIncrementalSavePlan } from './planBuilder'
import { PreValidator } from './preValidator'
import type { SavePlan, SaveResult, AutoFixRecord } from './types'
export interface OrchestratorDeps {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  projectName: Ref<string>
  getEffectiveProjectConfigPath: () => string | undefined
  updateNodeData: (nodeId: string, patch: Partial<CustomNodeData>) => void
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
      this.deps.updateNodeData(node.id, {
        saveState: 'saved',
        lastSaved: now,
      } as Partial<CustomNodeData>)
    }
  }
}
