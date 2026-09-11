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
 * @fileoverview V2 画布布局持久化类型：多标签工作区（含完整画布快照）与
 * project.view.json 项目视图。
 */

import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '../nodes'

/**
 * V2 项目视图文件（project.view.json）。
 *
 * 设计目标：
 * - 将"画布布局（节点坐标/视口）"与"校验语义配置（schema/constraint/regex）"解耦
 * - 避免把 UI 相关信息写入后端全量校验所需的配置文件
 */
export interface ProjectViewV2 {
  /** 视图版本号，用于未来扩展兼容 */
  version: number
  /** 节点坐标映射：nodeId -> { x, y } */
  nodes: Record<string, { x: number; y: number }>
  /** 节点 UI 状态：hidden / expanded 等 */
  nodeStates?: Record<string, { hidden?: boolean; expanded?: boolean }>
  /** 可选视口信息（不强依赖，缺省时前端使用默认缩放） */
  viewport?: { x: number; y: number; zoom: number }
}

/**
 * 工作区视口状态。
 *
 * 记录画布当前的平移和缩放状态。
 */
export interface WorkspaceV2Viewport {
  /** 视口 X 坐标 */
  x?: number
  /** 视口 Y 坐标 */
  y?: number
  /** 视口缩放比例 */
  zoom?: number
}

/**
 * 工作区项。
 *
 * 表示一个画布工作区的配置，包括可见节点、视口状态和完整画布快照。
 * nodes/edges 保存完整画布数据，实现跨会话恢复。
 */
export interface WorkspaceV2Item {
  /** 工作区唯一标识符 */
  id: string
  /** 工作区标题 */
  title: string
  /** 工作区排序索引（删除后不重新编号，新建时取 max+1） */
  index: number
  /** 创建时间戳（ISO 8601 格式） */
  createdAt: string
  /** 最后活跃时间戳（ISO 8601 格式） */
  lastActiveAt: string
  /** 当前工作区中可见的节点 ID 列表 */
  visibleNodeIds: string[]
  /** 工作区视口状态（可选） */
  viewport?: WorkspaceV2Viewport
  /** 画布节点完整数据 */
  nodes: CustomNode[]
  /** 画布边完整数据 */
  edges: Edge[]
}

/**
 * 工作区列表响应。
 *
 * 后端返回的所有工作区配置，每个工作区包含完整画布快照。
 */
export interface WorkspacesV2Response {
  /** 响应版本号 */
  version: number
  /** 当前活跃的工作区 ID，无则为 null */
  activeWorkspaceId: string | null
  /** 工作区列表（含完整画布快照） */
  workspaces: WorkspaceV2Item[]
}
