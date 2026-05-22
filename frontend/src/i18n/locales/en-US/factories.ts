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
}

export { factories }
