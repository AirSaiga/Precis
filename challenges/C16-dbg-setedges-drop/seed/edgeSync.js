/**
 * C16 seed — createGraphEdges 有静默丢边的 bug。
 *
 * 当 findNode(edge.source) 或 findNode(edge.target) 返回 null 时，
 * 当前实现直接 continue 跳过该边，不报告、不抛错——调用方完全不知道边被丢了。
 *
 * 任务：修复这个静默失败，让缺失节点的边以某种方式被调用方感知
 * （抛错、或返回 warnings 列表、或两者皆可），但不要影响正常边的处理。
 */

/**
 * 把逻辑边列表转换成渲染边列表。
 * @param {Array<{id: string, source: string, target: string}>} edges - 逻辑边
 * @param {(id: string) => object|null} findNode - 查找节点，找不到返回 null
 * @returns {Array<object>} 渲染边（当前实现会静默丢弃缺失节点的边）
 */
function createGraphEdges(edges, findNode) {
  const result = []
  for (const edge of edges) {
    const sourceNode = findNode(edge.source)
    const targetNode = findNode(edge.target)
    // BUG: 节点找不到时静默 continue，边被无声丢弃
    if (!sourceNode || !targetNode) {
      continue
    }
    result.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceNode,
      targetNode,
    })
  }
  return result
}

module.exports = { createGraphEdges }
