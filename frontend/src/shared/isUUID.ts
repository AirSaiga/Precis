/**
 * @file isUUID.ts
 * @description UUID格式判断工具函数
 * 提供字符串是否为UUID格式的检测功能
 */

/**
 * 判断字符串是否为 UUID 格式
 * UUID 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * 支持变体格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * 
 * @param str - 待检测的字符串
 * @returns 是否为 UUID 格式
 */
export function isUUID(str: string): boolean {
  const standardUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const variantUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return standardUuidRegex.test(str) || variantUuidRegex.test(str);
}
