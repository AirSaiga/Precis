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
    projectNotFound:
      'Directory is missing project.precis.yaml manifest. Please create a new project or select a valid project directory.\n{path}',
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
    confirmClearAll: 'Are you sure you want to clear all {count} data sources?',
    removeFailed: 'Failed to remove data source, please try again later',
    filePathRequired: 'Cannot open file: file path is empty, please re-import the data source',
    electronRequired: 'Cannot open file: Electron environment is not available',
    cannotReselectFile: 'Cannot reselect file: Electron environment is not available',
    reloadFailed: 'Failed to reload file, please try again later',
    invalidFolderPath: 'Invalid folder path',
    importSuccess: 'Import successful',
    uploadFailed: 'File upload failed, please try again later',
    fileDownloadStarted: 'File download started',
    folderProcessFailed: 'Failed to process folder {name}',
    fileImportFailed: 'Failed to process file {name}: {error}',
    addDataSourceFailed: 'Failed to add data source {name}: {error}',
    fileUpdated: 'File updated: {name}. You can now drag this data source onto the canvas.',
    reselectFailed: 'Failed to reselect file, please try again later',
    openFileFailed: 'Failed to open file: {error}. Please try reselecting the file.',
    confirmReselectFile:
      'Cannot open file: {name}\n\nError: {error}\n\nPossible reasons:\n• File has been moved or deleted\n• Path has changed\n• No associated program for this file type\n\nReselect file?',
    folderNoDataFiles: 'No data files found in folder "{name}"',
    scanFolderFailed: 'Failed to scan folder: {name}',
    folderImportSummary: 'Folder import complete: {success} succeeded, {fail} failed',
    folderImportFailed: 'Folder import failed: {error}',
    electronFileSelectFailed: 'File selection failed, please try again later',
    ipcFailed: 'IPC communication failed, please try restarting the application',
    dialogOpenFailed: 'Failed to open file dialog, please check application permissions',
    networkRequestFailed: 'Network request failed, please check your network connection',
    dialog: {
      reselectFileTitle: 'Reselect Data File',
      reselectFileButton: 'Confirm Selection',
      dataFiles: 'Data Files',
      allFiles: 'All Files',
    },
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
    newTemplateInstance: 'New Template Instance',
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
    saveSuccess: 'Save successful',
    loadFailed: 'Load failed',
    loadSuccess: 'Load successful',
    exportYamlFailed: 'Cannot generate YAML file',
    saveRegexDesignFailed: 'Save failed',
    projectSaved: 'Project "{name}" saved',
    projectSavedWithWarnings: 'Project "{name}" saved ({count} warnings)',
    projectLoaded: 'V2 project "{name}" loaded',
    schemaSaved: 'Schema "{name}" saved',
    constraintSaved: 'Constraint "{name}" saved',
    regexSaved: 'Regex "{name}" saved',
    transformSaved: 'Transform "{name}" saved',
    templateInstanceSaved: 'Template instance "{name}" saved',
    regexSavedWithPaths: 'Regex "{name}" saved to: {path} (manifest: {manifest})',
    pleaseSelectDataSourceFirst: 'Please select a data source before saving',
    configWarningTitle: 'Config warning',
    configParseFailed: 'Some configuration files failed to parse, skipped:\n{list}',
  },
  import: {
    patternNotFound: 'Regex pattern not found: {patternId}',
    importFailed: 'Import failed',
    externalDataSourceIncomplete:
      'External data source drag data is incomplete, missing key information',
  },
  builder: {
    constraintNodeNotFound: 'Constraint node not found',
    schemaNodeNotFound: 'Schema node not found',
    regexNodeNotFound: 'Regex node not found',
    transformNodeNotFound: 'Transform node not found',
    templateInstanceNodeNotFound: 'Template instance node not found',
    unsupportedConstraintType: 'Unsupported constraint type',
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
