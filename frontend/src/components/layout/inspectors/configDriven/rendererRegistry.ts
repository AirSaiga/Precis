/**
 * @file rendererRegistry.ts
 * @description Inspector 属性渲染器注册表
 *
 * 将 InspectorField 的 kind 映射到对应的 Vue 渲染组件。
 * 支持文本、数字、布尔值、下拉选择、代码编辑器、JSON 编辑器等字段类型。
 */

import type { Component } from 'vue'
import type { InspectorField } from './types'

import TextRenderer from './renderers/TextRenderer.vue'
import NumberRenderer from './renderers/NumberRenderer.vue'
import BooleanRenderer from './renderers/BooleanRenderer.vue'
import TextareaRenderer from './renderers/TextareaRenderer.vue'
import DateRenderer from './renderers/DateRenderer.vue'
import CodeRenderer from './renderers/CodeRenderer.vue'
import SelectRenderer from './renderers/SelectRenderer.vue'
import PathRenderer from './renderers/PathRenderer.vue'
import JsonRenderer from './renderers/JsonRenderer.vue'
import JsonEditorRenderer from './renderers/JsonEditorRenderer.vue'
import TagsRenderer from './renderers/TagsRenderer.vue'
import ReadonlyRenderer from './renderers/ReadonlyRenderer.vue'
import DateReferenceTypeRenderer from './renderers/DateReferenceTypeRenderer.vue'
import ForeignKeyTargetColumnRenderer from './renderers/ForeignKeyTargetColumnRenderer.vue'
import DynamicListRenderer from './renderers/DynamicListRenderer.vue'
import RegexPatternRenderer from './renderers/RegexPatternRenderer.vue'
import KeyValueListRenderer from './renderers/KeyValueListRenderer.vue'
import WeightedSumRenderer from './renderers/WeightedSumRenderer.vue'
import ActionButtonRenderer from './renderers/ActionButtonRenderer.vue'
import StatCardRenderer from './renderers/StatCardRenderer.vue'
import ValidationSummaryRenderer from './renderers/ValidationSummaryRenderer.vue'

export const rendererRegistry: Record<InspectorField['kind'], Component> = {
  text: TextRenderer,
  number: NumberRenderer,
  boolean: BooleanRenderer,
  textarea: TextareaRenderer,
  date: DateRenderer,
  code: CodeRenderer,
  select: SelectRenderer,
  path: PathRenderer,
  json: JsonRenderer,
  jsonEditor: JsonEditorRenderer,
  tags: TagsRenderer,
  readonly: ReadonlyRenderer,
  dateReferenceType: DateReferenceTypeRenderer,
  foreignKeyTargetColumn: ForeignKeyTargetColumnRenderer,
  dynamicList: DynamicListRenderer,
  keyValueList: KeyValueListRenderer,
  regexPattern: RegexPatternRenderer,
  weightedSum: WeightedSumRenderer,
  actionButton: ActionButtonRenderer,
  statCard: StatCardRenderer,
  validationSummary: ValidationSummaryRenderer,
}
