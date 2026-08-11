/**
 * God Store（C24 seed —— 过大，待拆分）。
 *
 * 当前把三组不相关逻辑全塞在一个 createGodStore 里：
 * - 节点操作（addNode, removeNode, getNode）
 * - 剪贴板操作（copyNode, pasteNode）—— 这是本题的提取目标
 * - 历史操作（undo, redo）
 *
 * AGENTS.md "god-split-plan.md"：graphStore 曾是 God store，拆成 ~27 个工厂模块。
 *
 * 任务：把剪贴板操作提取到 workspace/clipboardOps.js 工厂模块，
 * godStore 通过工厂调用引用它，行为不变。
 */

function createGodStore(deps) {
  const { nodes } = deps
  const clipboard = { value: null }  // 模块级剪贴板状态

  // === 节点操作（保留在 godStore）===
  function addNode(node) { nodes.push(node) }
  function removeNode(id) {
    const idx = nodes.findIndex((n) => n.id === id)
    if (idx >= 0) nodes.splice(idx, 1)
  }
  function getNode(id) { return nodes.find((n) => n.id === id) || null }

  // === 剪贴板操作（提取目标）===
  function copyNode(id) {
    const node = getNode(id)
    if (!node) return false
    clipboard.value = JSON.parse(JSON.stringify(node))
    return true
  }
  function pasteNode(newId) {
    if (!clipboard.value) return null
    const newNode = { id: newId, data: clipboard.value.data, type: clipboard.value.type }
    addNode(newNode)
    return newNode
  }

  // === 历史操作（保留在 godStore）===
  const past = []
  const future = []
  function snapshot() {
    past.push(JSON.parse(JSON.stringify(nodes)))
    future.length = 0
  }
  function undo() {
    if (past.length === 0) return false
    future.push(JSON.parse(JSON.stringify(nodes)))
    const prev = past.pop()
    nodes.length = 0
    nodes.push(...prev)
    return true
  }
  function redo() {
    if (future.length === 0) return false
    past.push(JSON.parse(JSON.stringify(nodes)))
    const next = future.pop()
    nodes.length = 0
    nodes.push(...next)
    return true
  }

  return {
    // node ops
    addNode, removeNode, getNode,
    // clipboard ops
    copyNode, pasteNode,
    // history ops
    snapshot, undo, redo,
  }
}

module.exports = { createGodStore }
