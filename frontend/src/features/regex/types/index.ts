/**
 * @file index.ts
 * @description 正则表达式模块专属类型的统一导出入口
 *
 * 导出说明：
 * - Rule, RegexParameter, RegexNodeData 等: 提供正则规则、节点数据及模式相关的 TypeScript 类型支持
 */

/**
 * @file regex.ts
 * @description 正则表达式相关类型定义
 *
 * 【模块概述】
 * 本文件定义了 Precis 数据质量平台中正则表达式功能的所有类型定义。
 * 涵盖正则规则、节点数据、输出映射等核心数据结构。
 *
 * 【类型分类】
 * 1. 规则类型 (Rule): 正则表达式的规则定义
 * 2. 节点数据 (RegexNodeData): 正则节点的运行时数据
 * 3. 设计更新 (RegexDesignUpdateData): 正则设计器的更新数据结构
 *
 * 【数据流概述】
 * Schema(表结构) → Regex(正则校验) → 派生列 → 写入数据
 *
 * 【与后端的对应关系】
 * - RegexNodeData.pattern → 后端 regex_pattern 字段
 * - RegexNodeData.matchMode → 后端 match_mode 字段
 * - Rule.output → 后端 extracted_columns 映射
 */

/**
 * 正则表达式规则定义
 *
 * 【业务场景】
 * 描述一条完整的正则校验规则，包括规则名称、正则表达式、描述信息，
 * 以及输出映射配置（用于 extract 模式下的派生列生成）。
 *
 * 【数据来源】
 * - 由正则设计器 (RegexDesignModal) 创建和管理
 * - 持久化存储于节点数据中 (RegexNodeData.rules)
 *
 * 【与其他类型的关联】
 * - RegexNodeData.rules: 数组形式存储多个规则
 * - Rule.output: 映射到正则设计器中的输出映射配置
 */
export interface Rule {
  /**
   * 规则唯一标识符
   *
   * 【生成时机】
   * - 新建规则时由前端生成 UUID
   * - 从后端加载时使用后端返回的 ID
   */
  id?: string

  /**
   * 规则名称
   *
   * 【用途】
   * - 在正则设计器中显示规则名称
   * - 用于调试和日志输出
   */
  name: string

  /**
   * 正则表达式模式字符串
   *
   * 【格式要求】
   * - JavaScript 兼容的正则语法
   * - 支持命名捕获组：(?P<name>pattern)
   *
   【示例】
   * - 提取金额：(?P<amount>\d+\.?\d*)
   * - 提取日期：(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})
   */
  regex: string

  /**
   * 规则描述信息
   *
   * 【用途】
   * - 向用户解释规则的用途
   * - 在设计器中作为辅助说明
   */
  description?: string

  /**
   * 输出映射配置
   *
   * 【业务目的】
   * 定义如何将正则匹配的命名捕获组转换为派生列。
   * 这是 extract 模式的核心配置。
   *
   * 【数据结构】
   * - key: 输出字段名（将作为派生列的列名）
   * - value: 静态值或参数绑定表达式
   *
   * 【value 格式说明】
   * 1. 静态值：任意字符串，例如 "CNY"
   *    - 用于生成常量列
   *
   * 2. 参数绑定："{paramName:type}" 格式
   *    - paramName: 对应正则中的命名捕获组名称
   *    - type: 数据类型 (string/int/float/boolean)
   *
   * 【使用示例】
   * {
   *   "currency": "CNY",                    // 静态值：货币类型为 CNY
   *   "amount": "{amount:int}",             // 参数绑定：提取金额为整数
   *   "price": "{price:float}",             // 参数绑定：提取价格为浮点数
   *   "isValid": "{is_valid:boolean}"       // 参数绑定：提取为布尔值
   * }
   *
   *转换 【类型】
   * - 提取的值会按照 type 进行基础转换
   * - 转换失败时返回空字符串，保证矩阵对齐
   */
  output: Record<string, string>

  /**
   * 扩展字段
   *
   * 【用途】
   * 允许 Rule 接口接收额外的未知属性，
   * 避免类型检查报错，提供更好的向前兼容性。
   */
  [key: string]: unknown
}

