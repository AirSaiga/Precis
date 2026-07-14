/**
 * @file template.ts
 * @description Template feature English translations
 *
 * Covers the "Save canvas selection as template" dialog (SaveAsTemplateDialog).
 */

const template = {
  saveAsTemplateTitle: 'Save as Template',
  saveAsTemplate: 'Save as Template',
  selectionSummary: 'Selection Summary',
  excludedNodes: '{count} ineligible node(s) excluded',
  templateId: 'Template ID',
  templateName: 'Template Name',
  description: 'Description',
  save: 'Save Template',
  saveSuccess: 'Template "{name}" saved',
  saveFailed: 'Failed to save template',
  invalidIdFormat: 'Template ID can only contain letters, numbers, underscores and hyphens',
  errors: {
    missingManualData: 'Template is missing a manualData node as input source',
    missingConstraint: 'Template is missing a constraint node as validation target',
    externalInputReference:
      'Template contains nodes referencing external data sources outside the selection',
  },
}

export { template }
