/**
 * @file fileInput.ts
 * @description 跨平台的浏览器文件选择辅助函数
 *
 * 解决 `<input type="file">` 的 `oncancel` 事件不可靠的问题：
 - 通过 focus/blur + setTimeout 保险机制检测用户取消选择。
 * - Electron 环境下返回空数组（应使用 Electron 原生对话框）。
 */

export interface FileInputOptions {
  /** 文件类型过滤，例如 '.xlsx,.xls,.csv,.json' */
  accept?: string
  /** 是否允许多选 */
  multiple?: boolean
  /** 是否选择目录（仅部分浏览器支持） */
  directory?: boolean
}

/**
 * 在浏览器中触发文件选择，并返回选中的文件列表。
 *
 * @param options - 文件输入配置
 * @returns 用户选择的 File 数组；取消或超时返回空数组
 */
export function selectFilesInBrowser(options: FileInputOptions = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'

    if (options.accept) {
      input.accept = options.accept
    }
    if (options.multiple) {
      input.multiple = true
    }
    if (options.directory) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    }

    let resolved = false
    const finish = (files: File[]) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(files)
    }

    const cleanup = () => {
      input.onchange = null
      input.onblur = null
      if (input.parentNode) {
        input.parentNode.removeChild(input)
      }
    }

    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : []
      finish(files)
    }

    // 保险机制：input 失去焦点后，若 onchange 未触发，则认为用户取消选择
    input.onblur = () => {
      window.setTimeout(() => {
        if (!resolved) {
          finish([])
        }
      }, 500)
    }

    document.body.appendChild(input)
    input.click()

    // 兜底超时，防止任何异常情况下 Promise 永远 pending
    window.setTimeout(() => {
      if (!resolved) {
        finish([])
      }
    }, 60000)
  })
}
