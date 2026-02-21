/**
 * App Adapter Types
 *
 * Defines the interface for adapting the JTBD testing framework
 * to different AFD applications (Violet, Noisett, Todo, etc.)
 */

import type { CommandResult } from '@lushly-dev/afd-core';

// ============================================================================
// Core Adapter Interface
// ============================================================================

/**
 * App adapter interface for AFD applications.
 * Each app provides this to enable JTBD testing.
 */
export interface AppAdapter {
	/** Unique app identifier (e.g., 'violet', 'noisett', 'todo') */
	name: string;

	/** App version for compatibility checking */
	version: string;

	/** CLI configuration */
	cli: CliConfig;

	/** Fixture handling configuration */
	fixture: FixtureConfig;

	/** Commands metadata */
	commands: CommandsConfig;

	/** Error codes metadata */
	errors: ErrorsConfig;

	/** Jobs/user-goals metadata */
	jobs: JobsConfig;
}

// ============================================================================
// CLI Configuration
// ============================================================================

/**
 * CLI execution configuration for an app.
 */
export interface CliConfig {
	/** CLI executable command (e.g., 'violet', 'noisett', 'node dist/server.js') */
	command: string;

	/** Default arguments to include with every command */
	defaultArgs?: string[];

	/** How to pass JSON input to the CLI */
	inputFormat: 'json-arg' | 'json-stdin' | 'flags';

	/** Expected output format from CLI */
	outputFormat: 'json' | 'text';

	/** Environment variables to set */
	env?: Record<string, string>;
}

// ============================================================================
// Fixture Configuration
// ============================================================================

/**
 * Fixture handling for an app.
 */
export interface FixtureConfig {
	/** JSON Schema for validating fixture format */
	schema?: object;

	/**
	 * Apply fixture data to set up test state.
	 * Called before scenario execution.
	 */
	apply: FixtureApplicator;

	/**
	 * Reset app state to clean slate.
	 * Called between scenarios or on cleanup.
	 */
	reset: FixtureResetter;

	/**
	 * Validate fixture data against schema.
	 * Returns validation errors if any.
	 */
	validate?: FixtureValidator;
}

/**
 * Function to apply fixture data.
 */
export type FixtureApplicator = (
	fixture: unknown,
	context: AdapterContext
) => Promise<ApplyFixtureResult>;

/**
 * Function to reset app state.
 */
export type FixtureResetter = (context: AdapterContext) => Promise<void>;

/**
 * Function to validate fixture data.
 */
export type FixtureValidator = (fixture: unknown) => Promise<FixtureValidationResult>;

/**
 * Result of applying a fixture.
 */
export interface ApplyFixtureResult {
	/** Commands that were executed */
	appliedCommands: AppliedCommand[];
	/** Any warnings during application */
	warnings?: string[];
}

/**
 * A command that was applied from a fixture.
 */
export interface AppliedCommand {
	/** Command name */
	command: string;
	/** Input passed to command */
	input?: Record<string, unknown>;
	/** Result of command execution */
	result?: CommandResult<unknown>;
}

/**
 * Result of fixture validation.
 */
export interface FixtureValidationResult {
	valid: boolean;
	errors?: string[];
}

// ============================================================================
// Commands Configuration
// ============================================================================

/**
 * Commands metadata for an app.
 */
export interface CommandsConfig {
	/**
	 * Get list of available commands.
	 */
	list: () => Promise<string[]> | string[];

	/**
	 * Get JSON Schema for a command's input.
	 */
	getSchema?: (command: string) => Promise<object> | object;

	/**
	 * Get command description.
	 */
	getDescription?: (command: string) => string;

	/**
	 * Map file paths to related commands (for scenario-suggest).
	 */
	mapFileToCommands?: (filePath: string) => string[];
}

// ============================================================================
// Errors Configuration
// ============================================================================

/**
 * Error codes metadata for an app.
 */
export interface ErrorsConfig {
	/**
	 * Get list of known error codes.
	 */
	list: () => Promise<string[]> | string[];

	/**
	 * Get human-readable description for an error code.
	 */
	getDescription?: (code: string) => string;

	/**
	 * Check if an error is retryable.
	 */
	isRetryable?: (code: string) => boolean;
}

// ============================================================================
// Jobs Configuration
// ============================================================================

/**
 * Jobs (user goals) metadata for an app.
 */
export interface JobsConfig {
	/**
	 * Get list of defined jobs.
	 */
	list: () => Promise<string[]> | string[];

	/**
	 * Get human-readable description for a job.
	 */
	getDescription?: (job: string) => string;

	/**
	 * Get related commands for a job.
	 */
	getRelatedCommands?: (job: string) => string[];
}

// ============================================================================
// Context
// ============================================================================

/**
 * Context passed to adapter functions.
 */
export interface AdapterContext {
	/** CLI command to use */
	cli: string;

	/** Command handler for in-process execution */
	handler?: CommandHandler;

	/** Working directory */
	cwd?: string;

	/** Environment variables */
	env?: Record<string, string>;
}

/**
 * Command handler function type.
 */
export type CommandHandler = (
	command: string,
	input: Record<string, unknown>
) => Promise<CommandResult<unknown>>;

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Adapter registry for managing multiple app adapters.
 */
export interface AdapterRegistry {
	/**
	 * Register an adapter.
	 */
	register(adapter: AppAdapter): void;

	/**
	 * Get adapter by name.
	 */
	get(name: string): AppAdapter | undefined;

	/**
	 * List all registered adapters.
	 */
	list(): AppAdapter[];

	/**
	 * Detect adapter from fixture data.
	 */
	detect(fixture: unknown): AppAdapter | undefined;

	/**
	 * Check if an adapter is registered.
	 */
	has(name: string): boolean;
}

/**
 * Options for creating an adapter registry.
 */
export interface AdapterRegistryOptions {
	/** Adapters to register initially */
	adapters?: AppAdapter[];

	/** Default adapter name to use when detection fails */
	defaultAdapter?: string;
}
