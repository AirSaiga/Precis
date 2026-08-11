/**
 * 节点 store（C18 seed —— 模拟 Vue Flow 的响应式同步契约）。
 *
 * Vue Flow 通过一个 pausable watcher 监听 nodes ref 的变化。
 * 该 watcher 追踪 ref 的【值引用】——赋值（nodes.value = [...]）会触发，
 * 但 mutation（nodes.value.push(x)）不会触发，因为引用没变。
 *
 * 后果：push 添加的节点在 Vue Flow 内部状态里完全不存在——渲染丢失、
 * 后续查找找不到、边连接失败。
 *
 * AGENTS.md 原文："nodes.value.push(newNode) — Vue Flow 的 pausable watcher
 * 追踪 ref 值引用，push 不触发。节点在 Vue Flow 内部完全不存在。"
 *
 * 本文件模拟这个契约：
 *   - ref 是一个 { value: [] } 对象（模拟 ref）
 *   - _flush() 模拟 watcher 的"轮询检测"：检测到 ref.value 引用变化就 sync
 *   - addNodeBuggy 用 push（不触发 sync —— 引用没变）
 *   - addNodeCorrect 应该用赋值（触发 sync —— 新引用）
 *
 * 真实 Vue Flow 用调度器（scheduler）驱动 watcher；这里用显式 _flush()
 * 便于 node 直接测试，语义等价：_flush 就是 watcher 的一次"检查 + 回写"。
 */

/**
 * 创建一个模拟 Vue Flow 同步的节点 store。
 *
 * - ref.value 是逻辑节点列表（业务代码改它）
 * - internalState 是 Vue Flow 内部状态（渲染来源），由 sync() 从 ref.value 同步
 * - _flush() 检测 ref.value 是否换了新引用，是则 sync（model→store 回写）
 *
 * 关键：_flush 用【引用比较】判断变化。push 不换引用 → 检测不到 → 不同步。
 * 挑战者需在 addNodeCorrect 里换成【赋值】（产生新引用）。
 */
function createNodeStore() {
  const ref = { value: [] }
  let internalState = [] // Vue Flow 内部状态（渲染来源）
  let lastSeenRef = ref.value // watcher 上次见到的引用

  // 把 ref.value 同步到 internalState（Vue Flow 的 model→store 回写）
  function sync() {
    internalState = [...ref.value]
  }

  // 模拟 watcher 的一次"检查"：引用变了才 sync。
  // 真实 Vue Flow 用调度器轮询；这里用显式调用便于测试，语义等价。
  function _flush() {
    if (ref.value !== lastSeenRef) {
      sync()
      lastSeenRef = ref.value
    }
  }

  return {
    ref,
    _flush, // 测试调用以驱动 watcher
    _getInternalState: () => [...internalState], // 测试用：看 Vue Flow 内部看到什么
    addNodeBuggy(node) {
      // BUG: push 不换引用 → _flush 检测不到 → 不同步
      ref.value.push(node)
    },
    addNodeCorrect(node) {
      // TODO: 修复 —— 用赋值（产生新引用）让 _flush 能检测到变化
      // 当前留空，挑战者需实现
    },
  }
}

module.exports = { createNodeStore }
