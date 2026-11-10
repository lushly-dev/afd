/**
 * @fileoverview The data directory's lock (phase 6 specification, section 4): the operating system's,
 * on `lock.sqlite`. `PRAGMA locking_mode = EXCLUSIVE` with the rollback journal (never WAL, whose shared
 * memory would not hold an exclusive lock across processes) and a busy timeout of 0, one write, and the
 * connection kept open for the process's life. A second process opens the file without error and meets
 * `SQLITE_BUSY` on its first statement. The lock ends with the process however it ends, so nothing is
 * ever stale. `.lock` beside it is informational: nothing reads it as a rule.
 */

import { chmodSync, closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HostError } from './errors.js';

export const LOCK_FILE = 'lock.sqlite';
export const LOCK_INFO_FILE = '.lock';

/** `.lock`'s contents: who holds the directory, for `doctor` and people. */
export interface LockInfo {
	pid: number;
	startedAt: string;
	host: string;
}

export interface DataLock {
	readonly info: LockInfo;
	/** Closes the connection, which releases the lock, and removes `.lock` if it is still this one's. */
	release(): void;
}

/**
 * What the holder runs, in order, on a connection with a busy timeout of 0, and keeps open. The first that
 * reads the file (the journal mode) meets `SQLITE_BUSY` in a second process; the write makes the lock
 * exclusive for as long as the connection lives.
 */
export const LOCK_STATEMENTS: readonly string[] = Object.freeze([
	'PRAGMA busy_timeout = 0',
	'PRAGMA locking_mode = EXCLUSIVE',
	'PRAGMA journal_mode = DELETE',
	'CREATE TABLE IF NOT EXISTS holder (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL)',
	"INSERT OR REPLACE INTO holder (id, at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
]);

/** SQLite's `SQLITE_BUSY` and `SQLITE_LOCKED`, as `node:sqlite` reports them in `errcode`. */
const LOCKED_CODES = new Set([5, 6]);

function lockedError(data: string): HostError {
	return new HostError([
		{
			code: 'HOST_DATA_LOCKED',
			key: data,
			message: 'Another process holds this data directory.',
			suggestion:
				'Stop the other `loam-host` first; `loam-host doctor` names the holder `.lock` reports.',
		},
	]);
}

/** Takes the lock on `<data>/lock.sqlite`, or throws `HOST_DATA_LOCKED`. */
export function acquireDataLock(data: string): DataLock {
	const path = join(data, LOCK_FILE);
	// Created 0600 before SQLite opens it, so it and its journal, which copies its mode, stay private.
	closeSync(openSync(path, 'a', 0o600));
	chmodSync(path, 0o600);
	let database: DatabaseSync;
	try {
		database = new DatabaseSync(path, { timeout: 0 });
	} catch (cause) {
		if (LOCKED_CODES.has((cause as { errcode?: number }).errcode ?? -1)) throw lockedError(data);
		throw cause;
	}
	try {
		for (const statement of LOCK_STATEMENTS) database.exec(statement);
	} catch (cause) {
		database.close();
		if (LOCKED_CODES.has((cause as { errcode?: number }).errcode ?? -1)) throw lockedError(data);
		throw cause;
	}
	const info: LockInfo = {
		pid: process.pid,
		startedAt: new Date().toISOString(),
		host: hostname(),
	};
	const infoPath = join(data, LOCK_INFO_FILE);
	// Removed first, since a mode applies only when a file is created.
	rmSync(infoPath, { force: true });
	writeFileSync(infoPath, `${JSON.stringify(info)}\n`, { mode: 0o600, flag: 'wx' });
	let released = false;
	return {
		info,
		release() {
			if (released) return;
			released = true;
			if (readLockInfo(data)?.pid === info.pid) rmSync(infoPath, { force: true });
			database.close();
		},
	};
}

/** `.lock` as written, or `null`; never opens `lock.sqlite`, so it cannot race a server taking it. */
export function readLockInfo(data: string): LockInfo | null {
	try {
		const parsed = JSON.parse(
			readFileSync(join(data, LOCK_INFO_FILE), 'utf8')
		) as Partial<LockInfo>;
		return typeof parsed.pid === 'number' &&
			typeof parsed.startedAt === 'string' &&
			typeof parsed.host === 'string'
			? { pid: parsed.pid, startedAt: parsed.startedAt, host: parsed.host }
			: null;
	} catch {
		return null;
	}
}
