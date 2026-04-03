/**
 * Uses an AI model to generate a custom ASCII character.
 * Returns sprite frames and personality tips.
 */

export interface GeneratedCharacter {
  name: string
  frames: string[][] // 3 frames, each 5 lines of 12 chars
  tips: string[] // 4-6 personality-specific tips/jokes
  greeting: string // first message when character appears
}

const GENERATION_PROMPT = `Generate an ASCII art character for a terminal companion. The character is: {CHARACTER_NAME}

You MUST respond in EXACTLY this JSON format, nothing else:

{
  "name": "{CHARACTER_NAME}",
  "frames": [
    ["line1_____12", "line2_____12", "line3_____12", "line4_____12", "line5_____12"],
    ["line1_____12", "line2_____12", "line3_____12", "line4_____12", "line5_____12"],
    ["line1_____12", "line2_____12", "line3_____12", "line4_____12", "line5_____12"]
  ],
  "tips": [
    "Tip or joke in character's voice 1",
    "Tip or joke in character's voice 2",
    "Tip or joke in character's voice 3",
    "Tip or joke in character's voice 4"
  ],
  "greeting": "Hello message in character's voice"
}

Rules:
- Each frame is 5 lines, each line EXACTLY 12 characters (pad with spaces)
- 3 frames for idle animation (small differences between frames)
- The ASCII art should be recognizable as the character
- Tips should be coding/programming related but in the character's voice/personality
- Use simple ASCII characters only (letters, symbols, no unicode)
- Frame 1 = idle, Frame 2 = small movement, Frame 3 = small variant
- Make it cute and fun!

RESPOND WITH ONLY THE JSON. No markdown, no explanation.`

/**
 * Normalize frames to exactly 3 frames of 5 lines, each line 12 chars.
 */
export function normalizeFrames(frames: string[][]): string[][] {
  return frames.slice(0, 3).map((frame) =>
    frame.slice(0, 5).map((line) => line.slice(0, 12).padEnd(12)),
  )
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
      max_tokens: 1000,
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

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonStr) as GeneratedCharacter

  // Validate structure
  if (!parsed.frames || parsed.frames.length < 3) {
    throw new Error('Invalid character: need 3 frames')
  }
  if (!parsed.tips || parsed.tips.length < 2) {
    throw new Error('Invalid character: need at least 2 tips')
  }

  // Normalize frames to exactly 5 lines of 12 chars
  parsed.frames = normalizeFrames(parsed.frames)

  return parsed
}
