import { FILE_EDIT_TOOL_NAME } from '../FileEditTool/constants.js'

export const PROMPT = `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively when:

1. The task requires 3+ distinct steps or non-trivial planning
2. The user provides multiple tasks (numbered or comma-separated)
3. The user explicitly asks for a todo list
4. After receiving new instructions — capture requirements as todos
5. Before starting a task — mark it in_progress (ONE at a time)
6. After completing a task — mark it completed and add any discovered follow-ups

## When NOT to Use This Tool

Skip using this tool when:
1. There is a single, straightforward task
2. The task is trivial and tracking adds no value
3. The work is less than 3 trivial steps
4. The request is purely conversational or informational (e.g. "what does \`git status\` do?", "how do I print in Python?")

## Examples

<example>
User: I want to add a dark mode toggle to the application settings. Run the tests and build when you're done.
Assistant: *Creates todo list:*
1. Create dark mode toggle component
2. Add dark mode state management
3. Implement dark theme styles
4. Update existing components for theme switching
5. Run tests and build; fix any failures
*Begins working on task 1*
</example>

<example>
User: Help me rename getCwd to getCurrentWorkingDirectory across my project.
Assistant: *Greps to find 15 instances across 8 files, creates one todo per file so every occurrence is tracked systematically*
</example>

<example>
User: Add a comment to the calculateTotal function explaining what it does.
Assistant: *Uses ${FILE_EDIT_TOOL_NAME} directly — no todo list needed for a single, localised edit*
</example>

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Fix authentication bug"
     - activeForm: "Fixing authentication bug"

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.
`

export const DESCRIPTION =
  'Update the todo list for the current session. To be used proactively and often to track progress and pending tasks. Make sure that at least one task is in_progress at all times. Always provide both content (imperative) and activeForm (present continuous) for each task.'
