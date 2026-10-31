import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { releaseClaim } from './release-claim.mjs';
import { hash } from './release-operations/shared.mjs';

const environment = {
	GH_REPO: 'lushly-dev/afd',
	GITHUB_REPOSITORY: 'lushly-dev/afd',
	GITHUB_SERVER_URL: 'https://github.com',
	GITHUB_RUN_ID: '123',
	GITHUB_RUN_ATTEMPT: '1',
};
const git = (root, args) =>
	execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function fixture(t, { intent = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'afd-claim-test-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (file, value) => {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
	};
	write('scripts/release/inventory.json', {
		schemaVersion: 1,
		roots: ['packages'],
		units: [
			{
				id: 'afd-npm',
				family: 'afd',
				protocol: 'npm-changesets',
				sourceRevision: 'fixture',
				authority: 'github: lushly-dev/afd',
				state: 'admitted',
				routes: ['npm-main'],
				gates: ['fixture'],
				distributions: [
					{
						name: '@fixture/a',
						registry: 'npm',
						manifest: 'packages/a/package.json',
						format: 'npm',
					},
				],
			},
		],
	});
	if (intent) write('.release/npm-intent.json', { schemaVersion: 1, selectedUnits: ['afd-npm'] });
	git(root, ['init', '-b', 'main']);
	git(root, ['config', 'user.name', 'Fixture']);
	git(root, ['config', 'user.email', 'fixture@example.invalid']);
	git(root, ['add', '.']);
	git(root, ['commit', '-m', 'fixture']);
	git(root, ['remote', 'add', 'origin', 'https://github.com/lushly-dev/afd.git']);
	const state = { entries: [], calls: [] };
	const api = ({ endpoint, body }) => {
		state.calls.push({ endpoint, body });
		if (body) {
			const item = {
				id: Math.max(0, ...state.entries.map((entry) => entry.id)) + 1,
				context: body.context,
				state: body.state,
				target_url: body.target_url,
			};
			state.entries.unshift(item);
			return item;
		}
		const page = Number(new URL(`https://github.com/${endpoint}`).searchParams.get('page'));
		return state.entries.slice((page - 1) * 100, page * 100);
	};
	const options = { root, environment, api };
	const invoke = (action, extras = {}) => releaseClaim({ ...options, action, ...extras });
	return { root, state, write, invoke, options };
}
function completed(f, claim) {
	const plan = {
		intentDigest: claim.intentDigest,
		binding: 'bound',
		artifacts: [{ name: '@fixture/a', version: '1.0.0' }],
		core: { registryEvidence: [] },
	};
	const receipt = {
		state: 'complete',
		binding: 'bound',
		publishedPackages: [{ name: '@fixture/a', version: '1.0.0', tag: '@fixture/a@1.0.0' }],
		finalization: {
			state: 'complete',
			head: git(f.root, ['rev-parse', 'HEAD']).trim(),
			tags: ['@fixture/a@1.0.0'],
		},
	};
	return { claim, plan, receipt };
}

