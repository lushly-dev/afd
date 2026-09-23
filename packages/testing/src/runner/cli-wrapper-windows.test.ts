/**
 * CliWrapper spawn arguments per platform, with child_process mocked so the Windows
 * branch runs on any OS. Real subprocess tests live in cli-wrapper.test.ts.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliWrapper } from './cli-wrapper.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const mockSpawn = vi.mocked(spawn);
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
}

function fakeChild(stdout: string): ChildProcess {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(),
	});
	setImmediate(() => {
		child.stdout.on('end', () => child.emit('close', 0));
		child.stdout.end(stdout);
		child.stderr.end();
	});
	return child as unknown as ChildProcess;
}

describe('CliWrapper spawn arguments', () => {
	const input = { title: 'x & calc "quoted"' };
	const args = [
		'call',
		'todo-create',
		JSON.stringify(input),
		'--connect',
		'http://test.example/mcp',
		'--transport',
		'http',
		'--format',
		'json',
	];

	beforeEach(() => {
		mockSpawn.mockReset();
		mockSpawn.mockImplementation((() =>
			fakeChild('{"success":true,"data":{}}')) as unknown as typeof spawn);
	});

	afterEach(() => {
		if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
	});

	it('spawns the CLI directly without a shell on non-Windows platforms', async () => {
		setPlatform('linux');
		const wrapper = new CliWrapper({ cliPath: 'afd', serverUrl: 'http://test.example/mcp' });

		const result = await wrapper.execute('todo-create', input);

		expect(result.success).toBe(true);
		expect(mockSpawn).toHaveBeenCalledWith(
			'afd',
			args,
			expect.objectContaining({ shell: false, windowsVerbatimArguments: false })
		);
	});

	it('escapes every argument for cmd.exe on Windows', async () => {
		setPlatform('win32');
		const wrapper = new CliWrapper({
			// portability-ok: Windows path fixture for spawn-escaping tests
			cliPath: 'C:\\tools\\afd.cmd',
			serverUrl: 'http://test.example/mcp',
			// portability-ok: Windows path fixture for spawn-escaping tests
			env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
		});

		const result = await wrapper.execute('todo-create', input);

		expect(result.success).toBe(true);
		expect(mockSpawn).toHaveBeenCalledWith(
			// portability-ok: Windows path fixture for spawn-escaping tests
			'C:\\Windows\\system32\\cmd.exe',
			[
				'/d',
				'/s',
				'/c',
				// portability-ok: Windows path fixture for spawn-escaping tests
				String.raw`"C:\tools\afd.cmd ^"call^" ^"todo-create^" ^"{\^"title\^":\^"x^ ^&^ calc^ \\\^"quoted\\\^"\^"}^" ^"--connect^" ^"http://test.example/mcp^" ^"--transport^" ^"http^" ^"--format^" ^"json^""`,
			],
			expect.objectContaining({ shell: false, windowsVerbatimArguments: true })
		);
	});
});
