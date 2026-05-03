import type { Command } from '../../commands.js'

const BABYSIT_PRS_PROMPT = `# Babysit PRs

You're watching open PRs in this repository and reacting to changes that need attention. Pace yourself — this is a periodic check, not a one-shot.

## Step 1: List

Run \`gh pr list --json number,title,state,statusCheckRollup,reviewDecision,isDraft,headRefName,updatedAt --limit 50\` (use --repo if needed).

## Step 2: Triage

For each PR (drafts last):
- **Failing checks** → fetch the failing logs (\`gh run view <runId> --log-failed\` or \`gh pr checks <num>\`), summarize the failure, and propose the smallest fix. If you can fix it locally, do so on a worktree of the PR branch.
- **Blocked on review** (CHANGES_REQUESTED) → read the latest review comments via \`gh api repos/{owner}/{repo}/pulls/{num}/comments\`, address each one in a follow-up commit, and reply explaining the change.
- **Approved + green** → ready to merge. Surface for the user to confirm; do NOT merge without explicit approval.
- **Stale (>3 days no update)** → flag with a one-line reason; never close without asking.
- **Drafts** → skip unless the user pinned them.

## Step 3: Report

Output a tight summary:
- ✅ ready-to-merge (need user confirmation)
- 🔧 fixes attempted (PR # + what was changed)
- ❓ needs decision (stale, conflicting, or ambiguous)
- 🟢 healthy + active (one line)

Pair this with \`/loop 5m /babysit-prs\` to keep watching. Each iteration must be self-contained (no shared state across iterations beyond the git remote).

Constraints:
- Never force-push, never close PRs, never merge — those need explicit user approval.
- If \`gh\` rate-limits, back off (note the reset time and exit; the loop will re-fire).
- Skip PRs the user has marked WIP or blocked.`

const command = {
  type: 'prompt',
  name: 'babysit-prs',
  description:
    'Watch open PRs, triage failing checks / requested-changes, and propose fixes',
  contentLength: BABYSIT_PRS_PROMPT.length,
  progressMessage: 'triaging open PRs',
  source: 'builtin',
  async getPromptForCommand() {
    return [{ type: 'text', text: BABYSIT_PRS_PROMPT }]
  },
} satisfies Command

export default command
