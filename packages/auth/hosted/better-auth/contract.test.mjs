/** Node24-only opt-in harness regressions; separate from package default Vitest discovery. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	deadline,
	hasRestartLifetimeMargin,
	hostedConfig,
	hostedListenConfig,
	RESTART_CLOCK_SKEW_MARGIN_MS,
	receiptJSON,
	renewalEvidenceIsConsistent,
	requiredRestartLifetimeMs,
} from './contract.ts';
import { secureProviderFetch, validateDiscovery } from './provider-fetch.ts';
import { remainingBudgetMs, restartWithinBudget, withinTimeout } from './restart.ts';

const valid = {
	AFD_BA_DISPOSABLE: '1',
	AFD_BA_APP_URL: 'https://disposable.example.test',
	AFD_BA_PROVIDER_ID: 'oidc',
	AFD_BA_CALLBACK_URL: 'https://disposable.example.test/api/auth/callback/oidc',
	AFD_BA_RETURN_URL: 'https://disposable.example.test/',
	AFD_BA_EXPECTED_EMAIL: 'synthetic@example.test',
	AFD_BA_REVISION: 'abcdef0123456789',
	AFD_BA_CONTROL_KEY: 'control-test-only-0123456789abcdef',
	AFD_BA_RESTART_COMMAND: '["test-restart", "disposable"]',
};
test('hosted preflight requires every input and exact secure callback topology', () => {
	assert.deepEqual(
		{
			...hostedConfig(valid),
			restartCommand: undefined,
		},
		{
			mode: 'hosted',
			appURL: 'https://disposable.example.test',
			providerId: 'oidc',
			callbackURL: 'https://disposable.example.test/api/auth/callback/oidc',
			returnURL: 'https://disposable.example.test/',
			expectedEmail: 'synthetic@example.test',
			revision: 'abcdef0123456789',
			controlKey: 'control-test-only-0123456789abcdef',
			restartCommand: undefined,
			deadlineMs: 600_000,
			operationTimeoutMs: 15_000,
			restartTimeoutMs: 90_000,
			sessionExpiresIn: 180,
			sessionUpdateAge: 5,
		}
	);
	for (const name of Object.keys(valid)) {
		const env = { ...valid };
		delete env[name];
		assert.throws(() => hostedConfig(env));
	}
	for (const override of [
		{ AFD_BA_APP_URL: 'http://disposable.example.test' },
		{ AFD_BA_CALLBACK_URL: 'https://other.example.test/api/auth/callback/oidc' },
		{ AFD_BA_CALLBACK_URL: 'https://disposable.example.test/incorrect' },
		{ AFD_BA_RETURN_URL: 'https://disposable.example.test/?secret=no' },
		{ AFD_BA_RESTART_COMMAND: 'shell-command-instead-of-argv' },
		{ AFD_BA_RESTART_COMMAND: '[42]' },
		{ AFD_BA_REVISION: 'not-a-commit' },
	])
		assert.throws(() => hostedConfig({ ...valid, ...override }));
	for (const value of ['0', '9999', '900001', 'Infinity', '10000.1'])
		assert.throws(() => deadline(value));
});
test('hosted timing is bounded and the whole-run deadline covers expiry and restart', () => {
	for (const override of [
		{ AFD_BA_SESSION_EXPIRES_IN: '119' },
		{ AFD_BA_SESSION_EXPIRES_IN: '301' },
		{ AFD_BA_SESSION_UPDATE_AGE: '0' },
		{ AFD_BA_SESSION_UPDATE_AGE: '31' },
		{ AFD_BA_OPERATION_TIMEOUT_MS: '4999' },
		{ AFD_BA_OPERATION_TIMEOUT_MS: '60001' },
		{ AFD_BA_RESTART_TIMEOUT_MS: '29999' },
		{ AFD_BA_RESTART_TIMEOUT_MS: '120001' },
		{ AFD_BA_DEADLINE_MS: '285000' },
		{
			AFD_BA_SESSION_EXPIRES_IN: '120',
			AFD_BA_RESTART_TIMEOUT_MS: '120000',
			AFD_BA_DEADLINE_MS: '900000',
		},
		{
			AFD_BA_SESSION_EXPIRES_IN: '120',
			AFD_BA_RESTART_TIMEOUT_MS: '60000',
			AFD_BA_OPERATION_TIMEOUT_MS: '60000',
			AFD_BA_DEADLINE_MS: '900000',
		},
	]) {
		assert.throws(() => hostedConfig({ ...valid, ...override }));
	}
	const maximum = hostedConfig({
		...valid,
		AFD_BA_SESSION_EXPIRES_IN: '300',
		AFD_BA_SESSION_UPDATE_AGE: '30',
		AFD_BA_OPERATION_TIMEOUT_MS: '60000',
		AFD_BA_RESTART_TIMEOUT_MS: '120000',
		AFD_BA_DEADLINE_MS: '900000',
	});
	assert.equal(maximum.sessionExpiresIn, 300);
	assert.equal(maximum.deadlineMs, 900_000);
	const boundary = hostedConfig({
		...valid,
		AFD_BA_SESSION_EXPIRES_IN: '120',
		AFD_BA_RESTART_TIMEOUT_MS: '90000',
		AFD_BA_OPERATION_TIMEOUT_MS: '28999',
	});
	assert.equal(
		requiredRestartLifetimeMs(boundary.restartTimeoutMs, boundary.operationTimeoutMs),
		119_999
	);
});
test('renewal evidence requires adapter expiry advancement and provider agreement', () => {
	const originalAdapter = { id: 'session', userId: 'user', expiresAt: 1_000 };
	const originalProvider = { id: 'session', userId: 'user', expiresAt: 1_100 };
	const renewedAdapter = { id: 'session', userId: 'user', expiresAt: 2_000 };
	const renewedProvider = { id: 'session', userId: 'user', expiresAt: 2_100 };
	const evidence = (adapter, provider = renewedProvider) =>
		renewalEvidenceIsConsistent({
			originalAdapter,
			originalProvider,
			renewedAdapter: adapter,
			renewedProvider: provider,
		});
	assert.equal(evidence(renewedAdapter), true);
	assert.equal(evidence({ ...renewedAdapter, expiresAt: originalAdapter.expiresAt }), false);
	assert.equal(evidence({ id: 'session', userId: 'user' }), false);
	assert.equal(evidence(renewedAdapter, { ...renewedProvider, expiresAt: 1_999 }), false);
	assert.equal(evidence({ ...renewedAdapter, id: 'different-session' }), false);
});
test('restart lifetime reserves one post-restart operation budget', () => {
	assert.equal(RESTART_CLOCK_SKEW_MARGIN_MS, 1_000);
	assert.equal(requiredRestartLifetimeMs(90_000, 15_000), 106_000);
	assert.equal(hasRestartLifetimeMargin(107_000, 1_000, 90_000, 15_000), false);
	assert.equal(hasRestartLifetimeMargin(107_001, 1_000, 90_000, 15_000), true);
	assert.equal(hasRestartLifetimeMargin(undefined, 1_000, 90_000, 15_000), false);
});
test('hosted listener defaults to loopback and honors validated platform port precedence', () => {
	assert.deepEqual(hostedListenConfig({}), { host: '127.0.0.1', port: 3000 });
	assert.deepEqual(hostedListenConfig({ AFD_BA_HOST: '0.0.0.0', PORT: '10000' }), {
		host: '0.0.0.0',
		port: 10000,
	});
	assert.equal(hostedListenConfig({ AFD_BA_PORT: '4000', PORT: '10000' }).port, 4000);
	for (const env of [
		{ AFD_BA_HOST: 'example.test' },
		{ PORT: '0' },
		{ PORT: '65536' },
		{ PORT: '3.5' },
		{ PORT: '' },
	]) {
		assert.throws(() => hostedListenConfig(env));
	}
});
test('restart command and observation spend one shared timeout budget', async () => {
	let clock = 0;
	let observationBudget = 0;
	await restartWithinBudget({
		timeoutMs: 90_000,
		now: () => clock,
		restart: async (budget) => {
			assert.equal(budget, 90_000);
			clock = 35_000;
		},
		observeRestart: async (budget) => {
			observationBudget = budget;
		},
	});
	assert.equal(observationBudget, 55_000);
	assert.equal(
		remainingBudgetMs(10_000, 55_000, () => 60_000),
		5_000
	);
	assert.throws(() => remainingBudgetMs(10_000, 55_000, () => 65_000));
	assert.equal(await withinTimeout(Promise.resolve('observed'), 100), 'observed');
	await assert.rejects(withinTimeout(new Promise(() => {}), 1));
	await assert.rejects(
		restartWithinBudget({
			timeoutMs: 90_000,
			now: () => clock,
			restart: async () => {
				clock += 90_001;
			},
			observeRestart: async () => assert.fail('observation must not start'),
		})
	);
});
test('receipts whitelist output and strip OAuth query/fragment/credentials', () => {
	const secret = 'SECRET-SENTINEL-DO-NOT-PERSIST';
	const encoded = receiptJSON({
		schema: 1,
		mode: 'local',
		provider: 'test-only-local-oauth-pkce',
		origin: `https://user:${secret}@example.test/path?code=${secret}#${secret}`,
		revision: 'abcdef0',
		node: '24',
		versions: { betterAuth: '1.7.2' },
		browser: '156',
		assertions: ['named assertion'],
		checks: { startup: 'passed' },
		resourceCleanup: 'passed',
		result: 'passed',
		cleanup: 'passed',
		token: secret,
		cookie: secret,
		error: { message: secret },
		environment: { secret },
	});
	assert.ok(!encoded.includes(secret));
	assert.equal(JSON.parse(encoded).origin, 'https://example.test');
	assert.ok(!encoded.includes('environment'));
});
function run(args, env = {}, interruptAfterMs) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[fileURLToPath(new URL('./run.mjs', import.meta.url)), ...args],
			{
				env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
				stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
			}
		);
		let readySeen = false;
		const timer = interruptAfterMs ? setTimeout(() => child.kill('SIGTERM'), 10000) : undefined;
		child.on('message', (message) => {
			if (message.phase === 'fixture-ready' && interruptAfterMs) {
				readySeen = true;
				clearTimeout(timer);
				child.kill('SIGTERM');
			}
		});
		child.once('exit', () => clearTimeout(timer));
		let output = '';
		let errors = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
		});
		child.stderr.on('data', (chunk) => {
			errors += chunk;
		});
		child.once('error', reject);
		child.once('exit', (code) => resolve({ code, output, errors, readySeen }));
	});
}
test('explicit hosted request with missing configuration fails without provider pass or secrets', async () => {
	const result = await run(['--hosted'], { AFD_BA_SECRET: 'SECRET-SENTINEL' });
	assert.equal(result.code, 1);
	assert.equal(result.output, '');
	assert.match(result.errors, /not run/);
	assert.ok(!result.errors.includes('SECRET-SENTINEL'));
});
test('real Chromium deadline failure removes child server, database, generated key and browser', {
	timeout: 35_000,
}, async () => {
	const scratch = async () =>
		(await readdir(tmpdir())).filter((name) => name.startsWith('afd-better-auth-')).sort();
	const before = await scratch();
	const result = await run(['--local'], { AFD_BA_DEADLINE_MS: '10000' });
	assert.equal(result.code, 1);
	const receipt = JSON.parse(result.output);
	assert.equal(receipt.result, 'failed');
	assert.equal(receipt.interrupted, false);
	assert.equal(receipt.cleanup, 'passed');
	assert.equal(receipt.resourceCleanup, 'passed');
	assert.ok(receipt.assertions.length > 2); // It ran real provider/browser work before the deadline.
	assert.deepEqual(await scratch(), before);
	assert.equal(result.errors, '');
});

// Exercise the actual OS signal path, not only the harness's own browser timer.
test('SIGTERM during a real local run unwinds provider, browser, store and certificate cleanup', {
	timeout: 15_000,
}, async () => {
	const scratch = async () =>
		(await readdir(tmpdir())).filter((name) => name.startsWith('afd-better-auth-')).sort();
	const before = await scratch();
	const cache = async () =>
		(await readdir('node_modules/.cache'))
			.filter((name) => name.startsWith('afd-better-auth-run-'))
			.sort();
	const cacheBefore = await cache();
	const result = await run(['--local'], {}, 2000);
	assert.equal(result.code, 1);
	const receipt = JSON.parse(result.output);
	assert.equal(receipt.result, 'failed');
	assert.equal(receipt.interrupted, true);
	assert.equal(result.readySeen, true);
	assert.equal(receipt.cleanup, 'passed');
	assert.equal(receipt.resourceCleanup, 'passed');
	assert.ok(receipt.assertions.length > 0);
	assert.deepEqual(await cache(), cacheBefore);
	await new Promise((resolve, reject) => {
		const socket = createConnection({
			host: new URL(receipt.origin).hostname,
			port: Number(new URL(receipt.origin).port),
		});
		socket.once('error', resolve);
		socket.once('connect', () => {
			socket.destroy();
			reject(new Error('Provider child still listening after signal cleanup'));
		});
	});
	assert.deepEqual(await scratch(), before);
	assert.equal(result.errors, '');
});

test('external discovery rejects missing/insecure endpoints and issuer mismatch without network calls', () => {
	const metadata = {
		issuer: 'https://idp.example.test/tenant',
		authorization_endpoint: 'https://idp.example.test/authorize',
		token_endpoint: 'https://idp.example.test/token',
		userinfo_endpoint: 'https://idp.example.test/userinfo',
		jwks_uri: 'https://idp.example.test/jwks',
		id_token_signing_alg_values_supported: ['RS256'],
	};
	validateDiscovery(metadata, metadata.issuer);
	for (const field of [
		'issuer',
		'authorization_endpoint',
		'token_endpoint',
		'userinfo_endpoint',
		'jwks_uri',
	]) {
		for (const value of [
			undefined,
			'http://idp.example.test/plaintext',
			'https://credential@idp.example.test/endpoint',
		]) {
			assert.throws(() => validateDiscovery({ ...metadata, [field]: value }, metadata.issuer));
		}
	}
	assert.throws(() => validateDiscovery(metadata, 'https://idp.example.test/different-tenant'));
	assert.throws(() =>
		validateDiscovery(
			{ ...metadata, id_token_signing_alg_values_supported: ['none'] },
			metadata.issuer
		)
	);
});
test('provider fetch policy delegates real loopback network but never follows redirects', async () => {
	let targetRequests = 0;
	const server = createServer((incoming, response) => {
		if (incoming.url === '/redirect') response.writeHead(302, { location: '/target' }).end();
		else {
			targetRequests++;
			response.writeHead(200).end('real socket');
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	try {
		const origin = `http://127.0.0.1:${server.address().port}`;
		const external = secureProviderFetch(fetch, {});
		await assert.rejects(external(`${origin}/target`));
		assert.equal(targetRequests, 0);
		const local = secureProviderFetch(fetch, { localOAuthOrigin: origin });
		assert.equal(await (await local(`${origin}/target`)).text(), 'real socket');
		await assert.rejects(local(`${origin}/redirect`));
		assert.equal(targetRequests, 1);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});
