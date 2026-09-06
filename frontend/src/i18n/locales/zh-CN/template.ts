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
