import { describe, it, expect } from 'vitest'
import { getModelCosts, COST_ZERO } from 'src/utils/modelCost.js'

describe('Cost tracking for external models', () => {
  const emptyUsage = { input_tokens: 0, output_tokens: 0, speed: 'standard' } as any

  it('returns COST_ZERO for provider/model format', () => {
    const costs = getModelCosts('ollama/qwen2.5-coder:7b', emptyUsage)
    expect(costs.inputTokens).toBe(0)
    expect(costs.outputTokens).toBe(0)
  })

  it('returns COST_ZERO for known local model names', () => {
    expect(getModelCosts('qwen2.5-coder:7b', emptyUsage).inputTokens).toBe(0)
    expect(getModelCosts('deepseek-coder-v2', emptyUsage).inputTokens).toBe(0)
    expect(getModelCosts('llama3.2:8b', emptyUsage).inputTokens).toBe(0)
  })

  it('still returns Claude pricing for Claude models', () => {
    const costs = getModelCosts('claude-opus-4-6', emptyUsage)
    expect(costs.inputTokens).toBeGreaterThan(0)
  })

  it('COST_ZERO has all zero fields', () => {
    expect(COST_ZERO.inputTokens).toBe(0)
    expect(COST_ZERO.outputTokens).toBe(0)
    expect(COST_ZERO.promptCacheWriteTokens).toBe(0)
    expect(COST_ZERO.promptCacheReadTokens).toBe(0)
    expect(COST_ZERO.webSearchRequests).toBe(0)
  })
})
