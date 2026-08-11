/**
 * 工厂聚合入口（C12 seed）。
 *
 * 把所有 createXxxOps 工厂模块的返回值聚合成一个扁平 store 对象。
 * AGENTS.md："assembly.ts 将所有模块导出聚合到一个扁平对象中"。
 *
 * 当前聚合了 nodeOps 和 historyOps。任务：加 clipboardOps。
 */
const { createNodeOps } = require('./nodeOps')
const { createHistoryOps } = require('./historyOps')

function assembleStore(deps) {
  // 调用各工厂，注入 deps
  const nodeOps = createNodeOps(deps)
  const historyOps = createHistoryOps(deps)

  // 聚合到扁平对象
  return {
    ...nodeOps,
    ...historyOps,
  }
}

module.exports = { assembleStore }
