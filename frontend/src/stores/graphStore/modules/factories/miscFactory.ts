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
 * @file miscFactory.ts
 * @description 杂项节点工厂
 *
 * 提供便捷方法来创建各类空节点，作为画布快捷操作的入口。
 *
 * 功能概述：
 * - createEmptyTableNode: 创建空 Schema 节点
 * - createEmptyPatternNode: 创建空 Regex 节点
 * - createLogicNode: 创建外键约束节点（用于逻辑关系）
 * - 所有方法委托给具体的 createSchemaNode / createRegexNode / createConstraintNode
 *
 * 架构设计：
 * - 纯委托模式，封装常用节点创建操作
 * - 接收具体工厂方法作为参数，不直接操作状态
 * - 使用 i18n 提供本地化默认名称（factories.defaultName.* 命名空间）
 */

import { i18n } from '@/i18n'

export function createMiscFactoryModule(params: {
  createSchemaNode: (position: { x: number; y: number }, name?: string) => string
  createRegexNode: (position: { x: number; y: number }, pattern?: string, name?: string) => string
  createConstraintNode: (
    position: { x: number; y: number },
    constraintType:
      | 'foreignKey'
      | 'unique'
      | 'notNull'
      | 'allowedValues'
      | 'conditional'
      | 'scripted'
      | 'range'
      | 'charset'
      | 'dateLogic',
    data?: Record<string, unknown>
  ) => string
}) {
  const { createSchemaNode, createRegexNode, createConstraintNode } = params

  function createEmptyTableNode(position: { x: number; y: number }, name?: string) {
    return createSchemaNode(position, name || i18n.global.t('factories.defaultName.table'))
  }

  function createEmptyPatternNode(position: { x: number; y: number }, name?: string) {
    return createRegexNode(position, '', name || i18n.global.t('factories.defaultName.pattern'))
  }

  function createLogicNode(position: { x: number; y: number }, name?: string) {
    return createConstraintNode(position, 'foreignKey', {
      configName: name || i18n.global.t('factories.defaultName.logicConstraint'),
    })
  }

  return {
    createEmptyTableNode,
    createEmptyPatternNode,
    createLogicNode,
  }
}
