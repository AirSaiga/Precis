/**
 * 节点操作工厂模块（C12 seed —— 参考模板）。
 *
 * Precis 的 graphStore 用 Pinia setup store + 工厂模块拆分：
 *   - 每个工厂通过参数接收 nodes/edges 等响应式引用（依赖注入）
 *   - 返回一组操作方法
 *   - assembly.js 聚合所有工厂到一个扁平 store 对象
 *
 * AGENTS.md："每个模块工厂通过参数接收 nodes, edges 等响应式引用（依赖注入），
 * 不直接导入 store"。
 */

/**
 * 创建节点操作模块。
 * @param {{nodes: Array, addNode: Function}} deps - 注入的依赖
 */
function createNodeOps(deps) {
  const { nodes, addNode } = deps

  function addNodeWithId(id, data) {
    const node = { id, data, type: 'default' }
    addNode(node)
    return node
  }

  function removeNode(id) {
    const idx = nodes.findIndex((n) => n.id === id)
    if (idx >= 0) nodes.splice(idx, 1)
  }

  function getNode(id) {
    return nodes.find((n) => n.id === id) || null
  }

  return { addNodeWithId, removeNode, getNode }
}

module.exports = { createNodeOps }
