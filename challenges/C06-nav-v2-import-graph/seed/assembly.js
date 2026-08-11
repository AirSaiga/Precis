/**
 * 模块聚合入口（C06 seed）。
 * 模拟 Precis graphStore/setup/assembly.ts —— 聚合各子模块到扁平对象。
 * 业务代码从这里取 importConfig。
 */
const { importConfig } = require('./v2Import')
const { listRegisteredTypes } = require('./nodeFactory')

// 聚合导出（扁平对象）
module.exports = {
  importConfig,
  listRegisteredTypes,
  // 元信息
  _modules: ['v2Import', 'nodeFactory'],
}
