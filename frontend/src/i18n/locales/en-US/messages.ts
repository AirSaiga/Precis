/**
 * @file messages.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const welcome = {
  title: 'Welcome to DataValidator',
  subtitle: 'Data Validation and Constraint Management Platform',
  description:
    'This is a modern data validation tool based on Vue 3 and TypeScript, helping you define, manage and execute data constraint rules.',
  features: [
    'Visual data schema design',
    'Flexible constraint rule definition',
    'Real-time data validation',
    'Detailed validation reports',
  ],
  getStarted: 'Get Started',
  learnMore: 'Learn More',
}

const messages = {
  success: {
    projectLoaded: 'Project loaded successfully',
    configSaved: 'Configuration saved successfully',
    validationStarted: 'Validation started',
    validationCompleted: 'Validation completed',
    fileUploaded: 'File uploaded successfully',
    expressionSaved: 'Expression rules saved!',
    saved: 'Saved successfully',
    deleted: 'Deleted successfully',
    copied: 'Copied successfully',
  },
  error: {
    loadResourceFailed: 'Failed to load resources',
    saveFailed: 'Save failed',
    deleteFailed: 'Delete failed',
    projectLoadFailed: 'Project loading failed',
    configSaveFailed: 'Configuration save failed',
    validationFailed: 'Validation failed',
    networkError: 'Network error',
    unknownError: 'Unknown error',
  },
  warning: {
    unsavedChanges: 'You have unsaved changes',
    deleteConfirm: 'This operation cannot be undone, are you sure to delete?',
    switchProject: 'Switching projects will lose all unsaved changes',
  },
  messages: {
    createNodeFailed: 'Failed to create node, please check console error messages',
    electronNotDetected:
      'Cannot detect Electron environment, please ensure the application is running correctly',
    electronApiFailed: 'Electron API failed to load, please try restarting the application',
    noFilesSelected: 'No files selected',
    clearFailed: 'Failed to clear data source, please try again later',
    removeFailed: 'Failed to remove data source, please try again later',
    filePathRequired: 'Cannot open file: file path is empty, please re-import the data source',
    electronRequired: 'Cannot open file: Electron environment is not available',
    cannotReselectFile: 'Cannot reselect file: Electron environment is not available',
    reloadFailed: 'Failed to reload file, please try again later',
  },
  projectLibrary: {
    createSchemaNodeFailed: 'Failed to create Schema node',
    createRegexNodeFailed: 'Failed to create Regex node',
    createConstraintNodeFailed: 'Failed to create Constraint node',
  },
  previewData: {
    reloadFileNotFound: 'Failed to reload data: file not found, please re-add data source',
    reloadFailed: 'Failed to reload data, please try again later',
    reloadError: 'Error occurred while reloading data, please try again later',
    reloadEmptyPath: 'Failed to reload data: file path is empty',
    reloadInvalidPath: 'Failed to reload data, please check if the file path is correct',
    reloadErrorWithPath:
      'Error occurred while reloading data, please check if the file path is correct',
  },
  canvas: {
    newTable: 'New Table',
    newPattern: 'New Pattern',
    newRegex: 'New Regex',
    newTransform: 'New Transform',
    newManualData: 'Manual Data',
    transformMenu: {
      searchPlaceholder: 'Search Transform...',
      recentUsed: 'Recent',
      noResults: 'No matching operations found',
      categories: {
        text: 'Text',
        numeric: 'Numeric',
        cleaning: 'Cleaning',
        structure: 'Structure',
        date: 'Date',
      },
      constraintCategories: {
        attribute: 'Attribute',
        relation: 'Relation',
        logic: 'Logic',
      },
    },
  },
  persistence: {
    exportYamlSuccess: 'Project exported as YAML file',
    exportSuccess: 'Export Successful',
    schemaNotFound: 'Schema node not found',
    invalidYamlFormat: 'Invalid YAML format',
    comments: {
      projectConfig: '# Precis Project Configuration\n',
      schemaConfig: '# Schema Configuration\n',
      constraintConfig: '# Constraint Configuration\n',
      assetsConfig: '# Assets\n',
    },
    savePartialSuccess: 'Failed to save project view, project config saved but view update failed',
    saveFailed: 'Save failed',
    loadFailed: 'Load failed',
    exportYamlFailed: 'Cannot generate YAML file',
    saveRegexDesignFailed: 'Save failed',
  },
  import: {
    patternNotFound: 'Regex pattern not found: {patternId}',
    importFailed: 'Import failed',
    externalDataSourceIncomplete:
      'External data source drag data is incomplete, missing key information',
  },
  builder: {
    constraintNodeNotFound: 'Constraint node not found',
  },
}

const startupLoading = {
  title: 'Starting',
  waitingBackend: 'Starting backend service…',
  initializingWorkspace: 'Loading workspace config…',
  initializingCanvas: 'Initializing canvas…',
  continueWithoutBackend: 'Backend is starting slowly. Entered app (you can retry later).',
}

export { welcome }
export { messages }
export { startupLoading }
