/**
 * @file common.ts
 * @description 通用类型定义
 *
 * 该模块定义了在整个应用中共用的基础类型，包括：
 * 1. 数据类型 - 表示列的数据类型（String、Integer、Float 等）
 * 2. 列结构 - 表示单个列的信息
 * 3. 表格资产 - 表示完整的表格配置
 * 4. 绑定来源 - 表示字段绑定的来源信息
 * 5. 运行时绑定配置 - 表示运行时的绑定状态
 *
 * 类型设计原则：
 * - 使用联合类型代替字符串，提供类型安全和自动补全
 * - 明确的命名和注释，便于理解和使用
 * - 基础类型与其他模块解耦，可在多处复用
 *
 * 数据类型说明：
 * - String: 字符串类型
 * - Integer: 整数类型
 * - Float: 浮点数类型
 * - Boolean: 布尔类型
 * - Date: 日期类型
 * - Expression: 表达式类型（用于正则等计算）
 *
 * 使用场景：
 * - SchemaColumn.dataType: 列的数据类型
 * - TableAsset.columns: 表格的列定义
 * - BindingSource: 字段绑定来源追踪
 */

/**
 * 定义允许的数据类型。
 * 使用联合类型 (Union Type) 而不是简单的 'string'，可以防止拼写错误，
 * 并在我们使用这些值时提供自动补全。
 *
 * @values
 * - 'String': 字符串类型
 * - 'Integer': 整数类型
 * - 'Float': 浮点数类型
 * - 'Boolean': 布尔类型
 * - 'Date': 日期类型
 * - 'Expression': 表达式类型（用于正则等计算）
 */
export type DataType = 'String' | 'Integer' | 'Float' | 'Boolean' | 'Date' | 'Expression'

/**
 * 定义一个数据列表的结构。
 * 这个接口描述了在表格资产中，单个列所包含的信息。
 */
export interface Column {
  /** 列名称，用于在 UI 和配置中标识该列 */
  columnName: string
  /** 列的数据类型，决定该列存储的数据种类和校验方式 */
  dataType: DataType
}

/**
 * 定义"表格配置资产"的完整结构。
 * 这是当用户保存一个表格定义时，被序列化并储存在资产库（以及未来发送到后端）的数据模型。
 */
export interface TableAsset {
  /** 表格资产的唯一标识符 */
  id: string
  /** 配置名称，用于在资产库中展示该表格的业务含义 */
  configName: string
  /** 表名，对应实际数据源的表/Sheet 名称 */
  tableName: string
  /** Sheet 名称（仅 Excel 数据源有效，可选） */
  sheetName?: string
  /** 列定义列表，描述该表格的所有列结构 */
  columns: Column[]
}

/**
 * 定义字段绑定来源信息。
 *
 * 用于追踪某一列的数据绑定关系，记录该列的值来源于哪个节点的哪个字段。
 */
export interface BindingSource {
  /** 来源节点的唯一标识符（Vue Flow 节点 ID） */
  nodeId: string
  /** 来源节点中的字段名称 */
  fieldName: string
}

/**
 * 运行时绑定配置。
 *
 * 描述数据源与 Schema 节点之间的运行时绑定状态，包括字段映射、校验结果等。
 */
export interface RuntimeBindingConfig {
  /** 数据源的唯一标识符 */
  sourceId: string
  /** 绑定的目标 Schema 节点 ID */
  schemaNodeId: string
  /** 字段映射关系：key 为数据源字段名，value 为 Schema 列名 */
  fieldMappings?: Record<string, string>
  /**
   * 绑定状态
   * @values
   * - 'pending': 等待绑定
   * - 'linked': 已绑定
   * - 'mapping_required': 需要手动映射字段
   * - 'error': 绑定出错
   */
  status: 'pending' | 'linked' | 'mapping_required' | 'error'
  /** 绑定匹配时间戳（ISO 8601 格式） */
  matchedAt?: string
  /** 校验结果映射，key 为字段名，value 为该校验的详细结果 */
  validationResults?: Record<string, unknown>
}
