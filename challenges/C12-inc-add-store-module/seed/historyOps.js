/**
 * 历史操作工厂模块（C12 seed —— 另一个参考）。
 * 接收 nodes 依赖，提供 undo/redo 栈。
 */
function createHistoryOps(deps) {
  const { nodes } = deps
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

  return { snapshot, undo, redo }
}

module.exports = { createHistoryOps }
