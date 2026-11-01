/**
 * @fileoverview Validating in-process registry for `DirectClient`.
 *
 * `createDirectRegistry()` runs commands through the same execution engine as
 * `createMcpServer()`: Zod input validation, middleware, error sanitization and
 * `onCommand`/`onError` hooks. It only lists and runs the commands exposed to
 * one interface, `'agent'` by default.
 *
 * With `contexts`, each call names its active context in the `activeContext` call option, as an
 * MCP 2026-07-28 request names it in `_meta["dev.afd/context"]`; the registry keeps no context
 * state between calls. With `tools: createDirectToolSurface()`, it also lists and routes the MCP
 * tool surface: the module-graph rule below keeps that surface out of a registry that does not
 * ask for it. The `allow` call option, which `DirectClient` passes from its own `allow`, narrows
 * one call to the commands a trusted predicate permits, at every level the call reaches.
 *
 * Module-graph rule: this module imports only types from the tool router, the tool list, the
 * meta-tools and `bootstrap/`, so a registry built without `tools` does not bundle them.
 * `entry-points.test.ts` holds it to that with a size budget.
 */

import type {
	Actor,
	BatchRequest,
	BatchResult,
	Clock,
	CommandContext,
	CommandError,
	CommandMiddleware,
	CommandResult,
	ExposeOptions,
	JsonSchema,
	PipelineRequest,
	PipelineResult,
	RandomSource,
} from '@lushly-dev/afd-core';
import { failure, isExposedTo as isCoreExposedTo, truncateName } from '@lushly-dev/afd-core';
import { commandNotAllowed } from '@lushly-dev/afd-core/internal/direct-allow';
import {
	createDirectApprovalExchange,
	directApprovalExchange,
	publicDirectContext,
} from '@lushly-dev/afd-core/internal/direct-approval';
import { bindCommandAllow, filterAllowed, isCommandAllowed } from './command-allow.js';
import { type ContextField, checkContextFields } from './context-fields.js';
import { bindContextState, type ContextState, createContextState } from './context-scope.js';
import { createExecutionEngine } from './execution.js';
import type { McpToolDefinition } from './meta-tools.js';
import type { ZodCommandDefinition } from './schema.js';
import type { ContextConfig, ToolStrategy } from './server-types.js';

/** An interface a command can be exposed to (`palette`, `mcp`, `agent`, `cli`). */
export type ExposeInterface = keyof ExposeOptions;

/**
 * Options for {@link createDirectRegistry}.
 */
export interface DirectRegistryOptions {
	/**
	 * The interface this registry serves. Only commands exposed to it are
	 * listed and executable. Default: `'agent'`, the in-app AI assistant.
	 */
	interface?: ExposeInterface;

	/** Middleware applied to every command, in onion order (same as `createMcpServer`). */
	middleware?: CommandMiddleware[];

	/**
	 * Include exception messages and stacks in failures. Default: `false`, which
	 * returns a generic `COMMAND_EXECUTION_ERROR` message instead.
	 */
	devMode?: boolean;

	/** Called after each command completes. A throwing hook never changes the result. */
	onCommand?: (command: string, input: unknown, result: CommandResult) => void;

	/** Called when a handler or input validation throws. */
	onError?: (error: Error) => void;

	/** `context.clock` when the caller sets none. Default: `systemClock`. */
	clock?: Clock;

	/** `context.random` when the caller sets none. Default: `systemRandom`. */
	random?: RandomSource;

	/**
	 * `context.actor` when the caller sets none. Default: none. `DirectClient` sets its own
	 * actor (`human` unless configured), so this only applies to direct `execute()` calls.
	 */
	actor?: Actor;

	/**
	 * Request values the host declares (`spec/context-fields.md`). A call sets each on its context
	 * under the field's name; it is validated before middleware runs, and an invalid or missing
	 * required one fails the call with `VALIDATION_ERROR`.
	 */
	contextFields?: readonly ContextField[];

