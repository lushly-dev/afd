import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareEntry, gitBlob, parseTree } from './freeze.mjs';

describe('freeze source binding', () => {
	let directory;
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), 'specimen-freeze-'));
		await writeFile(join(directory, 'plain.txt'), 'hello\n');
		await writeFile(join(directory, 'tool.sh'), '#!/bin/sh\n');
		await chmod(join(directory, 'tool.sh'), 0o755);
		await symlink('plain.txt', join(directory, 'link'));
	});
	afterAll(() => rm(directory, { recursive: true, force: true }));

	it('matches Git blob ids, including symlink link text', () => {
		const blob = (path) =>
			execFileSync('git', ['hash-object', path], { cwd: directory, encoding: 'utf8' }).trim();
		expect(gitBlob(Buffer.from('hello\n'))).toBe(blob('plain.txt'));
		expect(gitBlob(Buffer.from('plain.txt'))).toBe(
			execFileSync('git', ['hash-object', '--stdin'], {
				input: 'plain.txt',
				encoding: 'utf8',
			}).trim()
		);
	});

	it('detects content, mode and symlink differences', async () => {
		const plain = gitBlob(Buffer.from('hello\n'));
		expect(
			await compareEntry(join(directory, 'plain.txt'), { mode: '100644', object: plain })
		).toBeNull();
		expect(
			await compareEntry(join(directory, 'plain.txt'), { mode: '100755', object: plain })
		).toBe('mode');
		expect(
			await compareEntry(join(directory, 'plain.txt'), { mode: '100644', object: '0'.repeat(40) })
		).toBe('content');
		const link = gitBlob(Buffer.from('plain.txt'));
		expect(
			await compareEntry(join(directory, 'link'), { mode: '120000', object: link })
		).toBeNull();
		expect(await compareEntry(join(directory, 'link'), { mode: '100644', object: plain })).toBe(
			'unexpected-symlink'
		);
		expect(await compareEntry(join(directory, 'plain.txt'), { mode: '120000', object: link })).toBe(
			'not-a-symlink'
		);
	});

	it('parses ls-tree output with tabs in paths and reports submodules', () => {
		const tree = parseTree(
			[
				`100644 blob ${'a'.repeat(40)}\tdir/with\ttab.txt`,
				`160000 commit ${'b'.repeat(40)}\tvendor/sub`,
				'',
			].join('\u0000')
		);
		expect([...tree.blobs.keys()]).toEqual(['dir/with\ttab.txt']);
		expect(tree.submodules).toEqual([{ path: 'vendor/sub', object: 'b'.repeat(40) }]);
	});
});
