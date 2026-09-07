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
  errorGroups: {
    allErrors: '全部错误',
    unknownTable: '未知表',
    unknownType: '未知类型',
  },
}

export { validation }
