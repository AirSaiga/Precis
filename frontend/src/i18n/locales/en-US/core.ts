/**
 * @file core.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const navigation = {
  languageSwitch: {
    zhCN: '简体中文',
    enUS: 'English',
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
    project: 'Project Resource View',
    data: 'Data Source View',
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

export { navigation }
export { assetLibrary }
