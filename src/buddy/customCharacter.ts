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
