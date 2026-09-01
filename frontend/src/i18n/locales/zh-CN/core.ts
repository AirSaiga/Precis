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

export { navigation }
export { assetLibrary }
