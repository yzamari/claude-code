import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { generateCharacter } from '../../buddy/generateCharacter.js'
import { saveCustomCharacter, invalidateBuddyCache } from '../../buddy/customCharacter.js'

/**
 * Resolves an API endpoint and model for character generation.
 * Checks GEMINI_API_KEY, OPENAI_API_KEY, or falls back to Ollama.
 */
function resolveProvider(): {
  apiBaseUrl: string
  apiKey: string | undefined
  model: string
} {
  // Prefer Gemini
  if (process.env.GEMINI_API_KEY) {
    return {
      apiBaseUrl:
        'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: process.env.GEMINI_API_KEY,
      model: 'gemini-2.5-flash',
    }
  }

  // Try OpenAI
  if (process.env.OPENAI_API_KEY) {
    return {
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
    }
  }

  // Fallback to local Ollama
  return {
    apiBaseUrl: 'http://localhost:11434/v1',
    apiKey: undefined,
    model: 'qwen2.5:0.5b',
  }
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const characterName = args.trim()

  if (!characterName) {
    onDone(
      'Usage: /character <name>\n' +
        'Example: /character Homer Simpson\n' +
        'Example: /character Shrek\n' +
        'Example: /character Baby Yoda',
      { display: 'system' },
    )
    return null
  }

  const { apiBaseUrl, apiKey, model } = resolveProvider()

  try {
    const character = await generateCharacter(
      characterName,
      apiBaseUrl,
      apiKey,
      model,
    )
    saveCustomCharacter(character)
    invalidateBuddyCache()

    // Format the sprite for display
    const spritePreview = character.frames[0]!.join('\n')

    onDone(
      `Generated "${character.name}"!\n\n` +
        `${spritePreview}\n\n` +
        `${character.greeting}\n\n` +
        `Your companion has been updated. Tips:\n` +
        character.tips.map((t) => `  - ${t}`).join('\n'),
      { display: 'system' },
    )
  } catch (error) {
    onDone(`Failed to generate character: ${(error as Error).message}`, {
      display: 'system',
    })
  }

  return null
}