/**
 * 输出映射中参数绑定支持的类型
 *
 * 【类型用途】
 * 决定：
 * 1. 前端对提取值的基础类型转换
 * 2. Schema 列的数据类型 (Integer/Float/Boolean/String)
 * 3. 数据验证和格式化的处理方式
 *
 * 【与 DataType 的映射】
 * - 'string' → String
 * - 'int' → Integer
 * - 'float' → Float
 * - 'boolean' → Boolean
 */
export type OutputMappingParamType = 'string' | 'int' | 'float' | 'boolean'

/**
 * 正则表达式参数定义
 *
 * 【业务场景】
 * 用于定义正则表达式中的可配置参数，
 * 支持用户在运行时动态调整正则行为。
 *
 * 【当前使用状态】
 * 此类型定义保留，但当前版本中 RegexNodeData.parameters
 * 可能未完全投入使用。
 */
export interface RegexParameter {
  /**
   * 参数名称
   *
   * 【命名规范】
   * - 使用驼峰命名法 (camelCase)
   * - 语义化命名
   */
  name: string

  /**
   * 参数类型
   *
   * 【类型说明】
   * - int: 整数类型
   * - float: 浮点数类型
   * - word: 单词字符
   * - non_space: 非空白字符
   * - anything: 任意字符
   */
  type: 'int' | 'float' | 'word' | 'non_space' | 'anything'

  /**
   * 是否为必需参数
   *
   * 【默认值】
   * undefined (视为可选参数)
   */
  required?: boolean

  /**
   * 参数默认值
   *
   * 【类型约束】
   * - 当 type 为 int/float 时，应为 number 类型
   * - 当 type 为 word/non_space/anything 时，应为 string 类型
   * - 布尔类型参数使用 boolean 值
   */
  default?: string | number | boolean
}

/**
 * 正则表达式节点数据
 *
 * 【业务场景】
 * 这是 RegexNode.vue 组件的核心数据类型，
 * 存储了正则节点的所有配置信息和运行时状态。
 *
 * 【数据来源】
 * 1. 节点创建时：使用默认配置初始化
 * 2. 用户配置时：通过正则设计器更新
 * 3. 校验完成后：由 useRegexValidation 更新状态
 *
 * 【数据持久化】
 * - 与节点一起存储于 IndexedDB
 * - 包含完整的配置和状态信息
 *
 * 【与其他节点的关联】
 * - sourceRef: 关联上游 Schema 列信息（{ nodeId, columnId, columnName? }）
 */
export interface RegexNodeData {
  /**
   * 节点配置名称
   *
   * 【用途】
   * - 在画布上显示的节点标题
   * - 区分不同的正则节点
   */
  configName: string

  /**
   * 节点描述信息
   *
   * 【用途】
   * - 提供配置说明
   * - 帮助用户理解节点的用途
   */
  description: string

  /**
   * 正则表达式模式字符串
   *
   * 【格式要求】
   * - JavaScript 兼容的正则语法
   * - 建议使用命名捕获组以支持 extract 模式
   *
   * 【示例】
   * - 邮箱验证：^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
   * - 手机号：1[3-9]\d{9}
   * - 金额提取：(?P<amount>\d+\.?\d*)
   */
  pattern: string

  /**
   * 正则表达式参数列表
   *
   * 【当前状态】
   * 保留字段，暂未完全实现参数化支持
   */
  parameters: RegexParameter[]

  /**
   * 匹配模式
   *
   * 模式说明：
   * - full: 完整匹配 (必须完全匹配整个字符串)
   * - partial: 子串匹配 (只需部分匹配)
   *
   * 注意：extract 模式已拆分为独立的 regexExtract 节点类型，
   * 因此 RegexNodeData 中不再包含 'extract'。
   *
   * 与后端的交互：
   * - 传递给后端的 match_mode 字段
   */
  matchMode: 'full' | 'partial'

  /**
   * 校验规则配置
   *
   * 【当前状态】
   * 保留字段，暂未完全实现自定义校验规则
   */
  validationRules: Record<string, unknown>

  /**
   * 节点是否启用
   *
   * 【用途】
   * 控制节点是否参与数据处理流程
   *
   * 【默认值】
   * true (默认可用)
   */
  enabled: boolean

  /**
   * 是否区分大小写
   *
   * 【后端处理】
   * - true: 使用正则原样匹配
   * - false: 后端会自动附加 ignorecase 标志
   */
  caseSensitive: boolean

  /**
   * 正则标志字符串
   *
   * 【常见标志】
   * - g: 全局匹配
   * - i: 忽略大小写
   * - m: 多行模式
   *
   * 【默认值】
   * 'g' (全局匹配)
   */
  flags: string

