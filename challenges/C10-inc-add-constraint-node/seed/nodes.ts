/**
 * 节点数据类型定义（C10 精简版）。
 * 每种约束节点有专属 NodeData 接口，并加入 CustomNodeData 联合类型。
 */
interface BaseConstraintNodeData {
  id: string
  type: string
  table: string
  column: string
}

export interface NotNullConstraintNodeData extends BaseConstraintNodeData {
  type: 'notNullConstraint'
}

export type CustomNodeData = NotNullConstraintNodeData
