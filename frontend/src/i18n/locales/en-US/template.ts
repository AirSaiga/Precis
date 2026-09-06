/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
