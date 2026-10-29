import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fixtureEnvironment, runToolingTests } from './run-tooling-tests.mjs';

test('tooling children discard hook Git routing without changing the caller environment', () => {
	const original = { PATH: process.env.PATH, GIT_DIR: '/sentinel', GIT_CONFIG_COUNT: '1' };
	assert.deepEqual(fixtureEnvironment(original), { PATH: process.env.PATH });
	assert.equal(original.GIT_DIR, '/sentinel');
});

test('Git fixtures cannot rewrite the invoking hook repository or its index/config', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'afd-hook-isolation-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const parent = join(directory, 'parent');
	const git = (args, cwd = directory) =>
		execFileSync('git', args, { cwd, env: fixtureEnvironment(), stdio: 'pipe' });
	git(['init', '-b', 'main', parent]);
	git(['config', 'user.name', 'Protected owner'], parent);
	git(['config', 'user.email', 'protected@example.invalid'], parent);
	writeFileSync(join(parent, 'protected.txt'), 'protected\n');
	git(['add', '.'], parent);
	git(['commit', '-m', 'protected'], parent);
	const config = readFileSync(join(parent, '.git/config'));
	const index = readFileSync(join(parent, '.git/index'));
	const head = git(['rev-parse', 'HEAD'], parent).toString();
	const childFile = join(directory, 'fixture.test.cjs');
	writeFileSync(
		childFile,
		`const {execFileSync}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('GIT_'));
const fixture=join(process.cwd(),'fixture');
mkdirSync(fixture);
execFileSync('git',['init','--bare',fixture],{stdio:'pipe'});
execFileSync('git',['--git-dir',fixture,'config','user.name','Fixture'],{stdio:'pipe'});
writeFileSync(join(process.cwd(),'fixture-proof.txt'),'executed');
`
	);
	runToolingTests({
		directory,
		files: [childFile],
		environment: {
			...process.env,
			GIT_DIR: join(parent, '.git'),
			GIT_WORK_TREE: parent,
			GIT_INDEX_FILE: join(parent, '.git/index'),
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'user.name',
			GIT_CONFIG_VALUE_0: 'Injected hook identity',
		},
	});
	assert.equal(readFileSync(join(directory, 'fixture-proof.txt'), 'utf8'), 'executed');
	assert.equal(
		git(['--git-dir', join(directory, 'fixture'), 'config', 'user.name'])
			.toString()
			.trim(),
		'Fixture'
	);
	assert.deepEqual(readFileSync(join(parent, '.git/config')), config);
	assert.deepEqual(readFileSync(join(parent, '.git/index')), index);
	assert.equal(git(['rev-parse', 'HEAD'], parent).toString(), head);
	assert.equal(git(['config', '--get', 'core.bare'], parent).toString().trim(), 'false');
});
