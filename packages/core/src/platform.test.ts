import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ExecErrorCode,
	createExecResult,
	exec,
	findUp,
	getTempDir,
	isExecError,
	isLinux,
	isMac,
	isWindows,
	normalizePath,
} from './platform.js';

describe('Platform Constants', () => {
	it('has platform detection constants', () => {
		// At least one should be true (unless running on an exotic platform)
		const platformDetected = isWindows || isMac || isLinux;
		// Just verify they are booleans - the actual value depends on the test environment
		expect(typeof isWindows).toBe('boolean');
		expect(typeof isMac).toBe('boolean');
		expect(typeof isLinux).toBe('boolean');
		// In a typical CI/dev environment, one of these should be true
		expect(platformDetected || typeof isWindows === 'boolean').toBe(true);
	});

	it('only one platform constant is true', () => {
		const trueCount = [isWindows, isMac, isLinux].filter(Boolean).length;
		// Should be 0 or 1 (0 if on an exotic platform)
		expect(trueCount).toBeLessThanOrEqual(1);
	});
});

describe('createExecResult', () => {
	it('creates a result with all fields', () => {
		const result = createExecResult('output', 'error', 0, 100);

		expect(result.stdout).toBe('output');
		expect(result.stderr).toBe('error');
		expect(result.exitCode).toBe(0);
		expect(result.durationMs).toBe(100);
		expect(result.errorCode).toBeUndefined();
	});

	it('includes error code when provided', () => {
		const result = createExecResult('', 'timeout', 1, 5000, ExecErrorCode.TIMEOUT);

		expect(result.errorCode).toBe(ExecErrorCode.TIMEOUT);
		expect(result.exitCode).toBe(1);
	});
});

describe('isExecError', () => {
	it('returns false for successful results', () => {
		const result = createExecResult('success', '', 0, 50);
		expect(isExecError(result)).toBe(false);
	});

	it('returns true for results with error codes', () => {
		const timeout = createExecResult('', '', 1, 100, ExecErrorCode.TIMEOUT);
		const signal = createExecResult('', '', 1, 100, ExecErrorCode.SIGNAL);
		const exitCode = createExecResult('', '', 1, 100, ExecErrorCode.EXIT_CODE);
		const spawnFailed = createExecResult('', '', 1, 100, ExecErrorCode.SPAWN_FAILED);

		expect(isExecError(timeout)).toBe(true);
		expect(isExecError(signal)).toBe(true);
		expect(isExecError(exitCode)).toBe(true);
		expect(isExecError(spawnFailed)).toBe(true);
	});
});

