# Agent-First Development (AFD) - Executive Summary

*A comprehensive technical overview of what AFD is, what it does, and how it works.*

---

## What AFD Is

**Agent-First Development** is a software development methodology that inverts the traditional build order. Instead of designing a UI and then exposing it via an API for programmatic access, AFD establishes a **command layer** as the single source of truth for all application capabilities. UI is built last, and only as one of many interchangeable "surfaces."

```
Traditional:  UI → API → Agent Access (afterthought)
AFD:          Commands → CLI Validation → UI (optional surface)
```

**The central idea**: Commands *are* the application. A web UI, a CLI, a Figma plugin, or an AI agent are all just different ways to invoke those commands.

---

## The Problem It Solves

Traditional applications are optimized for human senses—visual layouts, mouse clicks, immediate feedback. This creates what AFD calls **inverted accessibility**: apps that are perfectly usable by humans but nearly opaque to machines.

### The Integration Tax

Organizations that want to add AI agents to existing systems face significant costs:

| Cost                              | Typical Investment                    |
| --------------------------------- | ------------------------------------- |
| Reverse-engineering UI flows      | 4-8 weeks                             |
| Building an automation layer      | 4-6 weeks                             |
| Error handling and recovery       | 2-4 weeks                             |
| Ongoing maintenance               | 20-40% of original effort *annually* |
| **Total (first year, medium app)** | **4-6 engineer-months**               |

AFD eliminates this tax. Because capabilities are programmatically accessible by design, adding a new agent surface is a configuration exercise, not a multi-month project.

---

## Core Principles

| # | Principle               | Description                                                                                                |
|---|-------------------------|------------------------------------------------------------------------------------------------------------|
| 1 | **Command-First**       | All functionality is exposed as commands with well-defined schemas *before* any UI is built.              |
| 2 | **CLI Validation**      | Commands must be testable via CLI. If a feature can't be tested without a browser, the architecture is wrong. |
| 3 | **The Honesty Check**   | *"If it can't be done via CLI, the architecture is wrong."* The CLI is a quality gate.                    |
| 4 | **Dual Interface**      | The same commands power both human UIs and AI agents. They share a single registry.                       |
| 5 | **UX-Enabling Schemas** | Commands return structured metadata—confidence, reasoning, sources—that enables good agent UX.            |

---

## The Development Workflow

AFD enforces a three-step loop for every feature:

### Step 1: Define
- Create a command with a clear input/output schema (using Zod or similar).
- Register it in the command registry.
- Document all possible error codes.

### Step 2: Validate
- Test the command via CLI: `afd call <command> <args>`.
- Cover edge cases and error states.
- Add automated unit tests.
- **Do not proceed to UI until the CLI works.**

### Step 3: Surface
- Build a UI component that invokes the *exact same* command.
- The UI is a thin wrapper, not a container for business logic.

---

## The `CommandResult` Contract

Every AFD command returns a `CommandResult<T>`. This is the contract between the command layer and all consumers.

### Core Fields (Required)

```typescript
interface CommandResult<T> {
  success: boolean;    // Did the command work?
  data?: T;            // The result, if successful.
  error?: CommandError; // Error details, if failed.
}
```

### UX-Enabling Fields (Recommended)

| Field          | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `confidence`   | A 0-1 score indicating how certain the command is in its result.        |
| `reasoning`    | An explanation of *why* the command produced this result.               |
| `sources`      | References to external documents or data used.                          |
| `plan`         | A breakdown of steps for multi-step operations, with status for each.   |
| `alternatives` | Other options the command considered but did not choose.                |
| `warnings`     | Non-fatal issues the user should be aware of.                           |
| `metadata`     | Execution details: `traceId`, `durationMs`, `commandVersion`.           |

These fields enable transparency and trust. A UI can show a confidence meter, link to sources for verification, or display a step-by-step plan.

### Actionable Errors

AFD errors are designed to be *actionable*: they tell users what went wrong and what they can do about it.

```json
// ❌ Bad error
{ "code": "ERROR", "message": "Failed" }

// ✅ Good error
{
  "code": "RATE_LIMITED",
  "message": "API rate limit exceeded (100 requests/minute)",
  "suggestion": "Wait 45 seconds and try again, or upgrade to Pro tier",
  "retryable": true,
  "details": { "retryAfterSeconds": 45, "currentTier": "free" }
}
```

---

## The Implementation Roadmap

AFD prescribes a four-phase implementation plan:

| Phase                     | Duration       | Focus                                                                                  |
| ------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| **1. Foundation**         | Weeks 1-4      | Define 5-10 core commands. Set up CLI validation. Standardize error handling.         |
| **2. Expansion**          | Weeks 5-8      | Expand command coverage. Ship the MCP server. Add UX-enabling fields.                 |
| **3. Refinement**         | Weeks 9-12     | Build UI surfaces. Implement trust signals (confidence, reasoning). Add error recovery. |
| **4. Ecosystem**          | Ongoing        | Open the platform. Create extension APIs, SDKs, and marketplace.                      |

### Phase Transition Criteria

Each phase has explicit exit criteria. For example:

**Phase 1 → Phase 2** ("Honesty Check")
-   Can *every* core feature be done via CLI?

**Phase 2 → Phase 3** ("Trust Check")
-   Do AI-powered commands return `confidence` and `sources`?

---

## The Trust Framework

AFD builds **Competence Trust**—user confidence that the agent can do what it claims—through a chain of validation:

