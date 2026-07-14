/**
 * @file assetLibrary.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const assetLibraryExtended = {
  // 项目视图
  projectView: {
    cannotDragEmbeddedConstraint: '无法独立操作，内嵌约束必须依附于数据模型',
    onCanvas: '已拖拽到画布',
    toolbox: {
      title: '创建 / 工具箱',
      tableSchema: '表结构',
      regexGroup: 'Regex',
      regexPatternMode: '模式匹配',
      regexExtractMode: '提取模式',
      regexPattern: '正则表达式',
      constraintNode: '约束节点',
      constraintCategories: {
        attribute: '基础约束',
        relation: '关系约束',
        logic: '逻辑约束',
      },
    },
    explorer: {
      title: '项目资源',
      schemas: '数据模型',
      patternRegistry: '正则表达式注册表',
      regexNodes: '正则表达式节点',
      atomic: '原子模式',
      complex: '组合模式',
      constraintGraphs: '约束规则',
      projectConfig: '项目配置',
      filterAssets: '过滤资源...',
      dragFilesHere: '拖拽文件到这里以建立链接',
      dragFromOutside: '从外部拖入文件以建立链接',
      emptyPatterns: '暂无正则表达式注册',
      emptyRegexNodes: '暂无正则表达式节点',
      emptySchemas: '暂无数据模型',
      emptyConstraints: '暂无约束规则',
      onCanvas: '已拖拽到画布',
      embedded: '内嵌约束',
      independent: '独立约束',
      dataModels: '数据模型',
      validationAssets: '校验资产库',
      independentConstraints: '独立约束',
      regexCenter: '正则中心',
      templates: '模板',
      emptyTemplates: '暂无模板',
      embeddedConstraints: '内嵌约束',
      cannotDragEmbeddedConstraint: '无法独立操作，内嵌约束必须依附于数据模型',
      unlistedInManifest: '未入清单',
      unlistedInManifestTip: '该资源存在于项目目录，但未列入 project.precis.yaml',
      schemaParseError: '解析错误',
      schemaParseErrorTip: '该 Schema 配置文件解析失败，请检查文件格式或内容是否合法',
    },
    status: {
      projectResourceView: '项目资源视图',
      dataSourceView: '数据源视图',
      filesLinked: 'Files Linked',
    },
    resourceContext: {
      preview: '预览配置',
      addToCanvas: '添加到画布',
      locateOnCanvas: '定位到画布',
      addToManifest: '加入清单',
      rename: '重命名',
      delete: '删除',
      refresh: '刷新',
      renameTitle: '重命名资源',
      renameLabel: '名称',
      renameFailedTitle: '重命名失败',
      deleteFailedTitle: '删除失败',
      deleteConfirm: '确定要删除"{name}"吗？该操作不可撤销。',
      addToManifestFailedTitle: '加入清单失败',
      renameEmptyError: '名称不能为空',
      renameTooLongError: '名称不能超过 100 个字符',
    },
    multiSelect: {
      selectedCount: '已选择 {count} 项',
      addToCanvas: '添加到画布',
      deleteSelected: '删除所选',
      clearSelection: '取消选择',
      deleteConfirm: '确定要删除选中的 {count} 个资源吗？该操作不可撤销。',
    },
  },
  // 数据视图
  dataView: {
    title: '外部数据',
    buttons: {
      import: '导入',
      importFolder: '导入文件夹',
      clear: '清空全部',
      preview: '预览',
      edit: '编辑',
      open: '打开',
      relink: '重新链接',
      remove: '移除',
    },
    dropZone: {
      mainText: '拖拽文件或文件夹到这里作为数据源链接',
      subText: '支持 Excel、CSV 和其他数据格式',
      folderHint: '支持导入文件夹（包含子文件夹）',
    },
    statusBar: {
      title: '已链接数据源',
    },
    fileList: {
      status: {
        uploading: '上传中...',
        error: '错误',
        success: '就绪',
      },
    },
    folder: {
      filesCount: '{count} 个文件',
    },
    messages: {
      folderImported: '已导入文件夹，共 {count} 个文件',
      scanningFolder: '正在扫描文件夹...',
      scanComplete: '扫描完成，找到 {count} 个数据文件',
    },
  },
}

export { assetLibraryExtended }
