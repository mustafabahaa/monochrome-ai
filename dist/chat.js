"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.boundAssistantContext = boundAssistantContext;
exports.toAssistantModelMessages = toAssistantModelMessages;
exports.textHistoryToModelMessages = textHistoryToModelMessages;
exports.serializeAssistantParts = serializeAssistantParts;
const ai_1 = require("ai");
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
    const bounded = [...messages];
    let size = JSON.stringify(bounded).length;
    while (size > maxCharacters && bounded.length > 1) {
        bounded.shift();
        size = JSON.stringify(bounded).length;
    }
    return (0, ai_1.convertToModelMessages)(bounded.map((message, index) => ({
        id: `history-${index}`,
        role: message.role,
        parts: [{ type: 'text', text: message.content }],
    })));
}
/** Serialize UI parts for persistence or a text-based remote tool bridge. */
function serializeAssistantParts(parts, maxCharacters) {
    const serialized = JSON.stringify(parts);
    return serialized.length <= maxCharacters
        ? serialized
        : JSON.stringify([{ type: 'text', text: '[Older tool transcript omitted from model context because it exceeded the model limit.]' }]);
}