	/**
	 * The contexts commands can be scoped to, as for `createMcpServer`. A call names its context
	 * in the `activeContext` option of {@link DirectCommandRegistry.execute}; a command whose
	 * `contexts` leave it out fails with `COMMAND_NOT_IN_CONTEXT`. Without `activeContext` every
	 * command is available, as on MCP with no context selected.
	 */
	contexts?: ContextConfig[];

	/**
	 * The MCP tool surface: pass `createDirectToolSurface()` to list tools with
	 * {@link DirectCommandRegistry.listTools} and route the meta-tools, the context tools and,
	 * with `bootstrap: true`, the bootstrap tools through `execute`, as an MCP server with the
	 * same commands, contexts and strategy does. Without it, the registry runs only the commands
	 * it is given, and does not load the tool router.
	 */
	tools?: DirectToolSurface;
}

/** Options of one {@link DirectCommandRegistry.execute} call, passed beside the command context. */
export interface DirectExecuteOptions {
	/**
	 * The context the call runs in: one of the registry's `contexts`, as MCP 2026-07-28 names it
	 * in `_meta["dev.afd/context"]`. It applies to this call only, including the commands it runs
	 * through `afd-call`, `afd-batch` and `afd-pipe`; handlers cannot read or change it. An
	 * unknown name fails with `CONTEXT_NOT_FOUND` before anything runs. Default: none, so every
	 * command is available.
	 */
	activeContext?: string;

	/**
	 * The commands this call may run: a trusted, in-process predicate over names, such as
	 * `DirectClient`'s `allow`. It covers the name called and every command the call runs: the
	 * `afd-call` target, each `afd-batch` item, each `afd-pipe` step and a grouped tool's action.
	 * A name it rejects (or a throw) fails with `COMMAND_NOT_ALLOWED` and does not run, and
	 * `afd-discover`, `afd-detail` and the bootstrap tools leave such commands out. Handlers
	 * cannot read or change it; it may be called more than once per name. Default: none, so every
	 * exposed command runs.
	 */
	allow?: (command: string) => boolean;
}

/** Options of {@link DirectCommandRegistry.listTools}. */
export interface DirectListToolsOptions {
	/** The strategy to list by. Default: the tool surface's. */
	strategy?: ToolStrategy;
	/** The context to list in, as for {@link DirectExecuteOptions.activeContext}. Default: none. */
	activeContext?: string;
	/**
	 * List only what this predicate permits, as for {@link DirectExecuteOptions.allow}: the
	 * commands it rejects are left out (grouped tools list only the actions it permits), and so
	 * are the tool names it rejects. Default: none.
	 */
	allow?: (command: string) => boolean;
}

/**
 * The MCP tool surface of a registry, from `createDirectToolSurface()`. Pass it as the `tools`
 * option of {@link createDirectRegistry}; the registry calls `attach` once.
 */
export interface DirectToolSurface {
	/** The strategy `listTools` uses by default, and that grouped tool calls route by. */
	readonly strategy: ToolStrategy;
	/** Connect the surface to one registry. Called by `createDirectRegistry`. */
	attach(host: DirectToolHost): DirectToolBinding;
}

/** What {@link createDirectRegistry} gives its tool surface. */
export interface DirectToolHost {
	readonly interface: ExposeInterface;
	readonly contexts: readonly ContextConfig[];
	readonly contextFields: readonly ContextField[];
	readonly devMode: boolean;
	/** The registered commands, in order, before the surface adds its own. */
	readonly commands: readonly ZodCommandDefinition[];
	/** Whether a command is exposed to the registry's interface. */
	isExposed(command: Pick<ZodCommandDefinition, 'expose'>): boolean;
	/** The registry's engine, which the router runs commands through. */
	executeCommand(name: string, input: unknown, context?: CommandContext): Promise<CommandResult>;
	executeBatch(request: BatchRequest, context?: CommandContext): Promise<BatchResult>;
	executePipeline(request: PipelineRequest, context?: CommandContext): Promise<PipelineResult>;
}

