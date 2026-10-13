import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { boundedEvaluate, closeWithStatus, runWithInterruption } from './browser-control.mjs';
import {
	ConfigurationError,
	createReceipt,
	executeCleanup,
	loadConfig,
	withDeadline,
} from './lib.mjs';

const fixtureDir = dirname(fileURLToPath(import.meta.url));

const complete = {
	AFD_AUTH_HOSTED_ADAPTER: 'convex',
	AFD_AUTH_HOSTED_CONVEX_URL: 'https://example.convex.cloud',
	AFD_AUTH_HOSTED_CONVEX_SITE_URL: 'https://example.convex.site',
	AFD_AUTH_HOSTED_REVISION: 'abc123',
	AFD_AUTH_HOSTED_RUN_ID: 'run-12345678',
	AFD_AUTH_HOSTED_EMAIL_SUFFIX: '@example.test',
	AFD_AUTH_HOSTED_PRIMARY_EMAIL: 'run-12345678-a@example.test',
	AFD_AUTH_HOSTED_PRIMARY_PASSWORD: 'secret-a',
	AFD_AUTH_HOSTED_SECONDARY_EMAIL: 'run-12345678-b@example.test',
	AFD_AUTH_HOSTED_SECONDARY_PASSWORD: 'secret-b',
};

test('reports an unrequested hosted execution as not run', () => {
	assert.deepEqual(loadConfig({}), {
		requested: false,
		status: 'not-run',
		reason: 'adapter-not-requested',
	});
});

test('fails an explicitly requested run with incomplete configuration', () => {
	assert.throws(
		() => loadConfig({ AFD_AUTH_HOSTED_ADAPTER: 'convex' }),
		(error) =>
			error instanceof ConfigurationError && error.missing.includes('AFD_AUTH_HOSTED_RUN_ID')
	);
});

test('hosted CLI fails closed while an unrequested direct invocation reports not run', () => {
	const environment = { PATH: process.env.PATH };
	const direct = spawnSync(process.execPath, [join(fixtureDir, 'run.mjs')], {
		env: environment,
		encoding: 'utf8',
		timeout: 5_000,
	});
	assert.equal(direct.status, 0);
	assert.match(direct.stdout, /"status":"not-run"/);
	const explicit = spawnSync(process.execPath, [join(fixtureDir, 'run.mjs'), '--hosted'], {
		env: environment,
		encoding: 'utf8',
		timeout: 5_000,
	});
	assert.equal(explicit.status, 2);
	assert.match(explicit.stderr, /"reason":"configuration"/);
});

test('rejects unscoped identities and non-TLS deployments', () => {
	assert.throws(() =>
		loadConfig({ ...complete, AFD_AUTH_HOSTED_PRIMARY_EMAIL: 'other@example.test' })
	);
	assert.throws(() =>
		loadConfig({ ...complete, AFD_AUTH_HOSTED_CONVEX_URL: 'http://example.test' })
	);
});

test('malformed configuration URLs fail closed without exposing their input', () => {
	const sentinel = 'credential-query-sentinel';
	assert.throws(
		() =>
			loadConfig({
				...complete,
				AFD_AUTH_HOSTED_CONVEX_URL: `https://user:password@[${sentinel}?token=${sentinel}`,
			}),
		(error) => error instanceof ConfigurationError && !error.message.includes(sentinel)
	);
	const result = spawnSync(process.execPath, [join(fixtureDir, 'run.mjs'), '--hosted'], {
		env: {
			PATH: process.env.PATH,
			...complete,
			AFD_AUTH_HOSTED_CONVEX_URL: `https://user:password@[${sentinel}?token=${sentinel}`,
		},
		encoding: 'utf8',
		timeout: 5_000,
	});
	assert.equal(result.status, 2);
	assert.equal(`${result.stdout}${result.stderr}`.includes(sentinel), false);
	assert.equal(`${result.stdout}${result.stderr}`.includes('secret-a'), false);
});

test('deadline fails closed and cleanup still attempts every principal', async () => {
	await assert.rejects(() => withDeadline(() => new Promise(() => {}), 5, 'bounded'), {
		code: 'DEADLINE',
	});
	const called = [];
	const results = await executeCleanup(
		[
			{ name: 'primary', run: async () => called.push('primary') },
			{
				name: 'secondary',
				run: async () => {
					called.push('secondary');
					throw new Error('not retained');
				},
			},
		],
		50
	);
	assert.deepEqual(called, ['primary', 'secondary']);
	assert.deepEqual(results, [
		{ name: 'primary', status: 'passed' },
		{ name: 'secondary', status: 'failed' },
	]);
});

test('browser and whole-run deadlines cancel pending work before cleanup', async () => {
	let pageClosed = false;
	const page = {
		evaluate: () => new Promise(() => {}),
		close: async () => {
			pageClosed = true;
		},
	};
	await assert.rejects(() => boundedEvaluate(page, 5, 'browser-operation', () => undefined), {
		code: 'DEADLINE',
	});
	assert.equal(pageClosed, true);
	let cancelled = false;
	await assert.rejects(
		() =>
			runWithInterruption(
				() => new Promise(() => {}),
				5,
				async () => {
					cancelled = true;
				}
			),
		{ code: 'DEADLINE' }
	);
	assert.equal(cancelled, true);
	assert.deepEqual(await closeWithStatus('pending', () => new Promise(() => {}), 5), {
		name: 'pending',
		status: 'failed',
	});
});

test('receipt is redacted and remains partial without OAuth or complete cleanup', () => {
	const receipt = createReceipt({
		runId: 'run-12345678',
		revision: 'abc123',
		deploymentUrl: new URL('https://example.convex.cloud/path?token=secret'),
		assertions: [{ name: 'credentials', status: 'passed' }],
		cleanup: [{ name: 'primary', status: 'failed' }],
		oauthConfigured: false,
	});
	const serialized = JSON.stringify(receipt);
	assert.equal(receipt.status, 'partial');
	assert.equal(receipt.runId, 'run-12345678');
	assert.match(receipt.receiptId, /^[0-9a-f-]{36}$/);
	assert.equal(receipt.deploymentOrigin, 'https://example.convex.cloud');
	assert.equal(serialized.includes('secret'), false);
});
