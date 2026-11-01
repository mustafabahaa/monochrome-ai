"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamAssistantText = streamAssistantText;
exports.assistantTextToUIMessageStream = assistantTextToUIMessageStream;
exports.boundAssistantContext = boundAssistantContext;
exports.toAssistantModelMessages = toAssistantModelMessages;
exports.textHistoryToModelMessages = textHistoryToModelMessages;
exports.boundAssistantTextHistory = boundAssistantTextHistory;
exports.serializeAssistantParts = serializeAssistantParts;
exports.assistantEventsToUIMessageStream = assistantEventsToUIMessageStream;
const ai_1 = require("ai");
/** One shared Vercel AI SDK invocation seam; providers and tool registries stay app-owned. */
function streamAssistantText(options) {
    return (0, ai_1.streamText)(options);
}
/** Convert Vercel's text/tool stream into the UI message stream used by useChat. */
function assistantTextToUIMessageStream(stream, onError) {
    return (0, ai_1.toUIMessageStream)({ stream, ...(onError ? { onError } : {}) });
}
const defaultLimits = {
    maxMessages: 50,
    maxCharacters: 180_000,
    maxMessageCharacters: 48_000,
    maxToolResultCharacters: 4_000,
};
/** Bound Vercel UI message history while preserving valid tool-call/result parts. */
function boundAssistantContext(messages, limits = {}) {
    const resolved = { ...defaultLimits, ...limits };
    const bounded = messages.slice(-resolved.maxMessages).map((message) => ({
        ...message,
        parts: message.parts.map((part) => {
            if (part.type === 'text' && part.text.length > resolved.maxMessageCharacters) {
                return { ...part, text: '[Message text omitted from older context because it exceeded the model limit.]' };
            }
            const candidate = part;
            if (candidate.output === undefined && candidate.result === undefined)
                return part;
            const key = candidate.output !== undefined ? 'output' : 'result';
            const value = JSON.stringify(candidate[key]);
            if (typeof value !== 'string' || value.length <= resolved.maxToolResultCharacters)
                return part;
            return { ...part, [key]: '[Tool result omitted from model context; use the tool again if needed.]' };
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
async function toAssistantModelMessages(messages, limits) {
    const bounded = boundAssistantContext(messages, limits);
    return (0, ai_1.convertToModelMessages)(bounded.map(({ id: _id, ...message }) => message));
}
/** Create Vercel AI SDK model history from persisted plain-text chat messages. */
async function textHistoryToModelMessages(messages, maxCharacters = defaultLimits.maxCharacters) {
    const bounded = boundAssistantTextHistory(messages, maxCharacters);
    return (0, ai_1.convertToModelMessages)(bounded.map((message, index) => ({
        id: `history-${index}`,
        role: message.role,
        parts: [{ type: 'text', text: message.content }],
    })));
}
/** Keep the newest plain-text conversation turns that fit a character budget. */
function boundAssistantTextHistory(messages, maxCharacters = defaultLimits.maxCharacters) {
    const bounded = [...messages];
    let size = JSON.stringify(bounded).length;
    while (size > maxCharacters && bounded.length > 1) {
        bounded.shift();
        size = JSON.stringify(bounded).length;
    }
    return bounded;
}
/** Serialize UI parts for persistence or a text-based remote tool bridge. */
function serializeAssistantParts(parts, maxCharacters) {
    const serialized = JSON.stringify(parts);
    return serialized.length <= maxCharacters
        ? serialized
        : JSON.stringify([{ type: 'text', text: '[Older tool transcript omitted from model context because it exceeded the model limit.]' }]);
}
/** Convert the shared app-neutral event protocol into Vercel AI SDK UI stream chunks. */
function assistantEventsToUIMessageStream(events, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted)
        abort();
    return new ReadableStream({
        async start(stream) {
            let textId;
            const endText = () => {
                if (textId)
                    stream.enqueue({ type: 'text-end', id: textId });
                textId = undefined;
            };
            try {
                stream.enqueue({ type: 'start', messageId: crypto.randomUUID() });
                stream.enqueue({ type: 'start-step' });
                for await (const event of events) {
                    controller.signal.throwIfAborted();
                    if (event.type === 'text') {
                        if (!textId) {
                            textId = crypto.randomUUID();
                            stream.enqueue({ type: 'text-start', id: textId });
                        }
                        stream.enqueue({ type: 'text-delta', id: textId, delta: event.text });
                    }
                    else if (event.type === 'tool-call') {
                        endText();
                        stream.enqueue({ type: 'tool-input-available', toolCallId: event.id, toolName: event.name, input: event.input });
                        try {
                            if (!options.onToolCall)
                                throw new Error(`No handler is registered for ${event.name}`);
                            const output = await options.onToolCall(event);
                            stream.enqueue({ type: 'tool-output-available', toolCallId: event.id, output: output ?? null });
                        }
                        catch (error) {
                            stream.enqueue({
                                type: 'tool-output-error',
                                toolCallId: event.id,
                                errorText: error instanceof Error ? error.message : 'The tool could not be completed.',
                            });
                        }
                    }
                    else if (event.type === 'error') {
                        throw new Error(event.message);
                    }
                }
                endText();
                stream.enqueue({ type: 'finish-step' });
                stream.enqueue({ type: 'finish', finishReason: 'stop' });
                stream.close();
            }
            catch (error) {
                stream.error(error);
            }
            finally {
                controller.abort();
                options.signal?.removeEventListener('abort', abort);
            }
        },
        cancel() {
            controller.abort();
        },
    });
}
