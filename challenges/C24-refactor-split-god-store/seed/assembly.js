/**
 * 装配入口（C24 seed）。
 * 当前直接调用 createGodStore。任务后应改为也调用 createClipboardOps。
 */
const { createGodStore } = require('./godStore')

function assembleStore(deps) {
  return createGodStore(deps)
}

module.exports = { assembleStore }
