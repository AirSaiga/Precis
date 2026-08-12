/**
 * V2 配置导入（C06 seed）。
 * 遍历 V2 配置的 nodes 数组，用 nodeFactory 创建每个节点。
 * 模拟 Precis 的 v2Import 模块。
 */
const { createNode } = require('./nodeFactory')

function importConfig(config) {
  const created = []
  const skipped = []
  for (const nodeCfg of (config.nodes || [])) {
    const node = createNode(nodeCfg.type, nodeCfg)
    if (node === null) {
      skipped.push({ id: nodeCfg.id, type: nodeCfg.type })
    } else {
      created.push(node)
    }
  }
  return { created, skipped, total_input: (config.nodes || []).length }
}

module.exports = { importConfig }
