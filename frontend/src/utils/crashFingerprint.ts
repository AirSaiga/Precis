/**
 * @file crashFingerprint.ts
 * @description 崩溃错误指纹计算
 *
 * 用途:对错误 message + stack 头部做轻量哈希,用于会话内去重,
 * 避免同一错误反复弹反馈窗口。
 */

/** djb2 字符串哈希,返回无符号 32 位整数 */
function djb2Hash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * 计算崩溃指纹:取 message + stack 前 10 行做 djb2 哈希。
 *
 * 设计要点:
 * - stack 只取前 10 行:同一调用路径稳定,排除尾部行号微小差异的干扰。
 * - 会话级去重:不持久化,重启后清空(新会话可再次提示)。
 *
 * @param message 错误消息
 * @param stack 错误堆栈(可选)
 * @returns 十六进制指纹字符串
 */
export function computeFingerprint(message: string, stack?: string): string {
  const stackHead = (stack ?? '').split('\n').slice(0, 10).join('\n')
  return djb2Hash(message + '|' + stackHead).toString(16)
}
