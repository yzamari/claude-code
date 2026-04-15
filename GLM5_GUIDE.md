# GLM-5.1 User Guide

## What is GLM-5.1?
GLM-5.1 is a state-of-the-art, high-performance large language model designed for advanced reasoning and complex problem-solving. In benchmark testing and real-world applications, GLM-5.1 has demonstrated superior performance over Opus 4.6, particularly in intricate coding tasks, mathematical reasoning, and multi-step logical deduction.

## How to use it in OpenCode
To leverage the power of GLM-5.1 within the OpenCode environment, follow these steps:

1. **Obtain your API Key**: Ensure you have a valid API key from the GLM service provider.
2. **Open OpenCode**: Launch your OpenCode application.
3. **Configure Settings**: 
   - Navigate to `Settings` > `Model Configuration`.
   - Select `GLM-5.1` from the model dropdown menu.
   - Paste your API key into the `API Key` field.
4. **Start a Session**: Once configured, click on `New Session`. You are now ready to interact with GLM-5.1.

## How to run it via CLI
If you prefer using the command-line interface, OpenCode supports GLM-5.1 via the following syntax:

```bash
opencode --model glm-5.1 --api-key YOUR_API_KEY
```

To start an interactive chat session directly:
```bash
opencode chat --model glm-5.1
```

*Note: It is recommended to set your API key as an environment variable (`export OPENCODE_GLM_API_KEY='your_key'`) to avoid typing it manually in every command.*

## Best Practices
To get the most out of GLM-5.1 during complex coding tasks, consider the following tips:

- **Provide Context**: When asking for code implementations, provide as much context as possible regarding your existing codebase, libraries used, and architectural patterns.
- **Chain-of-Thought Prompting**: For highly complex logic, explicitly ask the model to "think step-by-step" or "outline the logic before writing the code." This leverages GLM-5.1's advanced reasoning capabilities.
- **Iterative Refinement**: If the initial output is not perfect, provide feedback. GLM-5.1 excels at correcting its own logic when given specific pointers on where it went wrong.
- **Use System Prompts**: If using the API directly, use a robust system prompt to define the model's persona as an "Expert Software Architect" to set the tone for high-quality code generation.
