/**
 * Specimen MCP endpoint built on `@lushly-dev/afd-server` (`createMcpServer` / `createMcpHandler`).
 *
 * Uses the `hybrid` tool strategy by default (5 meta-tools + up to 8 first-class Specimen tools),
 * enforces `confirmations: 'require-human'`, and wires `HumanRelay` host-verified confirmation
 * (`spec/command-metadata.md`) for `decision-record`, `design-release`, and `panel-calibrate`.
 */
import {
	createMcpHandler,
	createMcpServer,
	type HumanRelay,
	MAX_FIRST_CLASS_TOOLS,
	type McpHandler,
	type McpHandlerOptions,
	type McpServer,
	type McpServerOptions,
	type ToolStrategy,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server';
import {
	computeCardDigest,
	createSpecimenBench,
	readCardRecord,
	type SpecimenBench,
} from '@lushly-dev/specimen';
import type { BenchOptions } from '@lushly-dev/specimen/types';
import {
	createSpecimenCommands,
	markSpecimenRelayConfirmed,
	SPECIMEN_RELAY_CONTEXT_KEY,
} from '@lushly-dev/specimen-afd';

/**
 * Preferred first-class tools under the `hybrid` strategy (`docs/features/active/agent-first-design/spec.md` §5.1).
 * Filtered against the registered MCP-exposed commands and capped at `MAX_FIRST_CLASS_TOOLS` (8).
 */
export const PREFERRED_SPECIMEN_FIRST_CLASS_TOOLS = [
	'design-states',
	'design-card-list',
	'decision-record',
	'specimen-review',
	'specimen-validate',
	'panel-walk',
	'panel-review',
	'design-release',
	'specimen-list',
	'specimen-capture',
	'decision-list',
] as const;

const SPECIMEN_MCP_INSTRUCTIONS =
	'Specimen observes and tests native components, retained stories, and job specimens, reviews unsettled changes, orchestrates multi-persona panel reviews, lists design decision cards, and records design decisions and releases under specimens/. Start with specimen-list, specimen-validate, and design-card-list; call decision-check before editing files, specimens, or tokens covered by a decision; use specimen-review to inspect unsettled changes (open items and decision cards belong to the person). Host-verified commands (decision-record, design-release, panel-calibrate) require a person to confirm through the configured HumanRelay; agents must not fabricate human confirmation. Use afd-discover and afd-detail to inspect any Specimen command not listed as a first-class tool. Use this server with trusted local projects.';

/** Options for creating the Specimen MCP server or embeddable HTTP handler. */
export interface SpecimenMcpServerOptions extends BenchOptions {
	/**
	 * Confirmation enforcement (`spec/command-metadata.md`).
	 * Always `'require-human'`: commands declaring `confirmPrompt` require accepted human
	 * confirmation, and host-verified commands (`decision-record`, `design-release`, `panel-calibrate`)
	 * require a configured `humanRelay` with MCP 2026-07-28 URL-mode elicitation.
	 */
	confirmations?: 'require-human';
	/**
	 * Host-verified confirmation relay for `decision-record`, `design-release`, and `panel-calibrate`.
	 * Without one, MCP and HTTP calls to host-verified commands fail closed with `CONFIRMATION_REQUIRED`.
	 */
	humanRelay?: HumanRelay;
	/**
	 * Tool strategy for MCP `tools/list` (`spec/tool-strategies.md`).
	 * Defaults to `'hybrid'` (meta-tools + up to 8 first-class Specimen tools).
	 */
	toolStrategy?: ToolStrategy;
	/** Custom first-class tools when `toolStrategy` is `'hybrid'` (at most 8). */
	firstClassTools?: string[];
	/** Transport mode for `createSpecimenMcpServer`. Defaults to `'stdio'`. */
	transport?: McpServerOptions['transport'];
	/** HTTP bind port when `transport` is `'http'`. */
	port?: number;
	/** HTTP bind host when `transport` is `'http'`. */
	host?: string;
	/** Additional `@lushly-dev/afd-server` options (`clock`, `devMode`, `confirmationKey`, `instances`, `taskStore`, etc.). */
	serverOptions?: Omit<
		McpHandlerOptions,
		| 'name'
		| 'version'
		| 'commands'
		| 'confirmations'
		| 'humanRelay'
		| 'toolStrategy'
		| 'firstClassTools'
		| 'port'
		| 'host'
	>;
}

export type SpecimenMcpHandlerOptions = Omit<SpecimenMcpServerOptions, 'transport'>;

export interface SpecimenMcpServer extends McpServer {
	/** Stop the MCP transport and dispose the underlying Specimen bench. */
	close(): Promise<void>;
}

export type SpecimenMcpHandler = McpHandler & {
	/** Dispose HTTP streams/tasks and close the underlying Specimen bench. */
	close(): Promise<void>;
};

const MAX_PINNED_DIGEST_ENTRIES = 256;

async function snapshotCardDigestsForCall(
	root: string,
	command: string,
	input: unknown
): Promise<Record<string, string> | undefined> {
	if (command !== 'decision-record' || typeof input !== 'object' || input === null) {
		return undefined;
	}
	const record = input as { card?: unknown; cards?: unknown };
	const ids: string[] = [];
	if (typeof record.card === 'string' && record.card.trim()) {
		ids.push(record.card.trim());
	} else if (Array.isArray(record.cards)) {
		for (const item of record.cards) {
			if (typeof item === 'string' && item.trim()) ids.push(item.trim());
		}
	}
	if (ids.length === 0) return undefined;
	const digests: Record<string, string> = {};
	for (const id of ids) {
		try {
			const card = await readCardRecord(root, id);
			digests[card.card] = computeCardDigest(card);
		} catch {
			// Let the command handler emit the canonical CARD_NOT_FOUND / VALIDATION_ERROR.
			return undefined;
		}
	}
	return digests;
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
	if (map.size >= MAX_PINNED_DIGEST_ENTRIES) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(key, value);
}

function wrapSpecimenHumanRelay(relay: HumanRelay, root: string): HumanRelay {
	const pendingByState = new Map<string, Record<string, string>>();
	const approvedByDecisionId = new Map<string, Record<string, string>>();
	return {
		begin: async (call) => {
			const digests = await snapshotCardDigestsForCall(root, call.command, call.input);
			const result = await relay.begin(call);
			if (result.ok && digests) {
				setBounded(pendingByState, result.prompt.state, digests);
			}
			return result;
		},
		resume: async (state, call) => {
			const outcome = await relay.resume(state, call);
			const digests = pendingByState.get(state);
			if (outcome.kind !== 'pending') {
				pendingByState.delete(state);
			}
			if (outcome.kind === 'approved' && digests) {
				setBounded(approvedByDecisionId, outcome.decisionId, digests);
			}
			return outcome;
		},
		approvedContext: async (decisionId, call) => {
			const extra = relay.approvedContext ? await relay.approvedContext(decisionId, call) : {};
			const cardDigests = approvedByDecisionId.get(decisionId);
			approvedByDecisionId.delete(decisionId);
			const confirmedByRaw =
				typeof extra['dev.afd.specimen/confirmedBy'] === 'string'
					? extra['dev.afd.specimen/confirmedBy']
					: typeof extra.confirmedBy === 'string'
						? extra.confirmedBy
						: undefined;
			return {
				...extra,
				[SPECIMEN_RELAY_CONTEXT_KEY]: markSpecimenRelayConfirmed({
					decisionId,
					command: call.command,
					inputDigest: call.inputDigest,
					...(cardDigests ? { cardDigests } : {}),
					...(confirmedByRaw ? { confirmedBy: confirmedByRaw } : {}),
					channel: 'mcp-relay',
				}),
			};
		},
	};
}

/** Resolve default hybrid first-class tools from the registered MCP-exposed commands (capped at 8). */
export function resolveDefaultSpecimenFirstClassTools(
	commands: readonly ZodCommandDefinition[]
): string[] {
	const exposed = new Set(
		commands.filter((command) => command.expose?.mcp === true).map((command) => command.name)
	);
	return PREFERRED_SPECIMEN_FIRST_CLASS_TOOLS.filter((name) => exposed.has(name)).slice(
		0,
		MAX_FIRST_CLASS_TOOLS
	);
}

async function prepareRuntime(options: SpecimenMcpServerOptions): Promise<{
	bench: SpecimenBench;
	handlerOptions: McpHandlerOptions;
	transport: McpServerOptions['transport'];
}> {
	const {
		confirmations = 'require-human',
		humanRelay,
		toolStrategy = 'hybrid',
		firstClassTools,
		transport = 'stdio',
		port,
		host,
		serverOptions,
		...benchOptions
	} = options;
	if (confirmations !== 'require-human') {
		throw new Error("createSpecimenMcpServer: confirmations must be 'require-human'");
	}
	const bench = await createSpecimenBench(benchOptions);
	try {
		const commands = [...createSpecimenCommands(bench)].filter(
			(command) => command.expose?.mcp === true
		);
		const resolvedFirstClass =
			toolStrategy === 'hybrid'
				? (firstClassTools ?? resolveDefaultSpecimenFirstClassTools(commands))
				: firstClassTools;
		const handlerOptions: McpHandlerOptions = {
			...serverOptions,
			name: 'specimen',
			version: '0.1.0',
			instructions: serverOptions?.instructions ?? SPECIMEN_MCP_INSTRUCTIONS,
			commands,
			confirmations: 'require-human',
			toolStrategy,
			...(resolvedFirstClass !== undefined ? { firstClassTools: resolvedFirstClass } : {}),
			...(humanRelay
				? { humanRelay: wrapSpecimenHumanRelay(humanRelay, benchOptions.root ?? process.cwd()) }
				: {}),
			...(port !== undefined ? { port } : {}),
			...(host !== undefined ? { host } : {}),
		};
		return { bench, handlerOptions, transport };
	} catch (error) {
		await bench.close().catch(() => {});
		throw error;
	}
}

/** Create the Specimen MCP server on `@lushly-dev/afd-server` (default: `stdio` + `hybrid` strategy). */
export async function createSpecimenMcpServer(
	options: SpecimenMcpServerOptions
): Promise<SpecimenMcpServer> {
	const { bench, handlerOptions, transport } = await prepareRuntime(options);
	let server: McpServer;
	try {
		server = createMcpServer({ ...handlerOptions, transport });
	} catch (error) {
		await bench.close().catch(() => {});
		throw error;
	}
	let closed: Promise<void> | undefined;
	const close = (): Promise<void> => {
		closed ??= (async () => {
			try {
				await server.stop();
			} finally {
				await bench.close();
			}
		})();
		return closed;
	};
	return {
		start: () => server.start(),
		stop: close,
		close,
		getUrl: () => server.getUrl(),
		getCommands: () => server.getCommands(),
		contextFields: server.contextFields,
		getTransport: () => server.getTransport(),
		execute: (name, input, context) => server.execute(name, input, context),
		executePipeline: (request, context) => server.executePipeline(request, context),
	};
}

/** Create an embeddable Node HTTP MCP handler for Specimen (supports MCP 2026-07-28 + `HumanRelay`). */
export async function createSpecimenMcpHandler(
	options: SpecimenMcpHandlerOptions
): Promise<SpecimenMcpHandler> {
	const { bench, handlerOptions } = await prepareRuntime(options);
	let handler: McpHandler;
	try {
		handler = createMcpHandler(handlerOptions);
	} catch (error) {
		await bench.close().catch(() => {});
		throw error;
	}
	let closed: Promise<void> | undefined;
	const close = (): Promise<void> => {
		closed ??= (async () => {
			handler.dispose();
			await bench.close();
		})();
		return closed;
	};
	const wrapped = Object.assign(
		(
			req: Parameters<McpHandler>[0],
			res: Parameters<McpHandler>[1],
			body?: Parameters<McpHandler>[2]
		) => handler(req, res, body),
		{
			dispose() {
				void close().catch((error: unknown) =>
					console.error('[specimen-mcp] Close failed:', error)
				);
			},
			close,
			admit: handler.admit.bind(handler),
			preDispatchCheck: handler.preDispatchCheck.bind(handler),
		}
	);
	return wrapped;
}
