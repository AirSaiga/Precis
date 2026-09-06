/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