  /**
   * 正则规则列表
   *
   * 【数据结构】
   * 数组形式的 Rule 配置
   *
   * 【使用场景】
   * - 存储用户配置的正则规则
   * - 支持多条规则组合使用
   */
  rules?: Rule[]

  /**
   * 【校验状态】
   *
   * 【状态定义】
   * - idle: 待校验 (未执行过校验，或配置已更改)
   * - pass: 校验通过 (所有行都匹配成功)
   * - error: 校验失败 (存在未匹配的行)
   *
   * 【状态流转】
   * idle → (开始校验) → (处理中) → pass/error
   * pass/error → (修改配置) → idle
   */
  validationStatus: 'idle' | 'pass' | 'error' | 'missing'

  /**
   * 校验失败的行数
   *
   * 【计算逻辑】
   * - totalRows - matchCount
   *
   * 【使用场景】
   * - 在节点卡片上显示错误数量
   * - 触发错误行过滤功能
   */
  errorCount?: number

  /**
   * 输入数据的总行数
   *
   * 【数据来源】
   * - 从 SourcePreview 节点获取
   * - 统计参与校验的数据行数
   */
  totalRows?: number

  /**
   * 校验匹配成功的行数
   *
   * 【计算逻辑】
   * - totalRows - errorCount
   *
   * 【使用场景】
   * - 在节点卡片上显示匹配统计
   * - 计算校验通过率
   */
  matchCount?: number

  /**
   * 最近一次校验的时间
   *
   * 【格式】
   * ISO 8601 时间字符串
   * 例如：'2024-01-15T10:30:00.000Z'
   *
   * 【用途】
   * - 显示校验时间戳
   * - 判断数据是否需要重新校验
   */
  lastValidationTime?: string

  /**
   * 源字段的稳定引用（节点 ID + 列 ID），用于项目保存/加载重建连线
   */
  sourceRef?: {
    nodeId: string
    columnId: string
  }

  /**
   * 保存状态：用于驱动“保存按钮”的状态展示
   */
  saveState?: 'draft' | 'saved' | 'error'
  /**
   * 最近一次保存时间
   */
  lastSaved?: string
  /**
   * 父节点 ID（关联的 Schema 节点）
   * 用于布局整理时快速获取关联节点，无需动态遍历边
   */
  parent?: string

  /**
   * 数据流输入接口（新增）
   * 若存在，优先于 sourceRef 使用
   */
  inputFromNode?: string
  inputColumn?: string

  /**
   * Extract 模式专用：捕获组定义
   */
  captureGroups?: Array<{ name: string; groupIndex: number }>

  /**
   * Extract 模式专用：输出列名列表
   */
  outputColumns?: string[]

  /**
   * 引用已注册的 Pattern
   *
   * 【用途】
   * - 当 Regex 节点引用 patterns 目录中的已注册表达式时使用
   * - 与 pattern 字段互斥（如果 uses_pattern 有值，pattern 应为空或移至 pattern_overrides）
   */
  uses_pattern?: {
    registry: 'patterns'
    pattern_name: string
  }
}

/**
 * 正则提取节点数据
 *
 * 【业务场景】
 * RegexExtract 节点专门用于从上游数据中提取匹配内容并生成新的列/数据流。
 * 它是从原 RegexNodeData 的 extract 模式拆分出来的独立节点类型，
 * 与 RegexNode（校验）职责分离：
 * - RegexNode：只返回匹配统计（full/partial）
 * - RegexExtract：提取命名捕获组，输出到下游数据流节点
 *
 * 【与后端的交互】
 * 序列化时保存为 match_mode='extract' 的 RegexNodeFile，
 * 反序列化时根据 match_mode='extract' 重建为 regexExtract 节点。
 */
export interface RegexExtractNodeData {
  /**
   * 节点配置名称
   */
  configName: string

  /**
   * 节点描述信息
   */
  description: string

  /**
   * 正则表达式模式字符串
   *
   * 必须使用命名捕获组 (?P<name>...) 以支持提取。
   */
  pattern: string

  /**
   * 正则标志字符串
   */
  flags: string

  /**
   * 是否区分大小写
   */
  caseSensitive: boolean

  /**
   * 参数列表（保留字段，用于前端扩展）
   */
  parameters?: RegexParameter[]

