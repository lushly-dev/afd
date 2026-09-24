/**
 * @lushly-dev/afd-testing - Fixture Loader
 *
 * Loads fixture files and applies them to set up initial test state.
 * Supports:
 * - JSON fixture files
 * - Base fixture inheritance
 * - Inline overrides
 * - Application through an app adapter (see `registerAdapter`)
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type CommandResult, failure } from '@lushly-dev/afd-core';
import { genericAdapter } from '../adapters/generic.js';
import { detectAdapter } from '../adapters/registry.js';
import { todoAdapter } from '../adapters/todo.js';
import type { AdapterContext, AppAdapter } from '../adapters/types.js';
import type { FixtureConfig } from '../types/scenario.js';
import { resolveInsideRoot } from './sandbox.js';

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
 * Result from loading a fixture.
 */
export type LoadFixtureResult =
	| { success: true; data: FixtureData; path: string }
	| { success: false; error: string; path?: string };

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
 * Options for fixture loading.
 */
export interface LoadFixtureOptions {
	/** Base directory for resolving relative paths (default: process.cwd()) */
	basePath?: string;

	/** Validate the merged fixture with its adapter's `fixture.validate` */
	validate?: boolean;

	/**
	 * Reject fixture files (including `base`) that resolve outside this
	 * directory, lexically or through a symlinked parent.
	 */
	rootDir?: string;
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

// ============================================================================
// Fixture Loader
// ============================================================================

function locate(base: string, file: string, rootDir: string | undefined, label: string): string {
	const target = resolve(base, file);
	return rootDir ? resolveInsideRoot(rootDir, target, label) : target;
}

/**
 * Load a fixture from configuration.
 *
 * @param config - Fixture configuration from scenario
 * @param options - Loading options
 * @returns Loaded and merged fixture data
 *
 * @example
 * ```typescript
 * const result = await loadFixture({
 *   file: "./fixtures/seeded-todos.json",
 *   overrides: { todos: [{ title: "Custom todo" }] }
 * });
 * if (result.success) {
 *   console.log(result.data);
 * }
 * ```
 */
export async function loadFixture(
	config: FixtureConfig,
	options: LoadFixtureOptions = {}
): Promise<LoadFixtureResult> {
	const basePath = options.basePath ?? process.cwd();

	try {
		// 1. Load the main fixture file
		const fixturePath = locate(basePath, config.file, options.rootDir, 'Fixture file');
		const mainData = await loadJsonFile(fixturePath);

		if (!mainData.success) {
			return mainData;
		}

		let mergedData = mainData.data;

		// 2. If there's a base fixture, load and merge it
		if (config.base) {
			const baseFixturePath = locate(
				dirname(fixturePath),
				config.base,
				options.rootDir,
				'Fixture base'
			);
			const baseData = await loadJsonFile(baseFixturePath);

			if (!baseData.success) {
				return {
					success: false,
					error: `Failed to load base fixture: ${baseData.error}`,
					path: baseFixturePath,
				};
			}

			// Base is applied first, then main fixture overrides
			mergedData = deepMerge(baseData.data, mergedData);
		}

		// 3. Apply inline overrides
		if (config.overrides) {
			mergedData = deepMerge(mergedData, config.overrides as FixtureData);
		}

		// 4. Optionally validate with the fixture's adapter
		if (options.validate) {
			const validationError = await validateWithAdapter(mergedData);
			if (validationError) {
				return { success: false, error: validationError, path: fixturePath };
			}
		}

		return {
			success: true,
			data: mergedData,
			path: fixturePath,
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Load a JSON file and parse it. Errors never echo the file's contents.
 */
async function loadJsonFile(filePath: string): Promise<LoadFixtureResult> {
	let content: string;
	try {
		content = await readFile(filePath, 'utf-8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return {
				success: false,
				error: `Fixture file not found: ${filePath}`,
				path: filePath,
			};
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			path: filePath,
		};
	}

	try {
		return { success: true, data: JSON.parse(content) as FixtureData, path: filePath };
	} catch (err) {
		const position = err instanceof Error ? /position (\d+)/.exec(err.message)?.[1] : undefined;
		return {
			success: false,
			error: `Invalid JSON in fixture file: ${filePath}${position ? ` (at position ${position})` : ''}`,
			path: filePath,
		};
	}
}

/**
 * Deep merge two objects. Source values override target values.
 * Arrays are replaced, not concatenated.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: T): T {
	const result = { ...target };

	for (const key of Object.keys(source)) {
		const sourceValue = source[key];
		const targetValue = result[key];

		if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
			// Recursively merge nested objects
			result[key as keyof T] = deepMerge(
				targetValue as Record<string, unknown>,
				sourceValue as Record<string, unknown>
			) as T[keyof T];
		} else {
			// Override with source value (including arrays)
			result[key as keyof T] = sourceValue as T[keyof T];
		}
	}

	return result;
}

/**
 * Check if value is a plain object (not array, null, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

// ============================================================================
// Fixture Application
// ============================================================================

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

async function validateWithAdapter(data: FixtureData): Promise<string | undefined> {
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
