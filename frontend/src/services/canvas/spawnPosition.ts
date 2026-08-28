/**
 * @file spawnPosition.ts
 * @description 工具箱创建节点的落点计算 —— 纯逻辑，无框架依赖
 *
 * 背景：节点创建曾使用固定坐标（如 schema 恒为 {200,100}），连续创建多个节点
 * 会精确堆叠在同一位置，新节点被旧节点遮挡，用户误以为创建失败。
 * 本模块负责在视口中心附近寻找第一个不与既有节点重叠的落点，并按对角线级联避让。
 */

/** 参与落点计算的既有节点最小信息 */
export interface SpawnOccupant {
  position: { x: number; y: number }
  width?: number
  height?: number
}

export interface ResolveSpawnPositionInput {
  /** 视口中心的 flow 坐标；未知（如 Vue Flow 未初始化）时传 null，回退到画布原点附近 */
  viewportCenter: { x: number; y: number } | null
  /** 画布上已有的节点（用于重叠避让） */
  occupants: SpawnOccupant[]
  /** 新节点的预估尺寸（节点未渲染前无实测尺寸，用保守估计） */
  newNodeSize?: { width: number; height: number }
  /** 级联步长（px），默认 40 */
  cascadeStep?: number
  /** 最大级联次数，超过后直接返回最后候选（保证有返回值），默认 24 */
  maxCascade?: number
  /** 候选位置与既有节点间的安全间距（px），默认 16 */
  gap?: number
}

/** 未渲染节点的保守尺寸估计（画布卡片普遍在 220~320 宽） */
export const DEFAULT_NEW_NODE_SIZE = { width: 280, height: 160 }
/** 既有节点缺失实测尺寸时的回退估计 */
const DEFAULT_OCCUPIED_SIZE = { width: 280, height: 160 }

/**
 * 在视口中心附近解析一个不与既有节点重叠的新节点落点。
 *
 * 候选序列：视口中心 → 沿右下对角线按 cascadeStep 逐级偏移；
 * 全部候选都被占用时返回最后一个候选（保证调用方总有可用坐标）。
 */
export function resolveSpawnPosition(input: ResolveSpawnPositionInput): { x: number; y: number } {
  const {
    viewportCenter,
    occupants,
    newNodeSize = DEFAULT_NEW_NODE_SIZE,
    cascadeStep = 40,
    maxCascade = 24,
    gap = 16,
  } = input

  const start = viewportCenter ?? { x: 160, y: 120 }

  for (let i = 0; i <= maxCascade; i++) {
    const candidate = { x: start.x + i * cascadeStep, y: start.y + i * cascadeStep }
    if (!overlapsAny(candidate, newNodeSize, occupants, gap)) {
      return candidate
    }
  }
  return { x: start.x + maxCascade * cascadeStep, y: start.y + maxCascade * cascadeStep }
}

function overlapsAny(
  candidate: { x: number; y: number },
  size: { width: number; height: number },
  occupants: SpawnOccupant[],
  gap: number
): boolean {
  const left = candidate.x - gap
  const top = candidate.y - gap
  const right = candidate.x + size.width + gap
  const bottom = candidate.y + size.height + gap
  return occupants.some((node) => {
    const w = node.width ?? DEFAULT_OCCUPIED_SIZE.width
    const h = node.height ?? DEFAULT_OCCUPIED_SIZE.height
    const nLeft = node.position.x
    const nTop = node.position.y
    const nRight = node.position.x + w
    const nBottom = node.position.y + h
    return left < nRight && right > nLeft && top < nBottom && bottom > nTop
  })
}
