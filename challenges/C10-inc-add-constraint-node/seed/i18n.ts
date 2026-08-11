/**
 * i18n 约束类型文案（C10 精简版）。
 * 每种约束需登记 name + description 双侧（zh-CN + en-US）。
 */
export const constraintTypes = {
  notNull: {
    name: '非空约束',
    nameEn: 'Not Null',
    description: '确保列不能包含空值',
    descriptionEn: 'Ensures the column cannot contain null values',
  },
} as const
