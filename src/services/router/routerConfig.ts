import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const TASK_TYPES = [
  'file_search',
  'simple_edit',
  'test_execution',
  'tool_followup',
  'subagent',
  'planning',
  'large_context',
  'complex_reasoning',
  'user_override',
] as const

export type TaskType = (typeof TASK_TYPES)[number]

// Deprecated aliases accepted in user configs for backward compatibility.
// classifyTask never returns these — they map to 'file_search' at validation time.
const DEPRECATED_TASK_ALIASES: Record<string, TaskType> = {
  grep: 'file_search',
  glob: 'file_search',
  file_read: 'file_search',
}

// All strings the Zod schema should accept (active + deprecated)
const ALL_ACCEPTED_TASK_TYPES = [
  ...TASK_TYPES,
  ...Object.keys(DEPRECATED_TASK_ALIASES),
] as const

const ProviderConfigSchema = lazySchema(() =>
  z.object({
    type: z.enum(['openai-compatible', 'openai', 'gemini']),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    models: z.array(z.string()),
  }),
)

const RouteSchema = lazySchema(() =>
  z.object({
    tasks: z.array(
      z.enum(ALL_ACCEPTED_TASK_TYPES as unknown as readonly [string, ...string[]])
        .transform(t => (DEPRECATED_TASK_ALIASES[t] ?? t) as TaskType)
    ).min(1),
    model: z.string(),
  }),
)

export const RouterConfigSchema = lazySchema(() =>
  z.object({
    enabled: z.boolean().default(false),
    default: z.string(),
    // Model used for tool follow-up turns (processing tool results, deciding
    // next tool call). Defaults to the main model if unset. Set to a cheaper
    // model (e.g. "claude-haiku-4-5-20251001") to save tokens on turns that
    // only need to read tool output and pick the next action.
    cheapModel: z.string().optional(),
    providers: z.record(z.string(), ProviderConfigSchema()).optional(),
    routes: z.array(RouteSchema()).optional(),
    fallbackChain: z.array(z.string()).optional(),
  }),
)

export type RouterConfig = z.infer<ReturnType<typeof RouterConfigSchema>>
export type ProviderConfig = z.infer<ReturnType<typeof ProviderConfigSchema>>
