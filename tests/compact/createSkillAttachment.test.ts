import { beforeEach, describe, expect, it } from 'vitest'
import {
  addInvokedSkill,
  clearInvokedSkills,
} from 'src/bootstrap/state.js'
import { createSkillAttachmentIfNeeded } from 'src/services/compact/compact.js'
import { createAssistantMessage } from 'src/utils/messages.js'
import type { AssistantMessage, Message } from 'src/types/message.js'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * Build an AssistantMessage carrying a Skill tool_use block, matching the
 * shape the main loop emits when the model invokes the Skill tool.
 */
function assistantSkillInvocation(skillName: string): AssistantMessage {
  const toolUseBlock = {
    type: 'tool_use' as const,
    id: `toolu_${skillName}`,
    name: 'Skill',
    input: { skill: skillName },
  } as unknown as BetaContentBlock
  return createAssistantMessage({ content: [toolUseBlock] })
}

describe('createSkillAttachmentIfNeeded — preserved-tail dedup', () => {
  beforeEach(() => {
    clearInvokedSkills()
  })

  it('returns null when no skills have been invoked', () => {
    expect(createSkillAttachmentIfNeeded()).toBeNull()
  })

  it('includes all invoked skills when preservedMessages is empty', () => {
    addInvokedSkill('pdf', '/skills/pdf/SKILL.md', 'pdf content', null)
    addInvokedSkill('commit', '/skills/commit/SKILL.md', 'commit content', null)

    const attachment = createSkillAttachmentIfNeeded(undefined, [])
    expect(attachment).not.toBeNull()
    const skills = (attachment!.attachment as { skills: { name: string }[] })
      .skills
    expect(skills.map(s => s.name).sort()).toEqual(['commit', 'pdf'])
  })

  it('skips a skill whose Skill tool_use is in the preserved tail', () => {
    addInvokedSkill('pdf', '/skills/pdf/SKILL.md', 'pdf content', null)
    addInvokedSkill('commit', '/skills/commit/SKILL.md', 'commit content', null)

    const preserved: Message[] = [assistantSkillInvocation('pdf')]

    const attachment = createSkillAttachmentIfNeeded(undefined, preserved)
    expect(attachment).not.toBeNull()
    const skills = (attachment!.attachment as { skills: { name: string }[] })
      .skills
    expect(skills.map(s => s.name)).toEqual(['commit'])
  })

  it('keeps invoked skills that do not appear in preserved tail', () => {
    addInvokedSkill('pdf', '/skills/pdf/SKILL.md', 'pdf content', null)

    // Preserved tail references a different skill — pdf must still surface.
    const preserved: Message[] = [assistantSkillInvocation('commit')]

    const attachment = createSkillAttachmentIfNeeded(undefined, preserved)
    expect(attachment).not.toBeNull()
    const skills = (attachment!.attachment as { skills: { name: string }[] })
      .skills
    expect(skills.map(s => s.name)).toEqual(['pdf'])
  })

  it('normalizes leading slash and whitespace when matching', () => {
    addInvokedSkill('pdf', '/skills/pdf/SKILL.md', 'pdf content', null)

    // The model might emit "/pdf" or "  pdf  " — both should dedup against
    // the stored "pdf".
    const preserved: Message[] = [assistantSkillInvocation('/pdf')]

    const attachment = createSkillAttachmentIfNeeded(undefined, preserved)
    expect(attachment).toBeNull()
  })

  it('returns null when every invoked skill is in the preserved tail', () => {
    addInvokedSkill('pdf', '/skills/pdf/SKILL.md', 'pdf content', null)
    addInvokedSkill('commit', '/skills/commit/SKILL.md', 'commit content', null)

    const preserved: Message[] = [
      assistantSkillInvocation('pdf'),
      assistantSkillInvocation('commit'),
    ]

    const attachment = createSkillAttachmentIfNeeded(undefined, preserved)
    expect(attachment).toBeNull()
  })

  it('ignores non-Skill tool_use blocks in preserved tail', () => {
    addInvokedSkill('pdf', '/skills/pdf/SKILL.md', 'pdf content', null)

    // A Read tool_use should NOT accidentally dedup the pdf skill.
    const readBlock = {
      type: 'tool_use' as const,
      id: 'toolu_read_1',
      name: 'Read',
      input: { file_path: '/tmp/pdf.txt' },
    } as unknown as BetaContentBlock
    const preserved: Message[] = [
      createAssistantMessage({ content: [readBlock] }),
    ]

    const attachment = createSkillAttachmentIfNeeded(undefined, preserved)
    expect(attachment).not.toBeNull()
  })
})
