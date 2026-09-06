/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
