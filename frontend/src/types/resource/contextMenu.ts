/**
 * @file contextMenu.ts
 * @description 资源右键菜单类型定义
 */

/**
 * 右键菜单操作类型
 */
export type ResourceContextAction =
  | 'preview'
  | 'addToCanvas'
  | 'locateOnCanvas'
  | 'separator'
  | 'rename'
  | 'delete'
  | 'refresh'
  | 'editTemplate'
  | 'addToManifest';

/**
 * 右键菜单操作配置
 */
export interface ContextMenuAction {
  /** 操作类型 */
  type: ResourceContextAction;
  /** 操作标签（国际化key） */
  labelKey: string;
  /** 图标名称 */
  icon?: string;
  /** 是否危险操作 */
  isDanger?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 权限要求 */
  permission?: string;
}

/**
 * 右键菜单状态
 */
export interface ResourceContextMenuState {
  /** 是否可见 */
  visible: boolean;
  /** 菜单位置 */
  position: {
    x: number;
    y: number;
  };
  /** 当前资源类型 */
  resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template' | null;
  /** 当前资源 */
  resourceItem: unknown | null;
  /** 可用操作列表 */
  availableActions: ContextMenuAction[];
}

/**
 * 右键菜单配置
 */
export interface ResourceContextMenuConfig {
  /** 菜单宽度 */
  width?: number;
  /** 菜单项高度 */
  itemHeight?: number;
  /** 最大显示项数 */
  maxVisibleItems?: number;
  /** 点击外部关闭 */
  clickOutsideClose?: boolean;
  /** ESC关闭 */
  escClose?: boolean;
  /** Z索引 */
  zIndex?: number;
}

/**
 * 重命名对话框状态
 */
export interface RenameDialogState {
  /** 是否可见 */
  visible: boolean;
  /** 资源ID */
  resourceId: string;
  /** 资源类型 */
  resourceKind: 'schema' | 'pattern' | 'constraint' | 'template' | null;
  /** 当前名称 */
  currentName: string;
  /** 输入值 */
  inputValue: string;
}

/**
 * 重命名验证结果
 */
export interface RenameValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误信息 */
  message?: string;
  /** 净化后的名称 */
  sanitizedName?: string;
}

/**
 * 预览模态框状态
 */
export interface PreviewModalState {
  /** 是否可见 */
  visible: boolean;
  /** 标题 */
  title: string;
  /** 内容（YAML格式） */
  content: string;
}

/**
 * 右键菜单事件
 */
export interface ContextMenuEvents {
  /** 预览事件 */
  onPreview: () => void;
  /** 添加到画布事件 */
  onAddToCanvas: () => void;
  /** 定位到画布事件 */
  onLocateOnCanvas: () => void;
  /** 重命名事件 */
  onRename: () => void;
  /** 删除事件 */
  onDelete: () => void;
  /** 刷新事件 */
  onRefresh: () => void;
  /** 关闭事件 */
  onClose: () => void;
}

/**
 * 右键菜单国际化配置
 */
export interface ContextMenuI18nConfig {
  /** 预览标签 */
  preview: string;
  /** 添加到画布标签 */
  addToCanvas: string;
  /** 定位到画布标签 */
  locateOnCanvas: string;
  /** 重命名标签 */
  rename: string;
  /** 删除标签 */
  delete: string;
  /** 刷新标签 */
  refresh: string;
  /** 标题 */
  title: string;
  /** 重命名标题 */
  renameTitle: string;
  /** 重命名标签 */
  renameLabel: string;
}
