/**
 * @fileoverview Persistence 层核心类型
 *
 * 定义 Builder 接口、SavePlan 结构、Pre-Validator 错误类型。
 * 所有 builder 必须实现 NodeBuilder 接口并通过 registry 自注册。
 */

import type { CustomNode } from '@/types/graph'
import type {
  ConstraintFileV2,
  ConstraintItemV2,
  ManualDataFileV2,
  ProjectManifestV2,
  RegexNodeFileV2,
  TableSchemaFileV2,
  TransformFileV2,
  TemplateInstanceRefV2,
} from '@/types/projectV2'

/**
 * Builder 上下文 — 所有 builder 共享的输入
 *
 * schemaIdByNodeId 必填，确保所有 table_id 引用都经过规范化
 */
export interface BuilderContext {
  /** 画布中所有节点 */
  nodes: CustomNode[]
  /** 当前要处理的节点 */
  node: CustomNode
  /** canvas UUID -> 确定性 schema ID 的映射 */
  schemaIdByNodeId: Record<string, string>
  /** 项目配置根目录 */
  configPath: string
}

/**
 * Builder 结果
 *
 * consumed: 该 builder 是否消费了这个节点（决定后续是否继续处理）
 * file: 生成的 V2 配置文件对象
 */
export interface BuilderResult<T> {
  consumed: boolean
  file: T
}

/**
 * 节点 Builder 接口
 *
 * 每个节点类型实现一个 builder，通过 registerBuilder() 注册。
 */
export interface NodeBuilder<T> {
  /** builder 类型标识 */
  kind:
    | 'schema'
    | 'constraint'
    | 'regex'
    | 'regexExtract'
    | 'transform'
    | 'templateInstance'
    | 'manualData'
  /** 判断该 builder 是否能处理指定节点 */
  matches: (node: CustomNode) => boolean
  /** 构建 V2 配置文件对象 */
  build: (ctx: BuilderContext) => BuilderResult<T>
}

/**
 * 验证错误严重级别
 */
export type ValidationSeverity = 'BLOCKER' | 'WARNING' | 'INFO'

/**
 * 预校验错误
 *
 * message 为兜底文案（原始本地化字符串，保证总有显示）。
 * messageKey/params 为 i18n 治理新增：UI 层优先用 renderText(t, messageKey, message, params)
 * 解析，使保存拦截错误能随 locale 切换。message 保留作 fallback。
 */
export interface PreValidationError {
  severity: ValidationSeverity
  nodeId: string
  message: string
  /** i18n key，缺失时回退到 message（可选，未设置则直接显示 message） */
  messageKey?: string
  /** messageKey 对应的插值参数（可选） */
  params?: Record<string, unknown>
  field?: string
  autoFix?: () => void
}

/**
 * Schema 文件计划
 *
 * 包含 schema 文件本身和关联的内嵌约束节点 ID 列表
 */
export interface SchemaFilePlan {
  schemaFile: TableSchemaFileV2
  embeddedConstraintIds: string[]
}

/**
 * 保存计划 — 一次保存操作的完整蓝图
 */
export interface SavePlan {
  manifest: ProjectManifestV2
  schemas: Map<string, SchemaFilePlan>
  constraints: Map<string, ConstraintFileV2>
  regexes: Map<string, RegexNodeFileV2>
  transforms: Map<string, TransformFileV2>
  manualData: Map<string, ManualDataFileV2>
  templateInstances: Map<string, TemplateInstanceRefV2>
  errors: PreValidationError[]
}

/**
 * 自动修复记录
 */
export interface AutoFixRecord {
  nodeId: string
  field: string
  from: string
  to: string
  description: string
}

/**
 * 保存结果
 */
export interface SaveResult {
  success: boolean
  errors?: PreValidationError[]
  /** 自动修复的操作记录 */
  fixed?: AutoFixRecord[]
}

/**
 * 内嵌约束 builder 结果
 */
export interface EmbeddedConstraintResult {
  item: ConstraintItemV2
  consumed: boolean
}
