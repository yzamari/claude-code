import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import type { NormalizedMessage, RenderableMessage } from '../types/message.js';
import { renderModelName } from '../utils/model/model.js';
import { SYNTHETIC_MODEL } from '../utils/messages.js';
type Props = {
  message: NormalizedMessage | RenderableMessage;
  isTranscriptMode: boolean;
};

/**
 * Returns a hex color for the model based on its family/provider.
 * Each model family gets a distinct color so users can visually
 * distinguish which model produced each response.
 */
function getModelColor(model: string): string {
  const m = model.toLowerCase();
  // Anthropic models
  if (m.includes('opus')) return '#D4A0FF';
  if (m.includes('sonnet')) return '#7EB8FF';
  if (m.includes('haiku')) return '#7FFFB2';
  // Google models
  if (m.includes('gemini') || m.includes('gemma')) return '#4ECDC4';
  // OpenAI models
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return '#74AA9C';
  // Meta models
  if (m.includes('llama')) return '#0084FF';
  // Mistral models
  if (m.includes('mistral') || m.includes('codestral') || m.includes('mixtral')) return '#FF7000';
  // Qwen models
  if (m.includes('qwen')) return '#615EFF';
  // DeepSeek models
  if (m.includes('deepseek')) return '#4D6BFF';
  // Microsoft models
  if (m.includes('phi')) return '#0078D4';
  // Cohere models
  if (m.includes('command')) return '#D18EE2';
  // Default gray
  return '#888888';
}

export function MessageModel(t0: Props) {
  const $ = _c(8);
  const {
    message,
    isTranscriptMode
  } = t0;

  // Only show for assistant messages with a real (non-synthetic) model
  if (message.type !== 'assistant') return null;
  const model = message.message.model;
  if (!model || model === SYNTHETIC_MODEL) return null;
  if (!message.message.content.some(_temp)) return null;

  const displayName = renderModelName(model);
  const color = getModelColor(model);

  if (isTranscriptMode) {
    const t1 = stringWidth(displayName) + 8;
    let t2;
    if ($[0] !== displayName || $[1] !== color) {
      t2 = <Box minWidth={t1}><Text color={color}>{displayName}</Text></Box>;
      $[0] = displayName;
      $[1] = color;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    return t2;
  }

  // Normal mode: colored model label above the response
  let t3;
  if ($[3] !== displayName || $[4] !== color) {
    t3 = <Box><Text color={color}>{'▍'} {displayName}</Text></Box>;
    $[3] = displayName;
    $[4] = color;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  return t3;
}
function _temp(c: { type: string }) {
  return c.type === "text";
}
