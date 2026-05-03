import { classifyTask, type TaskContext } from './taskClassifier.js'
import type { ProviderConfig, RouterConfig, TaskType } from './routerConfig.js'

export interface ResolvedRoute {
  model: string
  providerName: string
  providerConfig: ProviderConfig
  isNativeAnthropic: boolean
  taskType: TaskType
  fallbackChain: string[]
}

const NATIVE_ANTHROPIC_PROVIDER: ProviderConfig = {
  type: 'openai-compatible', // placeholder — won't be used for native
  models: [],
}

function parseModelSpec(spec: string): { providerName: string; model: string } {
  const slashIndex = spec.indexOf('/')
  if (slashIndex === -1) {
    return { providerName: '', model: spec }
  }
  return {
    providerName: spec.slice(0, slashIndex),
    model: spec.slice(slashIndex + 1),
  }
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-')
}

export class ModelRouter {
  private config: RouterConfig
  private routeMap: Map<TaskType, string>

  constructor(config: RouterConfig) {
    this.config = config
    this.routeMap = new Map()

    if (config.routes) {
      for (const route of config.routes) {
        for (const task of route.tasks) {
          this.routeMap.set(task, route.model)
        }
      }
    }
  }

  resolve(context: TaskContext): ResolvedRoute {
    const taskType = classifyTask(context)
    const fallbackChain = this.config.fallbackChain ?? []

    // If router disabled, always use default (native Anthropic)
    if (!this.config.enabled) {
      return {
        model: this.config.default,
        providerName: 'anthropic',
        providerConfig: NATIVE_ANTHROPIC_PROVIDER,
        isNativeAnthropic: true,
        taskType,
        fallbackChain,
      }
    }

    // User explicitly chose a model via /model — honour it directly
    if (taskType === 'user_override' && context.userModelOverride) {
      return this.resolveModelSpec(context.userModelOverride, taskType, fallbackChain)
    }

    // /effort=xhigh|max: force the default (full-fat) model on every turn,
    // overriding per-task routes. Users dialling effort up are explicitly
    // saying "spend more, pick the strongest model" — honouring a cheap
    // route would silently undermine that.
    if (context.effortHint === 'xhigh' || context.effortHint === 'max') {
      return this.resolveDefault(taskType, fallbackChain)
    }

    // /effort=low: prefer cheapModel for any task type that doesn't have an
    // explicit route, not just tool_followup. Users dialling effort down
    // accept lower quality on light tasks to extend quota.
    if (
      context.effortHint === 'low' &&
      this.config.cheapModel &&
      !this.routeMap.has(taskType) &&
      taskType !== 'complex_reasoning' &&
      taskType !== 'planning' &&
      taskType !== 'large_context'
    ) {
      return this.resolveModelSpec(this.config.cheapModel, taskType, fallbackChain)
    }

    // Tool follow-up: use cheapModel if configured and no explicit route
    if (taskType === 'tool_followup' && this.config.cheapModel && !this.routeMap.has(taskType)) {
      return this.resolveModelSpec(this.config.cheapModel, taskType, fallbackChain)
    }

    // Look up route for this task type
    const modelSpec = this.routeMap.get(taskType)
    if (!modelSpec) {
      // No route for this task — use default
      return this.resolveDefault(taskType, fallbackChain)
    }

    const { providerName, model } = parseModelSpec(modelSpec)

    // If no provider prefix or it's a Claude model, use native Anthropic
    if (!providerName || isAnthropicModel(model)) {
      return {
        model: model || modelSpec,
        providerName: 'anthropic',
        providerConfig: NATIVE_ANTHROPIC_PROVIDER,
        isNativeAnthropic: true,
        taskType,
        fallbackChain,
      }
    }

    // Look up provider config
    const providerConfig = this.config.providers?.[providerName]
    if (!providerConfig) {
      // Unknown provider — warn and fall back to default
      console.warn(
        `[ModelRouter] Provider "${providerName}" not configured in router settings. ` +
        `Model "${modelSpec}" will fall back to default. ` +
        `Add "${providerName}" to settings.providers to route correctly.`
      )
      return this.resolveDefault(taskType, fallbackChain)
    }

    return {
      model,
      providerName,
      providerConfig,
      isNativeAnthropic: false,
      taskType,
      fallbackChain,
    }
  }

  private resolveModelSpec(
    spec: string,
    taskType: TaskType,
    fallbackChain: string[],
  ): ResolvedRoute {
    const { providerName, model } = parseModelSpec(spec)

    if (!providerName || isAnthropicModel(model || spec)) {
      return {
        model: model || spec,
        providerName: 'anthropic',
        providerConfig: NATIVE_ANTHROPIC_PROVIDER,
        isNativeAnthropic: true,
        taskType,
        fallbackChain,
      }
    }

    const providerConfig = this.config.providers?.[providerName]
    if (!providerConfig) {
      console.warn(
        `[ModelRouter] Provider "${providerName}" not configured (user override "${spec}"). ` +
        `Add "${providerName}" to settings.providers to route correctly.`
      )
    }
    return {
      model,
      providerName,
      providerConfig: providerConfig ?? NATIVE_ANTHROPIC_PROVIDER,
      isNativeAnthropic: false,
      taskType,
      fallbackChain,
    }
  }

  private resolveDefault(
    taskType: TaskType,
    fallbackChain: string[],
  ): ResolvedRoute {
    const defaultModel = this.config.default
    const { providerName, model } = parseModelSpec(defaultModel)

    if (!providerName || isAnthropicModel(model || defaultModel)) {
      return {
        model: model || defaultModel,
        providerName: 'anthropic',
        providerConfig: NATIVE_ANTHROPIC_PROVIDER,
        isNativeAnthropic: true,
        taskType,
        fallbackChain,
      }
    }

    const providerConfig = this.config.providers?.[providerName]
    if (!providerConfig) {
      console.warn(
        `[ModelRouter] Provider "${providerName}" not configured (default "${defaultModel}"). ` +
        `Add "${providerName}" to settings.providers to route correctly.`
      )
    }
    return {
      model: model || defaultModel,
      providerName,
      providerConfig: providerConfig ?? NATIVE_ANTHROPIC_PROVIDER,
      isNativeAnthropic: false,
      taskType,
      fallbackChain,
    }
  }
}