  /**
   * 节点是否启用
   */
  enabled: boolean

  /**
   * 捕获组定义（名称与组索引映射）
   */
  captureGroups: Array<{ name: string; groupIndex: number }>

  /**
   * 输出列名列表
   */
  outputColumns: string[]

  /**
   * 数据流输入接口
   * 若存在，优先于 sourceRef 使用
   */
  inputFromNode?: string
  inputColumn?: string

  /**
   * 源字段的稳定引用（节点 ID + 列 ID），用于项目保存/加载重建连线
   */
  sourceRef?: {
    nodeId: string
    columnId: string
  }

  /**
   * 设计器规则（保留用于可视化编辑）
   */
  rules?: Rule[]

  /**
   * 校验/提取状态
   */
  validationStatus?: 'idle' | 'pass' | 'error' | 'missing'

  /**
   * 总行数（校验/提取运行时统计）
   */
  totalRows?: number

  /**
   * 匹配/成功行数
   */
  matchCount?: number

  /**
   * 错误/失败行数
   */
  errorCount?: number

  /**
   * 最近一次运行的时间
   */
  lastValidationTime?: string

  /**
   * 保存状态
   */
  saveState?: 'draft' | 'saved' | 'error'

  /**
   * 最近一次保存时间
   */
  lastSaved?: string

  /**
   * 父节点 ID（关联的 Schema 节点）
   */
  parent?: string

  /**
   * 引用已注册的 Pattern
   */
  uses_pattern?: {
    registry: 'patterns'
    pattern_name: string
  }
}

/**
 * 正则表达式设计更新数据类型
 *
 * 【业务场景】
 * 用于正则设计器 (RegexDesignModal) 保存更新时，
 * 将变更的数据传递给后端或更新节点数据。
 *
 * 【使用时机】
 * - 用户点击设计器的"保存"按钮时
 * - 需要更新 RegexNode 的配置时
 *
 * 【可选字段说明】
 * 所有字段均为可选，只更新传入的字段。
 */
export interface RegexDesignUpdateData {
  /**
   * 规则列表更新
   *
   * 【更新逻辑】
   * - 如果传入，则完全替换现有 rules
   * - 如果不传，则保持现有 rules 不变
   */
  rules?: Array<{
    /**
     * 规则 ID
     *
     * 【来源】
     * - 新规则：undefined (后端生成)
     * - 已有规则：从现有数据中获取
     */
    id: string
    name?: string
    regex?: string
    description?: string
    output?: Record<string, string>
  }>

  /**
   * 节点配置名称更新
   */
  configName?: string

  /**
   * 正则模式更新
   */
  pattern?: string

  /**
   * 匹配模式更新
   *
   * 仅用于 Regex 校验节点，取值为 'full' 或 'partial'。
   * RegexExtract 节点使用独立的设计器更新类型。
   */
  matchMode?: 'full' | 'partial'

  /**
   * 参数列表更新
   */
  parameters?: RegexParameter[]

  /**
   * 描述信息更新
   */
  description?: string
}

/**
 * 正则提取设计器更新数据类型
 *
 * 用于 RegexExtractDesignModal 保存更新时传递变更字段。
 * captureGroups / outputColumns 会在保存时由规则自动推导，无需调用方传入。
 */
export type RegexExtractDesignUpdateData = Partial<RegexExtractNodeData>

/**
 * Pattern 节点数据
 *
 * 【用途】
 * - 在 Canvas 中展示 patterns 注册表中的单个表达式
 * - 支持拖拽到 Regex 节点上生成完整配置
 */
export interface PatternNodeData {
  /**
   * Pattern 标识符
   *
   * 【用途】
   * - 唯一标识该 pattern
   * - 用于引用 registry 中的具体表达式
   */
  patternId: string

  /**
   * Pattern 展示名称
   */
  name: string

  /**
   * Pattern 所属注册表类型
   *
   * 【类型说明】
   * - patterns: 正则表达式模式
   */
  registry: 'patterns'

  /**
   * 完整的正则表达式内容
   *
   * 【来源】
   * 从 registry 中加载的实际正则表达式字符串
   */
  pattern?: string

  /**
   * 正则标志
   */
  flags?: string

  /**
   * 是否区分大小写
   */
  caseSensitive?: boolean

  /**
   * 节点保存状态
   */
  saveState?: 'saved' | 'modified' | 'saving'
}
