export type HarnessTool = {
    name: string;
    description: string;
    schema: object;
};
export type HarnessToolResult = {
    result?: unknown;
    error?: boolean;
};
export type HarnessToolCall = {
    id: string;
    name: string;
    input: unknown;
};
/** App-neutral tool capability policy. Tool definitions and execution remain app-owned. */
export type HarnessToolPolicy = {
    activeTools?: string[];
    inactiveTools?: string[];
};
export type CodexHarnessRequest = {
    credential: Record<string, unknown>;
    saveCredential: (credential: Record<string, unknown>) => Promise<void>;
    model: string;
    system: string;
    prompt: string | Array<unknown> | {
        role: 'user';
        content: Array<{
            type: 'text';
            text: string;
        } | {
            type: 'image';
            image: string;
        }>;
    };
    tools: HarnessTool[];
    toolPolicy?: HarnessToolPolicy;
    onText?: (text: string) => Promise<void> | void;
    onTool?: (call: HarnessToolCall, signal: AbortSignal) => Promise<HarnessToolResult>;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxOutputCharacters?: number;
    maxToolCalls?: number;
};
export declare class HarnessRuntimeError extends Error {
    readonly stage: string;
    readonly code?: string;
    constructor(message: string, stage?: string, code?: string);
}
/**
 * Runs the shared Vercel AI SDK Harness/Codex process while leaving identity,
 * tool definitions, MCP servers, tool execution, and product policy to the app.
 */
export declare function runCodexHarness(request: CodexHarnessRequest): Promise<string>;
