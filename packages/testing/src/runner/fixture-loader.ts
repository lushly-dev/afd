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
import type { FixtureConfig } from '../types/scenario.js';
import { type FixtureData, validateWithAdapter } from './fixture-applier.js';
import { resolveInsideRoot } from './sandbox.js';

export type {
	AppliedCommand,
	ApplyFixtureOptions,
	ApplyFixtureResult,
	FixtureCommandHandler,
	FixtureData,
} from './fixture-applier.js';
export { applyFixture } from './fixture-applier.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from loading a fixture.
 */
export type LoadFixtureResult =
	| { success: true; data: FixtureData; path: string }
	| { success: false; error: string; path?: string };

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
