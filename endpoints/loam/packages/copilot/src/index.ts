/**
 * @lushly-dev/loam-copilot: the copilot's runtime (phase 5 specification, sections 2 to 5). The runtime adapter
 * interface and its TanStack AI implementation, the ports' runtime halves, the context builder, the test provider
 * and an in-process launcher for tests. It never imports the kernel. The runtime frame's assets (`bootstrap.js`, the
 * runtime chunks and `index.html`) are built into `dist/frame/`, which a host serves on its sandbox origin's
 * `copilot/` path.
 */

export { anthropicAdapter } from './adapter-anthropic.js';
export { openaiAdapter } from './adapter-openai.js';
export {
	COMPOSER_LIMITS,
	composeOf,
	composeUnit,
	UNIT_COMPOSE_KEY,
	type UnitComposeV1,
} from './compose.js';
export {
	contentBlock,
	messagesFor,
	SYSTEM_PROMPT,
	serverClaimBlock,
	sessionNonce,
	toolResultText,
	UNIT_PROMPT,
} from './context.js';
export { createInProcessLauncher, type InProcessLauncher } from './in-process.js';
export { AgentPort, ModelPort } from './ports.js';
export { serveRuntime } from './serve.js';
export { type AdapterFactory, createTanStackRuntime, RUNTIME_LIMITS } from './tanstack.js';
export {
	createTestProvider,
	type ModelScriptV1,
	NO_SCRIPT,
	type ScriptRoundV1,
	type TestProviderOptionsV1,
	type TestProviderV1,
} from './test-provider.js';
export type * from './types.js';
