/**
 * @fileoverview Package manager connector for npm/pnpm operations.
 */

import {
	createExecResult,
	ExecErrorCode,
	type ExecOptions,
	type ExecResult,
	exec,
	isExecError,
} from '../platform.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Supported package managers */
export type PackageManager = 'npm' | 'pnpm';

/** Options for PackageManagerConnector */
export interface PackageManagerConnectorOptions {
	/** Enable debug logging of commands */
	debug?: boolean;
	/** Working directory for commands */
	cwd?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * npm package name (`name` or `@scope/name`: URL-safe characters, not starting with `.`, `_`
 * or `-`), optionally followed by `@version`, `@range` or `@tag`. Aliases, URLs, and
 * repository or file specs are not accepted.
 */
const PACKAGE_SPEC_PATTERN =
	/^(?<name>(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*)(?:@[a-z0-9.+^~<>=*| -]+)?$/i;

/** Maximum npm package name length. */
const MAX_PACKAGE_NAME_LENGTH = 214;

/** Conservative package.json script name, e.g. `build`, `test:unit`, `lint-fix`. */
const SCRIPT_NAME_PATTERN = /^[a-z0-9_][a-z0-9_.:+/-]*$/i;

const MAX_SCRIPT_NAME_LENGTH = 128;

function isValidPackageSpec(pkg: string): boolean {
	const name = PACKAGE_SPEC_PATTERN.exec(pkg)?.groups?.name;
	return name !== undefined && name.length <= MAX_PACKAGE_NAME_LENGTH;
}

function isValidScriptName(script: string): boolean {
	return script.length <= MAX_SCRIPT_NAME_LENGTH && SCRIPT_NAME_PATTERN.test(script);
}

/** An error result for input rejected before anything is spawned. */
function invalidInput(message: string): ExecResult {
	return createExecResult('', message, 1, 0, ExecErrorCode.SPAWN_FAILED);
}

function invalidPackage(pkg: string): ExecResult {
	return invalidInput(
		`Invalid package name ${JSON.stringify(pkg)}. Use an npm package name such as "lodash", "@scope/name" or "name@^1.2.3".`
	);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PACKAGE MANAGER CONNECTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connector for package manager operations (npm/pnpm).
 *
 * Package and script names are validated before anything runs. An invalid name returns an
 * ExecResult with `errorCode: SPAWN_FAILED` and the reason in `stderr`.
 *
 * @example
 * ```typescript
 * const pm = new PackageManagerConnector('pnpm', { debug: true });
 *
 * // Install all dependencies
 * await pm.install();
 *
 * // Install a specific package
 * await pm.install('lodash');
 *
 * // Install as dev dependency
 * await pm.install('vitest', true);
 *
 * // Run a script
 * const result = await pm.run('build');
 * ```
 */
export class PackageManagerConnector {
	private pm: PackageManager;
	private options?: PackageManagerConnectorOptions;

	constructor(pm: PackageManager = 'npm', options?: PackageManagerConnectorOptions) {
		this.pm = pm;
		this.options = options;
	}

	/**
	 * Install dependencies.
	 *
	 * @param pkg - Optional package name to install
	 * @param dev - If true, install as dev dependency
	 * @returns ExecResult from the install command
	 */
	async install(pkg?: string, dev?: boolean): Promise<ExecResult> {
		if (pkg && !isValidPackageSpec(pkg)) {
			return invalidPackage(pkg);
		}

		const cmd: string[] = [this.pm, 'install'];

		if (pkg) {
			cmd.push(pkg);
		}

		if (dev) {
			cmd.push('--save-dev');
		}

		return this.execPm(cmd);
	}

	/**
	 * Run a package.json script.
	 *
	 * @param script - Script name from package.json
	 * @returns ExecResult from the run command
	 */
	async run(script: string): Promise<ExecResult> {
		if (!isValidScriptName(script)) {
			return invalidInput(
				`Invalid script name ${JSON.stringify(script)}. Use a package.json script name such as "build" or "test:unit".`
			);
		}

		const cmd: string[] = [this.pm, 'run', script];
		return this.execPm(cmd);
	}

	/**
	 * Add a package to dependencies.
	 *
	 * @param pkg - Package name (with optional version)
	 * @param dev - If true, add as dev dependency
	 * @returns ExecResult from the add command
	 */
	async add(pkg: string, dev?: boolean): Promise<ExecResult> {
		if (!isValidPackageSpec(pkg)) {
			return invalidPackage(pkg);
		}

		const cmd: string[] = [this.pm, 'add', pkg];

		if (dev) {
			cmd.push('--save-dev');
		}

		return this.execPm(cmd);
	}

	/**
	 * Remove a package from dependencies.
	 *
	 * @param pkg - Package name to remove
	 * @returns ExecResult from the remove command
	 */
	async remove(pkg: string): Promise<ExecResult> {
		if (!isValidPackageSpec(pkg)) {
			return invalidPackage(pkg);
		}

		const cmd: string[] = [this.pm, 'remove', pkg];
		return this.execPm(cmd);
	}

	/**
	 * Check if a command succeeded.
	 *
	 * @param result - ExecResult to check
	 * @returns true if the command succeeded
	 */
	isSuccess(result: ExecResult): boolean {
		return !isExecError(result);
	}

	/**
	 * Execute a package manager command.
	 */
	private execPm(cmd: string[]): Promise<ExecResult> {
		const execOptions: ExecOptions = {};

		if (this.options?.debug) {
			execOptions.debug = true;
		}

		if (this.options?.cwd) {
			execOptions.cwd = this.options.cwd;
		}

		return exec(cmd, execOptions);
	}
}
