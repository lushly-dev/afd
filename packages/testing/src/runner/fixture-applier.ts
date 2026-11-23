/**
 * @lushly-dev/afd-testing - Browser-safe fixture applier
 *
 * Applies already-loaded fixture data to an application through its adapter
 * and a command handler. Contains no Node.js built-in imports so it can run
 * directly inside a browser page or worker as well as in Node.js.
 */

import { type CommandResult, failure } from '@lushly-dev/afd-core/result';
import { genericAdapter } from '../adapters/generic.js';
import { detectAdapter } from '../adapters/registry.js';
import { todoAdapter } from '../adapters/todo.js';
import type { AdapterContext, AppAdapter } from '../adapters/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Generic fixture data structure.
 * App-specific fixtures extend this with their own fields.
 */
export interface FixtureData {
	/** Schema identifier */
	$schema?: string;

	/** Target application */
	app?: string;

	/** Fixture format version */
	version?: string;

	/** Human-readable description */
	description?: string;

	/** App-specific data */
	[key: string]: unknown;
}

/**
 * Applied command with its input data.
 */
export interface AppliedCommand {
	/** Command name */
	command: string;

	/** Input data passed to command (if any) */
	input?: Record<string, unknown>;
}

/**
 * Result from applying a fixture.
 */
export interface ApplyFixtureResult {
	/** Whether every fixture command succeeded */
	success: boolean;

	/** Error message if failed, naming the failing command and its error code */
	error?: string;

	/** Commands that were applied with their inputs */
	appliedCommands: AppliedCommand[];

	/** Warnings reported by the fixture adapter */
	warnings?: string[];
}

/**
 * Executes one fixture command. Must return the command's real
 * `CommandResult`: a failed result fails the fixture.
 */
export type FixtureCommandHandler = (
	command: string,
	input?: Record<string, unknown>,
	context?: { signal?: AbortSignal }
) => Promise<CommandResult<unknown>>;

/**
 * Options for applying a fixture.
 */
export interface ApplyFixtureOptions {
	/** Specific adapter to use (overrides detection) */
	adapter?: AppAdapter;
	/** Working directory */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** Stops applying fixture commands once aborted */
	signal?: AbortSignal;
}

// ============================================================================
// Adapter Selection & Validation
// ============================================================================

/**
 * Pick the adapter for a fixture: a registered adapter for its `app`, the
 * built-in todo adapter for `app: "todo"`, or the generic adapter for a
 * fixture with a `setup` or `data` command list.
 */
function resolveFixtureAdapter(data: FixtureData): AppAdapter | undefined {
	const registered = detectAdapter(data);
	if (registered) return registered;
	if (data.app === todoAdapter.name) return todoAdapter;
	if (Array.isArray(data.setup) || Array.isArray(data.data)) return genericAdapter;
	return undefined;
}

function noAdapterError(data: FixtureData): string {
	return typeof data.app === 'string'
		? `No fixture adapter for app '${data.app}'. Register one with registerAdapter(), or list the commands to run in a 'setup' array.`
		: "Fixture has nothing to apply: set 'app' to an app with a registered adapter, or list the commands to run in a 'setup' array.";
}

/**
 * Validate merged fixture data using its resolved adapter.
 */
export async function validateWithAdapter(data: FixtureData): Promise<string | undefined> {
	const adapter = resolveFixtureAdapter(data);
	if (!adapter) {
		return noAdapterError(data);
	}
	const validation = await adapter.fixture.validate?.(data);
	if (validation && !validation.valid) {
		return `Invalid fixture: ${(validation.errors ?? ['failed validation']).join('; ')}`;
	}
	return undefined;
}

// ============================================================================
// Fixture Application
// ============================================================================

function isCommandResult(value: unknown): value is CommandResult<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { success?: unknown }).success === 'boolean'
	);
}

function describeFailure(command: string, result: CommandResult<unknown>): string {
	const error = result.error;
	const detail = error ? `${error.code}: ${error.message}` : 'the command reported success: false';
	return `Fixture command '${command}' failed with ${detail}`;
}

/**
 * Apply fixture data to a system via commands.
 *
 * The adapter is chosen by `resolveFixtureAdapter` (or `options.adapter`).
 * Each command's real `CommandResult` is passed to the adapter; the first
 * failed command fails the whole application, and adapter warnings are
 * returned in `warnings`.
 *
 * @param data - Loaded fixture data
 * @param handler - Command execution function returning a `CommandResult`
 * @param options - Application options
 * @returns Result of fixture application
 */
export async function applyFixture(
	data: FixtureData,
	handler: FixtureCommandHandler,
	options: ApplyFixtureOptions = {}
): Promise<ApplyFixtureResult> {
	const adapter = options.adapter ?? resolveFixtureAdapter(data);
	if (!adapter) {
		return { success: false, error: noAdapterError(data), appliedCommands: [] };
	}

	const executed: AppliedCommand[] = [];
	let firstFailure: string | undefined;

	const context: AdapterContext = {
		cli: adapter.cli.command,
		handler: async (command, input) => {
			options.signal?.throwIfAborted();
			const returned: unknown = await handler(command, input, { signal: options.signal });
			executed.push({ command, input });
			const result = isCommandResult(returned)
				? returned
				: failure({
						code: 'INVALID_COMMAND_RESULT',
						message: 'the handler did not return a CommandResult',
						suggestion: 'Return success(...) or failure(...) from the fixture command handler',
					});
			if (!result.success && firstFailure === undefined) {
				firstFailure = describeFailure(command, result);
			}
			return result;
		},
		cwd: options.cwd,
		env: options.env,
	};

	try {
		const adapterResult = await adapter.fixture.apply(data, context);
		const warnings =
			adapterResult.warnings && adapterResult.warnings.length > 0
				? adapterResult.warnings
				: undefined;
		const appliedCommands = adapterResult.appliedCommands.map((cmd) => ({
			command: cmd.command,
			input: cmd.input,
		}));
		return {
			success: firstFailure === undefined,
			...(firstFailure !== undefined ? { error: firstFailure } : {}),
			appliedCommands,
			...(warnings ? { warnings } : {}),
		};
	} catch (err) {
		return {
			success: false,
			error: firstFailure ?? (err instanceof Error ? err.message : String(err)),
			appliedCommands: executed,
		};
	}
}
