import { ModelRouter } from './ModelRouter.js'
import type { TaskContext } from './taskClassifier.js'
import type { RouterConfig } from './routerConfig.js'
import { logForDebugging } from '../../utils/debug.js'

let cachedRouter: ModelRouter | null = null
let cachedConfigHash: string | null = null

export interface ResolvedModelRoute {
  model: string | null
  fallbackChain: string[]
}

export function resolveModelForQuery(
  routerConfig: RouterConfig | undefined,
  context: {
    lastToolNames: string[]
    messageTokenCount: number
    isPlanMode: boolean
    isSubagent: boolean
    userModelOverride: string | undefined
    lastBashCommand?: string
    userPrompt?: string
  }
): ResolvedModelRoute {
  if (!routerConfig?.enabled) return { model: null, fallbackChain: [] }

  // Cache router instance (recreate only if config changes)
  const configHash = JSON.stringify(routerConfig)
  if (!cachedRouter || cachedConfigHash !== configHash) {
    cachedRouter = new ModelRouter(routerConfig)
    cachedConfigHash = configHash
  }

  const taskContext: TaskContext = {
    activeTools: context.lastToolNames,
    messageTokenCount: context.messageTokenCount,
    isPlanMode: context.isPlanMode,
    isSubagent: context.isSubagent,
    userModelOverride: context.userModelOverride,
    bashCommand: context.lastBashCommand,
    userPrompt: context.userPrompt,
  }

  const route = cachedRouter.resolve(taskContext)

  logForDebugging(
    `[Router] task=${route.taskType} → ${route.isNativeAnthropic ? 'anthropic' : route.providerName}/${route.model}`,
  )

  // If native Anthropic and the router explicitly selected a model via a route
  // (not just falling through to the default), return the model name so the
  // caller uses it instead of falling back to ANTHROPIC_MODEL env var.
  if (route.isNativeAnthropic) {
    // Check if the router actively matched a route (model differs from default)
    const defaultModel = routerConfig?.default ?? ''
    const routerExplicitlyChoseModel = route.model !== defaultModel &&
      route.model !== defaultModel.replace(/^[^/]*\//, '') // strip provider prefix
    if (routerExplicitlyChoseModel) {
      return { model: route.model, fallbackChain: route.fallbackChain }
    }
    return { model: null, fallbackChain: route.fallbackChain }
  }

  // Return "provider/model" spec for external routing
  return {
    model: `${route.providerName}/${route.model}`,
    fallbackChain: route.fallbackChain,
  }
}
