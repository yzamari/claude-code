import { describe, it, expect } from 'vitest'
import { classifyTask, type TaskContext } from 'src/services/router/taskClassifier.js'

describe('classifyTask', () => {
  it('classifies grep/glob tool calls as file_search', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool', 'GlobTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('file_search')
  })

  it('classifies FileEditTool as simple_edit', () => {
    const context: TaskContext = {
      activeTools: ['FileEditTool'],
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
      activeTools: ['AgentTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: true,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('subagent')
  })

  it('respects user model override', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool'],
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

  it('classifies BashTool with test patterns as test_execution', () => {
    const context: TaskContext = {
      activeTools: ['BashTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
      bashCommand: 'npx vitest run tests/',
    }
    expect(classifyTask(context)).toBe('test_execution')
  })
})
