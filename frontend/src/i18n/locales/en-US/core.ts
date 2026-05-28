/**
 * @file core.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const app = {
  title: 'DataValidator',
  layout: {
    activityBar: 'Navigation Bar',
    sidebar: 'Sidebar Panel',
    canvas: 'Canvas Area',
    rightPanel: 'Right Panel',
  },
}

const navigation = {
  dashboard: 'Dashboard',
  schemaConfig: 'Schema Configuration',
  expressionRules: 'Expression Rules',
  reportingConfig: 'Reporting Configuration',
  switchProject: 'Switch Project',
  language: 'Language',
  languageSwitch: {
    zhCN: '简体中文',
    enUS: 'English',
  },
}

const dashboard = {
  title: 'Project Dashboard',
  loading: 'Loading project information...',
  error: {
    title: 'Unable to load project information:',
    message: 'Project loading failed, please check network connection or contact administrator.',
  },
  info: {
    projectId: 'ID',
    description: 'Description',
    lastValidated: 'Last Validated',
    notAvailable: 'N/A',
  },
  stats: {
    schemas: 'Table Schemas',
    constraints: 'Constraint Rules',
    lastValidation: 'Last Validation Time',
  },
  actions: {
    startValidation: 'Start Validation',
    editConfig: 'Edit Configuration',
    viewReports: 'View Historical Reports',
  },
}

const assetLibrary = {
  title: 'Asset Library',
  project: {
    title: 'Project Data',
    empty: 'No project data available',
  },
  data: {
    title: 'Data Sources',
    empty: 'No data sources available',
  },
  // [Added] AssetLibrary related
  linked: 'Files Linked',
  view: {
    project: '🗃️ Project Resource View',
    data: '📊 Data Source View',
  },
  // AssetLibraryNav related
  activityBar: {
    toolboxView: 'Toolbox',
    resourcesView: 'Resources',
    aiChatView: 'AI Assistant',
    validationHistoryView: 'History',
    dataView: 'Data',
    settings: 'Settings',
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
