/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
    backToParent: '返回上级',
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
  // 错误/检查类型码 → 用户可读标签（validationErrorTypeLabel 动态引用，未登记码回退原文）
  errorTypes: {
    DataLoad: '数据加载',
    DataLoadingError: '数据加载失败',
    SchemaIdDuplicate: '表结构重名',
    RegexViolation: '正则不匹配',
    RegexExecutionError: '正则执行出错',
    TransformExecutionError: '转换执行出错',
    ConstraintConfigError: '约束配置有误',
    ScriptCheckExecutionError: '脚本执行出错',
    Timeout: '校验超时',
  },
  // 保存前校验（preValidator）
  save: {
    schemaMissingSource: '这个表还没有指定数据文件来源：请打开表节点，设置要读取的数据文件',
    schemaNoColumns: '这个表还没有定义任何列',
    columnMissingId: '第 {index} 列缺少标识（ID），保存时将使用「{suggestedId}」',
    columnMissingName: '第 {index} 列缺少名称，保存时将使用「{suggestedName}」',
    columnMissingType: '列「{column}」没有指定数据类型，已自动按文本（Str）处理',
    columnIdDuplicate: '列标识「{oldId}」重复，已自动改为「{newId}」',
    columnNameDuplicate: '列名「{oldName}」重复，已自动改为「{newName}」',
    constraintMissingTableId:
      '「{type}」约束还没有连到任何表：请把约束节点连线到要约束的表节点，再重新保存',
    constraintSchemaNotInPlan:
      '该约束关联的表「{tableId}」已不存在（可能被删除），请把这个约束重新连到表，或删除它',
    foreignKeyMissingTableRefs:
      '外键约束还没有连好两张表：请检查它是否分别连到了当前表和要引用的表',
    foreignKeyMissingColumnRefs: '外键约束还没有选好关联的列：请检查两端节点里的列是否都已选择',
    foreignKeySelfReference: '外键约束的起点和终点是同一列——如果这是刻意的自引用，可以忽略这条提醒',
    rangeMinGreaterThanMax: '范围约束的下限（{min}）比上限（{max}）还大，已自动交换',
    rangeMissingBounds:
      '范围约束没有配置任何边界（min/max 至少填一个），请补全后再保存。模板参数缺省时不会再自动填 0~100。',
    allowedValuesEmpty: '「允许值」约束还没有配置任何可选值，请至少填写一个',
    scriptedExpressionEmpty: '脚本约束还没有填写校验脚本',
    compositeNoSubConstraints: '组合约束里还没有添加任何子约束，请至少添加一个',
    compositeSelfReference: '组合约束不能包含它自己（会形成循环引用）',
    compositeSubConstraintMissingId: '组合约束里有一个子约束缺少 ID',
    regexMissingPattern: '这个正则节点还没有填写匹配规则',
    regexSyntaxInvalid:
      '正则表达式无法解析：「{pattern}」。常见原因：括号不配对，或命名分组的名字不合法（分组名不能是纯数字，例如 (?P<1>…）',
    regexSyntaxInvalidDetail:
      '正则表达式无法解析：「{pattern}」（{detail}）。常见原因：括号不配对，或命名分组的名字不合法（分组名不能是纯数字，例如 (?P<1>…）',
    regexSchemaNotInPlan:
      '该正则节点关联的表「{tableId}」已不存在（可能被删除），请把它重新连到表，或删除它',
    transformNoOutputColumns: '这个转换节点还没有配置输出列',
    transformInputNotInSchemas:
      '转换的输入节点「{nodeId}」不是已保存的表；如果是多个转换前后串联，可忽略这条提示',
    templateInstanceMissingId: '这个模板实例没有指定要使用的模板，请重新选择模板',
  },
  // 非空约束（行级错误）
  notNull: {
    valueEmpty: '值不能为空',
    rowEmpty: '第 {row} 行: 值不能为空',
    requestFailed: '非空校验请求失败：{detail}',
  },
  // 唯一约束
  unique: {
    valueNotUnique: '值必须唯一',
    rowNotUnique: '第 {row} 行: 值必须唯一',
    requestFailed: '唯一性校验请求失败：{detail}',
  },
  // 行级错误行前缀（renderLocalizedMessage 组合：行号 + 正文），正文经各自 key 渲染
  rowError: '第 {row} 行: {message}',
  // 其余约束种类的"校验请求失败"文案（后端业务失败 success:false，detail 携带后端原始错误串）
  range: { requestFailed: '区间校验请求失败：{detail}' },
  foreignKey: { requestFailed: '外键校验请求失败：{detail}' },
  allowedValues: { requestFailed: '允许值校验请求失败：{detail}' },
  conditional: { requestFailed: '条件约束校验请求失败：{detail}' },
  scripted: { requestFailed: '脚本约束校验请求失败：{detail}' },
  charset: { requestFailed: '字符集校验请求失败：{detail}' },
  dateLogic: { requestFailed: '日期逻辑校验请求失败：{detail}' },
  composite: { requestFailed: '组合约束校验请求失败：{detail}' },
  // 稳定错误码 → 用户可读文案（后端 error_code / 客户端前置校验共用命名空间）。
  // 前端经 validation.codes.<CODE> 动态取用，未登记码自动回退后端 message 原文。
  codes: {
    // —— 通用 / 预检 ——
    COLUMN_NOT_FOUND: "列 '{column}' 不存在",
    PARAM_REQUIRED: "参数 '{param}' 不能为空",
    CONFIG_INCOMPLETE: '校验配置不完整',
    VALIDATION_UNSUPPORTED_TYPE: '不支持的校验类型: {validation_type}',
    VALIDATION_EXECUTION_FAILED: '校验执行失败: {detail}',
    // —— 区间 Range ——
    RANGE_NO_BOUNDS: '未配置边界（min/max 至少填其一）',
    RANGE_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    RANGE_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    RANGE_COLUMN_NOT_NUMERIC:
      "列 '{column}' 不是数值类型。非数值字段不能使用区间校验（不会做字符串到数值的隐式转换）",
    RANGE_VALUE_OUT_OF_RANGE: '值 {value} 不在范围 {bounds} 内',
    RANGE_VALUE_BELOW_MIN: '值 {value} 不满足 {op} {min}',
    RANGE_VALUE_ABOVE_MAX: '值 {value} 不满足 {op} {max}',
    // —— 非空 NotNull ——
    NOT_NULL_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    NOT_NULL_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    NOT_NULL_VALUE_EMPTY: '值不能为空',
    // —— 唯一 Unique ——
    UNIQUE_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    UNIQUE_CONFIG_NO_COLUMNS: '未指定任何校验列',
    UNIQUE_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    UNIQUE_VALUE_DUPLICATED: "值 '{value}' 在列 '{columns}' 中重复",
    // —— 字符集 Charset ——
    CHARSET_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    CHARSET_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    CHARSET_INVALID_MODE: "未知的字符集模式 '{charset_mode}'，支持的模式为: {valid_modes}",
    CHARSET_INVALID_CHARACTER: "值 '{value}' 包含不符合{charset_name}字符集的字符",
    // —— 正则 Regex ——
    REGEX_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    REGEX_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    REGEX_PATTERN_EMPTY: 'pattern 为空，未提供正则表达式',
    REGEX_INVALID_MATCH_MODE: "未知的匹配模式 '{match_mode}'，支持的值为: {valid_modes}",
    REGEX_VIOLATION: "值 '{value}' 不符合正则表达式模式",
    REGEX_EXECUTION_ERROR: '校验出错: {value}（{error_detail}）',
    REGEX_PATTERN_SYNTAX_ERROR: '正则表达式语法错误: {pattern}（{error_detail}）',
    // —— 允许值 AllowedValues ——
    ALLOWED_VALUES_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    ALLOWED_VALUES_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    ALLOWED_VALUES_NOT_PERMITTED: "值 '{value}' 不在允许列表 {allowed} 中",
    ALLOWED_VALUES_EMPTY: '请先配置允许值列表后再进行校验',
    // —— 条件 Conditional ——
    CONDITIONAL_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    CONDITIONAL_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    CONDITIONAL_REF_COLUMN_NOT_FOUND: "参考列 '{column}' 在表 '{table}' 中不存在",
    CONDITIONAL_THEN_THRESHOLD_NOT_NUMERIC:
      "THEN 条件操作符 '{operator}' 的阈值必须为数值，实际: '{threshold}'；日期比较请使用日期逻辑约束",
    CONDITIONAL_UNKNOWN_IF_LOGIC: "未知的 IF 逻辑 '{if_logic}'",
    CONDITIONAL_IF_COLUMN_NOT_FOUND: "IF 列 '{column}' 在表 '{table}' 中不存在",
    CONDITIONAL_INVALID_IF_CONDITION: 'IF 条件无效: {detail}',
    CONDITIONAL_IF_VALUE_MISSING: "未配置 IF 列 '{if_column}' 的比较值",
    CONDITIONAL_TIMEOUT: '条件校验超时，已处理 {processed}/{total} 行',
    CONDITIONAL_THEN_VIOLATION:
      "条件满足时，列 '{column}' 的值 '{value}' 不满足要求（{condition}）",
    CONDITIONAL_IF_NOT_CONFIGURED: '未配置 IF 条件，请连接 IF 列或启用"无条件触发"',
    CONDITIONAL_IF_THEN_COLUMN_MISSING: 'IF/THEN 列不存在或已删除',
    // —— 外键 ForeignKey ——
    FK_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    FK_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    FK_VIOLATION: "值 '{value}' 在目标表 '{to_table}' 的列 '{to_column}' 中不存在",
    FK_TARGET_NOT_SELECTED: '请选择目标列后再进行校验',
    FK_TARGET_UNAVAILABLE: '目标表缺少可用数据源或目标列不存在，无法提取参照值',
    // —— 脚本 Scripted ——
    SCRIPTED_PERMISSION_DENIED:
      '脚本约束「{name}」已跳过：项目设置中的『允许执行脚本（eval）』尚未开启',
    SCRIPTED_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    SCRIPTED_TIMEOUT:
      "脚本约束 '{name}' 执行超时，已处理 {processed} 行，剩余 {remaining} 行未校验",
    SCRIPTED_NON_BOOL_RESULT:
      "规则 '{name}' 的表达式没有返回布尔值（True/False），而是返回了 {result_type}",
    SCRIPTED_VIOLATION: "业务逻辑检查失败: '{name}'",
    SCRIPTED_EXECUTION_ERROR:
      "执行规则 '{name}' 时发生错误，请检查表达式语法或数据类型（{detail}）",
    SCRIPTED_NO_SCRIPT: '请先配置脚本后再进行校验',
    // —— 日期逻辑 DateLogic ——
    DATE_LOGIC_TABLE_NOT_FOUND: "表 '{table}' 不在数据集中",
    DATE_LOGIC_COLUMN_NOT_FOUND: "列 '{column}' 在表 '{table}' 中不存在",
    DATE_LOGIC_REF_COLUMN_NOT_FOUND: "参考列 '{column}' 不存在",
    DATE_LOGIC_INVALID_REF_DATE: "无效的参考日期 '{reference_date}'",
    DATE_LOGIC_UNKNOWN_MODE: "未知的 logic_mode '{logic_mode}'，支持的模式为: compare, calculation",
    DATE_LOGIC_INVALID_DATE_VALUE: "值 '{value}' 无法解析为日期",
    DATE_LOGIC_RANGE_BOUNDARY_MISMATCH:
      'range 模式必须同时指定起点和终点，且两者类型一致（同为固定日期或同为列引用）',
    DATE_LOGIC_RANGE_MISSING_END:
      'range 模式必须指定终点（reference_date_end 或 reference_column_end）',
    DATE_LOGIC_RANGE_VIOLATION: '日期 {value} 不在 [{start}, {end}] 范围内',
    DATE_LOGIC_MISSING_REFERENCE: '比较模式必须指定 reference_column 或 reference_date',
    DATE_LOGIC_UNSUPPORTED_OP: "不支持比较操作符 '{compare_op}'，支持的操作符为 {valid_ops}",
    DATE_LOGIC_COMPARE_VIOLATION: '日期 {value} 应该 {op} {reference}',
    DATE_LOGIC_AGE_VIOLATION: '年龄检查失败: {value}（年龄 {age}）不满足 {op} {target}',
    DATE_LOGIC_TARGET_NOT_NUMERIC:
      '目标值「{target_value}」无法转换为数字，请检查约束配置（{detail}）',
    DATE_LOGIC_MISSING_TARGET: 'calculation_type={calculation_type} 必须指定 target_value',
    DATE_LOGIC_MISSING_TARGET_COLUMN: 'calculation_type=days_diff 必须指定 target_column（参考列）',
    DATE_LOGIC_UNKNOWN_CALCULATION_TYPE:
      "未知的 calculation_type '{calculation_type}'，支持的类型为: age, days_diff",
    DATE_LOGIC_DAYS_DIFF_VIOLATION:
      '天数差与目标不符: {value} vs {reference}，要求 {op} {expected} 天，实际 {actual} 天',
    // —— 组合 Composite ——
    COMPOSITE_ANY_ALL_FAILED:
      '组合约束（logic=any）要求至少一个子约束通过，但全部 {total} 个子约束均失败',
    COMPOSITE_NONE_HAS_PASSED:
      '组合约束（logic=none）要求全部子约束失败，但有 {passed} 个子约束通过',
    COMPOSITE_SUB_CONSTRAINT_ERROR: '子约束 {sub_type} 执行异常: {detail}',
    COMPOSITE_UNKNOWN_SUB_TYPE:
      '组合约束包含不支持的子约束类型: {unknown_types}；这些子约束未执行校验',
    COMPOSITE_NO_SUB_CONSTRAINTS: '请在属性面板中选择要聚合的约束节点',
    COMPOSITE_NO_VALID_SUB_CONSTRAINTS: '未找到有效的聚合约束节点',
    COMPOSITE_SUB_CONSTRAINTS_IDLE: '有 {count} 个约束尚未执行，请先执行上游约束校验',
    COMPOSITE_ALL_IDLE: '所有约束尚未执行',
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
  errorGroups: {
    allErrors: '全部错误',
    unknownTable: '未知表',
    unknownType: '未知类型',
  },
}

export { validation }
