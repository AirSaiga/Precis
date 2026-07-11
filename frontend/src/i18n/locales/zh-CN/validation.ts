/**
 * @file validation.ts
 * @description 校验/错误消息 i18n（key 化文案）
 *
 * 服务层/校验器返回的本地化消息用这些 key。UI 层通过 renderText(t, key, fallback, params)
 * 解析。命名空间：validation.save.*（保存前校验）、validation.notNull.*（非空约束行级错误）等。
 */

const validation = {
  // 校验统计迷你卡片标签
  stats: {
    files: '文件',
    tables: '表',
    errors: '错误',
    duration: '耗时',
  },
  // 错误过滤栏
  filter: {
    groupLabel: '分组',
    groupByTable: '按表',
    groupByStage: '按阶段',
    groupByType: '按类型',
    groupByNone: '不分组',
    searchPlaceholder: '搜索错误...',
  },
  // 校验设置网格单位
  settings: {
    unitSeconds: '秒',
    unitFiles: '文件',
  },
  // JSON 数据树/源预览
  json: {
    searchFieldPlaceholder: '搜索字段...',
    typeMismatchSummary: '{count} 个字段类型与 Schema 定义不匹配',
    viewDetails: '查看',
  },
  // 数据源预览（表头行提示）
  source: {
    currentHeaderRow: '当前表头行',
    clickToSetHeaderRow: '点击设为表头行',
  },
  // 校验摘要（getValidationSummary 的 key 化文案，供调用方按 locale 渲染）
  summary: {
    pass: '验证通过',
    errors: '{count} 个错误',
    warnings: '{count} 个警告',
  },
  // 保存前校验（preValidator）
  save: {
    schemaMissingSource: 'Schema 缺少数据源路径',
    schemaNoColumns: 'Schema 未定义任何列',
    columnMissingId: '第 {index} 列缺少 ID，建议: {suggestedId}',
    columnMissingName: '第 {index} 列缺少名称，建议: {suggestedName}',
    columnMissingType: '列 "{column}" 未指定数据类型，已默认设为 Str',
    columnIdDuplicate: '列 ID 重复: {oldId}，已修正为: {newId}',
    columnNameDuplicate: '列名重复: {oldName}，已修正为: {newName}',
    constraintMissingTableId: '约束 {type} 缺少 table_id 引用',
    constraintSchemaNotInPlan: '约束引用的 schema {tableId} 不在当前保存计划中',
    foreignKeyMissingTableRefs: 'ForeignKey 约束缺少 from_table_id 或 to_table_id',
    foreignKeyMissingColumnRefs: 'ForeignKey 约束缺少 from_column_id 或 to_column_id',
    foreignKeySelfReference: 'ForeignKey 自引用（from 和 to 指向同一列），请确认这是预期行为',
    rangeMinGreaterThanMax: 'Range 约束 min ({min}) 大于 max ({max})，已自动交换',
    allowedValuesEmpty: 'AllowedValues 约束未配置任何允许值',
    scriptedExpressionEmpty: 'Scripted 约束表达式为空',
    compositeNoSubConstraints: 'Composite 约束未包含任何子约束',
    compositeSelfReference: 'Composite 约束不能包含自身（循环引用）',
    compositeSubConstraintMissingId: 'Composite 包含一个缺少 ID 的子约束',
    regexMissingPattern: 'Regex 节点必须配置 pattern 或 uses_pattern',
    regexSyntaxInvalid: 'Regex 语法无效: {pattern}',
    regexSchemaNotInPlan: 'Regex 引用的 schema {tableId} 不在当前保存计划中',
    transformNoOutputColumns: 'Transform 未配置输出列',
    transformInputNotInSchemas:
      'Transform 引用的输入节点 {nodeId} 不在当前 schema 集合中（可能是 transform 链式引用）',
    templateInstanceMissingId: 'TemplateInstance 缺少 template_id',
  },
  // 非空约束（行级错误）
  notNull: {
    valueEmpty: '值不能为空',
    rowEmpty: '第 {row} 行: 值不能为空',
    requestFailed: '非空校验失败',
  },
  // 唯一约束
  unique: {
    valueNotUnique: '值必须唯一',
    rowNotUnique: '第 {row} 行: 值必须唯一',
    requestFailed: '唯一性校验失败',
  },
  // JSON Schema 列定义校验
  column: {
    idEmpty: '列 ID 不能为空',
    nameInvalid: '列名不合法（只能包含字母、数字、下划线，不能以数字开头，长度不超过50）',
    jsonPathInvalid: 'JSONPath 格式不合法（必须以 $ 开头）',
    dataTypeEmpty: '数据类型不能为空',
    uniqueAndNotNull: '唯一性和非空约束可以同时设置',
    allowedValuesEmpty: '允许值列表不能为空',
    arrayItemTypeMissing: '数组类型必须指定元素类型',
    columnsEmpty: '列定义不能为空',
    nameDuplicate: '列名 "{name}" 重复',
    idDuplicate: '列 ID "{id}" 重复',
    jsonPathDuplicate: 'JSONPath "{path}" 重复',
    nestedPathDuplicate: '嵌套路径 "{path}" 重复',
  },
}

export { validation }