test('absent intent is inert and never queries GitHub', (t) => {
	const f = fixture(t, { intent: false });
	assert.deepEqual(f.invoke('inspect'), { state: 'missing' });
	assert.throws(() => f.invoke('acquire'), /intent is missing/);
	assert.equal(f.state.calls.length, 0);
});
test('unclaimed committed intent uses byte digest and immutable origin commit', (t) => {
	const f = fixture(t);
	const result = f.invoke('inspect');
	assert.equal(result.state, 'unclaimed');
	assert.equal(result.commit, git(f.root, ['rev-parse', 'HEAD']).trim());
	assert.equal(result.intentDigest, hash(readFileSync(join(f.root, '.release/npm-intent.json'))));
	assert.equal(result.context, `release/npm/${result.intentDigest}`);
	assert.ok(result.context.length < 100);
	assert.equal(f.state.calls.filter((entry) => entry.body).length, 0);
});
test('pending durable claim survives later HEAD and loss of all local receipts', (t) => {
	const f = fixture(t);
	const claim = f.invoke('acquire');
	assert.equal(claim.state, 'pending');
	assert.match(claim.targetUrl, /\/123\/attempts\/1$/);
	f.write('later.txt', 'new HEAD');
	git(f.root, ['add', '.']);
	git(f.root, ['commit', '-m', 'later development']);
	assert.notEqual(claim.commit, git(f.root, ['rev-parse', 'HEAD']).trim());
	assert.throws(() => f.invoke('inspect'), /durable release claim is pending/);
	assert.throws(() => f.invoke('acquire'), /existing release claim is pending/);
	assert.ok(f.state.calls.every(({ endpoint }) => endpoint.includes(claim.commit)));
});
test('all status pages are consulted before claiming', (t) => {
	const f = fixture(t);
	const key = f.invoke('inspect');
	f.state.entries = Array.from({ length: 100 }, (_, index) => ({
		id: 200 - index,
		context: 'unrelated',
		state: 'success',
	}));
	f.state.entries.push({
		id: 1,
		context: key.context,
		state: 'failure',
		target_url: 'https://github.com/old',
	});
	assert.throws(() => f.invoke('inspect'), /durable release claim is failure/);
	assert.ok(f.state.calls.some(({ endpoint }) => endpoint.endsWith('page=2')));
	assert.equal(f.state.calls.filter(({ body }) => body).length, 0);
});
test('malformed responses and unknown outcomes fail closed', (t) => {
	const f = fixture(t);
	const key = f.invoke('inspect');
	for (const result of [
		null,
		{},
		{ state: 'success' },
		[null],
		[{ id: '1', context: key.context }],
		[{ id: 1, context: key.context, state: 'surprise', target_url: '' }],
	]) {
		assert.throws(() => f.invoke('acquire', { api: () => result }), /Publication held/);
	}
});
test('repeating pagination and excessive page lengths cannot conceal a claim', (t) => {
	const f = fixture(t);
	const page = Array.from({ length: 100 }, (_, id) => ({ id: id + 1, context: 'other' }));
	assert.throws(() => f.invoke('inspect', { api: () => page }), /repeated GitHub status/);
	assert.throws(
		() => f.invoke('inspect', { api: () => [...page, { id: 101 }] }),
		/unknown GitHub status/
	);
});
test('failed pending POST and unknown write response never authorize upload', (t) => {
	for (const response of [undefined, {}, { id: 4, state: 'pending', context: 'wrong' }]) {
		const f = fixture(t);
		let writes = 0;
		assert.throws(
			() =>
				f.invoke('acquire', {
					api: ({ body }) => {
						if (!body) return [];
						writes++;
						if (response === undefined) throw new Error('network lost');
						return response;
					},
				}),
			/network lost|did not confirm durable/
		);
		assert.equal(writes, 1);
	}
});
test('ambiguous POST response leaves the durable pending claim blocking reruns', (t) => {
	const f = fixture(t);
	const api = f.options.api;
	assert.throws(
		() =>
			f.invoke('acquire', {
				api: (request) => {
					const response = api(request);
					if (request.body) throw new Error('connection lost after server write');
					return response;
				},
			}),
		/connection lost/
	);
	assert.throws(() => f.invoke('inspect'), /pending/);
});
test('readback must establish the exact durable write ID', (t) => {
	const f = fixture(t);
	assert.throws(
		() =>
			f.invoke('acquire', {
				api: ({ body }) =>
					body
						? { id: 1, context: body.context, state: body.state, target_url: body.target_url }
						: [],
			}),
		/readback differs/
	);
});
test('failed publication persists failure, and unavailable failure write retains pending', (t) => {
	const f = fixture(t);
	const claim = f.invoke('acquire');
	assert.throws(
		() =>
			f.invoke('fail', {
				claim,
				api: (request) => {
					if (request.body) throw new Error('network unavailable');
					return f.options.api(request);
				},
			}),
		/network unavailable/
	);
	assert.throws(() => f.invoke('inspect'), /pending/);
	assert.equal(f.invoke('fail', { claim }).state, 'failure');
	assert.throws(() => f.invoke('inspect'), /failure/);
	assert.throws(() => f.invoke('acquire'), /existing release claim/);
});
test('complete validates plan, receipt, finalization and current intent before success', (t) => {
	const f = fixture(t);
	const claim = f.invoke('acquire');
	const valid = completed(f, claim);
	for (const extras of [
		{ ...valid, receipt: { ...valid.receipt, state: 'held' } },
		{ ...valid, receipt: { ...valid.receipt, binding: 'wrong' } },
		{ ...valid, receipt: { ...valid.receipt, finalization: { state: 'running' } } },
		{ ...valid, receipt: { ...valid.receipt, finalization: { state: 'complete', head: 'old' } } },
		{ ...valid, plan: { ...valid.plan, intentDigest: 'wrong' } },
	])
		assert.throws(() => f.invoke('complete', extras), /incomplete/);
	assert.throws(() => f.invoke('complete', valid), /Release plan binding changed/);
	assert.throws(
		() =>
			f.invoke('complete', {
				...valid,
				validate: () => {
					throw new Error('stale current plan');
				},
			}),
		/stale current plan/
	);

	for (const patch of [
		{ publishedPackages: [] },
		{ publishedPackages: [...valid.receipt.publishedPackages, ...valid.receipt.publishedPackages] },
		{ publishedPackages: [{ name: 'foreign', version: '1.0.0', tag: 'foreign@1.0.0' }] },
		{ finalization: { ...valid.receipt.finalization, tags: [] } },
	])
		assert.throws(
			() => f.invoke('complete', { ...valid, receipt: { ...valid.receipt, ...patch } }),
			/incomplete/
		);
	let validated = 0;
	const result = f.invoke('complete', {
		...valid,
		validate: (root, plan, evidence) => {
			assert.equal(root, f.root);
			assert.equal(plan, valid.plan);
			assert.equal(evidence, valid.plan.core.registryEvidence);
			validated++;
		},
	});
	assert.equal(validated, 1);
	assert.equal(result.state, 'succeeded');
	assert.equal(f.invoke('inspect').state, 'succeeded');
	assert.throws(() => f.invoke('acquire'), /existing release claim is success/);
	assert.equal(f.state.calls.filter(({ body }) => body?.state === 'success').length, 1);
});
test('complete cannot take ownership of another run or attempt or historical pending status', (t) => {
	const f = fixture(t);
	const claim = f.invoke('acquire');
	const valid = {
		...completed(f, claim),
		validate: () => assert.fail('wrong owner cannot validate'),
	};
	for (const env of [
		{ ...environment, GITHUB_RUN_ID: '124' },
		{ ...environment, GITHUB_RUN_ATTEMPT: '2' },
	])
		assert.throws(() => f.invoke('complete', { ...valid, environment: env }), /not owned/);
	f.state.entries.unshift({ ...f.state.entries[0], id: claim.statusId + 1 });
	assert.throws(() => f.invoke('complete', valid), /not owned/);
	assert.equal(f.state.calls.filter(({ body }) => body).length, 1);
});
test('repository override, uncommitted intent and shallow history cannot query GitHub', (t) => {
	const f = fixture(t);
	assert.throws(
		() => f.invoke('inspect', { environment: { GH_REPO: 'other/repo' } }),
		/GH_REPO differs/
	);
	git(f.root, ['remote', 'set-url', 'origin', 'https://github.com/other/repo.git']);
	assert.throws(() => f.invoke('inspect'), /origin differs/);
	git(f.root, ['remote', 'set-url', 'origin', 'https://github.com/lushly-dev/afd.git']);
	assert.throws(
		() =>
			f.invoke('inspect', {
				command: (_program, args, root) =>
					args.includes('--is-shallow-repository') ? 'true\n' : git(root, args),
			}),
		/full git history/
	);
	f.write('.release/npm-intent.json', {
		schemaVersion: 1,
		selectedUnits: ['afd-npm'],
		changed: true,
	});
	assert.throws(() => f.invoke('inspect'), /not committed/);
	assert.equal(f.state.calls.length, 0);
});
test('inventory publisher authority and Actions identity must be exact', (t) => {
	const f = fixture(t);
	assert.throws(
		() =>
			f.invoke('acquire', {
				environment: { ...environment, GITHUB_SERVER_URL: 'https://example.com' },
			}),
		/known GitHub Actions/
	);
	const inventory = JSON.parse(readFileSync(join(f.root, 'scripts/release/inventory.json')));
	inventory.units[0].authority = 'github: other/repo';
	f.write('scripts/release/inventory.json', inventory);
	const count = f.state.calls.length;
	assert.throws(() => f.invoke('inspect'), /publisher authority/);
	assert.equal(f.state.calls.length, count);
});

