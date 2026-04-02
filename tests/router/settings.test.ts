import { describe, it, expect } from 'vitest'
import { SettingsSchema } from 'src/utils/settings/types.js'

describe('Settings modelRouter integration', () => {
  it('accepts modelRouter in settings', () => {
    const settings = {
      modelRouter: {
        enabled: true,
        default: 'claude-opus-4-6',
        providers: {
          ollama: {
            type: 'openai-compatible',
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen2.5-coder:7b'],
          },
        },
        routes: [
          { tasks: ['file_search'], model: 'ollama/qwen2.5-coder:7b' },
        ],
      },
    }
    const result = SettingsSchema().safeParse(settings)
    expect(result.success).toBe(true)
  })

  it('accepts settings without modelRouter (backward compatible)', () => {
    const settings = {
      model: 'claude-opus-4-6',
    }
    const result = SettingsSchema().safeParse(settings)
    expect(result.success).toBe(true)
  })
})
