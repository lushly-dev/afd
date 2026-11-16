/**
 * @fileoverview The data directory (phase 6 specification, section 4): created 0700, and the written site
 * at `<data>/public/site`, with nothing else under `public/`. The site is written by `writeDeployment`
 * without `mountsOut`, since that file would hold the bearers' values (3.3); the mounts stay in memory.
 */

import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type WriteDeploymentResult, writeDeployment } from '@lushly-dev/loam-cli/deployment';
import { restrictAcls } from './acl.js';

export const PUBLIC_DIRECTORY = 'public';
export const SITE_DIRECTORY = join(PUBLIC_DIRECTORY, 'site');

/**
 * Creates the data directory 0700 when it is missing, and on Windows makes the one it created private
 * by ACL, since a new directory inherits its parent's. Its mode or ACL, when it exists, is the check's.
 */
export async function ensureDataDirectory(data: string): Promise<void> {
	const created = await mkdir(data, { recursive: true, mode: 0o700 });
	if (created !== undefined && process.platform === 'win32') restrictAcls([data]);
}

/** Every file 0600 and every directory 0700, below `directory` and itself. */
export async function makePrivate(directory: string): Promise<void> {
	await chmod(directory, 0o700);
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await makePrivate(path);
		else if (entry.isFile()) await chmod(path, 0o600);
	}
}

/**
 * Writes the deployment into `<data>/public/site`, replacing whatever `public/` held. The caller holds
 * the lock, so no other process reads or writes it meanwhile.
 */
export async function writeSite(options: {
	data: string;
	deployment: string;
	dist: string;
	/** The development profile's sandbox origin, written in place of the file's (5.1). */
	sandboxOrigin?: string;
}): Promise<WriteDeploymentResult & { site: string }> {
	const publicDirectory = join(options.data, PUBLIC_DIRECTORY);
	const site = join(options.data, SITE_DIRECTORY);
	await rm(publicDirectory, { recursive: true, force: true });
	await mkdir(publicDirectory, { mode: 0o700 });
	// Private before anything is written in it, so every file inherits that: on Windows a file takes
	// its directory's ACL when it is created, and a later change to the directory does not reach it.
	if (process.platform === 'win32') restrictAcls([publicDirectory]);
	const written = await writeDeployment({
		config: options.deployment,
		dist: options.dist,
		out: site,
		// `--host hosted` (3.3): the projection names the hosted server; `loam-host` serves nothing else.
		host: 'hosted',
		...(options.sandboxOrigin === undefined ? {} : { sandboxOrigin: options.sandboxOrigin }),
	});
	if (written.ok) await makePrivate(publicDirectory);
	return { ...written, site };
}
