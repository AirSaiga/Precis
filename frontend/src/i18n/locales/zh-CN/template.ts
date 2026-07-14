/**
 * @file template.ts
 * @description 模板功能中文翻译词条
 *
 * 覆盖"画布选区打包为模板"对话框（SaveAsTemplateDialog）的翻译。
 */

const template = {
  saveAsTemplateTitle: '保存为模板',
  saveAsTemplate: '保存为模板',
  selectionSummary: '选区摘要',
  excludedNodes: '已排除 {count} 个不适用的节点',
  templateId: '模板 ID',
  templateName: '模板名称',
  description: '描述',
  save: '保存模板',
  saveSuccess: '模板 "{name}" 已保存',
  saveFailed: '模板保存失败',
  invalidIdFormat: '模板 ID 只能包含字母、数字、下划线和连字符',
  errors: {
    missingManualData: '模板缺少 manualData 节点作为输入起点',
    missingConstraint: '模板缺少 constraint 节点作为校验终点',
    externalInputReference: '模板包含引用选区外部数据源的节点',
  },
}

export { template }
