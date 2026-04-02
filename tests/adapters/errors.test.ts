import { describe, it, expect } from 'vitest'
import { OpenAICompatibleAPIError } from 'src/services/api/adapters/errors.js'

describe('OpenAICompatibleAPIError', () => {
  it('has correct .status, .headers.get(), and .message', () => {
    const headers = new Headers({ 'retry-after': '30', 'x-request-id': 'req_abc' })
    const error = new OpenAICompatibleAPIError(429, 'Rate limited', headers)

    expect(error.status).toBe(429)
    expect(error.message).toBe('Rate limited')
    expect(error.headers.get('retry-after')).toBe('30')
    expect(error.headers.get('x-request-id')).toBe('req_abc')
  })

  it('has .error.error.message for Anthropic SDK compatibility', () => {
    const error = new OpenAICompatibleAPIError(
      500,
      'Internal server error',
      new Headers(),
    )

    expect(error.error).toEqual({ error: { message: 'Internal server error' } })
    expect(error.error.error.message).toBe('Internal server error')
  })

  it('is instanceof Error', () => {
    const error = new OpenAICompatibleAPIError(404, 'Not found', new Headers())

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(OpenAICompatibleAPIError)
  })

  it('has name set to OpenAICompatibleAPIError', () => {
    const error = new OpenAICompatibleAPIError(0, 'Connection failed', new Headers())

    expect(error.name).toBe('OpenAICompatibleAPIError')
  })

  it('handles connection failure with status 0 and empty headers', () => {
    const error = new OpenAICompatibleAPIError(
      0,
      'Connection failed: ECONNREFUSED',
      new Headers(),
    )

    expect(error.status).toBe(0)
    expect(error.message).toBe('Connection failed: ECONNREFUSED')
    expect(error.headers.get('retry-after')).toBeNull()
  })
})
