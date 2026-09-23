/**
 * @fileoverview Validating in-process registry for `DirectClient`.
 *
 * `createDirectRegistry()` runs commands through the same execution engine as
 * `createMcpServer()`: Zod input validation, middleware, error sanitization and
 * `onCommand`/`onError` hooks. It only lists and runs the commands exposed to
 * one interface, `'agent'` by default.
 */

import type {
	CommandContext,
	CommandMiddleware,
	CommandResult,
	ExposeOptions,
	JsonSchema,
} from '@lushly-dev/afd-core';
import { defaultExpose, failure } from '@lushly-dev/afd-core';
import { createExecutionEngine } from './execution.js';
import type { ZodCommandDefinition } from './schema.js';

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
}

/**
 * Summary of a command the registry exposes, for building tool declarations.
 */
export interface DirectRegistryCommand {
	name: string;
	description: string;
	category?: string;
	mutation?: boolean;
	destructive?: boolean;
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

	/**
	 * Validate the input with the command's Zod schema, then run the command
	 * through the middleware. Returns `COMMAND_NOT_FOUND` for unknown names,
	 * `COMMAND_NOT_EXPOSED` for commands not exposed to this interface and
	 * `VALIDATION_ERROR` for invalid input; the handler does not run for any of them.
	 */
	execute<T>(name: string, input?: unknown, context?: CommandContext): Promise<CommandResult<T>>;

	/** Names of the commands exposed to this interface. */
	listCommandNames(): string[];

	/** Commands exposed to this interface, with their input schemas. */
	listCommands(): DirectRegistryCommand[];

	/** Whether a command is registered and exposed to this interface. */
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
	return (command.expose?.[iface] ?? defaultExpose[iface]) === true;
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
 * @param options - Interface, middleware and hooks
 * @throws If two commands share a name
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

	const registered = new Map<string, ZodCommandDefinition>();
	for (const command of commands) {
		if (registered.has(command.name)) {
			throw new Error(`Duplicate command name: ${command.name}`);
		}
		registered.set(command.name, command);
	}

	const exposed = new Map([...registered].filter(([, command]) => isExposedTo(command, iface)));

	const engine = createExecutionEngine({
		commandMap: exposed,
		middleware: options.middleware ?? [],
		devMode: options.devMode ?? false,
		onCommand: options.onCommand,
		onError: options.onError,
	});

	return {
		interface: iface,

		async execute<T>(
			name: string,
			input: unknown = {},
			context: CommandContext = {}
		): Promise<CommandResult<T>> {
			if (!exposed.has(name) && registered.has(name)) {
				const available = [...exposed.keys()];
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
			// SAFETY: T is the caller's assertion about the command's data, as in DirectRegistry.
			return (await engine.executeCommand(name, input, {
				...context,
				interface: iface,
			})) as CommandResult<T>;
		},

		listCommandNames(): string[] {
			return [...exposed.keys()];
		},

		listCommands(): DirectRegistryCommand[] {
			return [...exposed.values()].map((command) => ({
				name: command.name,
				description: command.description,
				category: command.category,
				mutation: command.mutation,
				destructive: command.destructive,
				inputSchema: command.jsonSchema,
			}));
		},

		hasCommand(name: string): boolean {
			return exposed.has(name);
		},
	};
}
