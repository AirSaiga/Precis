/**
 * V2 配置导入（C06 seed）。
 * 遍历 V2 配置的 nodes 数组，用 nodeFactory 创建每个节点。
 * 模拟 Precis 的 v2Import 模块。
 */
const { createNode } = require('./nodeFactory')

// 示例 V2 配置（真实项目里来自 project.precis.yaml 的解析结果）。
// 覆盖目前项目用到的全部节点类型。
const EXAMPLE_CONFIG = {
  nodes: [
    { type: 'schema', id: 's1', table: 'users' },
    { type: 'transform', id: 't1', op: 'filter' },
    { type: 'template', id: 'tpl1', templateId: 'std_check', params: { strict: true } },
    { type: 'constraint', id: 'c1', rule: 'not_null' },
  ],
}

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

module.exports = { importConfig, EXAMPLE_CONFIG }