test('restoring identical intent preserves its earliest pending or succeeded claim anchor', (t) => {
	for (const succeeded of [false, true]) {
		const f = fixture(t);
		const original = readFileSync(join(f.root, '.release/npm-intent.json'));
		const claim = f.invoke('acquire');
		if (succeeded) f.invoke('complete', { ...completed(f, claim), validate: () => {} });
		git(f.root, ['rm', '.release/npm-intent.json']);
		git(f.root, ['commit', '-m', 'remove intent']);
		f.write('.release/npm-intent.json', original.toString('utf8'));
		git(f.root, ['add', '.']);
		git(f.root, ['commit', '-m', 'restore identical intent']);
		if (succeeded) assert.equal(f.invoke('inspect').commit, claim.commit);
		else assert.throws(() => f.invoke('inspect'), /durable release claim is pending/);
		assert.throws(() => f.invoke('acquire'), /existing release claim/);
		f.write('.release/npm-intent.json', `${original.toString('utf8')}\n`);
		git(f.root, ['add', '.']);
		git(f.root, ['commit', '-m', 'new intent bytes']);
		const next = f.invoke('inspect');
		assert.equal(next.state, 'unclaimed');
		assert.notEqual(next.intentDigest, claim.intentDigest);
		assert.equal(next.commit, git(f.root, ['rev-parse', 'HEAD']).trim());
	}
});
test('intent history ignores only known missing paths and propagates other git errors', (t) => {
	const f = fixture(t);
	const head = git(f.root, ['rev-parse', 'HEAD']).trim();
	assert.throws(
		() =>
			f.invoke('inspect', {
				command: (_program, args, root) => {
					if (args[0] === 'show' && args[1] === `${head}:.release/npm-intent.json`) {
						const error = new Error('corrupt git object');
						error.stderr = Buffer.from('fatal: bad object');
						throw error;
					}
					return git(root, args);
				},
			}),
		/corrupt git object/
	);
	assert.equal(f.state.calls.length, 0);
});

