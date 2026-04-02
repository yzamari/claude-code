import type { TaskType } from './routerConfig.js'

export interface TaskContext {
  activeTools: string[]
  messageTokenCount: number
  isPlanMode: boolean
  isSubagent: boolean
  userModelOverride: string | undefined
  bashCommand?: string
}

const SEARCH_TOOLS = new Set(['GrepTool', 'GlobTool', 'FileReadTool'])
const EDIT_TOOLS = new Set(['FileEditTool', 'FileWriteTool'])
const AGENT_TOOLS = new Set(['AgentTool', 'TeamCreateTool'])
const LARGE_CONTEXT_THRESHOLD = 100_000

const TEST_COMMAND_PATTERNS = [
  /\bvitest\b/, /\bjest\b/, /\bpytest\b/, /\bmocha\b/,
  /\bnpm\s+test\b/, /\bnpm\s+run\s+test\b/, /\bbun\s+test\b/,
  /\bcargo\s+test\b/, /\bgo\s+test\b/, /\bmake\s+test\b/,
]

export function classifyTask(context: TaskContext): TaskType {
  // Highest priority: user explicitly chose a model
  if (context.userModelOverride) {
    return 'user_override'
  }

  // Subagent mode
  if (context.isSubagent || context.activeTools.some(t => AGENT_TOOLS.has(t))) {
    return 'subagent'
  }

  // Plan mode
  if (context.isPlanMode) {
    return 'planning'
  }

  // Test execution
  if (
    context.activeTools.includes('BashTool') &&
    context.bashCommand &&
    TEST_COMMAND_PATTERNS.some(p => p.test(context.bashCommand!))
  ) {
    return 'test_execution'
  }

  // File search tools
  if (context.activeTools.some(t => SEARCH_TOOLS.has(t))) {
    return 'file_search'
  }

  // Edit tools
  if (context.activeTools.some(t => EDIT_TOOLS.has(t))) {
    return 'simple_edit'
  }

  // Large context (message history exceeds threshold)
  if (context.messageTokenCount > LARGE_CONTEXT_THRESHOLD) {
    return 'large_context'
  }

  return 'complex_reasoning'
}
