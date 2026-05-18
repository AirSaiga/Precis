/**
 * @file regexOutputMapping.ts
 * @description 正则“输出映射（output mapping）”解析与值转换工具
 *
 * 背景：
 * - 设计器侧以 `Rule.output` 存储映射配置（key 为输出字段名；value 为静态值或参数绑定表达式）。
 * - 运行时 RegexNode 在 extract 模式下拿到后端 `extracted_columns`（命名捕获组的列式结果）。
 * - 本文件负责把设计器协议解析成可执行的结构，并提供基础的类型转换能力。
 *
 * 设计原则：
 * - 输出映射只做轻量解析，不依赖节点上下文；
 * - 无论输入是什么类型，最终统一为可消费的 binding 结构；
 * - 类型转换失败时返回空字符串，保证二维矩阵行对齐。
 */
import type { DataType } from '@/types/common'
import type { OutputMappingParamType } from '@/features/regex/types'

/**
 * 输出映射：参数绑定（来自命名捕获组）
 */
export interface OutputMappingParamBinding {
  /**
   * 类型标识，用于区分 static 与 param
   */
  kind: 'param'
  /**
   * 命名捕获组名称（对应 extracted_columns 的 key）
   */
  name: string
  /**
   * 期望的类型，用于 Schema 列类型映射和前端转换
   */
  type: OutputMappingParamType
}

/**
 * 输出映射：静态值（常量列）
 */
export interface OutputMappingStaticBinding {
  /**
   * 类型标识，用于区分 static 与 param
   */
  kind: 'static'
  /**
   * 静态值，将按原样填充到派生列中
   */
  value: string
}

/**
 * 输出映射绑定的联合类型
 */
export type OutputMappingBinding = OutputMappingParamBinding | OutputMappingStaticBinding

/**
 * 判断输入值是否为参数绑定表达式。
 *
 * 参数绑定表达式格式："{paramName:type}"，例如 "{age:int}"、"{name:string}"。
 * 用于区分动态绑定的列引用（来自命名捕获组）和静态常量值。
 *
 * @param raw - 待检查的原始值，可以是任意类型
 * @returns 如果 raw 是字符串且符合 "{字母数字下划线:字母数字下划线}" 格式则返回 true，否则返回 false
 *
 * 关键逻辑：
 * - 正则表达式 ^\{\w+:\w+\}$ 匹配花括号包裹的 "name:type" 结构
 * - \w+ 表示参数名和类型名只能包含字母、数字、下划线
 * - 使用 typeof 检查确保输入是字符串类型，避免类型转换错误
 */
export function isOutputParamBinding(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\{\w+:\w+\}$/.test(raw)
}

/**
 * 解析参数绑定表达式为结构化对象。
 *
 * 输入格式："{paramName:type}"，例如 "{age:int}"、"{score:float}"、"{enabled:boolean}"、"{title:string}"
 * 输出格式：{ kind: 'param', name: 'paramName', type: OutputMappingParamType }
 *
 * @param raw - 符合 "{name:type}" 格式的参数字符串
 * @returns 解析成功返回 OutputMappingParamBinding 对象；格式不匹配或解析失败返回 null
 *
 * 关键逻辑步骤：
 * 1. 使用正则捕获组提取参数名（match[1]）和类型字符串（match[2]）
 * 2. 如果匹配失败（格式非法），直接返回 null，由调用方处理静默回退
 * 3. 对类型字符串进行规范化：
 *    - "int" → 保留为 'int'（整数类型）
 *    - "float" → 保留为 'float'（浮点数类型）
 *    - "boolean" → 保留为 'boolean'（布尔类型）
 *    - 其他任何值（如 "date"、"array" 等）统一回退为 'string'
 * 4. 返回标准化的绑定对象，保证前端 Schema 可消费
 *
 * 类型回退策略说明：
 * - 采用"宽进严出"策略：接受任意类型字符串，非法类型统一映射为 string
 * - 这样做的好处是前端不会因为类型解析失败而崩溃，保证二维矩阵结构完整
 */
export function parseOutputParamBinding(raw: string): OutputMappingParamBinding | null {
  const match = raw.match(/^\{(\w+):(\w+)\}$/)
  if (!match) return null
  const name = match[1]
  const typeRaw = match[2]

  const normalizedType: OutputMappingParamType =
    typeRaw === 'int' || typeRaw === 'float' || typeRaw === 'boolean' ? typeRaw : 'string'

  return { kind: 'param', name, type: normalizedType }
}

/**
 * 将任意原始值解析为统一的输出映射绑定结构。
 *
 * 这是本模块的入口函数，负责：
 * 1. 识别并解析参数绑定表达式（动态列引用）
 * 2. 将其他所有值视为静态常量（静态列）
 *
 * @param raw - 来自 Rule.output 配置的原始值，可以是：
 *   - 参数绑定字符串，如 "{age:int}" → 返回 OutputMappingParamBinding
 *   - 任意其他值（数字、布尔、null 等）→ 返回 OutputMappingStaticBinding
 * @returns 统一的 OutputMappingBinding 联合类型对象
 *
 * 关键逻辑步骤：
 * 1. 首先检查输入是否为字符串类型
 * 2. 如果是字符串，进一步检查是否符合参数绑定格式（isOutputParamBinding）
 * 3. 若符合参数绑定格式，尝试解析为结构化绑定对象（parseOutputParamBinding）
 * 4. 解析成功则返回参数绑定对象；失败时按静态值处理（容错设计）
 * 5. 非字符串或非绑定格式的值，统一封装为静态字符串绑定
 *
 * 静态值处理规则：
 * - null 或 undefined → 空字符串 ''（保证矩阵行对齐）
 * - 其他值 → 使用 String() 转换为字符串后存储
 *
 * 设计考量：
 * - 采用"参数绑定优先"策略，兼容配置中的多种输入形式
 * - 静默处理解析失败，避免因配置错误导致验证流程中断
 */
