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
 * @file factories.ts
 * @description Node factory English translations
 *
 * Overview:
 * - Provides default name templates for constraint and regex factory node creation
 */

const factories = {
  // Constraint factory - default name template
  newConstraint: 'New {type}',
  // Constraint type names
  foreignKey: 'Foreign Key',
  unique: 'Unique',
  notNull: 'Not Null',
  allowedValues: 'Allowed Values',
  conditional: 'Conditional',
  scripted: 'Script',
  range: 'Range',
  charset: 'Charset',
  dateLogic: 'Date Logic',
  composite: 'Composite',
  unknown: 'Constraint',
  // Regex factory
  newRegex: 'New Regex',
  // Node factory default names (empty nodes created via shortcuts)
  defaultName: {
    table: 'New Table',
    pattern: 'New Pattern',
    logicConstraint: 'New Logic Constraint',
    schema: 'New Schema Config',
    jsonSchema: 'New JSON Schema Config',
  },
}

export { factories }
