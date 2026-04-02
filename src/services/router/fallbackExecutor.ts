/**
 * Wraps a model call with fallback chain support.
 * On failure of external provider models, tries each fallback model in order.
 */
export async function* callModelWithFallback(
  callModel: (options: Record<string, unknown>) => AsyncIterable<unknown>,
  options: Record<string, unknown>,
  fallbackChain: string[],
  onFallback?: (fromModel: string, toModel: string, error: Error) => void,
): AsyncGenerator<unknown> {
  try {
    yield* callModel(options)
    return
  } catch (error) {
    const model = options.model as string | undefined
    if (!model?.includes('/') || fallbackChain.length === 0) {
      throw error
    }

    for (const fallbackSpec of fallbackChain) {
      try {
        onFallback?.(model, fallbackSpec, error as Error)
        yield* callModel({ ...options, model: fallbackSpec })
        return
      } catch {
        continue
      }
    }

    throw error
  }
}
