// Shared Vercel AI SDK Harness runner. Applications provide tools and policies
// over IPC; this process owns only Codex/Harness setup and stream transport.
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createCodex } from '@ai-sdk/harness-codex';
import { jsonSchema } from 'ai';
import { createLocalProbeSandbox } from './local-sandbox.mjs';

const require = createRequire(import.meta.url);
const entry = require.resolve('@ai-sdk/harness-codex');
const packageDir = dirname(dirname(entry));
const wsDir = dirname(require.resolve('ws/package.json'));
const codexDir = dirname(require.resolve('@openai/codex/package.json'));
const pending = new Map();
let started = false;
let activeSandbox;
let activeSession;
let stopping = false;

process.on('SIGTERM', () => {
  if (stopping) return;
  stopping = true;
  void (async () => {
    await activeSession?.destroy?.().catch(() => {});
    await activeSandbox?.destroy?.().catch(() => {});
    process.exit(1);
  })();
});

process.on('message', async (message) => {
  if (message?.type === 'tool-result') {
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      message.error ? waiter.reject(new Error('Client tool failed')) : waiter.resolve(message.result);
    }
    return;
  }
  if (message?.type !== 'start' || started) return;
  started = true;
  let sandbox;
  let session;
  let stage = 'bootstrap';
  try {
    const [bridgePackage, bridgeFile] = await Promise.all([
      readFile(join(packageDir, 'dist/bridge/package.json'), 'utf8'),
      readFile(join(packageDir, 'dist/bridge/index.mjs'), 'utf8'),
    ]);
    const bridge = bridgeFile.replace('host: "0.0.0.0"', 'host: "127.0.0.1"');
    const port = await freePort();
    sandbox = await createLocalProbeSandbox({ port });
    activeSandbox = sandbox;
    stage = 'agent';
    const native = createCodex({
      auth: 'direct',
      startupTimeoutMs: 45000,
      reasoningEffort: 'medium',
      codexConfig: { cli_auth_credentials_store: 'file' },
    });
    const harness = {
      ...native,
      async getBootstrap() {
        const bootstrapDir = '.harness-bootstrap/codex';
        return {
          harnessId: 'codex',
          bootstrapDir,
          files: [
            { path: `${bootstrapDir}/package.json`, content: bridgePackage },
            { path: `${bootstrapDir}/bridge.mjs`, content: bridge },
          ],
          commands: [
            { command: `mkdir -p node_modules/@openai && ln -s ${shellQuote(wsDir)} node_modules/ws && ln -s ${shellQuote(codexDir)} node_modules/@openai/codex` },
          ],
        };
      },
    };
    const tools = Object.fromEntries(
      (message.tools ?? []).map((definition) => [
        definition.name,
        {
          description: definition.description,
          inputSchema: jsonSchema(definition.schema),
          execute: (input) => new Promise((resolve, reject) => {
            const id = randomUUID();
            pending.set(id, { resolve, reject });
            process.send?.({ type: 'tool-call', id, name: definition.name, input });
          }),
        },
      ]),
    );
    const policy = message.toolPolicy ?? { activeTools: Object.keys(tools) };
    const agent = new HarnessAgent({
      harness,
      model: message.model,
      permissionMode: 'allow-all',
      ...policy,
      instructions: message.system,
      tools,
    });
    stage = 'session';
    session = await agent.createSession({ sandboxSession: sandbox, abortSignal: AbortSignal.timeout(120000) });
    activeSession = session;
    stage = 'stream';
    const prompt = typeof message.prompt === 'string'
      ? message.prompt
      : Array.isArray(message.prompt) ? message.prompt : [message.prompt];
    const result = await agent.stream({ session, prompt, abortSignal: AbortSignal.timeout(180000) });
    for await (const part of result.stream) {
      if (part.type === 'text-delta') process.send?.({ type: 'text', text: part.text });
      if (part.type === 'error' || part.type === 'tool-error') throw part.error;
    }
    process.send?.({ type: 'done' });
  } catch (error) {
    process.send?.({
      type: 'error',
      stage,
      name: error?.name ?? 'Error',
      code: error?.code,
      message: String(error?.message ?? error ?? 'Unknown harness error').slice(0, 400),
    });
  } finally {
    for (const waiter of pending.values()) waiter.reject(new Error('Request ended'));
    await session?.destroy?.().catch(() => {});
    await sandbox?.destroy?.().catch(() => {});
    process.disconnect?.();
  }
});

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
