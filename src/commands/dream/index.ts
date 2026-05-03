import type { Command } from '../../commands.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { recordConsolidation } from '../../services/autoDream/consolidationLock.js'
import { buildConsolidationPrompt } from '../../services/autoDream/consolidationPrompt.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getProjectDir } from '../../utils/sessionStorage.js'

/**
 * /dream — manual memory consolidation. Inlines the same dream prompt the
 * auto-dream cron uses so the model sweeps recent sessions and writes/updates
 * memory files. Optimistically stamps the consolidation lock so the next
 * auto-dream cycle waits the configured interval. Public counterpart of the
 * gated KAIROS auto-dream cron — works in standard builds.
 */
const command = {
  type: 'prompt',
  name: 'dream',
  description: 'Consolidate recent session memory into your memory files',
  contentLength: 0, // Dynamic content
  progressMessage: 'consolidating memory',
  source: 'builtin',
  async getPromptForCommand() {
    // Best-effort lock stamp — fires at prompt-build time before the model
    // actually executes. recordConsolidation just writes the file with the
    // current PID. If the model fails partway, the lock is still stamped;
    // user can re-run to retry. Same trade-off as the comment in
    // consolidationLock.ts:127 calls out.
    try {
      await recordConsolidation()
    } catch {
      // Non-fatal: a missing/unwritable lock just means the auto-dream cron
      // may fire sooner than expected. The prompt still goes through.
    }

    const memoryRoot = getAutoMemPath()
    const transcriptDir = getProjectDir(getOriginalCwd())
    const prompt = buildConsolidationPrompt(memoryRoot, transcriptDir, '')

    return [{ type: 'text', text: prompt }]
  },
} satisfies Command

export default command
