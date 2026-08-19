/**
 * @file overlapDetection.ts
 * @description 画布节点位置异常检测（纯函数，无 I/O 依赖）
 *
 * 用于项目加载/工作区恢复后的"自动布局修复"判定：
 * - 缺失位置 / 非法位置 / 零位置（恰好为 (0,0)，通常是未保存坐标的默认值）
 * - 同位置堆叠（多个节点完全相同坐标，通常是批量恢复时的兜底默认坐标互相压盖）
 *
 * 判定结果只标记"受影响节点"，绝不触碰位置正常的节点 —— 用户手动摆放过的
 * 布局不会被自动布局打乱。
 */

/** 最小节点形状：仅需 id 与 position */
export interface PositionProbeNode {
  id: string
  position?: { x: number; y: number } | null
}

/** 位置异常检测结果 */
export interface PositionAnomalyReport {
  /** 位置缺失/非法/为零的节点 id */
  invalidPositionIds: string[]
  /** 与其他节点完全同坐标堆叠的节点 id（整组计入，无法区分谁是"原始"位置） */
  stackedPositionIds: string[]
  /** 需要重新布局的节点 id（上两者并集，去重） */
  affectedIds: string[]
}

/** 判断单个位置是否非法：缺失、非有限数、或恰好为 (0,0) */
function isInvalidPosition(position: { x: number; y: number } | null | undefined): boolean {
  if (!position) return true
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return true
  // (0,0) 视为"零位置"：真实用户几乎不会把节点精确放回画布原点，
  // 而加载兜底/未持久化坐标常表现为 (0,0)
  return position.x === 0 && position.y === 0
}

/**
 * 检测一组节点中的位置异常。
 *
 * @param nodes 画布节点（仅需 id 与 position 字段）
 * @returns 异常报告；affectedIds 为空表示布局健康，无需修复
 */
export function detectPositionAnomalies(
  nodes: ReadonlyArray<PositionProbeNode>
): PositionAnomalyReport {
  const invalidPositionIds: string[] = []
  /** 有效位置 → 节点 id 列表（用于同位置堆叠检测） */
  const nodesByPositionKey = new Map<string, string[]>()

  for (const node of nodes) {
    if (isInvalidPosition(node.position)) {
      invalidPositionIds.push(node.id)
      continue
    }
    const key = `${node.position!.x},${node.position!.y}`
    const group = nodesByPositionKey.get(key)
    if (group) {
      group.push(node.id)
    } else {
      nodesByPositionKey.set(key, [node.id])
    }
  }

  const stackedPositionIds: string[] = []
  for (const group of nodesByPositionKey.values()) {
    // 仅当 ≥2 个节点共享完全相同坐标时视为堆叠异常
    if (group.length > 1) {
      stackedPositionIds.push(...group)
    }
  }

  const affectedIds = [...new Set([...invalidPositionIds, ...stackedPositionIds])]

  return { invalidPositionIds, stackedPositionIds, affectedIds }
}
