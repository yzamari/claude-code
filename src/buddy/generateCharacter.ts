/**
 * Uses an AI model to generate a custom ASCII character.
 * Uses a structured prompt that avoids JSON escaping issues with ASCII art.
 */

export interface GeneratedCharacter {
  name: string
  frames: string[][] // 3 frames, each 5 lines of 12 chars
  tips: string[] // 4-6 personality-specific tips/jokes
  greeting: string // first message when character appears
}

// Use delimiters instead of JSON to avoid backslash/quote escaping nightmares
const GENERATION_PROMPT = `Create a tiny ASCII art character for: {CHARACTER_NAME}

Respond in EXACTLY this format (no JSON, no markdown):

NAME: {CHARACTER_NAME}
GREETING: [one-line greeting in character voice]
TIP1: [coding tip in character voice]
TIP2: [coding tip in character voice]
TIP3: [coding tip in character voice]
TIP4: [coding tip in character voice]
FRAME1:
[line 1 - exactly 12 chars]
[line 2 - exactly 12 chars]
[line 3 - exactly 12 chars]
[line 4 - exactly 12 chars]
[line 5 - exactly 12 chars]
FRAME2:
[same as frame1 with tiny change]
[line 2]
[line 3]
[line 4]
[line 5]
FRAME3:
[same as frame1 with different tiny change]
[line 2]
[line 3]
[line 4]
[line 5]

Rules:
- Each line MUST be exactly 12 characters (pad shorter lines with spaces on the right)
- Use only: letters, numbers, ( ) / | _ - . ~ ^ * = + < > : ; ' " # @ ! ?
- Do NOT use backticks
- The art should look like the character (head, body shape, distinctive features)
- Frame 2 and 3 should differ by 1-2 characters from frame 1 (idle animation)
- Tips should be about coding/programming in the character's personality
- Keep it fun and recognizable!`

/**
 * Normalize frames to exactly 3 frames of 5 lines, each line 12 chars.
 */
export function normalizeFrames(frames: string[][]): string[][] {
  return frames.slice(0, 3).map((frame) =>
    frame.slice(0, 5).map((line) => line.slice(0, 12).padEnd(12)),
  )
}

/**
 * Parse the structured text response into a GeneratedCharacter.
 */
function parseResponse(text: string, characterName: string): GeneratedCharacter {
  const lines = text.split('\n')

  let name = characterName
  let greeting = `Hello! I'm ${characterName}!`
  const tips: string[] = []
  const frames: string[][] = [[], [], []]
  let currentFrame = -1

  for (const line of lines) {
    const trimmed = line.trimEnd()

    if (trimmed.startsWith('NAME:')) {
      name = trimmed.slice(5).trim()
    } else if (trimmed.startsWith('GREETING:')) {
      greeting = trimmed.slice(9).trim()
    } else if (trimmed.match(/^TIP\d:/)) {
      tips.push(trimmed.replace(/^TIP\d:\s*/, ''))
    } else if (trimmed === 'FRAME1:') {
      currentFrame = 0
    } else if (trimmed === 'FRAME2:') {
      currentFrame = 1
    } else if (trimmed === 'FRAME3:') {
      currentFrame = 2
    } else if (currentFrame >= 0 && currentFrame <= 2 && frames[currentFrame].length < 5 && trimmed.length > 0) {
      // This is a sprite line — pad/truncate to 12 chars
      frames[currentFrame].push(trimmed.slice(0, 12).padEnd(12))
    }
  }

  // Fill missing frames/lines with defaults
  const defaultLine = '            '
  for (let f = 0; f < 3; f++) {
    while (frames[f].length < 5) {
      frames[f].push(defaultLine)
    }
  }
  // If frame 2 or 3 are empty, copy frame 1
  if (frames[1].every(l => l.trim() === '')) frames[1] = [...frames[0]]
  if (frames[2].every(l => l.trim() === '')) frames[2] = [...frames[0]]

  // Ensure at least 2 tips
  if (tips.length === 0) {
    tips.push(`${name} says: Keep coding!`, `${name} says: Don't forget to save!`)
  } else if (tips.length === 1) {
    tips.push(`${name} says: Keep going!`)
  }

  return { name, frames: normalizeFrames(frames), tips, greeting }
}

export async function generateCharacter(
  characterName: string,
  apiBaseUrl: string,
  apiKey: string | undefined,
  model: string,
): Promise<GeneratedCharacter> {
  const prompt = GENERATION_PROMPT.replace(
    /\{CHARACTER_NAME\}/g,
    characterName,
  )

  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8000,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to generate character: ${response.status}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content ?? ''

  if (!content.trim()) {
    throw new Error('Empty response from AI model')
  }

  return parseResponse(content, characterName)
}
