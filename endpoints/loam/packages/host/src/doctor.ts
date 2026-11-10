/**
 * @fileoverview `loam-host doctor`'s read-only part (phase 6 specification, 3.8): `check`, the lock's
 * holder as `.lock` reports it, the data directory's files and sizes, and which of them to back up. It
 * never takes the lock and never opens `lock.sqlite`: even a read there takes a shared lock, which a
 * server starting at that moment, with its busy timeout of 0, would meet as `HOST_DATA_LOCKED`. The
 * databases' own reports (the binding, `IDENTITY_BINDING_MISMATCH`) and the instances' reachability come
 * with the steps that build them.
 */

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import { checkHost } from './check.js';
import type { HostFinding } from './errors.js';
import { type LockInfo, readLockInfo } from './lock.js';

/** What a deployer copies to keep a hosted workspace (section 4's Backups). */
export const BACKUP_FILES = ['loam.sqlite', 'auth.sqlite'] as const;

export interface DataFile {
	/** The path in the data directory, `/`-separated; a directory ends with `/`. */
	path: string;
	/** Bytes: a directory's is the sum of the files below it. */
	bytes: number;
}

export interface DoctorReport {
	refusals: HostFinding[];
	warnings: HostFinding[];
	/** `.lock`'s holder, or `null` when there is none or it cannot be read. Informational only. */
	lock: LockInfo | null;
	/** The data directory's top-level entries, or `null` when it does not exist yet. */
	files: DataFile[] | null;
	/** Which files to back up, and whether each exists yet. */
	backup: Array<{ path: string; exists: boolean }>;
}

async function bytesBelow(path: string): Promise<number> {
	const info = await lstat(path);
	if (!info.isDirectory()) return info.isFile() ? info.size : 0;
	let total = 0;
	for (const entry of await readdir(path)) total += await bytesBelow(join(path, entry));
	return total;
}

async function listData(data: string): Promise<DataFile[] | null> {
	let entries: string[];
	try {
		entries = (await readdir(data)).sort();
	} catch {
		return null;
	}
	const files: DataFile[] = [];
	for (const name of entries) {
		const path = join(data, name);
		const info = await lstat(path);
		files.push({ path: info.isDirectory() ? `${name}/` : name, bytes: await bytesBelow(path) });
	}
	return files;
}

export async function doctorReport(options: {
	server: ServerConfigV1;
	deployment: string;
	environment?: NodeJS.ProcessEnv;
}): Promise<DoctorReport> {
	const { refusals, warnings } = await checkHost({
		server: options.server,
		deployment: options.deployment,
		purpose: 'start',
		...(options.environment ? { environment: options.environment } : {}),
	});
	const files = await listData(options.server.data);
	return {
		refusals,
		warnings,
		lock: readLockInfo(options.server.data),
		files,
		backup: BACKUP_FILES.map((path) => ({
			path,
			exists: files?.some((file) => file.path === path) ?? false,
		})),
	};
}
