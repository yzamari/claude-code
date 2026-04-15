/**
 * Ambient type augmentations for the Anthropic SDK.
 *
 * The public fork of claude-code targets a newer (internal) Anthropic Messages
 * API surface than the published `@anthropic-ai/sdk` package. This file adds
 * the missing types and interface members so the fork compiles cleanly against
 * the shipped SDK without needing an SDK upgrade.
 *
 * Scope: only add members this fork actually uses. Do NOT re-declare types the
 * SDK already exports.
 *
 * The `export {}` below is load-bearing: it marks this file as a module, which
 * makes the `declare module` block a MODULE AUGMENTATION (merged) instead of
 * an ambient module declaration (which would REPLACE the SDK types).
 */
export {}

declare module '@anthropic-ai/sdk/resources/beta/messages/messages.mjs' {
  // --- Missing type exports used by claude.ts but not present in the SDK.

  /** Structured-output format descriptor passed through `output_config.format`. */
  export type BetaJSONOutputFormat = Record<string, unknown>

  /** Free-form output configuration object (effort, format, task_budget, etc.). */
  export interface BetaOutputConfig {
    effort?: string | number
    format?: BetaJSONOutputFormat
    task_budget?: unknown
    [key: string]: unknown
  }

  /** Fork alias for the shipped SDK document block type. */
  export type BetaRequestDocumentBlock = BetaBase64PDFBlock

  /**
   * Union of stop_reason values observed on the wire. Includes both the
   * published SDK literals and fork-only values (e.g.
   * `model_context_window_exceeded`) used by newer API versions.
   */
  export type BetaStopReason =
    | 'end_turn'
    | 'max_tokens'
    | 'stop_sequence'
    | 'tool_use'
    | 'model_context_window_exceeded'
    | 'pause_turn'
    | 'refusal'
    | null

  // --- Usage fields present on the wire but missing from shipped SDK types.
  // Required fields are `number | null` to line up with BetaUsage so callers
  // that pass a BetaUsage into code that expects BetaMessageDeltaUsage (the
  // streaming delta shape) still satisfy the type. Optional fields stay
  // optional so BetaUsage still assigns cleanly.
  interface BetaMessageDeltaUsage {
    input_tokens: number | null
    cache_creation_input_tokens: number | null
    cache_read_input_tokens: number | null
    server_tool_use?: {
      web_search_requests?: number
      web_fetch_requests?: number
    } | null
    iterations?: number
  }

  interface BetaUsage {
    cache_creation?: {
      ephemeral_1h_input_tokens?: number
      ephemeral_5m_input_tokens?: number
    }
    speed?: 'fast' | 'slow' | (string & {})
  }

  // --- Fork-internal request parameters.
  interface MessageCreateParamsBase {
    speed?: 'fast' | 'slow' | (string & {})
    output_config?: BetaOutputConfig
  }
}
