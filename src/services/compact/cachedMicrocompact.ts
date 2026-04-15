/**
 * Stub for the cached-microcompact module.
 *
 * The real implementation lives in an internal Anthropic-only build. This
 * public fork keeps the import call-sites behind `feature('CACHED_MICROCOMPACT')`
 * feature flags which are dead-code-eliminated by `bun:bundle` when the flag
 * is off, so the code here never runs — it only needs to satisfy types and
 * import resolution.
 *
 * If you're reading this looking for the real cached-microcompact logic:
 * it uses the Anthropic Messages API's `cache_edits` extension to mark
 * tool_result blocks for deletion in the server-side prompt cache without
 * invalidating the prefix. External builds can't rely on that extension,
 * so they use the content-clearing paths in `microCompact.ts`
 * (`maybeTimeBasedMicrocompact` + `maybeCountBasedMicrocompact`) instead.
 */

export type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
  pinnedEdits: PinnedCacheEdits[]
}

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCConfig = {
  supportedModels: string[]
  triggerThreshold: number
  keepRecent: number
}

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig(): CachedMCConfig {
  return {
    supportedModels: [],
    triggerThreshold: 0,
    keepRecent: 0,
  }
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
    pinnedEdits: [],
  }
}

export function resetCachedMCState(state: CachedMCState): void {
  state.registeredTools.clear()
  state.toolOrder.length = 0
  state.deletedRefs.clear()
  state.pinnedEdits.length = 0
}

export function markToolsSentToAPI(_state: CachedMCState): void {
  // no-op in the stub
}

export function registerToolResult(
  state: CachedMCState,
  toolUseId: string,
): void {
  state.registeredTools.add(toolUseId)
  state.toolOrder.push(toolUseId)
}

export function registerToolMessage(
  _state: CachedMCState,
  _groupIds: string[],
): void {
  // no-op in the stub
}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolsToDelete: string[],
): CacheEditsBlock | null {
  return null
}
