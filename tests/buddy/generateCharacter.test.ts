import { describe, it, expect } from 'vitest'
import { normalizeFrames } from '../../src/buddy/generateCharacter.js'

describe('normalizeFrames', () => {
  it('pads short lines to 12 characters', () => {
    const frames = [
      ['short', 'line2', 'line3', 'line4', 'line5'],
      ['a', 'b', 'c', 'd', 'e'],
      ['x', 'y', 'z', 'w', 'v'],
    ]

    const normalized = normalizeFrames(frames)

    expect(normalized[0]![0]).toHaveLength(12)
    expect(normalized[0]![0]).toBe('short       ')
    expect(normalized[1]![0]).toBe('a           ')
  })

  it('truncates lines longer than 12 characters', () => {
    const frames = [
      ['1234567890123456', '2', '3', '4', '5'],
      ['a', 'b', 'c', 'd', 'e'],
      ['x', 'y', 'z', 'w', 'v'],
    ]

    const normalized = normalizeFrames(frames)

    expect(normalized[0]![0]).toHaveLength(12)
    expect(normalized[0]![0]).toBe('123456789012')
  })

  it('limits to 5 lines per frame', () => {
    const frames = [
      ['1', '2', '3', '4', '5', 'extra', 'extra2'],
      ['a', 'b', 'c', 'd', 'e'],
      ['x', 'y', 'z', 'w', 'v'],
    ]

    const normalized = normalizeFrames(frames)

    expect(normalized[0]).toHaveLength(5)
  })

  it('limits to 3 frames', () => {
    const frames = [
      ['1', '2', '3', '4', '5'],
      ['a', 'b', 'c', 'd', 'e'],
      ['x', 'y', 'z', 'w', 'v'],
      ['extra', 'frame', 'here', 'too', 'many'],
    ]

    const normalized = normalizeFrames(frames)

    expect(normalized).toHaveLength(3)
  })

  it('every line in every frame is exactly 12 chars', () => {
    const frames = [
      ['  /\\_/\\  ', '( o o )', '(  >  )', ' (") (")', '   ~~  '],
      ['  /\\_/\\  ', '( o o )', '(  >  )', ' (") (")', '   ~~  '],
      ['  /\\_/\\  ', '( - o )', '(  >  )', ' (") (")', '   ~~  '],
    ]

    const normalized = normalizeFrames(frames)

    for (const frame of normalized) {
      for (const line of frame) {
        expect(line).toHaveLength(12)
      }
    }
  })
})
