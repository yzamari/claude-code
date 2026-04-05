import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import type { GeneratedCharacter } from './generateCharacter.js'

function getCharacterPath(): string {
  const dir = getClaudeConfigHomeDir()
  return join(dir, 'custom-character.json')
}

export function saveCustomCharacter(character: GeneratedCharacter): void {
  const path = getCharacterPath()
  writeFileSync(path, JSON.stringify(character, null, 2))
}

export function loadCustomCharacter(): GeneratedCharacter | null {
  try {
    const path = getCharacterPath()
    const data = readFileSync(path, 'utf-8')
    return JSON.parse(data) as GeneratedCharacter
  } catch {
    return null
  }
}

export function hasCustomCharacter(): boolean {
  return loadCustomCharacter() !== null
}

// Returns true when the companion sprite should render — either because
// the BUDDY feature flag is on OR a custom character exists from /character.
let _buddyEnabled: boolean | null = null
export function isBuddyOrCustom(): boolean {
  if (_buddyEnabled !== null) return _buddyEnabled
  const { feature } = require('bun:bundle') as { feature: (name: string) => boolean }
  _buddyEnabled = feature('BUDDY') || hasCustomCharacter()
  return _buddyEnabled
}

// Call after /character saves a new character to bust the cache
export function invalidateBuddyCache(): void {
  _buddyEnabled = null
}
