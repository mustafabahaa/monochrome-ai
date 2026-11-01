import { fork, type ChildProcess } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type HarnessTool = { name: string; description: string; schema: object };
export type HarnessToolResult = { result?: unknown; error?: boolean };
export type HarnessToolCall = { id: string; name: string; input: unknown };

/** App-neutral tool capability policy. Tool definitions and execution remain app-owned. */
export type HarnessToolPolicy = { activeTools?: string[]; inactiveTools?: string[] };

export type CodexHarnessRequest = {
  credential: Record<string, unknown>;
  saveCredential: (credential: Record<string, unknown>) => Promise<void>;
  model: string;
  system: string;
  prompt: string | Array<unknown> | { role: 'user'; content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> };
  tools: HarnessTool[];
  toolPolicy?: HarnessToolPolicy;
  onText?: (text: string) => Promise<void> | void;
  onTool?: (call: HarnessToolCall, signal: AbortSignal) => Promise<HarnessToolResult>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputCharacters?: number;
  maxToolCalls?: number;
};

export class HarnessRuntimeError extends Error {
  readonly stage: string;
  readonly code?: string;
  constructor(message: string, stage = 'runtime', code?: string) {
    super(message);
    this.name = 'HarnessRuntimeError';
    this.stage = stage;
    this.code = code;
  }
}

type RunnerMessage = { type?: string; text?: string; message?: string; stage?: string; code?: string; id?: string; name?: string; input?: unknown };

/**
 * Runs the shared Vercel AI SDK Harness/Codex process while leaving identity,
 * tool definitions, MCP servers, tool execution, and product policy to the app.
 */
export async function runCodexHarness(request: CodexHarnessRequest): Promise<string> {
  if (!request.model || !request.system || !Array.isArray(request.tools)) throw new Error('Invalid harness request');
  request.signal?.throwIfAborted();

  const lifetime = new AbortController();
  const signal = request.signal ? AbortSignal.any([lifetime.signal, request.signal]) : lifetime.signal;
  const home = await mkdtemp(join(tmpdir(), 'monochrome-ai-'));
  await chmod(home, 0o700);
  const authPath = join(home, 'auth.json');
  let child: ChildProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let output = '';
  let completed = false;
  let failure: unknown;
  let toolCallCount = 0;
  const stop = () => child?.kill('SIGTERM');

  try {
    await writeFile(authPath, JSON.stringify(request.credential), { mode: 0o600 });
    child = fork(join(__dirname, 'harness/runner.mjs'), [], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, CODEX_HOME: home },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const worker = child;
    const exit = new Promise<number | null>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', resolve);
    });
    signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => {
      failure = new HarnessRuntimeError('AI request timed out', 'timeout');
      lifetime.abort();
    }, request.timeoutMs ?? 210_000);
    worker.on('message', (raw: unknown) => {
      const message = raw && typeof raw === 'object' ? raw as RunnerMessage : {};
      queue = queue.then(async () => {
        if (message.type === 'text' && typeof message.text === 'string') {
          output += message.text;
          if (output.length > (request.maxOutputCharacters ?? 200_000)) throw new HarnessRuntimeError('AI response too large', 'stream');
          await request.onText?.(message.text);
        }
        if (message.type === 'error') failure = new HarnessRuntimeError(message.message || 'Harness failed', message.stage, message.code);
        if (message.type === 'done') completed = true;
        if (message.type === 'tool-call') {
          toolCallCount += 1;
          if (toolCallCount > (request.maxToolCalls ?? 12)) throw new HarnessRuntimeError('AI tool-call limit reached for this turn', 'tools');
          if (!message.id || !message.name || !request.tools.some((tool) => tool.name === message.name) || !request.onTool)
            throw new HarnessRuntimeError('Unknown AI tool', 'tools');
          const result = await request.onTool({ id: message.id, name: message.name, input: message.input }, signal);
          if (worker.connected) worker.send({ type: 'tool-result', id: message.id, ...result });
        }
      }).catch((error: unknown) => {
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
    if (failure) throw failure;
    if (!completed || code !== 0) throw new HarnessRuntimeError('Harness process did not complete successfully', 'exit');
    if (!output.trim()) throw new HarnessRuntimeError('Harness returned an empty response', 'stream');
    return output;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    lifetime.abort();
    stop();
    try {
      await request.saveCredential(JSON.parse(await readFile(authPath, 'utf8')) as Record<string, unknown>);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
}
