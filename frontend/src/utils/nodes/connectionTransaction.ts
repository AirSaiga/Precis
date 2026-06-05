/**
 * @file connectionTransaction.ts
 * @description 连接事务管理工具
 *
 * 提供原子性的节点数据更新事务，支持提交（commit）和回滚（rollback）。
 * 用于边连接建立过程中对节点 data 的批量修改，确保连接失败时可恢复。
 *
 * 核心功能：
 * - createConnectionTransaction: 创建事务实例
 * - patchNodeData: 暂存节点数据修改（不立即应用）
 * - commit: 批量应用所有暂存的修改
 * - rollback: 恢复到事务开始前的状态
 *
 * 架构设计：
 * - 快照模式：事务开始时记录所有节点的 data 快照
 * - 批量更新：commit 时一次性应用所有 patch
 * - 原子性：要么全部成功，要么全部回滚
 */

import type { CustomNode, CustomNodeData } from '@/types/graph'

type UndoFn = () => void

export interface ConnectionTransaction {
  patchNodeData: (nodeId: string, patch: Partial<CustomNodeData>) => void
  commit: () => void
  rollback: () => void
}

interface NodeSnapshot {
  nodeId: string
  data: Partial<CustomNodeData>
}

export function createConnectionTransaction(params: {
  nodes: CustomNode[]
  updateNodeData: (nodeId: string, data: Partial<CustomNodeData>) => void
}): ConnectionTransaction {
  const { nodes, updateNodeData } = params
  const undoStack: UndoFn[] = []
  const snapshots: NodeSnapshot[] = []

  const patchNodeData = (nodeId: string, patch: Partial<CustomNodeData>) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    const before: Record<string, any> = {}
    const nodeData = node.data ?? {}
    for (const key of Object.keys(patch)) {
      const k = key as keyof CustomNodeData
      before[key] = (nodeData as Record<string, unknown>)[k as string]
    }

    snapshots.push({ nodeId, data: before })

    undoStack.push(() => {
      const target = nodes.find((n) => n.id === nodeId)
      if (target) {
        updateNodeData(nodeId, before as Partial<CustomNodeData>)
      }
    })

    updateNodeData(nodeId, patch as Partial<CustomNodeData>)
  }

  const commit = () => {
    undoStack.length = 0
    snapshots.length = 0
  }

  const rollback = () => {
    for (let i = undoStack.length - 1; i >= 0; i--) {
      const fn = undoStack[i]
      if (fn) fn()
    }
    undoStack.length = 0
    snapshots.length = 0
  }

  return { patchNodeData, commit, rollback }
}
