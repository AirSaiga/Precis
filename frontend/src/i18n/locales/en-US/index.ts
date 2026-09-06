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
 * @file index.ts
 * @description 国际化语言包统一导出入口（已拆分为子模块）
 */

import commonLocales from './common'
import shortcuts from './shortcuts'
import inspection from './inspection'
import feedback from './feedback'

import { navigation, assetLibrary } from './core'
import { canvas, nodeTypeMenu, statusBar } from './canvas'
import { inspector, fallbackInspector } from './inspector'
import { customNodes, sourcePreview } from './nodes'
import {
  constraintRuleTypeMenu,
  constraintTypes,
  config,
  connectionValidation,
  connectionModes,
} from './constraints'
import {
  regexDesignModal,
  regexExtractDesignModal,
  expression,
  expressions,
  regexValidation,
} from './regex'
import { assetLibraryExtended } from './assetLibrary'
import { messages, startupLoading } from './messages'
import { settings } from './settings'
import { aiChat, aiConfigGenerator } from './ai'
import { template } from './template'
import { projectManagement } from './projectManagement'
import { factories } from './factories'
import { validationHistory } from './validationHistory'
import { validation } from './validation'

const enUS = {
  navigation,
  assetLibrary,
  canvas,
  nodeTypeMenu,
  statusBar,
  inspector,
  fallbackInspector,
  customNodes,
  sourcePreview,
  constraintRuleTypeMenu,
  constraintTypes,
  config,
  connectionValidation,
  connectionModes,
  regexDesignModal,
  regexExtractDesignModal,
  expression,
  expressions,
  regexValidation,
  assetLibraryExtended,
  messages,
  startupLoading,
  settings,
  aiChat,
  aiConfigGenerator,
  template,
  projectManagement,
  factories,
  validationHistory,
  validation,
  common: commonLocales,
  shortcuts,
  inspection,
  feedback,
}

export default enUS
