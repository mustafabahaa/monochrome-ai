/*
 * Local-only probe adapter. This provides a HarnessV1NetworkSandboxSession
 * shape for smoke testing; it is not a security boundary or a production
 * sandbox. Commands run as the current user inside a temporary directory.
 */

import { randomUUID } from 'node:crypto';
import { spawn as spawnProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile as readFileFs, realpath, rm, writeFile as writeFileFs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const decoder = new TextDecoder();

export async function createLocalProbeSandbox({ port, baseEnvironment = {} } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'monochrome-codex-harness-')));
  const home = path.join(root, 'home');
  await mkdir(path.join(home, '.ai-sdk-harness'), { recursive: true });
  const exposedPorts = port == null ? [] : [validatePort(port)];
  const processes = new Set();
  let stopped = false;
  let destroyed = false;

  const resolvePath = async (input, { mustExist = false } = {}) => {
    if (typeof input !== 'string' || input.length === 0) throw new Error('Sandbox path must be a non-empty string');
    const candidate = path.resolve(root, input);
    if (!isInside(root, candidate)) throw new Error('Sandbox path escapes the temporary root');
    if (candidate === root) return candidate;
    if (mustExist) {
      const actual = await realpath(candidate);
      if (!isInside(root, actual)) throw new Error('Sandbox path escapes the temporary root');
      return actual;
    }
    let parentCandidate = path.dirname(candidate);
    let parent;
    for (;;) {
      try {
        parent = await realpath(parentCandidate);
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT' || parentCandidate === root) throw error;
        parentCandidate = path.dirname(parentCandidate);
      }
    }
    if (!isInside(root, parent)) throw new Error('Sandbox path escapes the temporary root');
    return candidate;
  };

  const commandEnvironment = (env) => ({
    PATH: baseEnvironment.PATH ?? process.env.PATH ?? '/usr/bin:/bin',
    LANG: baseEnvironment.LANG ?? 'C.UTF-8',
    ...baseEnvironment,
    ...env,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: path.join(root, 'tmp'),
  });

  const spawn = async ({ command, workingDirectory, env, abortSignal }) => {
    if (stopped || destroyed) throw new Error('Sandbox session is stopped');
    abortSignal?.throwIfAborted();
    const cwd = await resolvePath(workingDirectory ?? root);
    const child = spawnProcess(command, {
      cwd,
      env: commandEnvironment(env),
      shell: '/bin/sh',
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { child, kill: null };
    processes.add(record);
    const remove = () => processes.delete(record);
    child.once('close', remove);
    child.once('error', remove);
    const kill = async () => {
      if (child.exitCode !== null || child.signalCode !== null || child.killed) {
        remove();
        return;
      }
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      }
      remove();
    };
    record.kill = kill;
    let abortHandler;
    if (abortSignal) {
      abortHandler = () => {
        void kill();
      };
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
    const waitPromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, signal) =>
        resolve({ exitCode: typeof exitCode === 'number' ? exitCode : 128 + signalNumber(signal) }),
      );
    }).finally(() => {
      if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);
      remove();
    });
    const wait = () => waitPromise;
    return {
      pid: child.pid,
      stdout: nodeStream(child.stdout),
      stderr: nodeStream(child.stderr),
      wait,
      kill,
    };
  };

  const session = {
    id: randomUUID(),
    defaultWorkingDirectory: root,
    ports: exposedPorts,
    description: 'Local probe sandbox (temporary directory; no process or network isolation).',
    getPortEndpoint: async ({ port: requestedPort, protocol = 'http' }) => {
      const checkedPort = validatePort(requestedPort);
      if (!exposedPorts.includes(checkedPort)) throw new Error(`Port ${checkedPort} is not exposed`);
      if (!['http', 'https', 'ws'].includes(protocol)) throw new Error(`Unsupported protocol: ${protocol}`);
      return { url: `${protocol}://localhost:${checkedPort}` };
    },
    getPortUrl: async (options) => (await session.getPortEndpoint(options)).url,
    spawn,
    run: async (options) => {
      const processHandle = await spawn(options);
      const [stdout, stderr, result] = await Promise.all([
        readStream(processHandle.stdout),
        readStream(processHandle.stderr),
        processHandle.wait(),
      ]);
      return { ...result, stdout, stderr };
    },
    readFile: async ({ path: filePath, abortSignal }) => {
      const bytes = await session.readBinaryFile({ path: filePath, abortSignal });
      return bytes === null ? null : bytesToStream(bytes);
    },
    readBinaryFile: async ({ path: filePath, abortSignal }) => {
      abortSignal?.throwIfAborted();
      try {
        return new Uint8Array(await readFileFs(await resolvePath(filePath, { mustExist: true })));
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },
    readTextFile: async ({ path: filePath, encoding = 'utf-8', startLine, endLine, abortSignal }) => {
      const bytes = await session.readBinaryFile({ path: filePath, abortSignal });
      if (bytes === null) return null;
      const lines = Buffer.from(bytes).toString(encoding).split(/\r?\n/);
      return lines.slice((startLine ?? 1) - 1, endLine ?? lines.length).join('\n');
    },
    writeFile: async ({ path: filePath, content, abortSignal }) =>
      session.writeBinaryFile({ path: filePath, content: await readBytes(content), abortSignal }),
    writeBinaryFile: async ({ path: filePath, content, abortSignal }) => {
      abortSignal?.throwIfAborted();
      const target = await resolvePath(filePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFileFs(target, content);
    },
    writeTextFile: async ({ path: filePath, content, encoding = 'utf-8', abortSignal }) =>
      session.writeBinaryFile({ path: filePath, content: new Uint8Array(Buffer.from(content, encoding)), abortSignal }),
    restricted: () => {
      const { id, defaultWorkingDirectory, ports, getPortEndpoint, getPortUrl, stop, destroy, restricted, ...sandbox } =
        session;
      return sandbox;
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await Promise.all([...processes].map((record) => record.kill()));
    },
    destroy: async () => {
      if (destroyed) return;
      await session.stop();
      destroyed = true;
      await rm(root, { recursive: true, force: true });
    },
  };
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  return session;
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535');
  return port;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function nodeStream(stream) {
  return ReadableStream.from
    ? ReadableStream.from(stream)
    : new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
          stream.once('end', () => controller.close());
          stream.once('error', (error) => controller.error(error));
        },
      });
}

async function readStream(stream) {
  return decoder.decode(await readBytes(stream));
}

async function readBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function bytesToStream(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
function signalNumber(signal) {
  return signal === 'SIGTERM' ? 15 : signal === 'SIGKILL' ? 9 : 1;
}
