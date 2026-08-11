// 现有的 useModal 组合式函数（参考模式，不修改）。
// 展示 Precis 项目中 composable 的约定：命名 useXxx，返回对象暴露状态 + 方法。
import { ref } from 'vue'

export function useModal() {
  const isVisible = ref(false)
  function open() { isVisible.value = true }
  function close() { isVisible.value = false }
  return { isVisible, open, close }
}
