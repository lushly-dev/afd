/**
 * @fileoverview Cross-platform utilities for subprocess execution
 * and path operations. Abstracts Windows/macOS/Linux differences.
 *
 * All imports must use .js extension for ESM module resolution.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { sep } from 'node:path';
import { findUpSync } from 'find-up';

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Whether the current platform is Windows */
export const isWindows = process.platform === 'win32';

/** Whether the current platform is macOS */
export const isMac = process.platform === 'darwin';

/** Whether the current platform is Linux */
export const isLinux = process.platform === 'linux';

// ═══════════════════════════════════════════════════════════════════════════════
// EXEC TYPES AND ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

/** Error codes for exec() failures */
export enum ExecErrorCode {
	/** Process exceeded timeout */
	TIMEOUT = 'TIMEOUT',
	/** Process was killed by a signal */
	SIGNAL = 'SIGNAL',
	/** Process exited with non-zero exit code */
	EXIT_CODE = 'EXIT_CODE',
	/** Failed to spawn the process */
	SPAWN_FAILED = 'SPAWN_FAILED',
}

/** Options for cross-platform exec */
export interface ExecOptions {
	/** Working directory */
	cwd?: string;
	/** Timeout in milliseconds */
	timeout?: number;
	/** Enable debug logging of commands (default: false) */
	debug?: boolean;
	/** Environment variables to merge with process.env */
	env?: Record<string, string>;
}

/** Result from exec() with error codes for observability */
export interface ExecResult {
	/** Standard output (trimmed) */
	stdout: string;
	/** Standard error (trimmed) */
	stderr: string;
	/** Process exit code */
	exitCode: number;
	/** Error code if failed, undefined if success */
	errorCode?: ExecErrorCode;
	/** Duration in milliseconds */
	durationMs: number;
}

/**
 * Factory function for ExecResult.
 * Follows afd-core pattern from errors.ts, streaming.ts.
 */
export function createExecResult(
	stdout: string,
	stderr: string,
	exitCode: number,
	durationMs: number,
	errorCode?: ExecErrorCode
): ExecResult {
	return { stdout, stderr, exitCode, durationMs, errorCode };
}

/**
 * Type guard: check if ExecResult indicates an error.
 */
export function isExecError(result: ExecResult): boolean {
	return result.errorCode !== undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXEC FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a command with cross-platform support.
 *
 * @param cmd - Command as array of strings [command, ...args]
 * @param options - Execution options
 * @returns Promise resolving to ExecResult
 *
 * @example
 * ```typescript
 * const result = await exec(['git', 'status']);
 * if (!isExecError(result)) {
 *   console.log(result.stdout);
 * }
 * ```
 */
export function exec(cmd: string[], options: ExecOptions = {}): Promise<ExecResult> {
	return new Promise((resolve) => {
		// Validate command
		if (!Array.isArray(cmd) || cmd.length === 0) {
			resolve(
				createExecResult('', 'Command must be a non-empty array', 1, 0, ExecErrorCode.SPAWN_FAILED)
			);
			return;
		}

		const startTime = Date.now();

		// Debug logging (command only, never output)
		if (options.debug) {
			console.log(`[exec] ${cmd.join(' ')}`);
		}

		// After validation, cmd[0] is guaranteed to exist
		const command = cmd[0] as string;
		const args = cmd.slice(1);

		let stdoutData = '';
		let stderrData = '';
		let timedOut = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		try {
			const child: ChildProcess = spawn(command, args, {
				cwd: options.cwd,
				env: options.env ? { ...process.env, ...options.env } : process.env,
				shell: isWindows,
			});

			// Handle timeout
			if (options.timeout && options.timeout > 0) {
				timeoutId = setTimeout(() => {
					timedOut = true;
					child.kill('SIGKILL');
				}, options.timeout);
			}

			child.stdout?.on('data', (data: Buffer) => {
				stdoutData += data.toString();
			});

			child.stderr?.on('data', (data: Buffer) => {
				stderrData += data.toString();
			});

			child.on('error', (error: Error) => {
				if (timeoutId) clearTimeout(timeoutId);
				const durationMs = Date.now() - startTime;
				resolve(
					createExecResult(
						stdoutData.trim(),
						error.message,
						1,
						durationMs,
						ExecErrorCode.SPAWN_FAILED
					)
				);
			});

			child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
				if (timeoutId) clearTimeout(timeoutId);
				const durationMs = Date.now() - startTime;
				const exitCode = code ?? 1;

				if (timedOut) {
					resolve(
						createExecResult(
							stdoutData.trim(),
							stderrData.trim(),
							exitCode,
							durationMs,
							ExecErrorCode.TIMEOUT
						)
					);
				} else if (signal) {
					resolve(
						createExecResult(
							stdoutData.trim(),
							stderrData.trim(),
							exitCode,
							durationMs,
							ExecErrorCode.SIGNAL
						)
					);
				} else if (exitCode !== 0) {
					resolve(
						createExecResult(
							stdoutData.trim(),
							stderrData.trim(),
							exitCode,
							durationMs,
							ExecErrorCode.EXIT_CODE
						)
					);
				} else {
					resolve(createExecResult(stdoutData.trim(), stderrData.trim(), 0, durationMs));
				}
			});
		} catch (error) {
			const durationMs = Date.now() - startTime;
			const message = error instanceof Error ? error.message : String(error);
			resolve(createExecResult('', message, 1, durationMs, ExecErrorCode.SPAWN_FAILED));
		}
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find a file by walking up parent directories.
 *
 * @param filename - Name of file to find
 * @param cwd - Starting directory (defaults to process.cwd())
 * @returns Absolute path to found file, or null if not found
 *
 * @example
 * ```typescript
 * const packageJson = findUp('package.json');
 * if (packageJson) {
 *   console.log('Found at:', packageJson);
 * }
 * ```
 */
export function findUp(filename: string, cwd?: string): string | null {
	const result = findUpSync(filename, { cwd: cwd ?? process.cwd() });
	return result ?? null;
}

/**
 * Get the system temporary directory.
 *
 * @returns Path to the system temp directory
 *
 * @example
 * ```typescript
 * const tempDir = getTempDir();
 * // Windows: 'C:\\Users\\...\\AppData\\Local\\Temp'
 * // macOS/Linux: '/tmp'
 * ```
 */
export function getTempDir(): string {
	return tmpdir();
}

/**
 * Normalize a path to use the platform's path separator.
 *
 * @param path - Path with mixed separators
 * @returns Path with consistent separators
 *
 * @example
 * ```typescript
 * // On Windows:
 * normalizePath('foo/bar\\baz'); // 'foo\\bar\\baz'
 * // On macOS/Linux:
 * normalizePath('foo/bar\\baz'); // 'foo/bar/baz'
 * ```
 */
export function normalizePath(path: string): string {
	return path.replace(/[/\\]/g, sep);
}
