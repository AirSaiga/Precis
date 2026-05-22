/**
 * @file assetLibrary.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const assetLibraryExtended = {
  // Project View
  projectView: {
    toolbox: {
      title: 'CREATE / TOOLBOX',
      tableSchema: 'Table Schema',
      regexPattern: 'Regex Pattern',
      constraintNode: 'Constraint Node',
      constraintCategories: {
        attribute: 'Attribute',
        relation: 'Relation',
        logic: 'Logic',
      },
    },
    explorer: {
      title: 'Project Resources',
      schemas: 'Data Schemas',
      patternRegistry: 'Regex Patterns',
      regexNodes: 'Regex Nodes',
      atomic: 'Atomic',
      complex: 'Composite',
      constraintGraphs: 'Constraint Rules',
      projectConfig: 'Project Config',
      filterAssets: 'Filter assets...',
      dragFilesHere: 'Drag files here to link',
      dragFromOutside: 'Drag files from outside to create links',
      emptySchemas: 'No data schemas',
      emptyPatterns: 'No regex patterns',
      emptyRegexNodes: 'No regex nodes',
      emptyConstraints: 'No constraint rules',
      onCanvas: 'On canvas',
      embedded: 'Embedded',
      independent: 'Independent',
      dataModels: 'Data Models',
      validationAssets: 'Validation Assets',
      independentConstraints: 'Independent Constraints',
      regexCenter: 'Regex Center',
      templates: 'Templates',
      emptyTemplates: 'No templates',
      embeddedConstraints: 'Embedded Constraints',
      cannotDragEmbeddedConstraint:
        'Cannot operate independently, embedded constraints must be attached to a data model',
      unlistedInManifest: 'Unlisted',
      unlistedInManifestTip:
        'This resource exists in the project directory but is not listed in project.precis.yaml',
      schemaParseError: 'Parse Error',
      schemaParseErrorTip:
        'The Schema config file failed to parse. Please check the file format or content for errors',
    },
    status: {
      projectResourceView: '🗃️ Project Resource View',
      dataSourceView: '📊 Data Source View',
      filesLinked: 'Files Linked',
    },
    resourceContext: {
      addToCanvas: 'Add to Canvas',
      locateOnCanvas: 'Locate on Canvas',
      rename: 'Rename',
      delete: 'Delete',
      refresh: 'Refresh',
      renameTitle: 'Rename Resource',
      renameLabel: 'Name',
      renameFailedTitle: 'Rename Failed',
      deleteFailedTitle: 'Delete Failed',
      deleteConfirm: 'Delete "{name}"? This action cannot be undone.',
    },
    multiSelect: {
      selectedCount: '{count} selected',
      addToCanvas: 'Add to Canvas',
      deleteSelected: 'Delete Selected',
      clearSelection: 'Clear Selection',
      deleteConfirm: 'Delete {count} selected resources? This action cannot be undone.',
    },
  },
  // Data View
  dataView: {
    title: 'External Data',
    buttons: {
      import: 'Import',
      importFolder: 'Import Folder',
      clear: 'Clear All',
      preview: 'Preview',
      edit: 'Edit',
      open: 'Open',
      relink: 'Relink',
      remove: 'Remove',
    },
    dropZone: {
      mainText: 'Drag files or folders here to link as data sources',
      subText: 'Supports Excel, CSV, and other data formats',
      folderHint: 'Supports importing folders (including subfolders)',
    },
    statusBar: {
      title: 'Linked Data Sources',
    },
    fileList: {
      status: {
        uploading: 'Uploading...',
        error: 'Error',
        success: 'Ready',
      },
    },
    folder: {
      filesCount: '{count} files',
    },
    messages: {
      folderImported: 'Folder imported, {count} files total',
      scanningFolder: 'Scanning folder...',
      scanComplete: 'Scan complete, found {count} data files',
    },
  },
}

export { assetLibraryExtended }
