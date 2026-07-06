/**
 * @file core.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const app = {
  title: 'DataValidator',
  layout: {
    activityBar: '导航条',
    sidebar: '侧边面板',
    canvas: '画布区域',
    rightPanel: '右侧面板',
  },
}

const navigation = {
  dashboard: '仪表盘',
  schemaConfig: 'Schema 配置',
  expressionRules: '表达式规则',
  reportingConfig: '报告配置',
  switchProject: '切换项目',
  language: '语言',
  languageSwitch: {
    zhCN: '简体中文',
    enUS: 'English',
  },
}

const dashboard = {
  title: '项目仪表盘',
  loading: '正在加载项目信息...',
  error: {
    title: '无法加载项目信息：',
    message: '项目加载失败，请检查网络连接或联系管理员。',
  },
  info: {
    projectId: 'ID',
    description: '描述',
    lastValidated: '上次校验时间',
    notAvailable: 'N/A',
  },
  stats: {
    schemas: '表结构 (Schemas)',
    constraints: '约束规则',
    lastValidation: '上次校验时间',
  },
  actions: {
    startValidation: '开始校验',
    editConfig: '编辑配置',
    viewReports: '查看历史报告',
  },
}

const assetLibrary = {
  title: '资产库',
  project: {
    title: '项目数据',
    empty: '暂无项目数据',
  },
  data: {
    title: '数据源',
    empty: '暂无数据源',
  },
  // [新增] AssetLibrary相关
  linked: 'Files Linked',
  view: {
    project: '项目资源视图',
    data: '数据源视图',
  },
  // AssetLibraryNav相关
  activityBar: {
    toolboxView: '工具箱',
    resourcesView: '项目资源',
    aiChatView: 'AI 助手',
    validationHistoryView: '校验历史',
    dataView: '数据源',
    settings: '设置',
    languageSwitch: {
      english: 'EN',
      chinese: '中',
    },
  },
}

export { app }
export { navigation }
export { dashboard }
export { assetLibrary }
