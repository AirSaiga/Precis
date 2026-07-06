/**
 * @file canvas.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const canvas = {
  workspace: 'Workspace',
  newWorkspace: 'New Canvas Workspace',
  workspaceWithIndex: '{name} {index}',
  closeWorkspaceConfirm:
    'Workspace "{title}" has unsaved changes, are you sure you want to close it?',
  renameWorkspacePrompt: 'Enter new workspace name:',
  tabs: {
    dirty: '●',
    close: '',
    add: '+',
  },
  controls: {
    toggleLeft: 'Toggle Left Panel',
    toggleRight: 'Toggle Right Panel',
  },
  // [Added] NodeCanvas related
  nodeCanvas: {
    title: 'Data Validation System',
    createProject: 'Create Project',
    openProject: 'Open Project',
    focusProject: 'Focus Project',
    organizeNodes: 'Organize Nodes',
    organizeNodesInProgress: 'Organizing...',
    deleteSelected: 'Delete Selected',
    projectName: 'Project Name:',
    projectNamePlaceholder: 'e.g., MyValidationProject',
    folderPath: 'Folder Path:',
    folderPathPlaceholder: 'e.g., /Users/AirSaiga/Projects',
    create: 'Create',
    confirm: 'Confirm',
    cancel: 'Cancel',
    dropHint: {
      default: 'Drop to create node',
      schema: 'Drop to create Schema node',
      pattern: 'Drop to create Pattern node (or drop onto Schema column to bind)',
      constraint: 'Drop to create Constraint node (or drop onto Schema column to add)',
      projectConfig: 'Drop to create Project Console node',
      patternFolder: 'Drop to create Pattern Toolbox node',
      constraintFolder: 'Drop to create Constraint Dashboard node',
      externalData: 'Drop to create Source Preview node',
    },
    schemaNode: 'Create Schema Node',
    sourcePreviewNode: 'Create Source Preview',
    fieldBindingSuccess: 'Field "{fieldName}" successfully bound to Schema node',
    fieldBindingFailed: 'Binding failed: source or target node not found',
    rightMenu: {
      createSchema: 'Create Schema Node',
      createSourcePreview: 'Create Source Preview',
    },
    smartFill: {
      title: 'Smart Fill',
      message:
        'Detected connection from "{sourceName}" to "{schemaName}".\n\nDo you want to automatically generate column definitions based on the data source?\n\nTip: This will overwrite the current {currentColumnsCount} column definitions.',
      confirm: 'Generate',
    },
    smartFix: {
      title: 'Column Definition Fix',
      message:
        'Column definitions between data source "{sourceName}" and "{schemaName}" are inconsistent:\n\n{details}\n\nApply smart fix?',
      confirm: 'Smart Fix',
      skip: 'Skip',
      moreItems: ' and {count} more',
      newInSource: '{count} new column(s) in data source not defined in Schema ({columns})',
      staleInSchema: '{count} non-derived column(s) in Schema not found in data source ({columns})',
    },
    columnMismatch: {
      title: 'Column Mismatch Warning',
      message:
        'Current Schema defines {schemaCount} columns, but the following {missingCount} columns were not found in the data source:\n\n{missingColumns}\n\nThis may cause subsequent constraint validations to fail. It is recommended to check if the data source column names are correct, or regenerate column definitions.',
      confirm: 'I understand',
    },
    constraintsDisconnected: 'All downstream constraint connections have been disconnected.',
    disconnectedOldSource: 'Disconnected from previous data source. Current source: {sourceName}',
    // [Added] Regex connection confirm dialog related
    regexConnectionTitle: 'Regex Connection',
    regexConnectionMessage:
      'Column "{column}" has been connected to regex validation. Do you want to validate now or edit the regex first?',
    regexConnectionHint:
      'Tip: When editing regex, you can use real data from this column for testing',
    validateDirectly: 'Validate Now',
    editRegex: 'Edit Regex',
    regexConnectionSuccess:
      'Column {column} has been connected to regex "{regex}" and initial validation completed',
    connectionFailed: 'Connection failed',
    connectionSuccess: 'Successfully connected "{source}" to "{target}"',
    // Common toast messages
    sourceRefreshSuccess: 'Data source refreshed',
    sourceRefreshFailed: 'Failed to refresh data source',
    columnsGenerated: 'Successfully generated {count} column definitions!',
    columnsGenerationFailed:
      'Failed to auto-generate column definitions, please configure manually',
    dataSourceEmpty: 'Data source is empty, cannot generate column definitions',
    headerRowMissing: 'Header row data is missing, cannot generate column definitions',
    schemaNodesUpdated: 'Updated {count} Schema node(s)',
    externalDataAdded: 'External data added: {name}',
    duplicateSourceTitle: 'Duplicate Data Source',
    duplicateSourceMessage:
      'Data source "{source}" is already used by other Schema node(s) ({nodes}). Please avoid duplicate binding.',
    duplicateSourceImportMessage:
      'Imported Schema "{resourceId}" uses the same data source as existing Schema node(s) ({nodes}). Please check for duplicates.',
    relatedConstraintsTitle: 'Related Independent Constraints Found',
    relatedConstraintsMessage:
      'Schema "{schema}" is referenced by {count} independent constraint(s): {constraints}. Import them and auto-connect?',
    relatedConstraintsImportAll: 'Import All',
    relatedConstraintsSchemaOnly: 'Schema Only',
    sheetNotFound:
      'Sheet "{sheet}" does not exist in the target file, please correct the sheet name in the Schema property panel',
    sheetNotFoundWithList:
      'Sheet "{sheet}" does not exist in the target file. Available sheets: {list}. Please correct the sheet name in the Schema property panel',
    // JSON Schema connection related
    jsonSourceEmpty: 'JSON data source is empty, cannot generate column definitions',
    jsonSourceInvalid: 'JSON data source is invalid, cannot generate column definitions',
    jsonColumnsGeneratedSuccess: 'Successfully generated {count} JSON column definitions!',
    jsonColumnsGenerationFailed:
      'Failed to auto-generate JSON column definitions, please configure manually',
    nodeTypes: {
      schema: {
        name: 'Data Table Schema',
        description: 'Create data table Schema definition',
      },
      sourcePreview: {
        name: 'Data Source Preview',
        description: 'Create data source preview card',
      },
    },
  },
  // Sub-Canvas (SubCanvasModal)
  subCanvas: {
    save: 'Save',
    close: 'Close',
    addConstraint: 'Add Constraint',
  },
}

const nodeTypeMenu = {
  title: 'Node Type',
  columnDefinition: 'Column Definition Node',
  tableDefinition: 'Table Definition Node',
  schemaNode: 'Schema Node',
  regexSetNode: 'Regex Set Node',
  constraintRuleNode: 'Constraint Rule Node',
}

const statusBar = {
  ready: 'Ready',
  loading: 'Loading...',
  saving: 'Saving...',
  error: 'Error',
  connected: 'Connected',
  disconnected: 'Disconnected',
  schema: 'Schema',
  constraint: 'Constraint',
  regex: 'Regex',
  transforms: 'Transforms',
  noProject: 'No project open',
}

export { canvas }
export { nodeTypeMenu }
export { statusBar }
