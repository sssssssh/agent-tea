# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

agent-tea is a TypeScript AI agent framework implementing the ReAct (Reasoning + Acting) pattern. It provides a vendor-agnostic agent loop that orchestrates LLM ↔ Tool interactions with streaming-first, type-safe design.

## Commands

```bash
pnpm install              # Install dependencies
pnpm build                # Build all packages (tsup)
pnpm test                 # Run all tests (vitest, single run)
pnpm test:watch           # Run tests in watch mode
pnpm typecheck            # Type check all packages (tsc --noEmit)

# Run a single test file
pnpm vitest run packages/core/src/agent/agent.test.ts

# Run examples (requires .env with API keys)
pnpm example              # Basic agent demo
pnpm example:subagent     # Multi-agent demo
```

## Architecture

### Monorepo Structure (pnpm workspaces)

```
packages/
  core/                 # Framework core — agent loop, tool system, LLM interfaces
  sdk/                  # High-level API — Extension, Skill, SubAgent abstractions
  provider-openai/      # OpenAI adapter
  provider-anthropic/   # Anthropic Claude adapter
  provider-gemini/      # Google Gemini adapter
examples/               # Usage examples
```

### Core Concepts

**Three-layer architecture**: Core (framework) → Provider (LLM adapters) → SDK (developer API)

**Provider + ChatSession pattern**: `LLMProvider` is a factory that creates `ChatSession` instances. One provider, many sessions with different configs. Each session's `sendMessage()` returns `AsyncGenerator<ChatStreamEvent>`.

**Agent loop** (`packages/core/src/agent/agent.ts`): The central ReAct loop — sends messages to LLM, executes requested tools, feeds results back, repeats until LLM responds with text only or hits max iterations (default 20).

**Tool system**: Tools are defined with Zod schemas for parameters. `ToolRegistry` stores tools and converts Zod→JSON Schema for LLM consumption. `ToolExecutor` validates inputs against Zod before execution.

**Event stream**: `Agent.run()` yields `AgentEvent` via AsyncGenerator — enables real-time UI without blocking. Event types: `agent_start`, `message`, `tool_request`, `tool_response`, `usage`, `error`, `agent_end`.

**SDK abstractions** (`packages/sdk/`):
- `Extension` — reusable capability packages (bundled tools + instructions)
- `Skill` — task-specific prompts + tools with trigger conditions
- `SubAgent` — wraps an Agent as a Tool for multi-agent coordination

### Key Design Decisions

- **Zod as single source of truth**: Zod schemas drive both TypeScript type inference and runtime validation for tool parameters.
- **ESM only**: All packages output ESM (`format: ['esm']`), target ES2022.
- **Streaming-first**: All LLM communication uses async generators; no blocking request/response pattern.
- **Error hierarchy**: `AgentTeaError` → `ProviderError` / `ToolExecutionError` / `ToolValidationError` / `MaxIterationsError`.

## Conventions

- Source code comments are in Chinese; code identifiers and APIs are in English.
- Node.js >= 20.0.0 required.
- Each package builds with `tsup` and type-checks with `tsc --noEmit`.
- Tests use Vitest with `globals: true`. Test pattern: mock LLM providers with pre-scripted response sequences.
