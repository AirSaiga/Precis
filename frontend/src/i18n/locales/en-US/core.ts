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
