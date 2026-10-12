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
import { deadline, hostedConfig, receiptJSON } from './contract.ts';
import { secureProviderFetch, validateDiscovery } from './provider-fetch.ts';

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
	assert.equal(hostedConfig(valid).mode, 'hosted');
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
