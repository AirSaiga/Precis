export type LineageNodeType =
  | 'sourcePreview'
  | 'schema'
  | 'constraint'
  | 'regex'
  | 'transform'
  | 'transformOutput'
  | 'manualData'

export type LineageEdgeKind = 'data' | 'constraint' | 'regex' | 'fk' | 'transform'

export interface LineageNode {
  id: string
  type: LineageNodeType
  name: string
  columnId?: string
  constraintType?: string
  status?: string
}

export interface LineageEdge {
  from: string
  to: string
  kind: LineageEdgeKind
  columnId?: string
}

export interface LineageGraph {
  nodes: LineageNode[]
  edges: LineageEdge[]
  selectedNodeId?: string
}

export interface LineageLayoutNode extends LineageNode {
  x: number
  y: number
  layer: number
}

export interface LineageLayoutResult {
  nodes: LineageLayoutNode[]
  edges: LineageEdge[]
  width: number
  height: number
}