test('explicit recovery preserves failed history and binds the replacement claim', (t) => {
	const f = fixture(t);
	const first = f.invoke('acquire');
	const failed = f.invoke('fail', { claim: first });
	const nextEnvironment = { ...environment, GITHUB_RUN_ID: '456' };
	const plan = { sourceRevision: failed.commit, intentDigest: failed.intentDigest };
	let reconciled = 0;
	const options = {
		claim: failed,
		plan,
		receipt: { state: 'held' },
		environment: nextEnvironment,
		reconcile: () => {
			reconciled++;
			return { verified: ['a'], missing: [] };
		},
	};
	for (const bad of [
		{ ...failed, statusId: 999 },
		{ ...failed, intentDigest: 'wrong' },
		{ ...failed, targetUrl: 'wrong' },
	]) {
		assert.throws(() => f.invoke('reconcile', { ...options, claim: bad }), /exact failed claim/);
	}
	assert.equal(reconciled, 0);
	assert.throws(
		() =>
			f.invoke('reconcile', {
				...options,
				reconcile: () => {
					throw new Error('artifact differs');
				},
			}),
		/artifact differs/
	);
	assert.equal(f.state.entries[0].state, 'failure');
	const recovered = f.invoke('reconcile', options);
	assert.equal(reconciled, 1);
	assert.equal(recovered.state, 'pending');
	assert.deepEqual(recovered.recoveredFrom, {
		statusId: failed.statusId,
		targetUrl: failed.targetUrl,
	});
	assert.equal(f.state.entries[1].state, 'failure');
	assert.match(recovered.targetUrl, /456/);
	assert.throws(() => f.invoke('reconcile', options), /exact failed claim/);
});
