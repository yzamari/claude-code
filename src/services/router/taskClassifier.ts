import type { TaskType } from './routerConfig.js'

export interface TaskContext {
  activeTools: string[]
  messageTokenCount: number
  isPlanMode: boolean
  isSubagent: boolean
  userModelOverride: string | undefined
  bashCommand?: string
  userPrompt?: string
}

const SEARCH_TOOLS = new Set(['Grep', 'Glob'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const AGENT_TOOLS = new Set(['Agent', 'TeamCreate'])
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
    context.activeTools.includes('Bash') &&
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

  // First-turn heuristic: when no prior tools exist, classify from user prompt text
  if (context.activeTools.length === 0 && context.userPrompt) {
    const p = context.userPrompt.toLowerCase()
    if (PLANNING_PATTERNS.some(r => r.test(p))) return 'planning'
    if (FILE_SEARCH_PATTERNS.some(r => r.test(p))) return 'file_search'
    if (SIMPLE_EDIT_PATTERNS.some(r => r.test(p))) return 'simple_edit'
    if (TEST_PROMPT_PATTERNS.some(r => r.test(p))) return 'test_execution'
  }

  return 'complex_reasoning'
}

const PLANNING_PATTERNS = [
  /\bplan\b/i, /\barchitect/i, /\bdesign\b/i, /\bstrateg/i,
  /\bhow\s+(?:should|would|can)\s+(?:we|i)\b/i, /\bpropose\b/i,
  /\bmigrat/i,
]

const FILE_SEARCH_PATTERNS = [
  /\bfind\b.*\b(?:files?|director|typescript|\.ts|\.js|\.py|matching|named)\b/i,
  /\bsearch\b/i, /\bgrep\b/i, /\bglob\b/i,
  /\bwhat\s+files?\b/i, /\bwhere\s+is\b/i, /\bwhere\s+(?:are|does)\b/i,
  /\blist\b.*\b(?:files?|director)/i, /\blist\s+all\b/i,
  /\blocate\b/i, /\blook\s+for\b/i, /\bshow\s+me\b/i,
  /\bscan\b/i, /\bfind\s+all\b/i,
  /\bimplementation\b/i, /\bwhere.*\bdefined\b/i,
  /\b(?:which|what)\s+(?:file|module|class)\b/i,
]

const SIMPLE_EDIT_PATTERNS = [
  /\brename\b/i, /\breplace\b.*\bwith\b/i, /\breplace\s+all\b/i,
  /\badd\b.*\bimport/i, /\bremove\b.*\bline/i,
  /\bfix\b.*\btypo/i, /\bfix\b.*\bspelling/i,
  /\bchange\b.*\bto\b/i, /\bupdate\b.*\bto\b/i,
  /\binsert\b/i, /\bdelete\b.*\bline/i,
  /\badd\b.*\bat\s+(?:the\s+)?top/i,
  /\bconsole\.log/i,
]

const TEST_PROMPT_PATTERNS = [
  /\brun\b.*\btests?\b/i, /\btest\b.*\bsuite\b/i,
  /\bvitest\b/i, /\bjest\b/i, /\bpytest\b/i, /\bmocha\b/i,
  /\bnpm\s+test\b/i, /\bbun\s+test\b/i, /\bcargo\s+test\b/i,
  /\brun\b.*\b(?:vitest|jest|pytest|mocha)\b/i,
  /\bexecute\b.*\btest/i,
]
