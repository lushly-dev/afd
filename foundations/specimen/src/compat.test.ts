import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, DiscoveryError } from './bench.js';

// CSF compatibility discovery against the incumbent: Storybook's own indexer reads the same
// fixtures, and the two must agree on every identity and on what fails to index.
const run = promisify(execFile);
const compat = resolve(import.meta.dirname, '../compat');
const storybook = resolve(import.meta.dirname, '../node_modules/.bin/storybook');
let scratch: string;

interface IndexEntry {
	id: string;
	title: string;
	name: string;
	importPath: string;
	exportName: string;
	tags: string[];
	type: string;
}

/** Storybook's index of one fixture project, or its indexing error. */
async function storybookIndex(
	directory: string
): Promise<{ entries: IndexEntry[] } | { error: string }> {
	const output = join(scratch, `${directory.replaceAll('/', '-')}.json`);
	// Spawned tools must not inherit a hook's Git environment.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	try {
		await run(storybook, ['index', '-c', '.storybook', '-o', output], {
			cwd: join(compat, directory),
			env: { ...env, STORYBOOK_DISABLE_TELEMETRY: '1' },
		});
	} catch (error) {
		const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
		return { error: `${stdout}\n${stderr}` };
	}
	const index = JSON.parse(await readFile(output, 'utf8')) as {
		entries: Record<string, IndexEntry>;
	};
	return { entries: Object.values(index.entries).filter((entry) => entry.type === 'story') };
}

/** The fields both indexes must agree on; Storybook's entries carry others too. */
const identity = (entry: {
	id: string;
	title: string;
	name: string;
	importPath: string;
	exportName: string;
	tags: string[];
}) => ({
	id: entry.id,
	title: entry.title,
	name: entry.name,
	importPath: entry.importPath,
	exportName: entry.exportName,
	tags: [...entry.tags].sort(),
});

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'specimen-compat-'));
});
afterAll(async () => {
	if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('CSF compatibility discovery agrees with Storybook', () => {
	it('gives every fixture story the id, title, name, import path and tags Storybook gives it', async () => {
		const expected = await storybookIndex('.');
		if ('error' in expected) throw new Error(expected.error);
		const bench = await createSpecimenBench({ root: compat });
		try {
			const listed = bench.list().map((entry) => {
				if (!entry.story) throw new Error(`${entry.id} is not a story`);
				return identity({
					id: entry.id,
					title: entry.title,
					name: entry.story.name,
					importPath: entry.module,
					exportName: entry.exportName,
					tags: entry.story.tags,
				});
			});
			expect(listed).toEqual(expected.entries.map(identity));
			const report = bench.validate();
			expect(report.valid).toBe(true);
			// Factory-built stories are indexable; what they set is only known when they run.
			expect(
				report.issues.map((issue) => [issue.severity, issue.code, issue.id, issue.field])
			).toEqual([
				['deferred', 'UNRESOLVED_ANNOTATION', 'fixtures-dynamic--made', 'story.*'],
				['deferred', 'UNRESOLVED_ANNOTATION', 'fixtures-dynamic--extended', 'story.*'],
			]);
			expect(bench.validate({ id: 'fixtures-identity-cases--named' })).toEqual({
				valid: true,
				scope: 'static',
				checked: 1,
				issues: [],
			});
			expect(bench.validate({ id: 'missing' }).issues[0]?.code).toBe('SPECIMEN_NOT_FOUND');
			await expect(bench.render({ id: 'fixtures-custom-id--alpha' })).rejects.toThrow(
				/retained story/
			);
		} finally {
			await bench.close();
		}
	}, 120_000);

	it.each([
		{
			fixture: 'duplicate-files',
			storybook: 'Duplicate stories with id: invalid-duplicate--primary',
			code: 'DUPLICATE_ID',
		},
		{
			fixture: 'unsorted-exports',
			storybook: 'Missing exports after sort: Beta',
			code: 'UNINDEXABLE_FILE',
		},
		{ fixture: 'dynamic-title', storybook: 'unexpected dynamic title', code: 'UNINDEXABLE_FILE' },
	])(
		'fails discovery where Storybook fails to index: $fixture',
		async ({ fixture, storybook, code }) => {
			const expected = await storybookIndex(`invalid/${fixture}`);
			expect('error' in expected && expected.error).toContain(storybook);
			const bench = await createSpecimenBench({ root: join(compat, 'invalid', fixture) });
			try {
				expect(() => bench.list()).toThrow(DiscoveryError);
				const report = bench.validate();
				expect(report.valid).toBe(false);
				expect(report.issues.map((issue) => issue.code)).toContain(code);
				expect(report.issues.find((issue) => issue.code === code)?.message).toContain(storybook);
			} finally {
				await bench.close();
			}
		},
		120_000
	);

	it('fails a same-file id collision that Storybook keeps silently', async () => {
		const expected = await storybookIndex('invalid/duplicate-exports');
		if ('error' in expected) throw new Error(expected.error);
		// Storybook's index keeps the first export; its Vitest run would test both.
		expect(expected.entries.map((entry) => entry.exportName)).toEqual(['Primary']);
		const bench = await createSpecimenBench({ root: join(compat, 'invalid', 'duplicate-exports') });
		try {
			const report = bench.validate();
			expect(report.issues.map((issue) => [issue.code, issue.exportName])).toEqual([
				['DUPLICATE_ID', 'primary'],
			]);
		} finally {
			await bench.close();
		}
	}, 120_000);

	it('indexes a story with an unsupported annotation as Storybook does, then fails validation', async () => {
		const expected = await storybookIndex('invalid/unsupported');
		if ('error' in expected) throw new Error(expected.error);
		const bench = await createSpecimenBench({ root: join(compat, 'invalid', 'unsupported') });
		try {
			expect(bench.list().map((entry) => entry.id)).toEqual(
				expected.entries.map((entry) => entry.id)
			);
			const report = bench.validate();
			expect(report.valid).toBe(false);
			expect(report.issues.map((issue) => [issue.code, issue.field])).toEqual([
				['UNSUPPORTED_ANNOTATION', 'meta.loaders'],
			]);
		} finally {
			await bench.close();
		}
	}, 120_000);
});
