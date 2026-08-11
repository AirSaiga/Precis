/**
 * 节点工厂（C06 seed）。
 * 按节点 type 创建节点对象。未注册的 type 返回 null（import 时跳过）。
 * 模拟 Precis 的节点创建逻辑。
 */

const FACTORIES = {
  schema: (cfg) => ({ type: 'schema', id: cfg.id, table: cfg.table }),
  constraint: (cfg) => ({ type: 'constraint', id: cfg.id, rule: cfg.rule }),
}

function createNode(type, config) {
  const fn = FACTORIES[type]
  if (!fn) return null
  return fn(config)
}

function listRegisteredTypes() {
  return Object.keys(FACTORIES).sort()
}

// 注册新类型
function registerType(type, fn) {
  FACTORIES[type] = fn
}

module.exports = { createNode, listRegisteredTypes, registerType }
