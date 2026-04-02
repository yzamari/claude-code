import { ModelRouter } from './ModelRouter.js'
import type { TaskContext } from './taskClassifier.js'
import type { RouterConfig } from './routerConfig.js'

let cachedRouter: ModelRouter | null = null
let cachedConfigHash: string | null = null

export function resolveModelForQuery(
  routerConfig: RouterConfig | undefined,
  context: {
    lastToolNames: string[]
    messageTokenCount: number
    isPlanMode: boolean
    isSubagent: boolean
    userModelOverride: string | undefined
    lastBashCommand?: string
  }
): string | null {
  if (!routerConfig?.enabled) return null

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
  }

  const route = cachedRouter.resolve(taskContext)

  // If native Anthropic, return null (use default model selection)
  if (route.isNativeAnthropic) return null

  // Return "provider/model" spec for external routing
  return `${route.providerName}/${route.model}`
}
