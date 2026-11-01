# Monochrome AI Core

App-neutral AI runtime and security primitives shared by Monochrome applications.

The package centralizes Vercel AI SDK Harness/Codex process setup and security primitives. It deliberately does not own product behavior: each app retains its MCP servers, tool definitions and implementations, tool permissions, OAuth scopes, resource URLs, Firebase identity checks, storage collections, and user-facing errors. Apps pass their tool schemas and execution callbacks to the shared runtime.

Included primitives: runCodexHarness for isolated Vercel AI SDK Harness execution; SHA-256 identifiers and opaque token generation; safe OAuth redirect and HTTPS-origin validation; scope normalization and public client metadata; AES-256-GCM JSON credential encryption with identity-bound associated data.

The runtime requires the host application to provide @ai-sdk/harness, @ai-sdk/harness-codex, @openai/codex, ai, and ws as peer dependencies. Apps should call it only after their own identity, authorization, and rate-limit checks have passed.

```sh
npm install
npm test
```

Node.js 20 or newer is required. Consumers must provide a 32-byte encryption key for credential encryption.
