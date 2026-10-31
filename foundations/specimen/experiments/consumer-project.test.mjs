import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readGitState } from './consumer-project.mjs';
import { contentDigest } from './inputs/freeze.mjs';

describe('readGitState for frozen snapshots', () => {
	let directory;
	let snapshot;
	const previous = process.env.SPECIMEN_FROZEN_MANIFESTS;
	const source = async (overrides = {}) => ({
		revision: 'a'.repeat(40),
		tree: 'b'.repeat(40),
		missing: [],
		modified: [],
		snapshotDigest: await contentDigest(snapshot),
		...overrides,
	});
	const manifest = async (name, body) => {
		const file = join(directory, name);
		await writeFile(file, typeof body === 'string' ? body : JSON.stringify(body));
		return file;
	};
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), 'specimen-frozen-'));
		snapshot = await mkdtemp(join(tmpdir(), 'specimen-snapshot-'));
		await writeFile(join(snapshot, 'component.ts'), 'export const value = 1;\n');
	});
	afterEach(async () => {
		if (previous === undefined) delete process.env.SPECIMEN_FROZEN_MANIFESTS;
		else process.env.SPECIMEN_FROZEN_MANIFESTS = previous;
		await writeFile(join(snapshot, 'component.ts'), 'export const value = 1;\n');
	});
	afterAll(async () => {
		await rm(directory, { recursive: true, force: true });
		await rm(snapshot, { recursive: true, force: true });
	});

	it('rejects a non-Git root with no listed manifest', async () => {
		delete process.env.SPECIMEN_FROZEN_MANIFESTS;
		await expect(readGitState(snapshot)).rejects.toThrow(/neither a listed frozen snapshot/);
	});

	it('uses a matching manifest and ignores manifests for other roots', async () => {
		const other = await manifest('other.json', { snapshot: directory, source: await source() });
		const own = await manifest('own.json', { snapshot, source: await source() });
		process.env.SPECIMEN_FROZEN_MANIFESTS = [other, own].join(':');
		const state = await readGitState(snapshot);
		expect(state).toMatchObject({ root: snapshot, revision: 'a'.repeat(40), status: '' });
		expect(state.frozen.tree).toBe('b'.repeat(40));
	});

	it('reports a snapshot edited after freezing as not clean', async () => {
		process.env.SPECIMEN_FROZEN_MANIFESTS = await manifest('edited.json', {
			snapshot,
			source: await source(),
		});
		const before = await readGitState(snapshot);
		await writeFile(join(snapshot, 'component.ts'), 'export const value = 2;\n');
		const after = await readGitState(snapshot);
		expect(after.status).toBe('snapshot changed since freeze');
		expect(after).not.toEqual(before);
	});

	it('prefers a listed manifest over an enclosing Git work tree', async () => {
		const repository = await mkdtemp(join(tmpdir(), 'specimen-outer-'));
		execFileSync('git', ['init', '-q', repository]);
		const nested = join(repository, 'snapshot');
		await mkdir(nested);
		await writeFile(join(nested, 'file.txt'), 'x\n');
		process.env.SPECIMEN_FROZEN_MANIFESTS = await manifest('nested.json', {
			snapshot: nested,
			source: {
				revision: 'c'.repeat(40),
				tree: null,
				missing: [],
				modified: [],
				snapshotDigest: await contentDigest(nested),
			},
		});
		const state = await readGitState(nested);
		expect(state.revision).toBe('c'.repeat(40));
		expect(state.status).toBe('');
		await rm(repository, { recursive: true, force: true });
	});

	it('rejects drift, missing fields and unreadable manifests with named errors', async () => {
		process.env.SPECIMEN_FROZEN_MANIFESTS = await manifest('drift.json', {
			snapshot,
			source: await source({ modified: [{ path: 'x', difference: 'content' }] }),
		});
		await expect(readGitState(snapshot)).rejects.toThrow(/does not match its revision/);
		process.env.SPECIMEN_FROZEN_MANIFESTS = await manifest('old.json', {
			snapshot,
			source: { revision: 'a'.repeat(40), missing: [], modified: [] },
		});
		await expect(readGitState(snapshot)).rejects.toThrow(/lacks source binding fields/);
		const garbled = await manifest('garbled.json', '{');
		process.env.SPECIMEN_FROZEN_MANIFESTS = garbled;
		await expect(readGitState(snapshot)).rejects.toThrow(
			/Cannot read frozen manifest .*garbled\.json/
		);
	});
});
