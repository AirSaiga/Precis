/**
 * @fileoverview Transform 节点检查器配置
 * @description 通过 JSON 配置驱动检查器面板的表单渲染
 *
 * 配置结构：
 * - transformType: 转换类型标识符
 * - fields: 表单字段列表
 *   - key: 参数键名（对应 params 中的字段）
 *   - label: 字段标签
 *   - type: 字段类型 (text, number, select, textarea, checkbox, array, etc.)
 *   - placeholder: 占位符文本
 *   - hint: 帮助提示
 *   - options: 下拉选项（type 为 select 时使用）
 *   - defaultValue: 默认值
 *   - validators: 验证规则
 *
 * 架构设计：
 * - 配置与渲染分离，新增转换类型只需添加配置，无需修改组件代码
 * - 支持自定义渲染组件（通过 component 字段指定）
 * - 支持字段联动和条件显示
 */

export interface FieldOption {
  label: string
  value: string | number
}

export interface FieldValidator {
  type: 'required' | 'pattern' | 'min' | 'max' | 'custom'
  message: string
  rule?: RegExp | ((value: any) => boolean)
}

export interface InspectorFieldConfig {
  key: string
  label: string
  type:
    | 'text'
    | 'number'
    | 'textarea'
    | 'select'
    | 'checkbox'
    | 'array'
    | 'custom'
  placeholder?: string
  hint?: string
  options?: FieldOption[]
  defaultValue?: any
  validators?: FieldValidator[]
  rows?: number // textarea 的行数
  component?: string // 自定义组件名称
  componentProps?: Record<string, any> // 传递给自定义组件的属性
  visible?: (params: Record<string, any>) => boolean // 条件显示
}

export interface TransformInspectorConfig {
  transformType: string
  title?: string
  description?: string
  fields: InspectorFieldConfig[]
}

