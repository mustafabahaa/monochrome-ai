# Monochrome AI Core

Shared AI infrastructure for Monochrome applications. It provides the Vercel AI SDK seams and safe Codex Harness execution; applications provide the product tools and data rules.

## New app boundary

Use `@monochrome-ui/design-system` for the assistant transcript and composer (`AssistantChat`). Use `@monochrome-ai/core/chat` for Vercel model invocation, message conversion, context limits, shared stream events, and stream-to-UI conversion. Use `@monochrome-ai/core` on trusted server code for Codex Harness execution and credential/security helpers.

An app should implement only the product-specific parts:

- Its MCP servers and tool definitions/execution.
- Its system instructions and the data those tools may read or change.
- Its provider configuration, user authorization, confirmation policy, and persistence.
- Its app-specific rendering for tool results, charts, and approval content passed into `AssistantChat`.

Do not create another assistant transcript/composer, Vercel model-message converter, stream event protocol, or Harness process runner in an app. The shared chat entry is browser-safe; the package root includes Node-only functionality and belongs on trusted server code.

## Shared APIs

- `AssistantChat` from `@monochrome-ui/design-system`: common transcript, composer, scrolling, and message layout. Apps pass message content and app-specific slots.
- `streamAssistantText`, `toAssistantModelMessages`, `textHistoryToModelMessages`, and `boundAssistantContext` from `@monochrome-ai/core/chat`: common Vercel AI SDK invocation and bounded message conversion.
- `assistantEventsToUIMessageStream` and `assistantTextToUIMessageStream` from `@monochrome-ai/core/chat`: standard conversion to the Vercel AI SDK UI stream format.
- `runCodexHarness` from `@monochrome-ai/core`: common isolated Codex/Harness execution. The app passes its own tools and policy callbacks.
- OAuth, opaque-token, and encrypted-credential helpers from `@monochrome-ai/core`: common security mechanics; identity and authorization decisions remain app-owned.

The runtime requires the host application to provide `@ai-sdk/harness`, `@ai-sdk/harness-codex`, `@openai/codex`, `ai`, and `ws` as peer dependencies. Call server helpers only after the app has checked identity, authorization, and rate limits.

```sh
npm install
npm test
```

Node.js 20 or newer is required. Consumers must provide a 32-byte encryption key for credential encryption.