```
DEFINE (schema declares capabilities)
    ↓
VALIDATE (developer proves it works via CLI)
    ↓
TEST (automated tests verify consistency)
    ↓
SURFACE (UI invokes the proven command)
    ↓
TRUST (user experiences reliable behavior)
```

| Trust Component           | How AFD Addresses It                                      |
| ------------------------- | --------------------------------------------------------- |
| Capability Transparency   | Commands have explicit, inspectable schemas.              |
| Performance Consistency   | CLI-tested commands work the same every time.             |
| Error Handling            | Standardized error schemas with suggestions.              |
| Expertise Boundaries      | Commands fail clearly rather than hallucinate.            |

---

## What is NOT a Command

Over-commanding creates noise. AFD defines clear boundaries:

| Action                          | Command? | Reason                                         |
| ------------------------------- | -------- | ---------------------------------------------- |
| Get document list               | ✅ Yes    | Fetches data from a source.                    |
| Create document                 | ✅ Yes    | Has side effects.                              |
| Sort documents locally          | ❌ No     | Client-side operation, no data fetch.          |
| Set sort preference (persisted) | ✅ Yes    | Persists user preference.                      |
| Show tooltip on hover           | ❌ No     | Ephemeral UI state.                            |
| Calculate order total           | ❌ No     | Derived from existing data.                    |

**Rule of thumb**: If an agent would never need to do it, it's probably not a command.

---

## Production Considerations

AFD is a **methodology**, not a framework. It intentionally leaves certain concerns to the implementing team:

| Concern                    | AFD's Scope                               | Your Responsibility                            |
| -------------------------- | ----------------------------------------- | ---------------------------------------------- |
| **Authorization**          | Commands work correctly.                  | Decide who can call them.                      |
| **Mutation Safety**        | Commands are testable.                    | Implement idempotency, preview/apply, undo.    |
| **Sensitive Reasoning**    | `reasoning` field exists for transparency. | Sanitize it for production (redaction, tiers). |
| **Observability**          | `metadata` field provides hooks.          | Integrate tracing (e.g., OpenTelemetry).       |

---

## Agent-Accelerated Development

AFD isn't just designed for agents to *use* software—it's optimized for agents to *build* software. The same structured contracts that make applications agent-accessible make them agent-buildable.

| Development Phase         | Human Time   | Agent-Assisted (AFD) | Compression |
| ------------------------- | ------------ | -------------------- | ----------- |
| Full feature (CRUD + UI)  | 1-2 weeks    | 1-3 hours            | 50-100x     |
| New integration surface   | 2-4 weeks    | 1 day                | 10-20x      |

**Why it works:**
1.  **Schema = Specification**: The agent doesn't guess; the schema *is* the spec.
2.  **CLI = Instant Feedback**: No waiting for hot reload, no clicking through UI.
3.  **Structured Errors**: When something fails, the agent knows exactly what to fix.

---

## The Repository

AFD is implemented as a TypeScript monorepo with the following packages:

| Package            | Purpose                                                     | Status      |
| ------------------ | ----------------------------------------------------------- | ----------- |
| `@afd/core`        | Core types: `CommandResult`, `CommandError`, metadata.      | ✅ Complete  |
| `@afd/server`      | Zod-based factory for MCP-compatible command servers.       | ✅ Complete  |
| `@afd/client`      | Node.js client for calling MCP servers (SSE/HTTP).          | ✅ Complete  |
| `@afd/cli`         | The `afd` command-line tool for validation and interaction. | ✅ Complete  |
| `@afd/testing`     | JTBD scenario testing, MCP integration, multi-app adapters. | ✅ Complete  |
| `examples/todo`    | Reference app with TypeScript + Python backends and UIs.    | ✅ Complete  |

### Key Features (v0.6.0)

-   **Command Batching & Streaming**: Built-in support for batch execution with partial failure handling, and SSE-based streaming for long-running commands.
-   **JTBD Scenario Testing**: YAML-based scenario files for testing user journeys, with step references and fixture pre-seeding.
-   **MCP Server for AI Agents**: Exposes scenario commands as MCP tools, with `_agentHints` for AI-friendly result interpretation.
-   **Multi-App Adapters**: Extensible adapter system for different AFD applications (e.g., `todoAdapter`, `genericAdapter`).

---

## Proven in Production

| Project                                                 | Description                  | Commands | Surfaces                                               | Backend Changes for New Surface |
| ------------------------------------------------------- | ---------------------------- | -------- | ------------------------------------------------------ | ------------------------------- |
| [Violet Design](https://github.com/Falkicon/dsas)       | Design token management      | 24       | CLI, MCP                                               | —                               |
| [Noisett](https://github.com/Falkicon/Noisett)          | AI image generation          | 19       | **5** (CLI, MCP, REST, Web UI, Figma Plugin)           | **Zero** ✅                      |

The Noisett Figma plugin (Phase 7) required **zero backend changes** to integrate. It simply calls the same API endpoints that the CLI and web UI use. This validates the core AFD promise: the command layer is stable; surfaces are interchangeable.

---

## Summary

AFD is a methodology for building software where the **command layer is the product**.

-   **For Engineers**: 80%+ test coverage at launch because everything is CLI-testable. Zero backend changes for new surfaces.
-   **For Product**: Future-proof architecture. The same commands work for CLI, GUI, chat, voice, and whatever comes next.
-   **For Users**: Consistent, transparent, and reliable behavior across all surfaces.

The interfaces will keep changing. AFD bets that the investment should be in commands, not pixels. When the next paradigm arrives, you're ready.