export function parseOutputMappingValue(raw: unknown): OutputMappingBinding {
  if (typeof raw === 'string' && isOutputParamBinding(raw)) {
    const parsed = parseOutputParamBinding(raw)
    if (parsed) return parsed
  }
  return { kind: 'static', value: raw == null ? '' : String(raw) }
}

/**
 * 将输出映射参数类型转换为 Schema 定义的列数据类型。
 *
 * 本函数用于在 RegexNode 的 extract 模式下，
 * 根据用户配置的输出映射类型生成对应的 Schema 列类型。
 *
 * @param type - 输出映射参数类型（来自用户配置）
 * @returns 对应的 Schema DataType 枚举值
 *
 * 类型映射表：
 * - 'int' → 'Integer'（整数类型，用于数值计算和比较）
 * - 'float' → 'Float'（浮点数类型，保留小数精度）
 * - 'boolean' → 'Boolean'（布尔类型，值为 true/false）
 * - 'string' → 'String'（默认类型，存储任意字符串）
 *
 * 使用场景：
 * - RegexNode 在 extract 模式下需要构建 outputSchema 时调用
 * - 根据每个输出字段的类型配置，生成对应的 DataType
 * - 生成的 Schema 用于下游节点的类型推断和数据验证
 */
export function outputParamTypeToDataType(type: OutputMappingParamType): DataType {
  switch (type) {
    case 'int':
      return 'Integer'
    case 'float':
      return 'Float'
    case 'boolean':
      return 'Boolean'
    default:
      return 'String'
  }
}

/**
 * 对提取的原始值进行类型转换和验证。
 *
 * 本函数是 RegexNode extract 模式数据处理流程中的最后一环：
 * 1. 后端返回 extracted_columns（命名捕获组的原始字符串值）
 * 2. 根据用户配置的类型（OutputMappingParamType）进行转换
 * 3. 转换失败时返回空字符串 ''，保证二维矩阵每行长度一致
 *
 * @param value - 从 extracted_columns 获取的原始字符串值
 * @param type - 期望的目标类型（来自用户配置的输出映射）
 * @returns 转换后的字符串值；转换失败返回空字符串 ''
 *
 * 类型转换规则详解：
 *
 * 【int 整数类型】
 * - 使用 Number.parseInt(v, 10) 解析十进制整数
 * - 仅接受可完全解析的值（如 "42"、"-7"）
 * - 解析结果必须为有限数（Number.isFinite），排除 Infinity/NaN
 * - 解析失败或非有限数 → 返回 ''（空字符串）
 * - 示例："42" → "42"；"3.14" → ""（小数部分导致解析失败）；"abc" → ""
 *
 * 【float 浮点数类型】
 * - 使用 Number.parseFloat(v) 解析浮点数
 * - 接受整数和小数（如 "3.14"、"-0.5"、"6e10"）
 * - 同样要求结果为有限数
 * - 解析失败或非有限数 → 返回 ''
 * - 示例："3.14" → "3.14"；"42" → "42"；"abc" → ""
 *
 * 【boolean 布尔类型】
 * - 接受多种 truthy/falsey 字符串表示，不区分大小写
 * - Truthy（返回 "true"）："true"、"1"、"yes"、"y"
 * - Falsey（返回 "false"）："false"、"0"、"no"、"n"
 * - 其他任何值 → 返回 ''（空字符串）
 * - 示例："YES" → "true"；"0" → "false"；"maybe" → ""
 *
 * 【string 字符串类型】
 * - 直接返回原值（经过 null/undefined 检查后）
 * - 不做任何转换或验证
 *
 * 空值处理策略：
 * - 输入为 null 或 undefined → 直接返回 ''
 * - 输入为空字符串 '' → 直接返回 ''（短路返回，避免不必要的类型转换）
 *
 * 关键设计决策：
 * - 返回值始终为字符串，保证输出矩阵的每个单元格类型一致
 * - 转换失败返回空字符串而非抛出异常，避免数据流中断
 * - 使用空字符串作为哨兵值，下游可据此判断数据质量问题
 */
export function coerceExtractedValue(value: string, type: OutputMappingParamType): string {
  const v = value == null ? '' : String(value)
  if (v === '') return ''

  switch (type) {
    case 'int': {
      const n = Number.parseInt(v, 10)
      return Number.isFinite(n) ? String(n) : ''
    }
    case 'float': {
      const n = Number.parseFloat(v)
      return Number.isFinite(n) ? String(n) : ''
    }
    case 'boolean': {
      const lower = v.trim().toLowerCase()
      if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'y') return 'true'
      if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'n') return 'false'
      return ''
    }
    default:
      return v
  }
}