/** A tool surface attached to one registry. */
export interface DirectToolBinding {
	/** The commands the surface registers: the context tools, then the bootstrap tools. */
	readonly commands: readonly ZodCommandDefinition[];
	/** Whether `name` is a tool the router handles that is not a command (a meta-tool or group). */
	routes(name: string): boolean;
	/** Route one tool call; the result is the JSON an MCP client reads. */
	callTool(name: string, input: unknown, context: CommandContext): Promise<unknown>;
	/**
	 * Apply a meta-tool's `meta` argument (`meta-argument.ts`) to an in-process call, where the
	 * `activeContext` option and the declared fields' values on the context stand for `_meta`.
	 */
	liftMetaArgument(
		name: string,
		input: unknown,
		context: CommandContext,
		activeContext: string | undefined
	):
		| { ok: true; input: unknown; context: CommandContext; activeContext: string | undefined }
		| { ok: false; error: CommandError };
	/**
	 * The tool list of an MCP server with the same commands, contexts and strategy, narrowed to
	 * what `allow` permits when it is given.
	 */
	listTools(
		strategy: ToolStrategy | undefined,
		activeContext: string | null,
		allow?: (command: string) => boolean
	): McpToolDefinition[];
}

/**
 * Summary of a command the registry exposes, for building tool declarations.
 */
export interface DirectRegistryCommand {
	name: string;
	/** Display label, when the command sets one. */
	title?: string;
	description: string;
	category?: string;
	mutation?: boolean;
	destructive?: boolean;
	undoable?: boolean;
	/** JSON Schema of the command input. */
	inputSchema: JsonSchema;
}

/**
 * A validating command registry. Structurally compatible with the
 * `DirectRegistry` interface of `@lushly-dev/afd-client`, so it can be passed
 * straight to `createDirectClient()` or `new DirectClient()`.
 */
export interface DirectCommandRegistry {
	/** The interface this registry serves. */
	readonly interface: ExposeInterface;

	/** The declared context fields, so `replayJournal` can tell which recorded values still apply. */
	readonly contextFields: readonly ContextField[];

	/**
	 * Validate the input with the command's Zod schema, then run the command
	 * through the middleware. Returns `COMMAND_NOT_FOUND` for unknown names,
	 * `COMMAND_NOT_EXPOSED` for commands not exposed to this interface,
	 * `CONTEXT_NOT_FOUND` for an unknown `activeContext`, `COMMAND_NOT_IN_CONTEXT` for a
	 * command outside it, `COMMAND_NOT_ALLOWED` for a name the `allow` option rejects, and
	 * `VALIDATION_ERROR` for invalid input; the handler does not run for any of them.
	 *
	 * With a tool surface, a meta-tool name (`afd-call`, `afd-batch`, `afd-pipe`,
	 * `afd-discover`, `afd-detail`), or a grouped tool name when the surface's strategy is
	 * `grouped`, runs through the MCP server's tool router, and the result is the JSON an MCP
	 * client reads: `afd-batch` gives a `BatchResult` and `afd-pipe` a `PipelineResult`.
	 */
	execute<T>(
		name: string,
		input?: unknown,
		context?: CommandContext,
		options?: DirectExecuteOptions
	): Promise<CommandResult<T>>;

	/**
	 * The tools an MCP server with the same commands, contexts and strategy lists, from the
	 * server's own tool list. Needs a tool surface (`tools: createDirectToolSurface()`).
	 *
	 * @throws TypeError without a tool surface; RangeError for an unknown `activeContext`, as
	 *   MCP answers `tools/list` with an invalid-params error
	 */
	listTools(options?: DirectListToolsOptions): McpToolDefinition[];

	/**
	 * Names of the commands exposed to this interface, the tool surface's context and bootstrap
	 * tools included.
	 */
	listCommandNames(): string[];

	/** Commands exposed to this interface, with their input schemas. */
	listCommands(): DirectRegistryCommand[];

