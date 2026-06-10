/**
 * @file messages.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const welcome = {
  title: '欢迎使用 DataValidator',
  subtitle: '数据验证和约束管理平台',
  description:
    '这是一个基于Vue 3和TypeScript的现代化数据验证工具，帮助您定义、管理和执行数据约束规则。',
  features: ['可视化数据架构设计', '灵活的约束规则定义', '实时数据验证', '详细的验证报告'],
  getStarted: '开始使用',
  learnMore: '了解更多',
}

const messages = {
  success: {
    saved: '保存成功',
    deleted: '删除成功',
    copied: '复制成功',
    projectLoaded: '项目加载成功',
    configSaved: '配置保存成功',
    validationStarted: '验证已开始',
    validationCompleted: '验证完成',
    fileUploaded: '文件上传成功',
    expressionSaved: '表达式规则已保存！',
  },
  error: {
    loadResourceFailed: '加载资源失败',
    saveFailed: '保存失败',
    deleteFailed: '删除失败',
    projectLoadFailed: '项目加载失败',
    configSaveFailed: '配置保存失败',
    validationFailed: '验证失败',
    networkError: '网络错误',
    unknownError: '未知错误',
    projectNotFound: '目录缺少 project.precis.yaml 项目清单文件，请新建项目或选择有效项目目录\n{path}',
  },
  warning: {
    unsavedChanges: '您有未保存的更改',
    deleteConfirm: '此操作不可撤销，确定要删除吗？',
    switchProject: '切换项目将丢失当前所有未保存的更改',
  },
  messages: {
    createNodeFailed: '创建节点失败，请检查控制台错误信息',
    electronNotDetected: '无法检测到 Electron 环境，请确保应用已正确启动',
    electronApiFailed: 'Electron API 加载失败，请尝试重启应用',
    noFilesSelected: '未选择任何文件',
    clearFailed: '清空数据源失败，请稍后重试',
    removeFailed: '移除数据源失败，请稍后重试',
    filePathRequired: '无法打开文件：文件路径为空，请重新导入数据源',
    electronRequired: '无法打开文件：Electron 环境不可用',
    cannotReselectFile: '无法重新选择文件：Electron 环境不可用',
    reloadFailed: '重新加载文件失败，请稍后重试',
    invalidFolderPath: '无效的文件夹路径',
  },
  projectLibrary: {
    createSchemaNodeFailed: '创建 Schema 节点失败',
    createRegexNodeFailed: '创建正则表达式节点失败',
    createConstraintNodeFailed: '创建约束节点失败',
  },
  previewData: {
    reloadFileNotFound: '重载数据失败：文件不存在，请重新添加数据源',
    reloadFailed: '重载数据失败，请稍后重试',
    reloadError: '重载数据时发生错误，请稍后重试',
    reloadEmptyPath: '重载数据失败：文件路径为空',
    reloadInvalidPath: '重载数据失败，请检查文件路径是否正确',
    reloadErrorWithPath: '重载数据时发生错误，请检查文件路径是否正确',
  },
  canvas: {
    newTable: '新表格',
    newPattern: '新模式',
    newRegex: '新正则表达式',
    newTransform: '新转换节点',
    newManualData: '手动数据',
    newTemplateInstance: '新模板实例',
    transformMenu: {
      searchPlaceholder: '搜索 Transform...',
      recentUsed: '最近使用',
      noResults: '未找到匹配的操作',
      categories: {
        text: '文本处理',
        numeric: '数值计算',
        cleaning: '数据清洗',
        structure: '数据重组',
        date: '日期处理',
      },
      constraintCategories: {
        attribute: '字段约束',
        relation: '关联约束',
        logic: '逻辑约束',
      },
    },
  },
  persistence: {
    exportYamlSuccess: '项目已导出为YAML文件',
    exportSuccess: '导出成功',
    exportFailed: '导出失败',
    schemaNotFound: '未找到Schema节点',
    invalidYamlFormat: '无效的YAML格式',
    comments: {
      projectConfig: '# Precis项目配置\n',
      schemaConfig: '# Schema配置\n',
      constraintConfig: '# 约束配置\n',
      assetsConfig: '# 资源资产\n',
    },
    savePartialSuccess: '保存项目视图失败，项目配置已保存但视图更新失败',
    saveFailed: '保存失败',
    saveSuccess: '保存成功',
    loadFailed: '加载失败',
    loadSuccess: '加载成功',
    exportYamlFailed: '无法生成YAML文件',
    saveRegexDesignFailed: '保存失败',
    projectSaved: '项目 "{name}" 已保存',
    projectSavedWithWarnings: '项目 "{name}" 已保存（{count} 个警告）',
    projectLoaded: 'V2 项目 "{name}" 已载入',
    schemaSaved: 'Schema "{name}" 已保存',
    constraintSaved: '约束 "{name}" 已保存',
    regexSaved: '正则 "{name}" 已保存',
    transformSaved: '转换节点 "{name}" 已保存',
    templateInstanceSaved: '模板实例 "{name}" 已保存',
    regexSavedWithPaths: '正则 "{name}" 已保存到：{path}（清单：{manifest}）',
    pleaseSelectDataSourceFirst: '请先选择数据源再保存',
    configWarningTitle: '配置警告',
    configParseFailed: '部分配置文件解析失败，已跳过:\n{list}',
  },
  import: {
    patternNotFound: '未找到正则表达式模式: {patternId}',
    importFailed: '导入失败',
    externalDataSourceIncomplete: '外部数据源拖拽数据不完整，缺少关键信息',
  },
  builder: {
    constraintNodeNotFound: '未找到约束节点',
    schemaNodeNotFound: '未找到Schema节点',
    regexNodeNotFound: '未找到Regex节点',
    transformNodeNotFound: '未找到Transform节点',
    templateInstanceNodeNotFound: '未找到模板实例节点',
    unsupportedConstraintType: '不支持的约束类型',
  },
}

const startupLoading = {
  title: '正在启动',
  waitingBackend: '正在启动后端服务…',
  initializingWorkspace: '正在加载工作区配置…',
  initializingCanvas: '正在初始化画布…',
  continueWithoutBackend: '后端启动较慢，已进入应用（可稍后重试）。',
}

export { welcome }
export { messages }
export { startupLoading }
