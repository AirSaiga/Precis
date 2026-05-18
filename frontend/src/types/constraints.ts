/**
 * @file constraints.ts
 * @description 约束节点相关类型定义
 *
 * 该模块定义了数据质量治理应用中所有约束规则节点的类型定义。
 * 约束节点用于定义数据校验规则，确保数据的完整性、准确性和一致性。
 *
 * 约束类型：
 * 1. ForeignKeyConstraint - 外键约束：验证参照完整性
 * 2. UniqueConstraint - 唯一约束：确保值唯一
 * 3. NotNullConstraint - 非空约束：确保值不为空
 * 4. AllowedValuesConstraint - 允许值约束：限制值的范围
 * 5. ConditionalConstraint - 条件约束：根据条件执行校验
 * 6. ScriptedConstraint - 脚本约束：使用自定义脚本校验
 *
 * 每个约束节点包含：
 * - 基本信息：配置名称、约束名称
 * - 校验配置：约束的具体参数
 * - 校验结果：验证状态、错误列表、统计信息
 * - 引用信息：关联的源节点和列
 *
 * 状态说明：
 * - idle: 待机状态，尚未执行校验
 * - pass: 校验通过，无错误
 * - error: 校验失败，存在错误
 * - missing: 缺少必要数据，无法执行校验
 */

// ========== 约束节点类型定义 ==========

/**
 * 约束节点保存状态
 */
export type ConstraintSaveState = 'draft' | 'saved' | 'error'

/**
 * 约束节点数据基接口
 *
 * 所有约束校验节点（除规则集合节点外）共享的公共字段。
 * 提取公共字段可减少重复类型定义，提高可维护性，并确保新增约束类型时
 * 自动继承标准的状态管理、校验结果追踪和父子关联能力。
 *
 * 设计原则：
 * - validationStatus 在基接口中为可选，子接口可根据业务需要声明为必填
 * - sourceRef 提供节点级稳定引用，避免表名/列名变更导致关联断裂
 * - lastValidation 提供最近一次校验的统计快照，用于节点状态徽章展示
 */
export interface BaseConstraintNodeData {
  /** 配置名称，用于在导出与 UI 中展示该约束的业务含义 */
  configName?: string
  /** 约束名称，用于对接后端或导出配置 */
  constraintName?: string
  /** 校验错误信息列表，用于 UI 展示与导出 */
  validationErrors?: string[]
  /** 源字段的稳定引用（节点 ID + 列 ID），避免名称变更导致关联丢失 */
  sourceRef?: {
    /** Schema 节点 ID */
    nodeId: string
    /** Schema 列 ID */
    columnId: string
  }
  /** 运行状态，用于驱动节点的状态样式 */
  validationStatus?: 'idle' | 'pass' | 'error' | 'missing'
  /** 最近一次校验的统计快照，用于 UI 指标展示 */
  lastValidation?: {
    /** 校验的总行数 */
    totalRows: number
    /** 错误数量 */
    errorCount: number
    /** 匹配数量 */
    matchCount: number
  }
  /** 保存状态：用于驱动"保存按钮"的状态展示 */
  saveState?: ConstraintSaveState
  /** 最近一次保存时间 */
  lastSaved?: string
  /**
   * 父节点 ID（关联的 Schema 节点）
   * 用于布局整理时快速获取关联节点，无需动态遍历边
   */
  parent?: string
}

/**
 * 约束规则集合节点数据
 */
export interface ConstraintRuleSetNodeData {
  setName: string
  description?: string
}

/**
 * 约束规则集合根节点数据
 */
export interface ConstraintRuleSetRootNodeData {
  setName: string
}

/**
 * 外键约束节点数据
 */
export interface ForeignKeyConstraintNodeData extends BaseConstraintNodeData {
  /** 源表名称，用于描述被校验的表 */
  sourceTable: string
  /** 源列名称，用于描述被校验的字段 */
  sourceColumn: string
  /** 目标表名称，用于描述参照的表 */
  targetTable: string
  /** 目标列名称，用于描述参照的字段 */
  targetColumn: string
  /** 参照目标的稳定引用（节点 ID + 列 ID），支持仅引用表级 */
  targetRef?: {
    /** 参照节点 ID */
    nodeId: string
    /** 参照列 ID，可为空表示仅连接到表级 */
    columnId?: string
  }
  /** 输入源信息（物理连接），用于连接关系追踪与 UI 展示 */
  sourceInfo?: {
    /** UI 展示标签 */
    label: string
    /** 父节点 ID（可选） */
    parentId?: string
    /** 节点 ID（可选） */
    nodeId?: string
    /** 列名（可选） */
    column?: string
  }
  /** 核心逻辑引用配置，区分存在性验证与引用验证 */
  config?: {
    /** 校验规则类型 */
    ruleType: 'EXIST_IN' | 'REFERENCE_FROM'
    /** 目标节点 ID，用于快速定位参照数据 */
    targetNodeId?: string
    /** 目标列名，用于实际校验 */
    targetColumn?: string
  }
  /** 运行状态，用于驱动节点的状态样式 */
  validationStatus: 'idle' | 'pass' | 'error' | 'missing'
  /** 是否允许为空，若允许则忽略空值的外键错误 */
  allowNull?: boolean
  /** 高级过滤条件，用于可选的筛选逻辑 */
  advancedFilter?: string
  /**
   * 是否显示外键参照目标的可视化连线（仅用于 UI 展示）
   *
   * 设计说明：
   * - 外键约束的"真实参照关系"以 targetRef/config.targetNodeId 为准，用于校验与导出
   * - 为避免 Schema 节点左侧连线过多导致画布拥挤，FK→Schema 的连线不再作为必需品
   * - 当该开关为 true 时，前端会为当前 FK 节点自动创建一条"展示边"（灰/紫色虚线 + 若隐若现动效）
   *   该边不参与业务逻辑，仅帮助用户理解拓扑关系
   */
  displayTargetConnection?: boolean
}

