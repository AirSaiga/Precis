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
 */
export type DataType = 'String' | 'Integer' | 'Float' | 'Boolean' | 'Date' | 'Expression';

/**
 * 定义一个数据列表的结构。
 * 这个接口描述了在表格资产中，单个列所包含的信息。
 */
export interface Column {
  columnName: string;
  dataType: DataType;
}

/**
 * 定义"表格配置资产"的完整结构。
 * 这是当用户保存一个表格定义时，被序列化并储存在资产库（以及未来发送到后端）的数据模型。
 */
export interface TableAsset {
  id: string;
  configName: string;
  tableName: string;
  sheetName?: string;
  columns: Column[];
}

/**
 * 定义字段绑定来源信息
 */
export interface BindingSource {
  nodeId: string;
  fieldName: string;
}

/**
 * 运行时绑定配置
 */
export interface RuntimeBindingConfig {
  sourceId: string;
  schemaNodeId: string;
  fieldMappings?: Record<string, string>;
  status: 'pending' | 'linked' | 'mapping_required' | 'error';
  matchedAt?: string;
  validationResults?: Record<string, unknown>;
}

