/**
 * Character command - generates a custom ASCII companion using AI.
 * Implementation is lazy-loaded from character.ts to reduce startup time.
 */
import type { Command } from '../../commands.js'

const character = {
  type: 'local-jsx',
  name: 'character',
  description: 'Generate a custom ASCII companion character using AI',
  immediate: true,
  argumentHint: '<character name>',
  load: () => import('./character.js'),
} satisfies Command

export default character
