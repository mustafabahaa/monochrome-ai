import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';

export type AssistantStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; result?: unknown; error?: boolean }
  | { type: 'approval'; id: string; name: string; description: string; input: unknown }
  | { type: 'done' }
  | { type: 'error'; code?: string; message: string };

export type AssistantContextLimits = {
  maxMessages?: number;
  maxCharacters?: number;
  maxMessageCharacters?: number;
  maxToolResultCharacters?: number;
};

const defaultLimits: Required<AssistantContextLimits> = {
  maxMessages: 50,
  maxCharacters: 180_000,
  maxMessageCharacters: 48_000,
  maxToolResultCharacters: 4_000,
};

/** Bound Vercel UI message history while preserving valid tool-call/result parts. */
export function boundAssistantContext(messages: UIMessage[], limits: AssistantContextLimits = {}): UIMessage[] {
  const resolved = { ...defaultLimits, ...limits };
  const bounded = messages.slice(-resolved.maxMessages).map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type === 'text' && part.text.length > resolved.maxMessageCharacters) {
        return { ...part, text: '[Message text omitted from older context because it exceeded the model limit.]' };
      }
      const candidate = part as { output?: unknown; result?: unknown };
      if (candidate.output === undefined && candidate.result === undefined) return part;
      const key = candidate.output !== undefined ? 'output' : 'result';
      const value = JSON.stringify(candidate[key]);
      if (typeof value !== 'string' || value.length <= resolved.maxToolResultCharacters) return part;
      return { ...part, [key]: '[Tool result omitted from model context; use the tool again if needed.]' } as typeof part;
    }),
  }));

  let total = JSON.stringify(bounded).length;
  while (total > resolved.maxCharacters && bounded.length > 1) {
    bounded.shift();
    total = JSON.stringify(bounded).length;
  }
  return bounded;
}

/** Convert Vercel AI SDK UI messages into model messages with one shared path. */
export async function toAssistantModelMessages(
  messages: UIMessage[],
  limits?: AssistantContextLimits,
): Promise<ModelMessage[]> {
  const bounded = boundAssistantContext(messages, limits);
  return convertToModelMessages(bounded.map(({ id: _id, ...message }) => message));
}

/** Create Vercel AI SDK model history from persisted plain-text chat messages. */
export async function textHistoryToModelMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxCharacters = defaultLimits.maxCharacters,
): Promise<ModelMessage[]> {
  const bounded = [...messages];
  let size = JSON.stringify(bounded).length;
  while (size > maxCharacters && bounded.length > 1) {
    bounded.shift();
    size = JSON.stringify(bounded).length;
  }
  return convertToModelMessages(bounded.map((message, index) => ({
    id: `history-${index}`,
    role: message.role,
    parts: [{ type: 'text' as const, text: message.content }],
  })));
}

/** Serialize UI parts for persistence or a text-based remote tool bridge. */
export function serializeAssistantParts(parts: UIMessage['parts'], maxCharacters: number): string {
  const serialized = JSON.stringify(parts);
  return serialized.length <= maxCharacters
    ? serialized
    : JSON.stringify([{ type: 'text', text: '[Older tool transcript omitted from model context because it exceeded the model limit.]' }]);
}
