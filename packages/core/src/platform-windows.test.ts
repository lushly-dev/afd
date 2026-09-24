/**
 * exec() spawn arguments per platform, with child_process and fs mocked so the Windows
 * branch runs on any OS. Real subprocess tests live in platform.test.ts.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecErrorCode, exec } from './platform.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return { ...actual, statSync: vi.fn() };
});

const mockSpawn = vi.mocked(spawn);
const mockStatSync = vi.mocked(statSync);
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
}

/** A fake child that writes the given stdout chunks, then closes with `code`. */
function fakeChild(stdoutChunks: Buffer[] = [], code = 0): ChildProcess {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(),
	});
	setImmediate(() => {
		child.stdout.on('end', () => child.emit('close', code, null));
		for (const chunk of stdoutChunks) child.stdout.write(chunk);
		child.stdout.end();
		child.stderr.end();
	});
	return child as unknown as ChildProcess;
}

const windowsEnv = {
	// portability-ok: Windows path fixture for spawn-escaping tests
	ComSpec: 'C:\\Windows\\system32\\cmd.exe',
	// portability-ok: Windows path fixture for spawn-escaping tests
	Path: 'C:\\Program Files\\GitHub CLI;C:\\Program Files\\nodejs',
	PATHEXT: '.COM;.EXE;.BAT;.CMD',
};
const existingFiles = new Set([
	// portability-ok: Windows path fixture for spawn-escaping tests
	'C:\\Program Files\\GitHub CLI\\gh.EXE',
	// portability-ok: Windows path fixture for spawn-escaping tests
	'C:\\Program Files\\nodejs\\npm.CMD',
]);

describe('exec spawn arguments', () => {
	beforeEach(() => {
		mockSpawn.mockReset();
		mockSpawn.mockImplementation((() => fakeChild()) as unknown as typeof spawn);
		mockStatSync.mockReset();
		mockStatSync.mockImplementation(((path: string) => {
			if (existingFiles.has(path)) return { isFile: () => true };
			throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
		}) as unknown as typeof statSync);
	});

	afterEach(() => {
		if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
	});

	it('spawns directly without a shell on non-Windows platforms', async () => {
		setPlatform('linux');
		const result = await exec(['gh', 'issue', 'create', '--title=x & calc'], { cwd: '/repo' });

		expect(result.errorCode).toBeUndefined();
		expect(mockSpawn).toHaveBeenCalledWith('gh', ['issue', 'create', '--title=x & calc'], {
			cwd: '/repo',
			env: process.env,
			shell: false,
			windowsVerbatimArguments: false,
		});
	});

	it('spawns a resolved .exe directly on Windows', async () => {
		setPlatform('win32');
		const args = ['issue', 'create', '--title=x & calc', '--body=a\nb'];
		// portability-ok: Windows path fixture for spawn-escaping tests
		await exec(['gh', ...args], { cwd: 'C:\\repo', env: windowsEnv });

		expect(mockSpawn).toHaveBeenCalledWith(
			// portability-ok: Windows path fixture for spawn-escaping tests
			'C:\\Program Files\\GitHub CLI\\gh.EXE',
			args,
			// portability-ok: Windows path fixture for spawn-escaping tests
			expect.objectContaining({ cwd: 'C:\\repo', shell: false, windowsVerbatimArguments: false })
		);
	});

	it('runs a .cmd shim through cmd.exe with escaped arguments on Windows', async () => {
		setPlatform('win32');
		// portability-ok: Windows path fixture for spawn-escaping tests
		await exec(['npm', 'install', 'x & calc'], { cwd: 'C:\\repo', env: windowsEnv });

		expect(mockSpawn).toHaveBeenCalledWith(
			// portability-ok: Windows path fixture for spawn-escaping tests
			'C:\\Windows\\system32\\cmd.exe',
			['/d', '/s', '/c', '"npm ^^^"install^^^" ^^^"x^^^ ^^^&^^^ calc^^^""'],
			// portability-ok: Windows path fixture for spawn-escaping tests
			expect.objectContaining({ cwd: 'C:\\repo', shell: false, windowsVerbatimArguments: true })
		);
	});

	it('runs an unresolved command through cmd.exe with escaped arguments on Windows', async () => {
		setPlatform('win32');
		// portability-ok: Windows path fixture for spawn-escaping tests
		await exec(['missing', '--title=%PATH% | calc'], { cwd: 'C:\\repo', env: windowsEnv });

		expect(mockSpawn).toHaveBeenCalledWith(
			// portability-ok: Windows path fixture for spawn-escaping tests
			'C:\\Windows\\system32\\cmd.exe',
			['/d', '/s', '/c', '"missing ^"--title=^%PATH^%^ ^|^ calc^""'],
			expect.objectContaining({ shell: false, windowsVerbatimArguments: true })
		);
	});

	it('returns SPAWN_FAILED instead of passing a line break through cmd.exe', async () => {
		setPlatform('win32');
		// portability-ok: Windows path fixture for spawn-escaping tests
		const result = await exec(['npm', 'run', 'a\nb'], { cwd: 'C:\\repo', env: windowsEnv });

		expect(result.errorCode).toBe(ExecErrorCode.SPAWN_FAILED);
		expect(result.stderr).toContain('line break');
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('decodes multibyte characters split across chunks', async () => {
		setPlatform('linux');
		const bytes = Buffer.from('héllo 😀', 'utf8');
		mockSpawn.mockImplementation((() =>
			fakeChild([
				bytes.subarray(0, 2),
				bytes.subarray(2, 9),
				bytes.subarray(9),
			])) as unknown as typeof spawn);

		const result = await exec(['echo']);

		expect(result.stdout).toBe('héllo 😀');
	});

	it('stops capturing at maxOutputBytes, kills the child and drops a cut character', async () => {
		setPlatform('linux');
		const child = fakeChild([Buffer.from('hé', 'utf8'), Buffer.from('llo', 'utf8')]);
		mockSpawn.mockImplementation((() => child) as unknown as typeof spawn);

		// 'h' is 1 byte and 'é' 2 bytes: a 2-byte limit cuts 'é' in half.
		const result = await exec(['echo'], { maxOutputBytes: 2 });

		expect(result.errorCode).toBe(ExecErrorCode.OUTPUT_LIMIT_EXCEEDED);
		expect(result.stdout).toBe('h');
		expect(child.kill).toHaveBeenCalledTimes(1);
		expect(child.kill).toHaveBeenCalledWith('SIGKILL');
	});
});
