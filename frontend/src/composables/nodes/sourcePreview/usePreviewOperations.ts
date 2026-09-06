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
 * @file usePreviewOperations.ts
 * @description 数据源预览节点操作
 * 负责节点删除等操作
 */

/**
 * 数据源预览节点操作
 * @param props - 组件属性
 * @returns 节点操作相关的方法
 */
import { NodeDeletionManager } from '@/services/managers/nodeDeletionManager'

export function usePreviewOperations(props: { id: string }) {
  /**
   * 处理节点移除
   */
  const handleRemove = async () => {
    const manager = NodeDeletionManager.getInstance()
    await manager.delete(props.id)
  }

  return {
    handleRemove,
  }
}
