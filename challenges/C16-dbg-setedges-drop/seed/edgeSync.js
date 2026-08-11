/**
 * 把逻辑边列表转换成渲染边列表。
 * @param {Array<{id: string, source: string, target: string}>} edges - 逻辑边
 * @param {(id: string) => object|null} findNode - 查找节点，找不到返回 null
 * @returns {Array<object>} 渲染边
 */
function createGraphEdges(edges, findNode) {
  const result = []
  for (const edge of edges) {
    const sourceNode = findNode(edge.source)
    const targetNode = findNode(edge.target)
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
