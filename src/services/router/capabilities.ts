export interface ModelCapabilities {
  maxInputTokens: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  supportsThinking: boolean
  supportsEffort: boolean
  supportsCaching: boolean
  supportsPDFs: boolean
  toolCallStyle: 'anthropic' | 'openai' | 'none'
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  maxInputTokens: 4096,
  maxOutputTokens: 4096,
  supportsTools: false,
  supportsStreaming: true,
  supportsVision: false,
  supportsThinking: false,
  supportsEffort: false,
  supportsCaching: false,
  supportsPDFs: false,
  toolCallStyle: 'none',
}

const KNOWN_CAPABILITIES: Record<string, Partial<ModelCapabilities>> = {
  // Claude models
  'claude-opus-4-6': {
    maxInputTokens: 1_000_000, maxOutputTokens: 16_384,
    supportsTools: true, supportsVision: true, supportsThinking: true,
    supportsEffort: true, supportsCaching: true, supportsPDFs: true,
    toolCallStyle: 'anthropic',
  },
  'claude-sonnet-4-6': {
    maxInputTokens: 1_000_000, maxOutputTokens: 16_384,
    supportsTools: true, supportsVision: true, supportsThinking: true,
    supportsEffort: false, supportsCaching: true, supportsPDFs: true,
    toolCallStyle: 'anthropic',
  },
  'claude-haiku-4-5': {
    maxInputTokens: 200_000, maxOutputTokens: 8_192,
    supportsTools: true, supportsVision: true, supportsThinking: true,
    supportsEffort: false, supportsCaching: true, supportsPDFs: true,
    toolCallStyle: 'anthropic',
  },
  // OpenAI models
  'gpt-4o': {
    maxInputTokens: 128_000, maxOutputTokens: 16_384,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
  'o3': {
    maxInputTokens: 200_000, maxOutputTokens: 100_000,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
  // Gemini models
  'gemini-2.5-pro': {
    maxInputTokens: 2_000_000, maxOutputTokens: 65_536,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: true,
    toolCallStyle: 'openai',
  },
  'gemini-2.5-flash': {
    maxInputTokens: 1_000_000, maxOutputTokens: 65_536,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
  // Local models (common Ollama defaults)
  'llama3': {
    maxInputTokens: 128_000, maxOutputTokens: 4096,
    supportsTools: false, supportsVision: false, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'none',
  },
  'qwen2.5-coder': {
    maxInputTokens: 32_768, maxOutputTokens: 4096,
    supportsTools: false, supportsVision: false, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'none',
  },
  'deepseek-coder-v2': {
    maxInputTokens: 128_000, maxOutputTokens: 4096,
    supportsTools: true, supportsVision: false, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
}

// User-registered capabilities (from settings or runtime)
const customCapabilities = new Map<string, ModelCapabilities>()

export function registerModelCapabilities(
  modelId: string,
  caps: ModelCapabilities,
): void {
  customCapabilities.set(modelId, caps)
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  // 1. Check custom registry first
  const custom = customCapabilities.get(modelId)
  if (custom) return custom

  // 2. Check exact match in known capabilities
  const known = KNOWN_CAPABILITIES[modelId]
  if (known) return { ...DEFAULT_CAPABILITIES, ...known }

  // 3. Prefix match: "gpt-4o-mini" matches "gpt-4o", "claude-opus-4-6-20260101" matches "claude-opus-4-6"
  for (const [prefix, caps] of Object.entries(KNOWN_CAPABILITIES)) {
    if (modelId.startsWith(prefix)) {
      return { ...DEFAULT_CAPABILITIES, ...caps }
    }
  }

  // 4. Heuristic: if model name contains provider hints
  if (modelId.startsWith('claude-')) {
    return { ...DEFAULT_CAPABILITIES, supportsTools: true, toolCallStyle: 'anthropic' }
  }
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    return { ...DEFAULT_CAPABILITIES, supportsTools: true, toolCallStyle: 'openai' }
  }
  if (modelId.startsWith('gemini-')) {
    return { ...DEFAULT_CAPABILITIES, supportsTools: true, toolCallStyle: 'openai' }
  }

  return DEFAULT_CAPABILITIES
}