	/**
	 * Whether `execute` runs `name`: a command registered and exposed to this interface or, with
	 * a tool surface, a tool name its router handles (a meta-tool, or a grouped tool).
	 */
	hasCommand(name: string): boolean;
}

/**
 * Whether a command is exposed to an interface. Each flag the command's
 * `expose` leaves out falls back to `defaultExpose`, so `expose: { mcp: true }`
 * keeps the default `agent` and `palette` access. Set `agent: false` to keep a
 * command away from in-app agents.
 */
export function isExposedTo(
	command: Pick<ZodCommandDefinition, 'expose'>,
	iface: ExposeInterface
): boolean {
	return isCoreExposedTo(command, iface);
}

/** The message and suggestion for an active context the registry does not configure. */
function unknownContext(name: unknown, contexts: readonly ContextConfig[]) {
	const names = contexts.map((context) => context.name);
	return {
		message: `Context '${truncateName(String(name))}' is not configured`,
		suggestion:
			names.length > 0
				? `Use one of: ${names.join(', ')}`
				: 'This registry configures no contexts: pass contexts to createDirectRegistry, or leave activeContext unset',
	};
}

/**
 * Create a validating in-process registry for `DirectClient`.
 *
 * Unlike a hand-written registry that calls `command.handler(input)`, this
 * registry validates input with the command's Zod schema (rejecting wrong
 * types, nested objects and unknown shapes before the handler runs), applies
 * middleware, hides exception details outside `devMode`, and refuses commands
 * that are not exposed to the chosen interface.
 *
 * @param commands - Commands created with `defineCommand()`
 * @param options - Interface, middleware, hooks, contexts and the tool surface
 * @throws If two commands share a name; with a tool surface, also for a reserved name or an
 *   invalid `firstClassTools`, as `createMcpServer` does
 *
 * @example
 * ```typescript
 * import { createDirectClient } from '@lushly-dev/afd-client';
 * import { createDirectRegistry, createLoggingMiddleware } from '@lushly-dev/afd-server';
 *
 * const registry = createDirectRegistry(commands, {
 *   middleware: [createLoggingMiddleware()],
 * });
 * const client = createDirectClient(registry);
 *
 * await client.call('todo-create', { title: { nested: true } });
 * // → { success: false, error: { code: 'VALIDATION_ERROR', ... } }
 * ```
 */
