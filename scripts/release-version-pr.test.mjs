import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInventory } from './release/control.mjs';
import { execTool } from './release/exec-tool.mjs';
import { saveIntent, selectRelease, versionSelected } from './release-control.mjs';
import {
	buildPrBody,
	pushCredentials,
	ROUTE_PR_CONFIG,
	routeConfig,
	updateVersionPr,
} from './release-version-pr.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const changesets = join(repository, 'node_modules/@changesets/cli/bin.js');

const shell = (cwd, command, args) =>
	execTool(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const write = (root, file, contents) => {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(
		join(root, file),
		typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`
	);
};

function commit(root, message = 'fixture') {
	shell(root, 'git', ['add', '.']);
	shell(root, 'git', [
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.invalid',
		'commit',
		'--allow-empty',
		'-m',
		message,
	]);
}

function fixture(t) {
	const base = mkdtempSync(join(tmpdir(), 'afd-version-pr-test-'));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const remote = join(base, 'origin.git');
	const root = join(base, 'repo');
	shell(base, 'git', ['init', '--bare', remote]);

	const unit = (id, route, version) => ({
		id,
		family: 'fixture',
		protocol: 'npm-changesets',
		sourceRevision: 'fixture',
		authority: 'fixture',
		state: 'admitted',
		routes: [route],
		...(route === 'npm-prerelease' ? { distTag: 'preview' } : {}),
		gates: ['fixture'],
		fixed: false,
		distributions: [
			{
				name: `@fixture/${id}`,
				registry: 'npm',
				manifest: `packages/${id}/package.json`,
				format: 'npm',
				initialVersion: version,
			},
		],
	});

	write(root, 'packages/m/package.json', {
		name: '@fixture/m',
		version: '1.0.0',
		files: ['index.js'],
	});
	write(root, 'packages/m/index.js', 'export const m = 1;\n');
	// Cross-route dependency: preview package depends on a published npm-main package.
	write(root, 'packages/p/package.json', {
		name: '@fixture/p',
		version: '2.0.0-preview',
		files: ['index.js'],
		dependencies: { '@fixture/m': '^1.0.0' },
	});
	write(root, 'packages/p/index.js', 'export const p = 1;\n');
	write(root, 'scripts/release/inventory.json', {
		schemaVersion: 1,
		roots: ['packages'],
		storages: [{ path: '.changeset', protocol: 'npm-changesets' }],
		units: [unit('p', 'npm-prerelease', '2.0.0-preview'), unit('m', 'npm-main', '1.0.0')],
	});
	write(root, '.changeset/config.json', {
		changelog: false,
		commit: false,
		fixed: [],
		linked: [],
		access: 'public',
		baseBranch: 'main',
		updateInternalDependencies: 'patch',
		ignore: [],
	});
	write(root, '.changeset/main.md', '---\n"@fixture/m": patch\n---\n\nMain release\n');
	write(root, '.changeset/preview.md', '---\n"@fixture/p": patch\n---\n\nPreview release\n');
	write(root, '.gitignore', 'node_modules/\n');
	write(root, 'package.json', { name: 'fixture', private: true, packageManager: 'pnpm@12.22.0' });
	write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');

	shell(root, 'git', ['init', '-b', 'main']);
	shell(root, 'git', ['config', 'user.name', 'Owner']);
	shell(root, 'git', ['config', 'user.email', 'owner@example.invalid']);
	shell(root, 'git', ['remote', 'add', 'origin', remote]);
	commit(root);
	shell(root, 'git', ['push', '-u', 'origin', 'main']);

	// Real ignored node_modules directory with a sentinel and linked @changesets/cli.
	const linkType = process.platform === 'win32' ? 'junction' : 'dir';
	const nm = join(root, 'node_modules');
	mkdirSync(join(nm, '@changesets'), { recursive: true });
	writeFileSync(join(nm, '.sentinel'), 'intact\n');
	symlinkSync(
		realpathSync(join(repository, 'node_modules/@changesets/cli')),
		join(nm, '@changesets/cli'),
		linkType
	);

	const evidence = [
		{ registry: 'npm', name: '@fixture/m', versions: ['1.0.0'] },
		{ registry: 'npm', name: '@fixture/p', versions: [] },
	];
	return { root, remote, evidence, nm };
}

function fakeApi({ app = { login: 'afd-release[bot]', id: 987654 }, commitAuthor } = {}) {
	const prs = new Map();
	let nextNumber = 100;
	const calls = [];
	const findByHead = (head) => {
		const branch = head.includes(':') ? head.split(':').slice(1).join(':') : head;
		return [...prs.values()].filter((pr) => pr.head === branch);
	};
	return {
		prs,
		calls,
		api: {
			async get(path) {
				calls.push(['GET', path]);
				if (path.startsWith('/repos/lushly-dev/afd/pulls?')) {
					const query = new URLSearchParams(path.split('?')[1]);
					return findByHead(query.get('head')).map((pr) => ({
						number: pr.number,
						user: pr.user,
					}));
				}
				if (path === `/users/${encodeURIComponent(app.login)}`) {
					return { ...app, type: 'Bot' };
				}
				const commitMatch = /^\/repos\/lushly-dev\/afd\/pulls\/(\d+)\/commits/.exec(path);
				if (commitMatch) {
					const pr = prs.get(Number(commitMatch[1]));
					const login = commitAuthor ?? pr.user.login;
					return [
						{
							sha: '1234567890abcdef',
							author: { login },
							commit: {
								author: { name: login, email: `${pr.user.id}+${login}@users.noreply.github.com` },
							},
						},
					];
				}
				throw new Error(`Unexpected GET ${path}`);
			},
			async post(path, _token, body) {
				calls.push(['POST', path, body]);
				assert.equal(path, '/repos/lushly-dev/afd/pulls');
				const number = nextNumber++;
				const user = { ...app, type: 'Bot' };
				const pr = { number, ...body, user };
				prs.set(number, pr);
				return pr;
			},
			async patch(path, _token, body) {
				calls.push(['PATCH', path, body]);
				const match = /^\/repos\/lushly-dev\/afd\/pulls\/(\d+)$/.exec(path);
				assert.ok(match, `Unexpected PATCH ${path}`);
				const pr = prs.get(Number(match[1]));
				Object.assign(pr, body);
				return pr;
			},
		},
	};
}

function versionInWorktree(route, evidence, seenEnv) {
	return (candidate, env) => {
		if (seenEnv) seenEnv.push(env);
		const plan = selectRelease({ root: candidate, route, registryEvidence: evidence });
		if (!plan.selectable) return;
		const result = versionSelected({
			root: candidate,
			plan,
			inventory: loadInventory(candidate),
			invoke: (cwd) => shell(cwd, process.execPath, [changesets, 'version']),
		});
		saveIntent(candidate, result.selectedUnits);
	};
}

describe('routeConfig and pushCredentials', () => {
	it('maps npm-main and npm-prerelease to distinct changeset-release branches', () => {
		assert.equal(routeConfig('npm-main').branch, 'changeset-release/npm-main');
		assert.equal(routeConfig('npm-prerelease').branch, 'changeset-release/npm-prerelease');
		assert.notEqual(ROUTE_PR_CONFIG['npm-main'].branch, ROUTE_PR_CONFIG['npm-prerelease'].branch);
		assert.throws(() => routeConfig('npm-manual'), /Unsupported release PR route/);
		assert.throws(() => routeConfig(''), /Unsupported release PR route/);
	});

	it('encodes push credentials and masks them when requested', () => {
		assert.deepEqual(pushCredentials(''), {});
		const logged = [];
		const env = pushCredentials('secret-token', { mask: true, log: (line) => logged.push(line) });
		assert.equal(env.GIT_CONFIG_COUNT, '2');
		assert.equal(env.GIT_CONFIG_VALUE_0, '');
		assert.match(env.GIT_CONFIG_VALUE_1, /^AUTHORIZATION: basic /);
		assert.equal(logged.length, 1);
		assert.match(logged[0], /^::add-mask::/);
	});
});

describe('updateVersionPr', () => {
	it('creates independent npm-main and npm-prerelease PR branches without mutating caller checkout or git config (#2406)', async (t) => {
		const f = fixture(t);
		const github = fakeApi();
		const seenEnv = [];

		const mainResult = await updateVersionPr({
			root: f.root,
			route: 'npm-main',
			repository: 'lushly-dev/afd',
			base: 'main',
			readToken: 'gh-token',
			appSlug: 'afd-release',
			versionCommand: versionInWorktree('npm-main', f.evidence, seenEnv),
			api: github.api,
			log: () => {},
		});
		assert.equal(mainResult.status, 'created');
		assert.equal(mainResult.branch, 'changeset-release/npm-main');

		const preResult = await updateVersionPr({
			root: f.root,
			route: 'npm-prerelease',
			repository: 'lushly-dev/afd',
			base: 'main',
			readToken: 'gh-token',
			appSlug: 'afd-release',
			versionCommand: versionInWorktree('npm-prerelease', f.evidence, seenEnv),
			api: github.api,
			log: () => {},
		});
		assert.equal(preResult.status, 'created');
		assert.equal(preResult.branch, 'changeset-release/npm-prerelease');
		assert.notEqual(mainResult.prNumber, preResult.prNumber);

		// `@changesets/changelog-github` receives GITHUB_TOKEN from readToken.
		assert.equal(seenEnv.length, 2);
		for (const env of seenEnv) assert.equal(env.GITHUB_TOKEN, 'gh-token');

		// Caller checkout, git config, and node_modules remain completely untouched.
		assert.equal(shell(f.root, 'git', ['status', '--porcelain']).trim(), '');
		assert.equal(shell(f.root, 'git', ['config', '--local', 'user.name']).trim(), 'Owner');
		assert.equal(
			shell(f.root, 'git', ['config', '--local', 'user.email']).trim(),
			'owner@example.invalid'
		);
		assert.equal(readFileSync(join(f.nm, '.sentinel'), 'utf8'), 'intact\n');

		// Neither remote branch committed node_modules.
		for (const branch of ['changeset-release/npm-main', 'changeset-release/npm-prerelease']) {
			const files = shell(f.remote, 'git', [
				'ls-tree',
				'-r',
				'--name-only',
				`refs/heads/${branch}`,
			]);
			assert.doesNotMatch(files, /(^|\n)node_modules(\/|$)/);
		}

		// Both remote branches exist with distinct versions and intents.
		const mainPkg = JSON.parse(
			shell(f.remote, 'git', [
				'show',
				'refs/heads/changeset-release/npm-main:packages/m/package.json',
			])
		);
		const mainUnchangedPre = JSON.parse(
			shell(f.remote, 'git', [
				'show',
				'refs/heads/changeset-release/npm-main:packages/p/package.json',
			])
		);
		assert.equal(mainPkg.version, '1.0.1');
		assert.equal(mainUnchangedPre.version, '2.0.0-preview');

		const prePkg = JSON.parse(
			shell(f.remote, 'git', [
				'show',
				'refs/heads/changeset-release/npm-prerelease:packages/p/package.json',
			])
		);
		const preUnchangedMain = JSON.parse(
			shell(f.remote, 'git', [
				'show',
				'refs/heads/changeset-release/npm-prerelease:packages/m/package.json',
			])
		);
		assert.equal(prePkg.version, '2.0.0-preview.0');
		assert.equal(preUnchangedMain.version, '1.0.0');
		assert.match(github.prs.get(preResult.prNumber).body, /`@fixture\/p@2\.0\.0-preview\.0`/);

		// Re-running updates the existing PR in place instead of opening a duplicate.
		const updated = await updateVersionPr({
			root: f.root,
			route: 'npm-main',
			repository: 'lushly-dev/afd',
			base: 'main',
			readToken: 'gh-token',
			appSlug: 'afd-release',
			versionCommand: versionInWorktree('npm-main', f.evidence),
			api: github.api,
			log: () => {},
		});
		assert.equal(updated.status, 'updated');
		assert.equal(updated.prNumber, mainResult.prNumber);
		assert.equal(github.prs.size, 2);
	});

	it('skips when a route has no selectable changesets', async (t) => {
		const f = fixture(t);
		rmSync(join(f.root, '.changeset/main.md'));
		commit(f.root, 'remove main changeset');
		const github = fakeApi();

		const result = await updateVersionPr({
			root: f.root,
			route: 'npm-main',
			repository: 'lushly-dev/afd',
			base: 'main',
			readToken: 'gh-token',
			versionCommand: versionInWorktree('npm-main', f.evidence),
			api: github.api,
			log: () => {},
		});
		assert.deepEqual(result, {
			route: 'npm-main',
			branch: 'changeset-release/npm-main',
			status: 'skipped',
		});
		assert.equal(github.calls.length, 0);
	});

	it('fails when commit authorship disagrees with the PR author', async (t) => {
		const f = fixture(t);
		const github = fakeApi({ commitAuthor: 'wrong-bot[bot]' });

		await assert.rejects(
			updateVersionPr({
				root: f.root,
				route: 'npm-main',
				repository: 'lushly-dev/afd',
				base: 'main',
				readToken: 'gh-token',
				appSlug: 'afd-release',
				versionCommand: versionInWorktree('npm-main', f.evidence),
				api: github.api,
				log: () => {},
			}),
			/author check failed/
		);
	});

	it('formats a readable PR body listing bumped packages', (t) => {
		const f = fixture(t);
		const body = buildPrBody({
			route: 'npm-prerelease',
			distTag: 'preview',
			selectedUnits: ['p'],
			distributions: [{ manifest: 'packages/p/package.json' }],
			candidate: f.root,
		});
		assert.match(body, /`npm-prerelease` route \(dist-tag `preview`\)/);
		assert.match(body, /`@fixture\/p@2\.0\.0-preview`/);
		assert.equal(existsSync(join(f.root, 'packages/p/package.json')), true);
		assert.equal(
			JSON.parse(readFileSync(join(f.root, 'packages/p/package.json'), 'utf8')).version,
			'2.0.0-preview'
		);
	});
});