export const transformInspectorConfigs: TransformInspectorConfig[] = [
  {
    transformType: 'StringSplit',
    fields: [
      {
        key: 'delimiter',
        label: '分隔符',
        type: 'text',
        placeholder: '例如 , 或 - 或 空格',
        defaultValue: ',',
      },
      {
        key: 'maxsplit',
        label: '最大分割次数',
        type: 'number',
        defaultValue: -1,
        hint: '-1 表示分割所有出现的分隔符',
      },
    ],
  },
  {
    transformType: 'MathExpr',
    fields: [
      {
        key: 'expression',
        label: '数学表达式',
        type: 'text',
        placeholder: '例如: @col_name * 2 + 10',
        hint: '使用 @列名 引用输入列，支持 + - * / ** 等运算符',
      },
      {
        key: 'output_type',
        label: '输出类型',
        type: 'select',
        options: [
          { label: '自动推断', value: '' },
          { label: '整数 (int)', value: 'int' },
          { label: '浮点数 (float)', value: 'float' },
        ],
        defaultValue: '',
      },
    ],
  },
  {
    transformType: 'DateFormat',
    fields: [
      {
        key: 'input_format',
        label: '输入日期格式',
        type: 'text',
        placeholder: '例如: %Y-%m-%d',
        defaultValue: '%Y-%m-%d',
        hint: '%Y=年 %m=月 %d=日 %H=时 %M=分 %S=秒',
      },
      {
        key: 'output_format',
        label: '输出日期格式',
        type: 'text',
        placeholder: '例如: %Y/%m/%d',
        defaultValue: '%Y/%m/%d',
      },
      {
        key: 'errors',
        label: '错误处理策略',
        type: 'select',
        options: [
          { label: '转为空值 (coerce)', value: 'coerce' },
          { label: '抛出异常 (raise)', value: 'raise' },
          { label: '保留原值 (ignore)', value: 'ignore' },
        ],
        defaultValue: 'coerce',
      },
    ],
  },
  {
    transformType: 'Strip',
    fields: [
      {
        key: 'chars',
        label: '要去除的字符',
        type: 'text',
        placeholder: '留空则去除首尾空白字符',
        defaultValue: '',
      },
    ],
  },
  {
    transformType: 'Replace',
    fields: [
      {
        key: 'pattern',
        label: '查找内容',
        type: 'text',
        placeholder: '要查找的字符串或正则表达式',
      },
      {
        key: 'replacement',
        label: '替换为',
        type: 'text',
        placeholder: '替换后的字符串',
        defaultValue: '',
      },
      {
        key: 'regex',
        label: '使用正则表达式',
        type: 'checkbox',
        defaultValue: false,
      },
    ],
  },
  {
    transformType: 'FillNA',
    fields: [
      {
        key: 'strategy',
        label: '填充策略',
        type: 'select',
        options: [
          { label: '固定值', value: 'value' },
          { label: '前向填充', value: 'ffill' },
          { label: '后向填充', value: 'bfill' },
          { label: '平均值', value: 'mean' },
          { label: '中位数', value: 'median' },
        ],
        defaultValue: 'value',
      },
      {
        key: 'value',
        label: '填充值',
        type: 'text',
        placeholder: '当策略为"固定值"时填写',
        visible: (params) => params.strategy === 'value',
      },
    ],
  },
  {
    transformType: 'DropDuplicates',
    fields: [
      {
        key: 'columns',
        label: '去重列（可选）',
        type: 'textarea',
        placeholder: '每行一个列名，留空则基于所有列去重',
        rows: 3,
        hint: '每行一个列名',
      },
    ],
  },
  {
    transformType: 'CastType',
    fields: [
      {
        key: 'target_type',
        label: '目标类型',
        type: 'select',
        options: [
          { label: '字符串 (string)', value: 'string' },
          { label: '整数 (int)', value: 'int' },
          { label: '浮点数 (float)', value: 'float' },
          { label: '布尔值 (boolean)', value: 'boolean' },
          { label: '日期时间 (datetime)', value: 'datetime' },
        ],
      },
      {
        key: 'errors',
        label: '错误处理',
        type: 'select',
        options: [
          { label: '转为空值', value: 'coerce' },
          { label: '抛出异常', value: 'raise' },
        ],
        defaultValue: 'coerce',
      },
    ],
  },
  {
    transformType: 'Concat',
    fields: [
      {
        key: 'columns',
        label: '要拼接的列',
        type: 'textarea',
        placeholder: '每行一个列名',
        rows: 3,
        hint: '按顺序拼接这些列的值',
      },
      {
        key: 'separator',
        label: '分隔符',
        type: 'text',
        placeholder: '例如: - 或 空格',
        defaultValue: '',
      },
    ],
  },
  {
    transformType: 'Substring',
    fields: [
      {
        key: 'start',
        label: '起始位置',
        type: 'number',
        placeholder: '从 0 开始',
        defaultValue: 0,
      },
      {
        key: 'end',
        label: '结束位置（可选）',
        type: 'number',
        placeholder: '留空则到末尾',
        hint: '不包含该位置',
      },
    ],
  },
  {
    transformType: 'Modulo',
    fields: [
      {
        key: 'divisor',
        label: '除数 (模数)',
        type: 'number',
        placeholder: '例如: 11',
        defaultValue: 1,
      },
    ],
  },
  {
    transformType: 'MapValue',
    fields: [
      {
        key: 'mapping',
        label: '映射表 (JSON 数组)',
        type: 'textarea',
        placeholder: '例如: [1, 0, "X", 9, 8, 7, 6, 5, 4, 3, 2]',
        rows: 4,
        hint: '以上游值作为索引取对应元素，索引越界时保留原值',
      },
    ],
  },
  {
    transformType: 'Lookup',
    fields: [
      {
        key: 'mapping',
        label: '映射表 (JSON)',
        type: 'textarea',
        placeholder: '例如: {"A": "优秀", "B": "良好", "C": "及格"}',
        rows: 4,
        hint: '键为原值，值为替换后的新值',
      },
      {
        key: 'default',
        label: '未匹配默认值',
        type: 'text',
        placeholder: '未匹配时填充的值（留空则保持原值）',
        defaultValue: '',
      },
    ],
  },
  // 以下类型需要特殊处理，暂时保留硬编码
  // - RegexExtract: 需要解析正则表达式的捕获组
  // - FilterRows: 需要动态添加条件行
  // - Aggregate: 需要配置聚合函数
  // - ConditionalAssign: 需要配置条件规则
  // - SortRows: 需要动态添加排序列
  // - WeightedSum: 需要权重列表编辑器（已实现）
]

/**
 * 根据转换类型获取配置
 */
export function getTransformInspectorConfig(transformType: string): TransformInspectorConfig | undefined {
  return transformInspectorConfigs.find((config) => config.transformType === transformType)
}

/**
 * 获取所有支持的转换类型
 */
export function getSupportedTransformTypes(): string[] {
  return transformInspectorConfigs.map((config) => config.transformType)
}
