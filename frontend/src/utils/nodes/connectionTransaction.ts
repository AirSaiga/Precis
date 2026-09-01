/**
 * @file connectionTransaction.ts
 * @description 连接事务管理工具
 *
 * 提供可回滚的节点数据更新事务。用于边连接建立过程中对节点 data 的批量修改，
 * 每次修改立即应用，但保留撤销记录，确保连接失败时可恢复。
 *
 * 核心功能：
 * - createConnectionTransaction: 创建事务实例
 * - patchNodeData: 立即应用节点数据修改，并在修改前记录受影响字段的旧值
 * - commit: 接受所有已应用的修改（清空撤销记录）
 * - rollback: 按逆序撤销本事务内的全部修改，恢复到事务开始前的状态
 *
 * 架构设计：
 * - 立即应用 + 撤销栈模式：patchNodeData 直接调用 updateNodeData（画布统一入口），
 *   并为每个 patch 捕获字段级旧值快照
 * - 逆序回滚：rollback 按压栈的相反顺序执行撤销，保证恢复正确
 * - 语义：commit 后修改不可再回滚；未 commit 前可随时 rollback
 */

import type { CustomNode, CustomNodeData } from '@/types/graph'

type UndoFn = () => void

export interface ConnectionTransaction {
  patchNodeData: (_nodeId: string, _patch: Partial<CustomNodeData>) => void
  commit: () => void
  rollback: () => void
}

interface NodeSnapshot {
  nodeId: string
  data: Partial<CustomNodeData>
}

export function createConnectionTransaction(params: {
  nodes: CustomNode[]
  updateNodeData: (_nodeId: string, _data: Partial<CustomNodeData>) => void
}): ConnectionTransaction {
  const { nodes, updateNodeData } = params
  const undoStack: UndoFn[] = []
  const snapshots: NodeSnapshot[] = []

  const patchNodeData = (nodeId: string, patch: Partial<CustomNodeData>) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    const before: Record<string, unknown> = {}
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
