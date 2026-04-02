/**
 * OpenAI-compatible API error class.
 *
 * Mimics the shape expected by withRetry.ts so that errors thrown by
 * OpenAI-compatible providers (Ollama, Gemini, TurboQuant) flow through
 * the same retry logic as native Anthropic APIError instances.
 *
 * Key properties:
 *  - .status   — HTTP status code (0 for connection failures)
 *  - .headers  — native Headers with .get() (matches Anthropic SDK shape)
 *  - .error    — nested { error: { message } } for SDK compat
 */
export class OpenAICompatibleAPIError extends Error {
  status: number
  headers: Headers
  error: { error: { message: string } }

  constructor(status: number, message: string, headers: Headers) {
    super(message)
    this.name = 'OpenAICompatibleAPIError'
    this.status = status
    this.headers = headers
    this.error = { error: { message } }
  }
}
