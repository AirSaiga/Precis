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

const zhCN = {
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

export default zhCN
