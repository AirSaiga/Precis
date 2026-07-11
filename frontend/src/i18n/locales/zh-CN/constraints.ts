/**
 * @file constraints.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const constraintRuleTypeMenu = {
  title: '约束规则类型',
  notNull: '非空约束',
  unique: '唯一约束',
  foreignKey: '外键约束',
  allowedValues: '允许值约束',
  scripted: '脚本约束',
  conditional: '条件约束',
  composite: '复合约束',
}

// 约束类型名称/描述的统一单一事实源：
// key 与 services/constraints/types.ts 的 ConstraintKind 严格对齐（10 种 camelCase）。
// 菜单、节点库、布局器等所有展示约束类型名的地方统一从此命名空间取值，
// 消除多处各自维护中文名导致的不同步与术语漂移（如 区间/范围、复合/组合）。
const constraintTypes = {
  notNull: {
    name: '非空约束',
    description: '确保列不能包含空值',
  },
  unique: {
    name: '唯一约束',
    description: '确保列或列组合的值在表中唯一',
  },
  range: {
    name: '区间约束',
    description: '限制列的值必须在指定数值范围内',
  },
  charset: {
    name: '字符集约束',
    description: '校验 ASCII 或中文字符',
  },
  allowedValues: {
    name: '允许值约束',
    description: '限制列只能包含指定的值',
  },
  foreignKey: {
    name: '外键约束',
    description: '建立表之间的外键关联关系',
  },
  conditional: {
    name: '条件约束',
    description: '基于条件逻辑的动态约束规则',
  },
  scripted: {
    name: '脚本约束',
    description: '使用自定义脚本定义的约束规则',
  },
  dateLogic: {
    name: '日期逻辑约束',
    description: '日期比较和计算校验',
  },
  composite: {
    name: '复合约束',
    description: '将多个子约束按逻辑策略组合校验',
  },
}

const config = {
  schema: {
    title: 'Schema 配置',
    list: 'Schema 列表',
    detail: 'Schema 详情',
    add: '新建 Schema',
    edit: '编辑 Schema',
    delete: '删除 Schema',
    columns: '列定义',
    column: {
      name: '列名',
      type: '数据类型',
      nullable: '可为空',
      primaryKey: '主键',
      defaultValue: '默认值',
    },
  },
  schemaList: {
    tablesTitle: '表 / Schemas',
    addTableTooltip: '添加新表',
    noTablesFound: '没有找到任何表。',
    clickToAdd: "点击 '+' 添加一个。",
  },
  schemaDetailPanel: {
    configTitle: '配置: {{ tableName }}',
    saveTable: '保存此表',
    basicInfo: '基础信息',
    scriptChecks: '业务逻辑检查 (Script Checks)',
    sourceFilename: '源文件名',
  },
  columnEditor: {
    title: '列编辑器',
    addColumn: '添加列',
    removeColumn: '删除列',
    moveUp: '上移',
    moveDown: '下移',
  },
  columnRow: {
    name: '列名',
    type: '类型',
    length: '长度',
    nullable: '可空',
    primaryKey: '主键',
    autoIncrement: '自增',
    defaultValue: '默认值',
    comment: '注释',
  },
  scriptCheckEditor: {
    title: '脚本检查编辑器',
    language: '脚本语言',
    code: '脚本代码',
    test: '测试',
    save: '保存',
    cancel: '取消',
  },
  webhookConfig: {
    title: 'Webhook 配置',
    url: 'Webhook URL',
    method: '请求方法',
    headers: '请求头',
    body: '请求体',
    test: '测试连接',
    save: '保存',
    cancel: '取消',
  },
  patternNode: {
    badgeReadOnly: '只读',
    groups: {
      config: '模式配置',
      regex: '正则表达式',
      source: '来源信息',
      status: '校验状态',
    },
    labels: {
      patternName: '模式名称',
      patternType: '模式类型',
      description: '描述',
      pattern: '正则表达式',
      flags: '标志',
      caseSensitive: '区分大小写',
      registry: '注册表类型',
      sourceFile: '来源文件',
      validationStatus: '校验状态',
      matchCount: '匹配数',
      matchRate: '匹配率',
    },
    values: {
      caseSensitive: '区分大小写',
      caseInsensitive: '不区分大小写',
      matches: '条匹配',
    },
    types: {
      atomic: '原子模式',
      combination: '组合模式',
      unknown: '未知',
    },
    status: {
      pass: '通过',
      error: '失败',
      idle: '待校验',
    },
  },
  projectRoot: {
    badgeReadOnly: '只读',
    groups: {
      basicInfo: '项目基本信息',
      statistics: '统计指标',
      quickActions: '快捷操作',
    },
    labels: {
      projectName: '项目名称',
      projectPath: '项目路径',
      configPath: '配置路径',
      lastOpenTime: '最后打开时间',
    },
    stats: {
      schemaCount: 'Schema 数量',
      constraintCount: '约束数量',
      regexCount: '正则数量',
      passRate: '校验通过率',
      errorCount: '错误总数',
    },
    actions: {
      fullValidation: '全量校验',
      export: '导出完整配置',
      aiGenerate: 'AI 初始化配置',
      reload: '重载项目',
      projectManagement: '项目管理',
      closeProject: '关闭项目',
    },
    confirm: {
      closeProject: '确定要关闭当前项目吗？',
    },
  },
}

const connectionValidation = {
  incompatibleSourceType: '源节点类型不支持此连接',
  incompatibleTargetType: '目标节点类型不支持此连接',
  sourceHandleNotAllowed: '源端点不允许连接',
  targetHandleNotAllowed: '目标端点不允许连接',
  handleMismatch: '端点不匹配',
  multipleConnectionsNotAllowed: '该连接类型不支持多个连接',
  noMatchingRule: '找不到匹配的连接规则',
  unknownError: '连接验证失败',
  selfConnectionNotAllowed: '不能连接到自己',
  connectionSuccess: '连接成功',
}

const connectionRules = {
  title: '连接规则配置',
  save: '保存',
  reset: '重置',
  addRule: '添加规则',
  addFirstRule: '添加第一条规则',
  rulesCount: '共 {count} 条规则',
  empty: '暂无连接规则',
  newRule: '新规则',
  ruleId: '规则 ID',
  ruleName: '规则名称',
  sourceEndpoint: '源端点',
  targetEndpoint: '目标端点',
  nodeTypes: '节点类型',
  handles: 'Handle',
  optional: '可选',
  handlesPlaceholder: '留空表示不限制，多个用逗号分隔',
  ruleConfig: '规则配置',
  allowMultiple: '允许多个连接',
  validationMode: '验证模式',
  saved: '规则已保存',
  saveFailed: '保存失败',
  resetConfirm: '确定要重置为默认规则吗？当前自定义规则将被覆盖。',
  resetSuccess: '规则已重置为默认值',
  resetFailed: '重置失败',
  deleteConfirm: '确定要删除这条规则吗？',
}

const connectionModes = {
  strict: '严格模式',
  loose: '宽松模式',
}

export { constraintRuleTypeMenu }
export { constraintTypes }
export { config }
export { connectionValidation }
export { connectionRules }
export { connectionModes }
