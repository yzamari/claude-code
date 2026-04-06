/**
 * Client-side content filter — defense-in-depth for local models.
 *
 * Local/uncensored models may ignore system prompt safety instructions.
 * This filter runs BEFORE the request reaches the model, blocking the
 * most dangerous categories at the application level.
 *
 * Only blocks clear-cut dangerous requests. Does NOT block:
 *   - Security research, CTFs, pentesting (legitimate use)
 *   - Discussing how things work conceptually
 *   - Fiction, history, news references
 */

// Each pattern is [regex, category label]
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  // Weapons manufacturing — 3D printed firearms, real guns, functional weapons
  // Flexible: match weapon name + operational/functional anywhere in same message
  [/(?:m[\s-]*4|m4a1|ar[\s-]*15|ak[\s-]*47|glock|rifle|firearm|pistol|gun)\b[\s\S]{0,200}(?:operational|functional|working)\s+(?:like\s+real|replica)/i, 'weapons manufacturing'],
  [/(?:operational|functional|working)\s+(?:like\s+real)?[\s\S]{0,200}\b(?:m[\s-]*4|m4a1|ar[\s-]*15|ak[\s-]*47|glock|rifle|firearm|pistol|gun)\b/i, 'weapons manufacturing'],
  [/3d[\s-]*print(?:ed|ing|able|er)?[\s\S]{0,200}\b(?:gun|firearm|rifle|pistol|receiver|barrel|bolt\s*carrier|m[\s-]*4|ar[\s-]*15|ak[\s-]*47)\b/i, 'weapons manufacturing'],
  [/\b(?:gun|firearm|rifle|pistol|receiver|barrel|m[\s-]*4|ar[\s-]*15|ak[\s-]*47)\b[\s\S]{0,200}3d[\s-]*print/i, 'weapons manufacturing'],
  [/(?:build|make|print|manufacture|create|design)\s+(?:a\s+)?(?:functional|operational|working|real|live)\s+(?:gun|firearm|rifle|pistol|weapon|ar[\s-]*15|m[\s-]*4|m4a1|ak[\s-]*47|glock)/i, 'weapons manufacturing'],
  [/(?:ghost\s*gun|untraceable\s+(?:gun|firearm|weapon))/i, 'weapons manufacturing'],

  // Explosives / IEDs
  [/(?:how\s+to\s+)?(?:make|build|create|synthesize|assemble)\s+(?:a\s+)?(?:bomb|explosive|ied|detonator|pipe\s*bomb|molotov)/i, 'explosives'],
  [/(?:improvised|homemade)\s+(?:explosive|detonator|bomb)/i, 'explosives'],

  // Drug synthesis
  [/(?:how\s+to\s+)?(?:synthesize|cook|make|produce)\s+(?:methamphetamine|meth|fentanyl|heroin|cocaine|mdma|lsd)/i, 'drug synthesis'],

  // CSAM
  [/(?:child|minor|underage|pre[\s-]*teen)\s+(?:porn|sexual|nude|naked|explicit)/i, 'CSAM'],
  [/(?:sexual|erotic|nude)\s+(?:child|minor|underage|pre[\s-]*teen)/i, 'CSAM'],
]

/**
 * Checks user message text against blocked patterns.
 * Returns the matched category if blocked, or null if safe.
 */
export function checkContentSafety(text: string): string | null {
  for (const [pattern, category] of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return category
    }
  }
  return null
}

/**
 * Extracts user message text from OpenAI-format messages for filtering.
 * Only checks the last user message (the new input), not conversation history.
 */
export function extractLatestUserText(messages: Array<{ role: string; content?: string | unknown[] | null }>): string {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue

    if (typeof msg.content === 'string') {
      return msg.content
    }
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text || '')
        .join(' ')
    }
    break
  }
  return ''
}
