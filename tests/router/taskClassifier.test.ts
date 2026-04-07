import { describe, it, expect } from 'vitest'
import { classifyTask, type TaskContext } from 'src/services/router/taskClassifier.js'

describe('classifyTask', () => {
  it('classifies grep/glob tool calls as file_search', () => {
    const context: TaskContext = {
      activeTools: ['Grep', 'Glob'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('file_search')
  })

  it('classifies Edit tool as simple_edit', () => {
    const context: TaskContext = {
      activeTools: ['Edit'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('simple_edit')
  })

  it('classifies plan mode as planning', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: true,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('planning')
  })

  it('classifies large context as large_context', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 150_000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('large_context')
  })

  it('classifies subagent queries', () => {
    const context: TaskContext = {
      activeTools: ['Agent'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: true,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('subagent')
  })

  it('respects user model override', () => {
    const context: TaskContext = {
      activeTools: ['Grep'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: 'gpt-4o',
    }
    expect(classifyTask(context)).toBe('user_override')
  })

  it('defaults to complex_reasoning', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('complex_reasoning')
  })

  it('classifies Bash with test patterns as test_execution', () => {
    const context: TaskContext = {
      activeTools: ['Bash'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
      bashCommand: 'npx vitest run tests/',
    }
    expect(classifyTask(context)).toBe('test_execution')
  })

  it('classifies NotebookEdit as simple_edit', () => {
    const context: TaskContext = {
      activeTools: ['NotebookEdit'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('simple_edit')
  })
})

// First-turn prompt heuristic tests (no activeTools — classification from userPrompt)
describe('classifyTask — prompt heuristics', () => {
  const base: TaskContext = {
    activeTools: [],
    messageTokenCount: 5000,
    isPlanMode: false,
    isSubagent: false,
    userModelOverride: undefined,
  }

  // Planning patterns
  it('detects "plan" in prompt as planning', () => {
    expect(classifyTask({ ...base, userPrompt: 'Can you plan the migration?' })).toBe('planning')
  })

  it('detects "architect" in prompt as planning', () => {
    expect(classifyTask({ ...base, userPrompt: 'Help me architect this system' })).toBe('planning')
  })

  it('detects "how should we" in prompt as planning', () => {
    expect(classifyTask({ ...base, userPrompt: 'How should we structure the API?' })).toBe('planning')
  })

  // File search patterns
  it('detects "find all files" as file_search', () => {
    expect(classifyTask({ ...base, userPrompt: 'Find all files matching *.ts' })).toBe('file_search')
  })

  it('detects "search" as file_search', () => {
    expect(classifyTask({ ...base, userPrompt: 'Search for the login handler' })).toBe('file_search')
  })

  it('detects "where is" as file_search', () => {
    expect(classifyTask({ ...base, userPrompt: 'Where is the database config defined?' })).toBe('file_search')
  })

  it('detects "grep" in prompt as file_search', () => {
    expect(classifyTask({ ...base, userPrompt: 'grep for TODO comments' })).toBe('file_search')
  })

  // Simple edit patterns
  it('detects "rename" as simple_edit', () => {
    expect(classifyTask({ ...base, userPrompt: 'Rename the variable from foo to bar' })).toBe('simple_edit')
  })

  it('detects "replace X with Y" as simple_edit', () => {
    expect(classifyTask({ ...base, userPrompt: 'Replace "old_name" with "new_name"' })).toBe('simple_edit')
  })

  it('detects "fix typo" as simple_edit', () => {
    expect(classifyTask({ ...base, userPrompt: 'Fix the typo in the README' })).toBe('simple_edit')
  })

  // Test prompt patterns
  it('detects "run the tests" as test_execution', () => {
    expect(classifyTask({ ...base, userPrompt: 'Run the tests for the auth module' })).toBe('test_execution')
  })

  it('detects "vitest" in prompt as test_execution', () => {
    expect(classifyTask({ ...base, userPrompt: 'Use vitest to check everything passes' })).toBe('test_execution')
  })

  // Fallback
  it('falls back to complex_reasoning for ambiguous prompts', () => {
    expect(classifyTask({ ...base, userPrompt: 'Explain how the authentication system works' })).toBe('complex_reasoning')
  })

  it('falls back to complex_reasoning for empty prompt', () => {
    expect(classifyTask({ ...base, userPrompt: '' })).toBe('complex_reasoning')
  })
})
