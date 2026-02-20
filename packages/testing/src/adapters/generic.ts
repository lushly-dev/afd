/**
 * Generic Adapter
 *
 * Fallback adapter for apps that don't have a specific adapter.
 * Provides basic functionality using convention over configuration.
 */

import type {
	AdapterContext,
	AppAdapter,
	ApplyFixtureResult,
	FixtureValidationResult,
} from './types.js';

// ============================================================================
// Generic Adapter
// ============================================================================

/**
 * Create a generic adapter for an app.
 * Uses conventions to provide basic functionality.
 */
export function createGenericAdapter(
	name: string,
	options: GenericAdapterOptions = {}
): AppAdapter {
	const {
		version = '1.0.0',
		cliCommand = name,
		defaultArgs = [],
		inputFormat = 'json-arg',
		outputFormat = 'json',
		commands = [],
		errors = [],
		jobs = [],
	} = options;

	return {
		name,
		version,

		cli: {
			command: cliCommand,
			defaultArgs,
			inputFormat,
			outputFormat,
		},

		fixture: {
			async apply(fixture: unknown, context: AdapterContext): Promise<ApplyFixtureResult> {
				return genericFixtureApplicator(fixture, context);
			},

			async reset(_context: AdapterContext): Promise<void> {
				// Generic reset - no-op by default
				// Apps should override this if they need cleanup
			},

			async validate(fixture: unknown): Promise<FixtureValidationResult> {
				return genericFixtureValidator(fixture);
			},
		},

		commands: {
			list: () => commands,
			getDescription: (cmd: string) => `Execute ${cmd} command`,
		},

		errors: {
			list: () => errors,
			getDescription: (code: string) => `Error: ${code}`,
			isRetryable: (code: string) => ['TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED'].includes(code),
		},

		jobs: {
			list: () => jobs,
			getDescription: (job: string) => `Job: ${job}`,
		},
	};
}

/**
 * Options for creating a generic adapter.
 */
export interface GenericAdapterOptions {
	/** App version */
	version?: string;

	/** CLI command to run */
	cliCommand?: string;

	/** Default CLI arguments */
	defaultArgs?: string[];

	/** How to pass JSON input */
	inputFormat?: 'json-arg' | 'json-stdin' | 'flags';

	/** Expected output format */
	outputFormat?: 'json' | 'text';

	/** List of known commands */
	commands?: string[];

	/** List of known error codes */
	errors?: string[];

	/** List of known jobs */
	jobs?: string[];
}

// ============================================================================
// Generic Fixture Handling
// ============================================================================

/**
 * Generic fixture applicator that handles common patterns.
 */
async function genericFixtureApplicator(
	fixture: unknown,
	context: AdapterContext
): Promise<ApplyFixtureResult> {
	const appliedCommands: ApplyFixtureResult['appliedCommands'] = [];
	const warnings: string[] = [];

	if (!isGenericFixture(fixture)) {
		warnings.push('Fixture does not match expected generic format');
		return { appliedCommands, warnings };
	}

	const { handler } = context;
	if (!handler) {
		warnings.push('No command handler provided, fixture not applied');
		return { appliedCommands, warnings };
	}

	// Handle 'data' array - generic data seeding
	if (fixture.data && Array.isArray(fixture.data)) {
		for (const item of fixture.data) {
			if (isDataItem(item)) {
				try {
					const result = await handler(item.command, item.input ?? {});
					appliedCommands.push({
						command: item.command,
						input: item.input,
						result,
					});
				} catch (error) {
					warnings.push(
						`Failed to apply ${item.command}: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		}
	}

	// Handle 'setup' commands - explicit setup steps
	if (fixture.setup && Array.isArray(fixture.setup)) {
		for (const step of fixture.setup) {
			if (isDataItem(step)) {
				try {
					const result = await handler(step.command, step.input ?? {});
					appliedCommands.push({
						command: step.command,
						input: step.input,
						result,
					});
				} catch (error) {
					warnings.push(
						`Failed setup step ${step.command}: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		}
	}

	return { appliedCommands, warnings };
}

/**
 * Generic fixture validator.
 */
async function genericFixtureValidator(fixture: unknown): Promise<FixtureValidationResult> {
	const errors: string[] = [];

	if (typeof fixture !== 'object' || fixture === null) {
		errors.push('Fixture must be an object');
		return { valid: false, errors };
	}

	const obj = fixture as Record<string, unknown>;

	// Check for app identifier
	if (!obj.app || typeof obj.app !== 'string') {
		errors.push("Fixture should have an 'app' field identifying the target app");
	}

	// Validate data array if present
	if (obj.data !== undefined) {
		if (!Array.isArray(obj.data)) {
			errors.push("Fixture 'data' must be an array");
		} else {
			for (let i = 0; i < obj.data.length; i++) {
				const item = obj.data[i];
				if (!isDataItem(item)) {
					errors.push(`data[${i}] must have a 'command' field`);
				}
			}
		}
	}

	// Validate setup array if present
	if (obj.setup !== undefined) {
		if (!Array.isArray(obj.setup)) {
			errors.push("Fixture 'setup' must be an array");
		} else {
			for (let i = 0; i < obj.setup.length; i++) {
				const step = obj.setup[i];
				if (!isDataItem(step)) {
					errors.push(`setup[${i}] must have a 'command' field`);
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors: errors.length > 0 ? errors : undefined,
	};
}

// ============================================================================
// Type Guards
// ============================================================================

interface GenericFixture {
	app?: string;
	data?: unknown[];
	setup?: unknown[];
	[key: string]: unknown;
}

interface DataItem {
	command: string;
	input?: Record<string, unknown>;
}

function isGenericFixture(value: unknown): value is GenericFixture {
	return typeof value === 'object' && value !== null;
}

function isDataItem(value: unknown): value is DataItem {
	return (
		typeof value === 'object' &&
		value !== null &&
		'command' in value &&
		typeof (value as Record<string, unknown>).command === 'string'
	);
}

// ============================================================================
// Default Generic Adapter
// ============================================================================

/**
 * Default generic adapter instance.
 * Used as fallback when no specific adapter is found.
 */
export const genericAdapter = createGenericAdapter('generic', {
	version: '1.0.0',
	cliCommand: 'app',
});
