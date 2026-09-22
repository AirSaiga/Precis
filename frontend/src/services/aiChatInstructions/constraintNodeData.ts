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
 * @fileoverview AI 约束指令的 params → 独立约束节点 data 字段映射
 *
 * 后端 apply_actions 落盘时已把 AI 的 params 写入约束文件，并经 frontend_instruction
 * 把 params 透传到前端。本模块负责把 spec params 翻译成各约束节点 data 的字段名
 * （与 types/constraints.ts 及持久化 builders/constraint/*.ts 的读取侧一一对应），
 * 保证 AI 创建的独立约束节点在"保存 roundtrip"时不丢参数。
 *
 * 键名对照（spec params → 节点 data）：
 * - range:      min/max(/boundaryMode) → minValue/maxValue(/boundaryMode)
 * - allowedValues: allowedValues → allowedValues（Set<string>）
 * - scripted:   expression(/pattern) → script
 * - foreignKey: toTableId/toColumnId → targetRef
 * - charset:    charsetMode/charset_mode → charsetMode（ascii/chinese/chinese_mixed）
 * - dateLogic:  同名透传；targetValue 双形态（数值/字符串——提示词教的即数值，
 *   后端 target_value 接受 int/float/str）
 * - conditional: thenCondition/thenConditionConfig → thenConditionConfig（DSL 键名
 *   归一 refColumn→ref_column）；ifConditions 条目的 ifColumnId 归一为 ref.columnId
 *   （保存链路消费的形态）
 * - 其余类型：同名透传或无需参数
 */

/** 从 params 取数字（不接受布尔/数组等隐式转换） */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 从 params 取字符串 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 从 params 取非空字符串或有限数值（提示词对部分参数教的即数值形态） */
function asStringOrNumber(value: unknown): string | number | undefined {
  return asString(value) ?? asNumber(value)
}

/**
 * 归一 THEN 条件 DSL 键名（镜像后端 constraint_builder._normalize_then_condition）。
 *
 * 提示词教 camelCase `refColumn`，而后端写盘归一为 `ref_column`；运行时
 * （conditional.py 只认 snake）与 GUI 编辑器（useConditional.normalizeThenCondition
 * 读 ref_column）同样只消费 snake——原样存 camelCase 会让列间比较静默失效，
 * 且 GUI 保存时以 camelCase 覆写已落盘的正确 YAML。snake 键原样通过（双接受）。
 */
function normalizeThenConditionDsl(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  if (raw.operator !== undefined && raw.operator !== null) normalized.operator = raw.operator
  for (const key of ['value', 'values'] as const) {
    if (raw[key] !== undefined && raw[key] !== null) normalized[key] = raw[key]
  }
  const refColumn = asString(raw.refColumn) ?? asString(raw.ref_column)
  if (refColumn) normalized.ref_column = refColumn
  return normalized
}

/** 从 params 取字符串数组（容忍单值/非字符串项，统一规整为字符串数组） */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return value.map((v) => String(v))
}

/**
 * 按约束类型把 spec params 映射为节点 data 补丁（仅含本次能确定的字段）
 *
 * @param constraintKind - camelCase 的 ConstraintKind（经 CONSTRAINT_TYPE_MAP 解析后）
 * @param params - 后端透传的 spec params（可能为空对象）
 * @returns 可合并进节点 data 的补丁对象
 */
export function buildConstraintParamsData(
  constraintKind: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  switch (constraintKind) {
    case 'range': {
      const min = asNumber(params.min)
      const max = asNumber(params.max)
      if (min !== undefined) data.minValue = min
      if (max !== undefined) data.maxValue = max
      const boundaryMode = asString(params.boundaryMode) ?? asString(params.boundary_mode)
      if (boundaryMode === 'inclusive' || boundaryMode === 'exclusive') {
        data.boundaryMode = boundaryMode
      }
      break
    }
    case 'allowedValues': {
      const values = asStringArray(params.allowedValues) ?? asStringArray(params.allowed_values)
      if (values) data.allowedValues = new Set(values)
      break
    }
    case 'scripted': {
      const script =
        asString(params.expression) ?? asString(params.pattern) ?? asString(params.script)
      if (script) data.script = script
      break
    }
    case 'charset': {
      const charsetMode = asString(params.charsetMode) ?? asString(params.charset_mode)
      // 与后端 charset_mode 三模式一致（chinese_mixed 此前漏收会导致 GUI 保存时丢参数）
      if (charsetMode === 'ascii' || charsetMode === 'chinese' || charsetMode === 'chinese_mixed') {
        data.charsetMode = charsetMode
      }
      break
    }
    case 'foreignKey': {
      // AI 给的是后端 schema 文件侧的 ID（toTableId/toColumnId），前端 targetRef 亦存节点/列 ID
      const toTableId = asString(params.toTableId)
      if (toTableId) {
        data.targetRef = {
          nodeId: toTableId,
          columnId: asString(params.toColumnId),
        }
      }
      break
    }
    case 'dateLogic': {
      for (const key of [
        'logicMode',
        'compareOp',
        'referenceDate',
        'referenceColumn',
        'referenceDateEnd',
        'referenceColumnEnd',
        'calculationType',
        'targetColumn',
      ] as const) {
        const v = asString(params[key])
        if (v) data[key] = v
      }
      // targetValue 数值必填参数（age/days_diff）：只认 string 会把它丢弃，
      // GUI 保存时以缺参覆写后端已落盘的正确文件（后端 fail-closed 报配置错误）
      const targetValue = asStringOrNumber(params.targetValue)
      if (targetValue !== undefined) data.targetValue = targetValue
      break
    }
    case 'conditional': {
      // thenCondition 是后端/提示词契约键（thenConditionConfig 为 GUI 节点字段名），双侧兼容；
      // DSL 对象经 normalizeThenConditionDsl 归一键名后入节点 data（见该函数注释）
      const thenRaw = params.thenCondition ?? params.thenConditionConfig
      if (typeof thenRaw === 'string' && thenRaw) {
        data.thenConditionConfig = thenRaw
      } else if (thenRaw && typeof thenRaw === 'object') {
        data.thenConditionConfig = normalizeThenConditionDsl(thenRaw as Record<string, unknown>)
      }
      for (const key of ['ifColumn', 'ifValue', 'thenColumn', 'ifLogic'] as const) {
        const v = params[key]
        if (v !== undefined && v !== null && v !== '') data[key] = v
      }
      if (Array.isArray(params.ifConditions)) {
        // AI 指令的 ifConditions 条目带 ifColumnId 键；映射为保存链路可消费的形态
        // （persistence builders 读取 ref.columnId / column，原样透传会在保存时被过滤丢失）
        data.ifConditions = params.ifConditions.map((raw) => {
          const e = raw as Record<string, unknown>
          const colRef = typeof e.ifColumnId === 'string' && e.ifColumnId ? e.ifColumnId : undefined
          return {
            operator: e.operator,
            value: e.value,
            values: e.values,
            column: typeof e.column === 'string' ? e.column : undefined,
            ref: colRef
              ? { columnId: colRef }
              : (e.ref as { nodeId?: string; columnId?: string } | undefined),
          }
        })
      }
      break
    }
    case 'notNull':
    case 'unique':
    case 'composite':
      // 无业务参数
      break
    default:
      // 未识别的约束类型：不产出补丁，由调用方决定兜底策略
      break
  }

  return data
}
