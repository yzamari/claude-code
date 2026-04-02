import { describe, it, expect, vi } from 'vitest'
import { callModelWithFallback } from 'src/services/router/fallbackExecutor.js'

async function* successGenerator(opts: any) {
  yield { type: 'message', content: `response from ${opts.model}` }
}

async function* failGenerator(opts: any): AsyncGenerator<unknown> {
  if (opts.model === 'ollama/bad-model') {
    throw new Error('Connection refused')
  }
  yield { type: 'message', content: `response from ${opts.model}` }
}

async function* alwaysFailGenerator(_opts: any): AsyncGenerator<unknown> {
  throw new Error('Always fails')
}

async function collectStream(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const results: unknown[] = []
  for await (const item of gen) {
    results.push(item)
  }
  return results
}

describe('callModelWithFallback', () => {
  it('passes through on success', async () => {
    const results = await collectStream(
      callModelWithFallback(
        successGenerator,
        { model: 'ollama/good-model' },
        ['fallback1'],
      ),
    )
    expect(results).toHaveLength(1)
    expect((results[0] as any).content).toContain('good-model')
  })

  it('falls back on primary failure', async () => {
    const onFallback = vi.fn()
    const results = await collectStream(
      callModelWithFallback(
        failGenerator,
        { model: 'ollama/bad-model' },
        ['ollama/good-model'],
        onFallback,
      ),
    )
    expect(results).toHaveLength(1)
    expect((results[0] as any).content).toContain('good-model')
    expect(onFallback).toHaveBeenCalledWith(
      'ollama/bad-model',
      'ollama/good-model',
      expect.any(Error),
    )
  })

  it('throws when all fallbacks fail', async () => {
    await expect(
      collectStream(
        callModelWithFallback(
          alwaysFailGenerator,
          { model: 'ollama/bad' },
          ['fallback1', 'fallback2'],
        ),
      ),
    ).rejects.toThrow('Always fails')
  })

  it('does not fallback for native Anthropic models', async () => {
    await expect(
      collectStream(
        callModelWithFallback(
          alwaysFailGenerator,
          { model: 'claude-opus-4-6' },
          ['fallback1'],
        ),
      ),
    ).rejects.toThrow('Always fails')
  })

  it('does not fallback when chain is empty', async () => {
    await expect(
      collectStream(
        callModelWithFallback(
          alwaysFailGenerator,
          { model: 'ollama/bad' },
          [],
        ),
      ),
    ).rejects.toThrow('Always fails')
  })
})
