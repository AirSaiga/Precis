/**
 * 键盘监听器（C17 seed —— 有 bug）。
 *
 * 监听全局 keydown，匹配快捷键并执行对应动作。
 *
 * 当前 bug：没有 IME 合成守卫。当用户用拼音/日文/韩文输入法选词时，
 * 浏览器会派发 keydown 事件（isComposing=true），本监听器仍会匹配快捷键，
 * 导致用户在输入中文时 Backspace 误删节点、单字符键误触发动作等。
 *
 * 任务：在 handleKeydown 的匹配逻辑之前加 IME 合成守卫。
 */
const shortcuts = require('./shortcuts')

/**
 * 处理 keydown 事件。
 * @param {KeyboardEvent} event
 * @returns {string | null} 被触发的快捷键动作名，未匹配返回 null
 */
function handleKeydown(event) {
  // BUG: 没有 isComposing / keyCode 229 守卫，IME 选词时会误触
  const key = event.key
  const ctrl = event.ctrlKey || event.metaKey

  // 单键快捷键
  if (!ctrl && key === 'Backspace') {
    return 'delete-node'
  }
  if (!ctrl && key === 'Enter') {
    return 'confirm'
  }
  // 组合键
  if (ctrl && key === 's') {
    return 'save'
  }
  if (ctrl && key === 'z') {
    return 'undo'
  }
  return null
}

module.exports = { handleKeydown }
