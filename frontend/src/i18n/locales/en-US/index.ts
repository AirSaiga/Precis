/**
 * @file index.ts
 * @description 国际化语言包统一导出入口（已拆分为子模块）
 */

import commonLocales from './common'
import shortcuts from './shortcuts'

import { app, navigation, dashboard, assetLibrary } from './core'
import { canvas, nodeTypeMenu, statusBar } from './canvas'
import { inspector, fallbackInspector } from './inspector'
import { customNodes, icons, sourcePreview } from './nodes'
import {
  constraintRuleTypeMenu,
  config,
  connectionValidation,
  connectionRules,
  connectionModes,
} from './constraints'
import { regexCreationModal, regexDesignModal, expression, expressions } from './regex'
import { assetLibraryExtended } from './assetLibrary'
import { welcome, messages, startupLoading } from './messages'
import { settings } from './settings'
import { aiChat, aiConfigGenerator } from './ai'
import { template } from './template'

const enUS = {
  app,
  navigation,
  dashboard,
  assetLibrary,
  canvas,
  nodeTypeMenu,
  statusBar,
  inspector,
  fallbackInspector,
  customNodes,
  icons,
  sourcePreview,
  constraintRuleTypeMenu,
  config,
  connectionValidation,
  connectionRules,
  connectionModes,
  regexCreationModal,
  regexDesignModal,
  expression,
  expressions,
  assetLibraryExtended,
  welcome,
  messages,
  startupLoading,
  settings,
  aiChat,
  aiConfigGenerator,
  template,
  common: commonLocales,
  shortcuts,
}

export default enUS
