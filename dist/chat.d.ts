import { type ModelMessage, type UIMessage, type UIMessageChunk } from 'ai';
export type AssistantStreamEvent = {
    type: 'text';
    text: string;
} | {
    type: 'tool-call';
    id: string;
    name: string;
    input: unknown;
} | {
    type: 'tool-result';
    id: string;
    result?: unknown;
    error?: boolean;
} | {
    type: 'approval';
    id: string;
    name: string;
    description: string;
    input: unknown;
} | {
    type: 'done';
} | {
    type: 'error';
    code?: string;
    message: string;
};
export type AssistantToolCallHandler = (call: Extract<AssistantStreamEvent, {
    type: 'tool-call';
}>) => Promise<unknown>;
export type AssistantContextLimits = {
    maxMessages?: number;
    maxCharacters?: number;
    maxMessageCharacters?: number;
    maxToolResultCharacters?: number;
};
/** Bound Vercel UI message history while preserving valid tool-call/result parts. */
export declare function boundAssistantContext(messages: UIMessage[], limits?: AssistantContextLimits): UIMessage[];
/** Convert Vercel AI SDK UI messages into model messages with one shared path. */
export declare function toAssistantModelMessages(messages: UIMessage[], limits?: AssistantContextLimits): Promise<ModelMessage[]>;
/** Create Vercel AI SDK model history from persisted plain-text chat messages. */
export declare function textHistoryToModelMessages(messages: Array<{
    role: 'user' | 'assistant';
    content: string;
}>, maxCharacters?: number): Promise<ModelMessage[]>;
/** Keep the newest plain-text conversation turns that fit a character budget. */
export declare function boundAssistantTextHistory<T extends {
    role: 'user' | 'assistant';
    content: string;
}>(messages: T[], maxCharacters?: number): T[];
/** Serialize UI parts for persistence or a text-based remote tool bridge. */
export declare function serializeAssistantParts(parts: UIMessage['parts'], maxCharacters: number): string;
/** Convert the shared app-neutral event protocol into Vercel AI SDK UI stream chunks. */
export declare function assistantEventsToUIMessageStream(events: AsyncIterable<AssistantStreamEvent>, options?: {
    signal?: AbortSignal;
    onToolCall?: AssistantToolCallHandler;
}): ReadableStream<UIMessageChunk>;
