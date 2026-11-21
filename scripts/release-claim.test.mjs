import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInventory } from './release/control.mjs';
import {
	CLAIM_READBACK_DEADLINE_MS,
	CLAIM_READBACK_MAX_ATTEMPTS,
	releaseClaim,
} from './release-claim.mjs';
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
	const options = { root, environment, api, wait: () => {} };
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

test('every admitted npm unit names this repository as its authority, exactly as the claim and finalization read it', () => {
	const repository = dirname(dirname(fileURLToPath(import.meta.url)));
	const units = loadInventory(repository).units.filter(
		(unit) => unit.state === 'admitted' && unit.protocol === 'npm-changesets'
	);
	assert.ok(units.length > 1);
	for (const unit of units) {
		assert.equal(unit.authority, 'github: lushly-dev/afd', unit.id);
		assert.equal(unit.authority.match(/^github:\s*([^/]+\/[^/]+)$/)?.[1], 'lushly-dev/afd');
	}
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

test('recovery accepts a release carried past the commit that introduced its intent', (t) => {
	const f = fixture(t);
	const failed = f.invoke('fail', { claim: f.invoke('acquire') });
	// A later push carries the publication: the plan is built at a descendant of the intent commit.
	f.write('later.txt', 'carried');
	git(f.root, ['add', '.']);
	git(f.root, ['commit', '-m', 'later']);
	const head = git(f.root, ['rev-parse', 'HEAD']).trim();
	assert.notEqual(head, failed.commit);
	const options = {
		claim: failed,
		receipt: { state: 'held' },
		environment: { ...environment, GITHUB_RUN_ID: '456' },
		reconcile: () => ({ verified: ['a'], missing: [] }),
	};
	// A plan bound to any revision but the checkout's own is refused, the intent commit included.
	for (const sourceRevision of [failed.commit, 'f'.repeat(40)])
		assert.throws(
			() =>
				f.invoke('reconcile', {
					...options,
					plan: { sourceRevision, intentDigest: failed.intentDigest },
				}),
			/exact failed claim/
		);
	const recovered = f.invoke('reconcile', {
		...options,
		plan: { sourceRevision: head, intentDigest: failed.intentDigest },
	});
	assert.equal(recovered.state, 'pending');
	assert.equal(recovered.commit, failed.commit);
});

test('stale claim readback retries with backoff and succeeds once the created status appears', (t) => {
	const f = fixture(t);
	let reads = 0;
	const waits = [];
	let time = 0;
	const created = [];
	const claim = f.invoke('acquire', {
		now: () => time,
		wait: (ms) => {
			waits.push(ms);
			time += ms;
		},
		api: ({ body }) => {
			if (body) {
				const item = {
					id: 10,
					context: body.context,
					state: body.state,
					target_url: body.target_url,
				};
				created.unshift(item);
				return item;
			}
			reads++;
			// Read 1 is pre-acquire check; reads 2 and 3 lag behind the POST; read 4 sees the write.
			return reads <= 3 ? [] : created;
		},
	});
	assert.equal(claim.state, 'pending');
	assert.equal(claim.statusId, 10);
	assert.deepEqual(waits, [1000, 2000]);

	// Older status ID visible during complete readback also retries until the new ID appears.
	let completeReads = 0;
	const completeWaits = [];
	const completeResult = f.invoke('complete', {
		...completed(f, claim),
		validate: () => {},
		now: () => time,
		wait: (ms) => {
			completeWaits.push(ms);
			time += ms;
		},
		api: ({ body }) => {
			if (body) {
				const item = {
					id: 11,
					context: body.context,
					state: body.state,
					target_url: body.target_url,
				};
				created.unshift(item);
				return item;
			}
			completeReads++;
			// Read 1 is verifyOwn (id 10); read 2 lags behind POST (still only id 10); read 3 sees id 11.
			return completeReads <= 2 ? created.filter((entry) => entry.id === 10) : created;
		},
	});
	assert.equal(completeResult.state, 'succeeded');
	assert.equal(completeResult.statusId, 11);
	assert.deepEqual(completeWaits, [1000]);

	// Reconcile also retries when readback still sees the exact failed status ID.
	const rf = fixture(t);
	const first = rf.invoke('acquire');
	const failed = rf.invoke('fail', { claim: first });
	const recEntries = structuredClone(rf.state.entries);
	let recReads = 0;
	const recWaits = [];
	let recTime = 0;
	const recovered = rf.invoke('reconcile', {
		claim: failed,
		plan: { sourceRevision: failed.commit, intentDigest: failed.intentDigest },
		receipt: { state: 'held' },
		environment: { ...environment, GITHUB_RUN_ID: '456' },
		reconcile: () => ({ verified: ['a'], missing: [] }),
		now: () => recTime,
		wait: (ms) => {
			recWaits.push(ms);
			recTime += ms;
		},
		api: ({ body }) => {
			if (body) {
				const item = {
					id: failed.statusId + 1,
					context: body.context,
					state: body.state,
					target_url: body.target_url,
				};
				recEntries.unshift(item);
				return item;
			}
			recReads++;
			// Reads 1 & 2 are pre-check and post-reconcile check; read 3 lags on failed.statusId; read 4 sees the new write.
			return recReads <= 3 ? recEntries.filter((entry) => entry.id <= failed.statusId) : recEntries;
		},
	});
	assert.equal(recovered.state, 'pending');
	assert.equal(recovered.statusId, failed.statusId + 1);
	assert.deepEqual(recWaits, [1000]);
});

test('newer conflicting status, field mismatch, or readback error fails immediately without waiting', (t) => {
	for (const scenario of [
		{
			name: 'newer status id',
			readback: (written) => [{ ...written, id: written.id + 1 }],
			pattern: /readback differs/,
		},
		{
			name: 'written id returned under a different context',
			readback: (written) => [{ ...written, context: 'release/npm/other-context' }],
			pattern: /readback differs/,
		},
		{
			name: 'unexpected older status id on acquire',
			readback: (written) => [{ ...written, id: written.id - 1 }],
			pattern: /readback differs/,
		},
		{
			name: 'concurrent extra status alongside written id on acquire',
			readback: (written) => [written, { ...written, id: written.id - 1 }],
			pattern: /readback differs/,
		},
		{
			name: 'mismatched state on same id',
			readback: (written) => [{ ...written, state: 'failure' }],
			pattern: /readback differs/,
		},
		{
			name: 'mismatched target_url on same id',
			readback: (written) => [{ ...written, target_url: 'https://github.com/other/run' }],
			pattern: /readback differs/,
		},
		{
			name: 'api error during readback',
			readback: () => {
				throw new Error('github 502');
			},
			pattern: /github 502/,
		},
	]) {
		const f = fixture(t);
		let written = null;
		let readbackCalls = 0;
		assert.throws(
			() =>
				f.invoke('acquire', {
					wait: () => assert.fail(`must not wait for ${scenario.name}`),
					api: ({ body }) => {
						if (body) {
							written = {
								id: 5,
								context: body.context,
								state: body.state,
								target_url: body.target_url,
							};
							return written;
						}
						if (!written) return [];
						readbackCalls++;
						return scenario.readback(written);
					},
				}),
			scenario.pattern
		);
		assert.equal(readbackCalls, 1, scenario.name);
	}

	// On complete, empty readback or an intervening unknown status ID fails at once with zero waits.
	for (const badComplete of [
		{ name: 'empty readback on complete', entries: () => [] },
		{
			name: 'unexpected intervening status id on complete',
			entries: (written, prior) => [written, { ...prior, id: prior.id + 1 }, prior],
		},
		{
			name: 'unknown older status id on complete',
			entries: (_written, prior) => [{ ...prior, id: prior.id + 1 }, prior],
		},
	]) {
		const f = fixture(t);
		const claim = f.invoke('acquire');
		const prior = f.state.entries[0];
		let written = null;
		let readbackCalls = 0;
		assert.throws(
			() =>
				f.invoke('complete', {
					...completed(f, claim),
					validate: () => {},
					wait: () => assert.fail(`must not wait for ${badComplete.name}`),
					api: ({ body }) => {
						if (body) {
							written = {
								id: prior.id + 2,
								context: body.context,
								state: body.state,
								target_url: body.target_url,
							};
							return written;
						}
						if (!written) return [prior];
						readbackCalls++;
						return badComplete.entries(written, prior);
					},
				}),
			/readback differs/
		);
		assert.equal(readbackCalls, 1, badComplete.name);
	}
});

test('stale readback stops at attempt limit and deadline without extra waits', (t) => {
	const f = fixture(t);
	let time = 0;
	let postDone = false;
	let readbacks = 0;
	const waits = [];
	const timeouts = [];
	assert.throws(
		() =>
			f.invoke('acquire', {
				now: () => time,
				wait: (ms) => {
					waits.push(ms);
					time += ms;
				},
				api: ({ body, timeoutMs }) => {
					if (body) {
						postDone = true;
						return { id: 1, context: body.context, state: body.state, target_url: body.target_url };
					}
					if (postDone) {
						readbacks++;
						timeouts.push(timeoutMs);
					}
					return [];
				},
			}),
		/readback differs/
	);
	assert.equal(readbacks, CLAIM_READBACK_MAX_ATTEMPTS);
	assert.deepEqual(waits, [1000, 2000, 4000, 8000, 8000]);
	assert.deepEqual(timeouts, [30_000, 29_000, 27_000, 23_000, 15_000, 7_000]);
	assert.equal(waits.length, CLAIM_READBACK_MAX_ATTEMPTS - 1);

	// A slow readback that reaches the deadline stops without waiting or issuing another GET.
	const slow = fixture(t);
	let slowTime = 0;
	let slowPostDone = false;
	let slowReadbacks = 0;
	assert.throws(
		() =>
			slow.invoke('acquire', {
				now: () => slowTime,
				wait: () => assert.fail('deadline reached'),
				api: ({ body }) => {
					if (body) {
						slowPostDone = true;
						return { id: 1, context: body.context, state: body.state, target_url: body.target_url };
					}
					if (slowPostDone) {
						slowReadbacks++;
						slowTime = CLAIM_READBACK_DEADLINE_MS;
					}
					return [];
				},
			}),
		/readback differs/
	);
	assert.equal(slowReadbacks, 1);

	// When remaining budget is no larger than the next backoff wait, stop without waiting or starting a GET at the deadline.
	const bounded = fixture(t);
	let boundTime = 0;
	let boundPostDone = false;
	let boundReadbacks = 0;
	const boundWaits = [];
	const boundTimeouts = [];
	assert.throws(
		() =>
			bounded.invoke('acquire', {
				now: () => boundTime,
				wait: (ms) => {
					boundWaits.push(ms);
					boundTime += ms;
				},
				api: ({ body, timeoutMs }) => {
					if (body) {
						boundPostDone = true;
						return { id: 1, context: body.context, state: body.state, target_url: body.target_url };
					}
					if (boundPostDone) {
						assert.ok(
							boundTime < CLAIM_READBACK_DEADLINE_MS,
							'must not start GET at or after deadline'
						);
						boundReadbacks++;
						boundTimeouts.push(timeoutMs);
						boundTime += 14_250;
					}
					return [];
				},
			}),
		/readback differs/
	);
	assert.equal(boundReadbacks, 2);
	assert.deepEqual(boundWaits, [1000]);
	assert.deepEqual(boundTimeouts, [30_000, 14_750]);

	// Pagination checks the remaining budget before requesting page 2.
	const paged = fixture(t);
	let pageTime = 0;
	let pagePostDone = false;
	let pageRequests = 0;
	const fullPage = Array.from({ length: 100 }, (_, index) => ({
		id: index + 100,
		context: 'unrelated',
	}));
	assert.throws(
		() =>
			paged.invoke('acquire', {
				now: () => pageTime,
				wait: () => assert.fail('deadline reached during pagination'),
				api: ({ body, endpoint }) => {
					if (body) {
						pagePostDone = true;
						return { id: 1, context: body.context, state: body.state, target_url: body.target_url };
					}
					if (!pagePostDone) return [];
					pageRequests++;
					assert.ok(endpoint.endsWith('page=1'), `must not request ${endpoint} past deadline`);
					pageTime = CLAIM_READBACK_DEADLINE_MS;
					return fullPage;
				},
			}),
		/readback differs/
	);
	assert.equal(pageRequests, 1);
});

test('supersedes record gives a fresh unclaimed digest and rejects malformed records', (t) => {
	const f = fixture(t);
	const originalBytes = readFileSync(join(f.root, '.release/npm-intent.json'), 'utf8');
	const heldClaim = f.invoke('acquire');
	const superseded = {
		...JSON.parse(originalBytes),
		supersedes: {
			intentDigest: heldClaim.intentDigest,
			statusId: heldClaim.statusId,
			runId: '123',
			attempt: '1',
			reason: 'Claim readback failed before upload',
		},
	};
	f.write('.release/npm-intent.json', superseded);
	git(f.root, ['add', '.']);
	git(f.root, ['commit', '-m', 'supersede held intent']);
	const next = f.invoke('inspect');
	assert.equal(next.state, 'unclaimed');
	assert.notEqual(next.intentDigest, heldClaim.intentDigest);
	assert.equal(next.commit, git(f.root, ['rev-parse', 'HEAD']).trim());

	for (const bad of [
		null,
		'not-an-object',
		[],
		{ ...superseded.supersedes, intentDigest: 'short' },
		{ ...superseded.supersedes, statusId: 0 },
		{ ...superseded.supersedes, statusId: '1' },
		{ ...superseded.supersedes, runId: 'abc' },
		{ ...superseded.supersedes, attempt: '' },
		{ ...superseded.supersedes, reason: '   ' },
		{ ...superseded.supersedes, extra: true },
	]) {
		f.write('.release/npm-intent.json', { ...JSON.parse(originalBytes), supersedes: bad });
		git(f.root, ['add', '.']);
		git(f.root, ['commit', '-m', 'bad supersedes']);
		const calls = f.state.calls.length;
		assert.throws(() => f.invoke('inspect'), /supersedes/);
		assert.equal(f.state.calls.length, calls);
	}
});
