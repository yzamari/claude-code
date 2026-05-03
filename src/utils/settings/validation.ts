import type { ConfigScope } from 'src/services/mcp/types.js'
import type { ZodError, ZodIssue } from 'zod/v4'
import { jsonParse } from '../slowOperations.js'
import { plural } from '../stringUtils.js'
import { validatePermissionRule } from './permissionValidation.js'
import { generateSettingsJSONSchema } from './schemaOutput.js'
import type { SettingsJson } from './types.js'
import { SettingsSchema } from './types.js'
import { getValidationTip } from './validationTips.js'

/**
 * Helper type guards for specific Zod v4 issue types
 * In v4, issue types have different structures than v3
 */
function isInvalidTypeIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'invalid_type'
  expected: string
  input: unknown
} {
  return issue.code === 'invalid_type'
}

function isInvalidValueIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'invalid_value'
  values: unknown[]
  input: unknown
} {
  return issue.code === 'invalid_value'
}

function isUnrecognizedKeysIssue(
  issue: ZodIssue,
): issue is ZodIssue & { code: 'unrecognized_keys'; keys: string[] } {
  return issue.code === 'unrecognized_keys'
}

function isTooSmallIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'too_small'
  minimum: number | bigint
  origin: string
} {
  return issue.code === 'too_small'
}

/** Field path in dot notation (e.g., "permissions.defaultMode", "env.DEBUG") */
export type FieldPath = string

export type ValidationError = {
  /** Relative file path */
  file?: string
  /** Field path in dot notation */
  path: FieldPath
  /** Human-readable error message */
  message: string
  /** Expected value or type */
  expected?: string
  /** The actual invalid value that was provided */
  invalidValue?: unknown
  /** Suggestion for fixing the error */
  suggestion?: string
  /** Link to relevant documentation */
  docLink?: string
  /** MCP-specific metadata - only present for MCP configuration errors */
  mcpErrorMetadata?: {
    /** Which configuration scope this error came from */
    scope: ConfigScope
    /** The server name if error is specific to a server */
    serverName?: string
    /** Severity of the error */
    severity?: 'fatal' | 'warning'
  }
}

export type SettingsWithErrors = {
  settings: SettingsJson
  errors: ValidationError[]
}

/**
 * Format a Zod validation error into human-readable validation errors
 */
/**
 * Get the type string for an unknown value (for error messages)
 */
function getReceivedType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function extractReceivedFromMessage(msg: string): string | undefined {
  const match = msg.match(/received (\w+)/)
  return match ? match[1] : undefined
}

export function formatZodError(
  error: ZodError,
  filePath: string,
): ValidationError[] {
  return error.issues.map((issue): ValidationError => {
    const path = issue.path.map(String).join('.')
    let message = issue.message
    let expected: string | undefined

    let enumValues: string[] | undefined
    let expectedValue: string | undefined
    let receivedValue: unknown
    let invalidValue: unknown

    if (isInvalidValueIssue(issue)) {
      enumValues = issue.values.map(v => String(v))
      expectedValue = enumValues.join(' | ')
      receivedValue = undefined
      invalidValue = undefined
    } else if (isInvalidTypeIssue(issue)) {
      expectedValue = issue.expected
      const receivedType = extractReceivedFromMessage(issue.message)
      receivedValue = receivedType ?? getReceivedType(issue.input)
      invalidValue = receivedType ?? getReceivedType(issue.input)
    } else if (isTooSmallIssue(issue)) {
      expectedValue = String(issue.minimum)
    } else if (issue.code === 'custom' && 'params' in issue) {
      const params = issue.params as { received?: unknown }
      receivedValue = params.received
      invalidValue = receivedValue
    }

    const tip = getValidationTip({
      path,
      code: issue.code,
      expected: expectedValue,
      received: receivedValue,
      enumValues,
      message: issue.message,
      value: receivedValue,
    })

    if (isInvalidValueIssue(issue)) {
      expected = enumValues?.map(v => `"${v}"`).join(', ')
      message = `Invalid value. Expected one of: ${expected}`
    } else if (isInvalidTypeIssue(issue)) {
      const receivedType =
        extractReceivedFromMessage(issue.message) ??
        getReceivedType(issue.input)
      if (
        issue.expected === 'object' &&
        receivedType === 'null' &&
        path === ''
      ) {
        message = 'Invalid or malformed JSON'
      } else {
        message = `Expected ${issue.expected}, but received ${receivedType}`
      }
    } else if (isUnrecognizedKeysIssue(issue)) {
      const keys = issue.keys.join(', ')
      message = `Unrecognized ${plural(issue.keys.length, 'field')}: ${keys}`
    } else if (isTooSmallIssue(issue)) {
      message = `Number must be greater than or equal to ${issue.minimum}`
      expected = String(issue.minimum)
    }

    return {
      file: filePath,
      path,
      message,
      expected,
      invalidValue,
      suggestion: tip?.suggestion,
      docLink: tip?.docLink,
    }
  })
}

/**
 * Validates that settings file content conforms to the SettingsSchema.
 * This is used during file edits to ensure the resulting file is valid.
 */
