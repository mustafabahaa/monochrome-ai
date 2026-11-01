"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarnessRuntimeError = void 0;
exports.runCodexHarness = runCodexHarness;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
class HarnessRuntimeError extends Error {
    stage;
    code;
    constructor(message, stage = 'runtime', code) {
        super(message);
        this.name = 'HarnessRuntimeError';
        this.stage = stage;
        this.code = code;
    }
}
exports.HarnessRuntimeError = HarnessRuntimeError;
/**
 * Runs the shared Vercel AI SDK Harness/Codex process while leaving identity,
 * tool definitions, MCP servers, tool execution, and product policy to the app.
 */
async function runCodexHarness(request) {
    if (!request.model || !request.system || !Array.isArray(request.tools))
        throw new Error('Invalid harness request');
    request.signal?.throwIfAborted();
    const lifetime = new AbortController();
    const signal = request.signal ? AbortSignal.any([lifetime.signal, request.signal]) : lifetime.signal;
    const home = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'monochrome-ai-'));
    await (0, promises_1.chmod)(home, 0o700);
    const authPath = (0, node_path_1.join)(home, 'auth.json');
    let child;
    let timer;
    let queue = Promise.resolve();
    let output = '';
    let completed = false;
    let failure;
    let toolCallCount = 0;
    const stop = () => child?.kill('SIGTERM');
    try {
        await (0, promises_1.writeFile)(authPath, JSON.stringify(request.credential), { mode: 0o600 });
        child = (0, node_child_process_1.fork)((0, node_path_1.join)(__dirname, 'harness/runner.mjs'), [], {
            env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, CODEX_HOME: home },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        const worker = child;
        const exit = new Promise((resolve, reject) => {
            worker.once('error', reject);
            worker.once('exit', resolve);
        });
        signal.addEventListener('abort', stop, { once: true });
        timer = setTimeout(() => {
            failure = new HarnessRuntimeError('AI request timed out', 'timeout');
            lifetime.abort();
        }, request.timeoutMs ?? 210_000);
        worker.on('message', (raw) => {
            const message = raw && typeof raw === 'object' ? raw : {};
            queue = queue.then(async () => {
                if (message.type === 'text' && typeof message.text === 'string') {
                    output += message.text;
                    if (output.length > (request.maxOutputCharacters ?? 200_000))
                        throw new HarnessRuntimeError('AI response too large', 'stream');
                    await request.onText?.(message.text);
                }
                if (message.type === 'error')
                    failure = new HarnessRuntimeError(message.message || 'Harness failed', message.stage, message.code);
                if (message.type === 'done')
                    completed = true;
                if (message.type === 'tool-call') {
                    toolCallCount += 1;
                    if (toolCallCount > (request.maxToolCalls ?? 12))
                        throw new HarnessRuntimeError('AI tool-call limit reached for this turn', 'tools');
                    if (!message.id || !message.name || !request.tools.some((tool) => tool.name === message.name) || !request.onTool)
                        throw new HarnessRuntimeError('Unknown AI tool', 'tools');
                    const result = await request.onTool({ id: message.id, name: message.name, input: message.input }, signal);
                    if (worker.connected)
                        worker.send({ type: 'tool-result', id: message.id, ...result });
                }
            }).catch((error) => {
                failure = error;
                stop();
            });
        });
        request.signal?.throwIfAborted();
        worker.send({
            type: 'start',
            model: request.model,
            system: request.system,
            prompt: request.prompt,
            tools: request.tools,
            toolPolicy: request.toolPolicy,
        });
        const code = await exit;
        lifetime.abort();
        await queue;
        request.signal?.throwIfAborted();
        if (failure)
            throw failure;
        if (!completed || code !== 0)
            throw new HarnessRuntimeError('Harness process did not complete successfully', 'exit');
        if (!output.trim())
            throw new HarnessRuntimeError('Harness returned an empty response', 'stream');
        return output;
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        lifetime.abort();
        stop();
        try {
            await request.saveCredential(JSON.parse(await (0, promises_1.readFile)(authPath, 'utf8')));
        }
        finally {
            await (0, promises_1.rm)(home, { recursive: true, force: true });
        }
    }
}