export function createDirectRegistry(
	commands: ZodCommandDefinition[],
	options: DirectRegistryOptions = {}
): DirectCommandRegistry {
	const iface = options.interface ?? 'agent';
	const contexts = [...(options.contexts ?? [])];
	const contextNames = new Set(contexts.map((context) => context.name));
	const contextFields = checkContextFields(options.contextFields);
	const devMode = options.devMode ?? false;

	const registered = new Map<string, ZodCommandDefinition>();
	const register = (command: ZodCommandDefinition) => {
		if (registered.has(command.name)) {
			throw new Error(`Duplicate command name: ${command.name}`);
		}
		registered.set(command.name, command);
	};
	for (const command of commands) register(command);

	// The surface checks the names, adds its context and bootstrap tools, and routes tool calls
	// back into this registry's engine.
	const tools = options.tools?.attach({
		interface: iface,
		contexts,
		contextFields,
		devMode,
		commands: [...registered.values()],
		isExposed: (command) => isExposedTo(command, iface),
		executeCommand: (name, input, context) => engine.executeCommand(name, input, context),
		executeBatch: (request, context) => engine.executeBatch(request, context),
		executePipeline: (request, context) => engine.executePipeline(request, context),
	});
	for (const command of tools?.commands ?? []) register(command);

	const exposed = new Map([...registered].filter(([, command]) => isExposedTo(command, iface)));

	const engine = createExecutionEngine({
		commandMap: exposed,
		middleware: options.middleware ?? [],
		devMode,
		onCommand: options.onCommand,
		onError: options.onError,
		contextDefaults: { clock: options.clock, random: options.random, actor: options.actor },
		contextFields,
		// Refusals name afd-discover and the context tools only where the surface serves them.
		suggestTools: tools !== undefined,
	});

	/**
	 * The context state of one call, as the MCP 2026-07-28 lane builds one per request: nothing
	 * persists, and the context tools only validate. Without contexts the state is `null`, which
	 * also drops any state a caller's context carried in from another surface.
	 */
	function callContextState(activeContext: string | undefined): ContextState | null {
		if (contexts.length === 0) return null;
		const state = createContextState({ persistent: false });
		if (activeContext !== undefined) state.enter(activeContext);
		return state;
	}

	return {
		interface: iface,
		contextFields,

		async execute<T>(
			name: string,
			input: unknown = {},
			context: CommandContext = {},
			callOptions: DirectExecuteOptions = {}
		): Promise<CommandResult<T>> {
			const { allow } = callOptions;
			let { activeContext } = callOptions;
			if (tools && !exposed.has(name) && tools.routes(name)) {
				const lifted = tools.liftMetaArgument(name, input, context, activeContext);
				if (!lifted.ok) return failure(lifted.error);
				({ input, context, activeContext } = lifted);
			}
			if (activeContext !== undefined && !contextNames.has(activeContext)) {
				return failure({
					code: 'CONTEXT_NOT_FOUND',
					...unknownContext(activeContext, contexts),
					retryable: false,
				});
			}
			// The predicate rides on the context, under a private symbol, so every command this call
			// runs (through the router, a batch or a pipeline) is checked by the engine.
			const allowed = bindCommandAllow(publicDirectContext(context), allow);
			if (!isCommandAllowed(allowed, name)) {
				return failure(commandNotAllowed(name));
			}
			if (!exposed.has(name) && registered.has(name)) {
				const available = filterAllowed([...exposed.values()], allowed).map(
					(command) => command.name
				);
				return failure({
					code: 'COMMAND_NOT_EXPOSED',
					message: `Command '${name}' is not exposed to ${iface}`,
					suggestion:
						available.length > 0
							? `Use one of the commands exposed to ${iface}: ${available.join(', ')}`
							: `No commands are exposed to ${iface}; set expose.${iface} on the commands it should call`,
					retryable: false,
				});
			}
			// Only the client-owned exchange can carry approval; raw execute calls are held.
			const supplied = directApprovalExchange(context);
			const exchange = supplied ?? createDirectApprovalExchange();
			try {
				const scoped = exchange.bind(
					bindContextState({ ...allowed, interface: iface }, callContextState(activeContext))
				);
				if (tools && !exposed.has(name) && tools.routes(name)) {
					return (await tools.callTool(name, input, scoped)) as CommandResult<T>;
				}
				return (await engine.executeCommand(name, input, scoped)) as CommandResult<T>;
			} finally {
				if (!supplied) exchange.dispose();
			}
		},

		listTools(listOptions: DirectListToolsOptions = {}): McpToolDefinition[] {
			if (!tools) {
				throw new TypeError(
					'This registry has no tool surface: create it with createDirectRegistry(commands, { tools: createDirectToolSurface() }) to list tools'
				);
			}
			const { activeContext, allow } = listOptions;
			if (activeContext !== undefined && !contextNames.has(activeContext)) {
				const { message, suggestion } = unknownContext(activeContext, contexts);
				throw new RangeError(`${message}. ${suggestion}`);
			}
			return tools.listTools(listOptions.strategy, activeContext ?? null, allow);
		},

		listCommandNames(): string[] {
			return [...exposed.keys()];
		},

		listCommands(): DirectRegistryCommand[] {
			return [...exposed.values()].map((command) => ({
				name: command.name,
				...(command.title !== undefined && { title: command.title }),
				description: command.description,
				category: command.category,
				mutation: command.mutation,
				destructive: command.destructive,
				undoable: command.undoable,
				inputSchema: command.jsonSchema,
			}));
		},

		hasCommand(name: string): boolean {
			return exposed.has(name) || (tools?.routes(name) ?? false);
		},
	};
}
