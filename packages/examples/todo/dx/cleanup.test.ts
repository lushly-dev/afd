/** `node --import tsx --test dx/cleanup.test.ts`, run first by `pnpm test:interop` (#1653). */

import { rejects, strictEqual } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { exited, withTempDir } from './cleanup.js';

const enotempty = async (dir: string) => {
	throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${dir}'`), {
		code: 'ENOTEMPTY',
	});
};

test('a failed cleanup does not replace the error of the run', async () => {
	const warnings: string[] = [];
	await rejects(
		withTempDir(
			'cleanup-test-',
			async () => {
				throw new Error('the seed was written twice');
			},
			enotempty,
			(message) => warnings.push(message)
		),
		/the seed was written twice/
	);
	strictEqual(warnings.length, 1);
	strictEqual(warnings[0]?.includes('ENOTEMPTY'), true);
});

test('a failed cleanup after a passing run is a warning, not a failure', async () => {
	const warnings: string[] = [];
	const result = await withTempDir(
		'cleanup-test-',
		async () => 'ok',
		enotempty,
		(message) => warnings.push(message)
	);
	strictEqual(result, 'ok');
	strictEqual(warnings.length, 1);
});

test('the directory and the files written into it are removed', async () => {
	let seen = '';
	await withTempDir('cleanup-test-', async (dir) => {
		seen = dir;
		await writeFile(path.join(dir, 'todos.db-wal'), 'x');
	});
	strictEqual(existsSync(seen), false);
});

test('exited waits for a process to end, and gives up at its timeout', async () => {
	const quick = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
	strictEqual(await exited(quick.pid, 5000), true);

	const slow = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
	try {
		strictEqual(await exited(slow.pid, 200), false);
	} finally {
		slow.kill('SIGKILL');
	}
	strictEqual(await exited(undefined), true);
});
