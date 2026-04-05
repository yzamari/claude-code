/**
 * Wraps a model call with fallback chain support.
 * On failure of external provider models, tries each fallback model in order.
 *
 * Handles both immediate errors (connection failures) and mid-stream errors
 * (e.g. empty response detected after the stream completes). For streaming,
 * we buffer events so that a late-thrown error doesn't leave the consumer
 * with a partial, broken message — instead, the fallback model is tried.
 */
export async function* callModelWithFallback(
  callModel: (options: Record<string, unknown>) => AsyncIterable<unknown>,
  options: Record<string, unknown>,
  fallbackChain: string[],
  onFallback?: (fromModel: string, toModel: string, error: Error) => void,
): AsyncGenerator<unknown> {
  try {
    // Buffer all events so a mid-stream error (like empty response detection)
    // can be caught before any events are yielded to the consumer.
    const events: unknown[] = []
    for await (const event of callModel(options)) {
      events.push(event)
    }
    for (const event of events) {
      yield event
    }
    return
  } catch (error) {
    const model = options.model as string | undefined
    if (!model?.includes('/') || fallbackChain.length === 0) {
      throw error
    }

    for (const fallbackSpec of fallbackChain) {
      try {
        onFallback?.(model, fallbackSpec, error as Error)
        const fallbackEvents: unknown[] = []
        for await (const event of callModel({ ...options, model: fallbackSpec })) {
          fallbackEvents.push(event)
        }
        for (const event of fallbackEvents) {
          yield event
        }
        return
      } catch {
        continue
      }
    }

    throw error
  }
}
