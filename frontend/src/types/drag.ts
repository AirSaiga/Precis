/**
 * @file drag.ts
 * @description 拖拽相关类型定义
 */

// ========== 拖拽和文件相关类型定义 ==========

/**
 * 拖拽源类型
 */
export type DragSource = 'toolbox' | 'explorer' | 'input_staging';

/**
 * 拖拽操作类型
 */
export type DragOperation = 'create_node' | 'load_resource' | 'bind_column';

/**
 * 文件资源类型
 */
export type FileResourceType = 'schema' | 'pattern' | 'source' | 'constraint' | 'external_data_source';

/**
 * 拖拽载荷数据结构
 */
export interface DragPayload {
  op: DragOperation;
  source: DragSource;
  type: FileResourceType;
  meta: {
    filePath?: string;
    fileName?: string;
    fileType?: 'yaml' | 'xlsx' | 'csv' | 'json';
    defaultLabel?: string;
    isRef?: boolean;
    initialConfig?: Record<string, unknown>;
  };
}

/**
 * Pattern拖拽载荷数据结构
 */
export interface PatternDragPayload extends Omit<DragPayload, 'meta'> {
  type: 'pattern';
  meta: {
    patternName: string;
    patternType: string;
    patternContent?: string;
  };
}

/**
 * Schema拖拽载荷数据结构
 */
export interface SchemaDragPayload extends Omit<DragPayload, 'meta'> {
  type: 'schema';
  meta: {
    schemaName: string;
    schemaConfig: Record<string, unknown>; // SchemaNodeData类型将在nodes.ts中定义
  };
}

/**
 * 外部数据源拖拽载荷数据结构
 */
export interface ExternalDataSourceDragPayload extends DragPayload {
  type: 'external_data_source';
  sourceId: string;
  name: string;
  fileType: 'excel' | 'csv' | 'json';
  fileName: string;
  dragSource: 'input_staging';
  label: string;
}

/**
 * 拖拽状态信息
 */
export interface DragState {
  isDragging: boolean;
  payload: DragPayload | null;
  dragSource?: DragSource;
  hoverTarget?: string;
}
