/**
 * 业务组件示例（C11 seed —— 使用 shellApi 的范例）。
 * 此文件展示能力层的消费方式。
 */
import { shellApi } from './shellApi'

export function renderOpenButton(filePath: string): { show: boolean; onClick?: () => void } {
  // 通过能力探测属性控制按钮显隐
  if (!shellApi.canOpenLocalFile) {
    return { show: false }
  }
  return { show: true, onClick: () => shellApi.openPath(filePath) }
}
