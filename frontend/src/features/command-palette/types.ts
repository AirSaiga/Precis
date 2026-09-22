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
 * @fileoverview 命令面板条目类型 —— 节点搜索结果与面板命令的统一契约
 *
 * 面板结果分两组（节点 / 命令），两组条目都实现 PaletteEntry 判别联合，
 * 组件层用一个扁平列表驱动键盘上下导航，渲染时按 kind 分组。
 */

/** 节点搜索结果条目（由 paletteSearch 从 graphStore.nodes 构建） */
export interface NodeSearchEntry {
  kind: 'node'
  nodeId: string
  nodeType: string
  /** 主标签：configName / 项目名 / 约束显示名等 */
  primaryLabel: string
  /** 次标签：所属 Schema 显示名（约束 / 正则等挂靠节点），无则空串 */
  secondaryLabel: string
  /** 匹配文本（已小写）：主次标签 + 类型名 + 列名 + pattern 等可检索字段的拼接 */
  searchText: string
  /** 节点当前是否被隐藏（坞聚合 / 视图筛选 / 模板折叠） */
  hidden: boolean
}

/** 面板命令条目（由 paletteCommandRegistry 工厂构建，依赖注入执行体） */
export interface PaletteCommandEntry {
  kind: 'command'
  id: string
  /** 命令显示名的 i18n key（commandPalette.commands.<id>） */
  labelKey: string
  /**
   * 关联的快捷键命令 id（如 'editor.save'）——用于读取用户实际绑定的
   * 快捷键并显示在命令项右侧；无绑定的命令省略
   */
  shortcutCommandId?: string
  /** 可用性条件（false 时不出现在结果中） */
  isAvailable: () => boolean
  /** 执行体（由组件层注入依赖：eventBus 发射 / store action） */
  run: () => void | Promise<void>
}

export type PaletteEntry = NodeSearchEntry | PaletteCommandEntry
