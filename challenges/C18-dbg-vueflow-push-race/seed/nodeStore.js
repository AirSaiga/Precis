/**
 * 节点 store —— 模拟 Vue Flow 的响应式同步契约（合成复现，便于 node 直接 require）。
 *
 * createNodeStore() 返回一个 store：
 *   - ref.value 是逻辑节点列表（业务层改它）
 *   - internalState 是内部渲染状态，由 sync() 从 ref.value 同步
 *   - _flush() 是 watcher 的一次"检查 + 回写"，由测试显式调用以驱动同步
 *   - addNodeBuggy(node) 是有缺陷的实现：加完后跑 _flush()，节点不会出现在 internalState 里
 *   - addNodeCorrect(node) 当前为空，需你实现：加完后跑 _flush()，节点要能出现在 internalState 里
 *
 * 先读 _flush / sync 的实现，理解 store 如何判定"ref.value 变了、需要同步"，
 * 再决定 addNodeCorrect 该怎么写。
 */
function createNodeStore() {
  const ref = { value: [] }
  let internalState = []
  let lastSeenRef = ref.value

  function sync() {
    internalState = [...ref.value]
  }

  function _flush() {
    if (ref.value !== lastSeenRef) {
      sync()
      lastSeenRef = ref.value
    }
  }

  return {
    ref,
    _flush,
    _getInternalState: () => [...internalState],
    addNodeBuggy(node) {
      ref.value.push(node)
    },
    addNodeCorrect(node) {
      // TODO: 实现正确版本
    },
  }
}

module.exports = { createNodeStore }
