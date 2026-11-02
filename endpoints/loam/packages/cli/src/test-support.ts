/** Temporary directories for the suites, removed after each test. */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const made: string[] = [];

export async function temporaryDirectory(): Promise<string> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'loam-cli-')));
	made.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
