import type { Command } from '../../commands.js'

const RECAP_PROMPT = `# Session Recap

Summarize what's happened in this session so far so the user can quickly reorient (e.g. after stepping away from the terminal).

Output sections:

**Done** — concrete, completed actions in chronological order. Reference file paths and PR/issue numbers when relevant. Skip exploratory dead-ends.

**In flight** — anything started but not finished, with the current blocker if there is one.

**Open questions** — decisions you've been waiting on the user for, if any.

**Where to resume** — the single next concrete action.

Style:
- 1–2 sentences per item, no walls of text.
- No filler (no "Great progress!", no "Let me know if…").
- If nothing notable has happened, say so in one line — don't pad.

Read from the current conversation context only. Do NOT re-read files or invoke tools just to write the recap.`

const command = {
  type: 'prompt',
  name: 'recap',
  description: 'Summarize what has happened in this session so far',
  contentLength: RECAP_PROMPT.length,
  progressMessage: 'recapping session',
  source: 'builtin',
  async getPromptForCommand() {
    return [{ type: 'text', text: RECAP_PROMPT }]
  },
} satisfies Command

export default command
