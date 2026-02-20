/**
 * @fileoverview Package manager connector for npm/pnpm operations.
 */

import { type ExecOptions, type ExecResult, exec, isExecError } from '../platform.js';

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
// PACKAGE MANAGER CONNECTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connector for package manager operations (npm/pnpm).
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
