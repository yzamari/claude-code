import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const TASK_TYPES = [
  'file_search',
  'glob',
  'grep',
  'simple_edit',
  'file_read',
  'test_execution',
  'subagent',
  'planning',
  'large_context',
  'complex_reasoning',
  'user_override',
] as const

export type TaskType = (typeof TASK_TYPES)[number]

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
    tasks: z.array(z.enum(TASK_TYPES)).min(1),
    model: z.string(),
  }),
)

export const RouterConfigSchema = lazySchema(() =>
  z.object({
    enabled: z.boolean().default(false),
    default: z.string(),
    providers: z.record(z.string(), ProviderConfigSchema()).optional(),
    routes: z.array(RouteSchema()).optional(),
    fallbackChain: z.array(z.string()).optional(),
  }),
)

export type RouterConfig = z.infer<ReturnType<typeof RouterConfigSchema>>
export type ProviderConfig = z.infer<ReturnType<typeof ProviderConfigSchema>>
