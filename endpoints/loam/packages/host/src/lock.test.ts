import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostError } from './errors.js';
import {
	acquireDataLock,
	LOCK_FILE,
	LOCK_INFO_FILE,
	LOCK_STATEMENTS,
	readLockInfo,
} from './lock.js';
import { temporaryDirectory } from './test-support.js';

/**
 * Another process taking the same lock with the same statements, as a second `loam-host` would. It
 * prints `held` and stays, or prints `refused <errcode>` and exits.
 */
const CHILD = `
import { DatabaseSync } from 'node:sqlite';
const [path, statements] = [process.argv[1], JSON.parse(process.argv[2])];
const database = new DatabaseSync(path, { timeout: 0 });
try {
	for (const statement of statements) database.exec(statement);
	console.log('held');
	setInterval(() => {}, 1 << 30);
} catch (error) {
	console.log('refused ' + error.errcode);
	process.exit(0);
}
`;

const children: ChildProcess[] = [];

function otherProcess(data: string): Promise<{ child: ChildProcess; said: string }> {
	const child = spawn(
		process.execPath,
		['--input-type=module', '-e', CHILD, join(data, LOCK_FILE), JSON.stringify(LOCK_STATEMENTS)],
		{ stdio: ['ignore', 'pipe', 'inherit'] }
	);
	children.push(child);
	return new Promise((done, fail) => {
		child.stdout?.once('data', (chunk: Buffer) => done({ child, said: chunk.toString().trim() }));
		child.once('error', fail);
	});
}

afterEach(() => {
	for (const child of children.splice(0)) child.kill('SIGKILL');
});

describe('the data directory lock (section 4)', () => {
	it('refuses a second process while one holds it, and frees it when that process ends', async () => {
		const data = await temporaryDirectory();
		const lock = acquireDataLock(data);
		expect((await otherProcess(data)).said).toBe('refused 5');
		lock.release();
		const { child, said } = await otherProcess(data);
		expect(said).toBe('held');
		let refused: unknown;
		try {
			acquireDataLock(data);
		} catch (cause) {
			refused = cause;
		}
		expect(refused).toBeInstanceOf(HostError);
		expect((refused as HostError).code).toBe('HOST_DATA_LOCKED');
		// SIGKILL leaves nothing stale: the lock ends with the process.
		child.kill('SIGKILL');
		await once(child, 'exit');
		acquireDataLock(data).release();
	});

	it('uses the rollback journal and an exclusive lock, never WAL', () => {
		expect(LOCK_STATEMENTS).toContain('PRAGMA locking_mode = EXCLUSIVE');
		expect(LOCK_STATEMENTS).toContain('PRAGMA journal_mode = DELETE');
		expect(LOCK_STATEMENTS).toContain('PRAGMA busy_timeout = 0');
		expect(LOCK_STATEMENTS.join('\n')).not.toMatch(/WAL/i);
	});

	it('writes .lock beside it, 0600, informational only, and removes it on release', async () => {
		const data = await temporaryDirectory();
		const lock = acquireDataLock(data);
		const info = readLockInfo(data);
		expect(info).toEqual(lock.info);
		expect(info?.pid).toBe(process.pid);
		expect(JSON.parse(readFileSync(join(data, LOCK_INFO_FILE), 'utf8'))).toEqual(lock.info);
		expect(statSync(join(data, LOCK_INFO_FILE)).mode & 0o777).toBe(0o600);
		expect(statSync(join(data, LOCK_FILE)).mode & 0o777).toBe(0o600);
		lock.release();
		lock.release();
		expect(existsSync(join(data, LOCK_INFO_FILE))).toBe(false);
		expect(readLockInfo(data)).toBeNull();
	});
});