export function validateSettingsFileContent(content: string):
  | {
      isValid: true
    }
  | {
      isValid: false
      error: string
      fullSchema: string
    } {
  try {
    // Parse the JSON first
    const jsonData = jsonParse(content)

    // Validate against SettingsSchema in strict mode
    const result = SettingsSchema().strict().safeParse(jsonData)

    if (result.success) {
      return { isValid: true }
    }

    // Format the validation error in a helpful way
    const errors = formatZodError(result.error, 'settings')
    const errorMessage =
      'Settings validation failed:\n' +
      errors.map(err => `- ${err.path}: ${err.message}`).join('\n')

    return {
      isValid: false,
      error: errorMessage,
      fullSchema: generateSettingsJSONSchema(),
    }
  } catch (parseError) {
    return {
      isValid: false,
      error: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`,
      fullSchema: generateSettingsJSONSchema(),
    }
  }
}

/**
 * Filters invalid permission rules from raw parsed JSON data before schema validation.
 * This prevents one bad rule from poisoning the entire settings file.
 * Returns warnings for each filtered rule.
 */
export function filterInvalidPermissionRules(
  data: unknown,
  filePath: string,
): ValidationError[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  if (!obj.permissions || typeof obj.permissions !== 'object') return []
  const perms = obj.permissions as Record<string, unknown>

  const warnings: ValidationError[] = []
  for (const key of ['allow', 'deny', 'ask']) {
    const rules = perms[key]
    if (!Array.isArray(rules)) continue

    perms[key] = rules.filter(rule => {
      if (typeof rule !== 'string') {
        warnings.push({
          file: filePath,
          path: `permissions.${key}`,
          message: `Non-string value in ${key} array was removed`,
          invalidValue: rule,
        })
        return false
      }
      const result = validatePermissionRule(rule)
      if (!result.valid) {
        let message = `Invalid permission rule "${rule}" was skipped`
        if (result.error) message += `: ${result.error}`
        if (result.suggestion) message += `. ${result.suggestion}`
        warnings.push({
          file: filePath,
          path: `permissions.${key}`,
          message,
          invalidValue: rule,
        })
        return false
      }
      return true
    })
  }
  return warnings
}

/**
 * Filters malformed hook entries from raw parsed JSON data before schema
 * validation. Upstream v2.1.118 parity — without this, ONE bad hook entry
 * (e.g. `{ "type": "command" }` missing `command`, or a hook with a typo'd
 * matcher) rejects the entire settings.json, breaking every other setting
 * (theme, permissions, mcp config, …) for that user.
 *
 * Filter rules: a hook entry must be an object with a string `type` field
 * matching one of the four supported types. Missing required fields per
 * type (e.g. `command` for type:'command', `prompt` for type:'prompt') are
 * also stripped. Anything else is left alone — the proper schema downstream
 * does the strict per-field validation, but at least it gets to run.
 */
export function filterInvalidHooks(
  data: unknown,
  filePath: string,
): ValidationError[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  if (!obj.hooks || typeof obj.hooks !== 'object') return []
  const hooksObj = obj.hooks as Record<string, unknown>

  const warnings: ValidationError[] = []

  for (const eventName of Object.keys(hooksObj)) {
    const eventEntries = hooksObj[eventName]
    if (!Array.isArray(eventEntries)) continue

    hooksObj[eventName] = eventEntries
      .map((matcherGroup, gIdx) => {
        if (
          !matcherGroup ||
          typeof matcherGroup !== 'object' ||
          Array.isArray(matcherGroup)
        ) {
          warnings.push({
            file: filePath,
            path: `hooks.${eventName}[${gIdx}]`,
            message: `Hook matcher group must be an object — entry was removed`,
            invalidValue: matcherGroup,
          })
          return null
        }
        const group = matcherGroup as Record<string, unknown>
        if (!Array.isArray(group.hooks)) return group
        group.hooks = group.hooks.filter((hook: unknown, hIdx: number) => {
          if (!hook || typeof hook !== 'object') {
            warnings.push({
              file: filePath,
              path: `hooks.${eventName}[${gIdx}].hooks[${hIdx}]`,
              message: `Hook entry must be an object — entry was removed`,
              invalidValue: hook,
            })
            return false
          }
          const h = hook as Record<string, unknown>
          const type = h.type
          if (
            type !== 'command' &&
            type !== 'prompt' &&
            type !== 'agent' &&
            type !== 'http'
          ) {
            warnings.push({
              file: filePath,
              path: `hooks.${eventName}[${gIdx}].hooks[${hIdx}]`,
              message: `Hook type must be 'command' | 'prompt' | 'agent' | 'http' — entry was removed`,
              invalidValue: hook,
            })
            return false
          }
          // Lightweight required-field check. Strict shape validation runs
          // later via SettingsSchema; we only catch the "obvious typo"
          // case here so the rest of settings.json survives.
          if (
            (type === 'command' && typeof h.command !== 'string') ||
            (type === 'prompt' && typeof h.prompt !== 'string') ||
            (type === 'agent' && typeof h.prompt !== 'string') ||
            (type === 'http' && typeof h.url !== 'string')
          ) {
            warnings.push({
              file: filePath,
              path: `hooks.${eventName}[${gIdx}].hooks[${hIdx}]`,
              message: `Hook of type '${type}' missing required field — entry was removed`,
              invalidValue: hook,
            })
            return false
          }
          return true
        })
        return group
      })
      .filter(g => g !== null)
  }

  return warnings
}