/**
 * 字符集约束节点数据
 * 用于验证字符串字段是否仅包含特定字符集（ASCII 或中文）
 */
export interface CharsetConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** 列名，用于描述被校验的字段 */
  column: string
  /** 字符集模式：ascii（纯 ASCII）/ chinese（纯中文） */
  charsetMode?: 'ascii' | 'chinese'
}

/**
 * 日期逻辑约束节点数据
 * 用于验证日期比较和日期计算
 */
export interface DateLogicConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** 列名，用于描述被校验的字段 */
  column: string
  /** 逻辑模式：compare（日期比较）/ calculation（日期计算） */
  logicMode?: 'compare' | 'calculation'
  /** 日期比较操作符：gt（大于）/ lt（小于）/ eq（等于）/ gte（大于等于）/ lte（小于等于）/ range（范围） */
  compareOp?: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'range'
  /** 参考日期（当使用固定日期时） */
  referenceDate?: string
  /** 参考列（当使用列值作为参考时） */
  referenceColumn?: string
  /** 计算类型：age（年龄）/ days_diff（天数差） */
  calculationType?: 'age' | 'days_diff'
  /** 目标日期值 */
  targetValue?: string
  /** 目标列 */
  targetColumn?: string
}

/**
 * 区间约束节点数据
 * 用于验证数值型列的值是否在指定范围内
 */
export interface RangeConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** 列名，用于描述被校验的字段 */
  column: string
  /** 最小值 */
  minValue?: number
  /** 最大值 */
  maxValue?: number
  /** 边界模式：inclusive（含）/ exclusive（不含） */
  boundaryMode?: 'inclusive' | 'exclusive'
}

/**
 * 唯一约束节点数据
 */
export interface UniqueConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** 列名，用于描述被校验的字段 */
  column: string
}

/**
 * 非空约束节点数据
 */
export interface NotNullConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** 列名，用于描述被校验的字段 */
  column: string
}

/**
 * 允许值约束节点数据
 */
export interface AllowedValuesConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** 列名，用于描述被校验的字段 */
  column: string
  /** 允许的值集合 */
  allowedValues: Set<string>
}

/**
 * 条件约束节点数据
 */
export interface ConditionalConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** IF 条件列名 */
  ifColumn: string
  /** IF 条件值（简化写法） */
  ifValue: string
  /** THEN 目标列名 */
  thenColumn: string
  /** THEN 条件配置 */
  thenConditionConfig: Record<string, unknown> | string
  /** 多条件逻辑：and / or */
  ifLogic?: 'and' | 'or'
  /** 是否跳过 IF 条件检查（无条件触发 THEN） */
  skipIfCondition?: boolean
  /** 多条件列表（高级写法） */
  ifConditions?: Array<{
    edgeId?: string
    ref?: {
      nodeId: string
      columnId: string
    }
    column?: string
    operator: 'eq' | 'neq' | 'in' | 'not_null' | 'greater_than'
    value?: string
    values?: string[]
  }>
  /** IF 条件列的稳定引用（节点 ID + 列 ID），避免名称变更导致关联丢失 */
  ifRef?: {
    /** Schema 节点 ID */
    nodeId: string
    /** Schema 列 ID */
    columnId: string
  }
  /** THEN 目标列的稳定引用（节点 ID + 列 ID），避免名称变更导致关联丢失 */
  thenRef?: {
    /** Schema 节点 ID */
    nodeId: string
    /** Schema 列 ID */
    columnId: string
  }
}

/**
 * 复合约束节点数据
 * 包含多个子约束，按逻辑策略聚合校验结果
 */
export interface CompositeConstraintNodeData extends BaseConstraintNodeData {
  /** 节点描述 */
  description?: string
  /** 复合逻辑策略：all（全部通过）/ any（至少一个通过）/ none（全部失败） */
  logic: 'all' | 'any' | 'none'
  /** 子画布数据：包含子约束节点和连线 */
  subGraph: {
    nodes: import('@vue-flow/core').Node[]
    edges: import('@vue-flow/core').Edge[]
  }
  /** 输入列名（可选） */
  inputColumn?: string
  /** 上游节点 ID（可选） */
  inputFromNode?: string
  /** 是否启用 */
  enabled?: boolean
  /** 运行状态 */
  validationStatus: 'idle' | 'pass' | 'error' | 'missing'
}

/**
 * 脚本约束节点数据
 * 使用自定义 Python 脚本执行复杂的数据校验逻辑
 */
export interface ScriptedConstraintNodeData extends BaseConstraintNodeData {
  /** 表名，用于描述被校验的表 */
  table: string
  /** 列名，用于描述被校验的字段（可选，支持多列） */
  column?: string
  /** 多列模式，校验多列组合 */
  columns?: string[]
  /** Python 校验脚本表达式 */
  script: string
  /** 脚本名称，用于后端标识 */
  scriptName?: string
}