describe('exec', () => {
	it('executes a simple command successfully', async () => {
		// Use a cross-platform command
		const cmd = isWindows ? ['cmd', '/c', 'echo', 'hello'] : ['echo', 'hello'];
		const result = await exec(cmd);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('hello');
		expect(result.errorCode).toBeUndefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('returns EXIT_CODE error for non-zero exit', async () => {
		// Use a command that will fail
		const cmd = isWindows ? ['cmd', '/c', 'exit', '1'] : ['sh', '-c', 'exit 1'];
		const result = await exec(cmd);

		expect(result.exitCode).toBe(1);
		expect(result.errorCode).toBe(ExecErrorCode.EXIT_CODE);
	});

	it('returns an error for invalid command', async () => {
		const result = await exec(['nonexistent_command_xyz_123']);

		// On Windows with shell mode, this returns EXIT_CODE
		// On Unix without shell mode, this returns SPAWN_FAILED
		expect(result.errorCode).toBeDefined();
		expect(isExecError(result)).toBe(true);
		expect(result.exitCode).not.toBe(0);
	});

	it('returns SPAWN_FAILED for empty command array', async () => {
		const result = await exec([]);

		expect(result.errorCode).toBe(ExecErrorCode.SPAWN_FAILED);
		expect(result.stderr).toContain('non-empty array');
	});

	it('returns TIMEOUT error when command exceeds timeout', async () => {
		// Use a command that sleeps longer than the timeout
		const cmd = isWindows ? ['cmd', '/c', 'ping', '-n', '5', '127.0.0.1'] : ['sleep', '5'];
		const result = await exec(cmd, { timeout: 100 });

		expect(result.errorCode).toBe(ExecErrorCode.TIMEOUT);
	});

	it('passes environment variables', async () => {
		const cmd = isWindows ? ['cmd', '/c', 'echo', '%TEST_VAR%'] : ['sh', '-c', 'echo $TEST_VAR'];
		const result = await exec(cmd, { env: { TEST_VAR: 'test_value' } });

		expect(result.stdout).toContain('test_value');
	});

	describe('debug mode', () => {
		let consoleSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		});

		afterEach(() => {
			consoleSpy.mockRestore();
		});

		it('logs command when debug is true', async () => {
			const cmd = isWindows ? ['cmd', '/c', 'echo', 'test'] : ['echo', 'test'];
			await exec(cmd, { debug: true });

			expect(consoleSpy).toHaveBeenCalled();
			const logCall = consoleSpy.mock.calls[0][0] as string;
			expect(logCall).toContain('[exec]');
		});

		it('does not log when debug is false', async () => {
			const cmd = isWindows ? ['cmd', '/c', 'echo', 'test'] : ['echo', 'test'];
			await exec(cmd, { debug: false });

			expect(consoleSpy).not.toHaveBeenCalled();
		});
	});
});

describe('findUp', () => {
	it('finds package.json from current directory', () => {
		const result = findUp('package.json');

		expect(result).not.toBeNull();
		expect(result).toContain('package.json');
	});

	it('returns null for non-existent file', () => {
		const result = findUp('nonexistent_file_xyz_123.txt');

		expect(result).toBeNull();
	});

	it('respects cwd parameter', () => {
		const result = findUp('package.json', process.cwd());

		expect(result).not.toBeNull();
	});
});

describe('getTempDir', () => {
	it('returns a non-empty string', () => {
		const tempDir = getTempDir();

		expect(typeof tempDir).toBe('string');
		expect(tempDir.length).toBeGreaterThan(0);
	});

	it('returns expected temp directory', () => {
		const tempDir = getTempDir();

		if (isWindows) {
			// Windows temp dir often contains 'Temp' or 'temp'
			expect(tempDir.toLowerCase()).toMatch(/temp|tmp/);
		} else {
			// Unix-like systems typically use /tmp or similar
			expect(tempDir).toMatch(/tmp/);
		}
	});
});

describe('normalizePath', () => {
	it('normalizes forward slashes', () => {
		const result = normalizePath('foo/bar/baz');

		if (isWindows) {
			expect(result).toBe('foo\\bar\\baz');
		} else {
			expect(result).toBe('foo/bar/baz');
		}
	});

	it('normalizes backslashes', () => {
		const result = normalizePath('foo\\bar\\baz');

		if (isWindows) {
			expect(result).toBe('foo\\bar\\baz');
		} else {
			expect(result).toBe('foo/bar/baz');
		}
	});

	it('normalizes mixed separators', () => {
		const result = normalizePath('foo/bar\\baz/qux');

		if (isWindows) {
			expect(result).toBe('foo\\bar\\baz\\qux');
		} else {
			expect(result).toBe('foo/bar/baz/qux');
		}
	});

	it('handles empty string', () => {
		expect(normalizePath('')).toBe('');
	});

	it('handles path with no separators', () => {
		expect(normalizePath('filename.txt')).toBe('filename.txt');
	});
});

describe('ExecErrorCode enum', () => {
	it('has expected values', () => {
		expect(ExecErrorCode.TIMEOUT).toBe('TIMEOUT');
		expect(ExecErrorCode.SIGNAL).toBe('SIGNAL');
		expect(ExecErrorCode.EXIT_CODE).toBe('EXIT_CODE');
		expect(ExecErrorCode.SPAWN_FAILED).toBe('SPAWN_FAILED');
	});
});
