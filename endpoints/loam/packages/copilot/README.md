# @lushly-dev/loam-copilot

Loam's copilot runtime ([phase 5 specification](../../docs/phases/5-copilot/spec.md), sections 2 to 5). Private, and quarantined in the release inventory.

- **The runtime adapter** (`CopilotRuntimeV1`, 4.3) and its TanStack AI implementation (`createTanStackRuntime`): `chat()` with Loam's tools, whose `execute` calls the agent port, over TanStack's own provider adapters with the model port's `fetch` (S6). No `needsApproval`, no client tools, no interrupt.
- **The ports' runtime halves** (`AgentPort`, `ModelPort`, `serveRuntime`). The trusted halves are the kernel's, in `@lushly-dev/loam-kernel/copilot`: they refuse any message with a key they do not define.
- **The context builder** (5.2): content blocks under a per-session random value, server claims, and Loam's system prompt.
- **The test provider** (`@lushly-dev/loam-copilot/test-provider`), `kind = "test"`: scripts keyed by `script:<name>`, answered in Anthropic's stream format on the trusted side of the model port.
- **The runtime frame**, built by `scripts/build-frame.mjs` into `dist/frame/`: `index.html`, the first-party `bootstrap.js`, and one runtime chunk per provider kind for a `blob:` worker's `importScripts`, with the vendor SDKs stubbed. The web build copies it to `sandbox/copilot/`, which each host serves on its sandbox origin under the frame's own policy (3.2).

It never imports the kernel.

## Where the code came from (D150)

Section 12 sends Lushly's AI client interfaces, its command-to-tool bridge and its chat transport's handshake here. They were **rewritten in this repository against the inventory on [#883](https://github.com/lushly-dev/afd/issues/883)** (Lushly's `main` at `f5d0bc592`, inventoried 2026-11-13) and against the throwaway spike of step 0a (`lush/loam-p5-spike-0a`, head `4a8055bb`). No Lushly code was copied, and nothing of Lushly's product policy, environment or names is here (D19). What carries over is the shape only: a runtime adapter behind an interface, tools built from the command registry, and a transport that sends the person's new text and streams events back. Lushly's model catalog, budgets and specialists stay Lushly's; its interrupt handshake does not carry over, since Loam's approval is the kernel's confirmation (12).

## Commands

```bash
pnpm -F @lushly-dev/loam-copilot build   # tsc, then dist/frame/, its sizes.json and modules.json (#2808)
pnpm -F @lushly-dev/loam-copilot test    # the context builder, the test provider and a runtime turn over MessagePorts
```
