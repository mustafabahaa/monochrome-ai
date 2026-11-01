import { cp, mkdir, rm } from 'node:fs/promises';

const target = new URL('../dist/harness/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(new URL('../runtime/runner.mjs', import.meta.url), new URL('runner.mjs', target));
await cp(new URL('../runtime/local-sandbox.mjs', import.meta.url), new URL('local-sandbox.mjs', target));
