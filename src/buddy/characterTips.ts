import type { Species } from './types.js'
import {
  homer,
  einstein,
  yoda,
  batman,
  mario,
  pikachu,
  ada,
  bobross,
  gandalf,
  r2d2,
} from './types.js'

/**
 * Personality-specific quips for famous character species.
 * Used by the companion speech bubble to add flavor when the
 * character has no model-generated reaction to show.
 */
export const CHARACTER_TIPS: Partial<Record<Species, string[]>> = {
  [homer]: [
    "D'oh! Don't forget to save!",
    'Mmm... clean code...',
    'Why do today what you can commit tomorrow?',
    'Beer... I mean, build succeeded!',
  ],
  [einstein]: [
    "Relatively speaking, that's elegant code",
    'E = mc\u00B2 (Errors = more code\u00B2)',
    'Imagination is more important than syntax',
    'The definition of insanity is debugging the same bug twice',
  ],
  [yoda]: [
    'Save your work, you must',
    'Strong with this codebase, the force is',
    'Do or do not. There is no try/catch',
    'Patience you must have, young coder',
  ],
  [batman]: [
    "I'm the developer this codebase deserves",
    "It's not who codes underneath, but what we commit",
    'The night is darkest before the deploy',
    'Why do we fall? So we can learn to debug',
  ],
  [mario]: [
    "It's-a me, your build system!",
    "Let's-a go! Tests passing!",
    'Thank you, but your bug is in another file',
    'Wahoo! Clean commit!',
  ],
  [pikachu]: [
    'Pika! Test passed!',
    'Pika pika! (Nice refactor!)',
    'Pikachu used Thunder... on the CI server',
    'Chu! (Build complete!)',
  ],
  [ada]: [
    'I wrote the first algorithm. You can write this function.',
    'The Analytical Engine has no pretensions to originate anything',
    'Notes on debugging: patience is key',
    'Science is a beautiful gift',
  ],
  [bobross]: [
    'Happy little functions, happy little tests',
    'There are no bugs, just happy accidents',
    "Let's add a happy little commit right here",
    'Everyone needs a friend. Even your code.',
  ],
  [gandalf]: [
    'You shall not pass... null!',
    'A wizard always commits precisely when he means to',
    'Fly, you fools! (run your tests)',
    'Even the smallest function can change the course of the project',
  ],
  [r2d2]: [
    '*beep boop* Compiling...',
    '*whistle* Build succeeded!',
    '*sad beep* Test failed...',
    '*excited chirp* New commit!',
  ],
}

/** Pick a random character tip for the given species, or undefined if none. */
export function getCharacterTip(species: Species): string | undefined {
  const tips = CHARACTER_TIPS[species]
  if (!tips || tips.length === 0) return undefined
  return tips[Math.floor(Math.random() * tips.length)]
}
