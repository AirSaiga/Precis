const shortcuts = require('./shortcuts')

/**
 * 处理 keydown 事件。
 * @param {KeyboardEvent} event
 * @returns {string | null} 被触发的快捷键动作名，未匹配返回 null
 *
 * 映射：Backspace→delete-node、Enter→confirm、Ctrl+S→save、Ctrl+Z→undo。
 */
function handleKeydown(event) {
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
