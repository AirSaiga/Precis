/**
 * @file regex.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const regexCreationModal = {
  title: '创建正则表达式',
  name: '正则表达式名称',
  pattern: '正则表达式模式',
  description: '描述',
  testString: '测试字符串',
  testResult: '测试结果',
  isValid: '有效',
  isInvalid: '无效',
  save: '保存',
  cancel: '取消',
  ruleNameRequired: '请输入规则名称',
  regexRequired: '请输入正则表达式',
}

const regexDesignModal = {
  title: '正则表达式设计',
  selectOrAddRule: '选择或添加一个规则',
  addRule: '添加规则',
  autoSaveTip: '自动保存已启用',
  cancel: '取消',
  save: '保存',
  defaultRuleName: '新规则',
  saveSuccess: '保存成功',
  saved: '正则表达式 "{name}" 已保存',
  savedWithRevalidation: '正则表达式 "{name}" 已保存并触发重校验',
  unsavedChangesTitle: '未保存的更改',
  unsavedChangesMessage: '当前有未保存的更改，确定要关闭吗？',
  unsavedChangesConfirm: '放弃更改',
  unsavedChangesCancel: '继续编辑',
}

const expression = {
  title: '表达式编辑器',
  interactiveBuilder: '交互式构建器',
  paramDefinition: '参数定义',
  ruleConfig: '规则配置',
  ruleList: '规则列表',
  ruleTest: '规则测试',
  selectionPopover: '选择弹出框',
}

const expressions = {
  selectionPopover: {
    setAsParameter: '设为参数',
    cancelSelection: '取消选择',
  },
  interactiveBuilder: {
    inputText: '输入文本',
    exampleText: '例如: 订单金额 > 100',
    previewSelection: '划词预览',
    previewHere: '在此处预览...',
    matchPreview: '匹配预览',
  },
  ruleConfigPanel: {
    ruleConfig: '规则配置',
    saveAllRules: '保存全部规则',
    ruleDefinition: '规则定义',
    ruleName: '规则名称',
    ruleNamePlaceholder: '为你的规则起一个名字',
    interactiveBuilder: '交互式构建器',
    regex: '正则表达式',
    regexPlaceholder: '由构建器生成或手动输入',
    regexHint: '由构建器生成或手动编辑',
    outputMapping: '输出映射',
    outputMappingHint: 'Key 即最终新增列名，建议使用语义化名称（通常等于捕获组名）。',
    outputTemplate: '输出模板 (Output)',
    clickToAddFirst: '点击下方按钮添加第一个输出键值对',
    key: 'Key',
    selectParameter: '选择参数',
    staticValue: '静态值',
    staticValuePlaceholder: '输入静态文本...',
    bindToParam: '绑定到正则变量',
    noNamedGroups: '（无命名捕获组）',
    deleteThisRow: '删除此行',
    addKeyValue: '添加键值对',
    keyAlreadyExists: '键 "{key}" 已存在，请使用唯一的键名。',
  },
  paramDefinitionModal: {
    defineParameter: '定义参数',
    closeModal: '关闭弹窗',
    parameterName: '参数名',
    parameterNamePlaceholder: '例如: amount',
    parameterType: '参数类型',
    typeInt: '整数 (int)',
    typeFloat: '浮点数 (float)',
    typeWord: '单词 (word)',
    typeNonSpace: '非空白字符 (non_space)',
    typeAnything: '任意字符 (anything)',
    cancel: '取消',
    confirm: '确认',
    paramNameCannotBeEmpty: '参数名不能为空！',
  },
  ruleTestPanel: {
    realTimeTest: '实时测试',
    testString: '测试字符串',
    testStringPlaceholder: '在此输入要测试的文本',
    matchStatus: '匹配状态',
    matchSuccess: '匹配成功',
    matchFailed: '匹配失败',
    waitingForInput: '等待输入...',
    captureGroups: '捕获组 (Groups)',
    errorMessage: '错误信息',
  },
  ruleList: {
    patterns: 'Patterns (组合规则)',
    addPattern: '添加 Pattern',
    atomicPatterns: 'Atomic Patterns (原子规则)',
    addAtomicPattern: '添加 Atomic Pattern',
  },
}

export { regexCreationModal }
export { regexDesignModal }
export { expression }
export { expressions }
