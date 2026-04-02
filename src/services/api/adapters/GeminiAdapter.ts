/**
 * Gemini Adapter — uses Google's OpenAI-compatible endpoint.
 *
 * Google provides an OpenAI-compatible API at:
 * https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * This means we can reuse the OpenAI adapter (OpenAIStreamClient) for Gemini
 * by pointing it to this base URL with GEMINI_API_KEY.
 *
 * See: https://ai.google.dev/gemini-api/docs/openai
 */

const GEMINI_OPENAI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'

export function getGeminiOpenAIBaseUrl(): string {
  return process.env.GEMINI_BASE_URL ?? GEMINI_OPENAI_BASE_URL
}

export function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
}
