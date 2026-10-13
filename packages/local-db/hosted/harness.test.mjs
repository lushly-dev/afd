import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { idsFor } from './harness-support.mjs';

const directory = new URL('.', import.meta.url);
const localScript = fileURLToPath(new URL('run-local.mjs', directory));
const phaseScript = fileURLToPath(new URL('run-phase.mjs', directory));
const serverScript = fileURLToPath(new URL('durable-rest-server.mjs', directory));

function runProcess(script, environment, timeoutMs = 15_000, onStdout) {
	const startedAt = Date.now();
	const processGroup = process.platform !== 'win32';
	const child = spawn(process.execPath, [script], {
		env: { ...process.env, ...environment },
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: processGroup,
	});
	let stdout = '';
	let stderr = '';
	let signalTree;
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
		onStdout?.(chunk, () => signalTree?.('SIGTERM'));
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	return new Promise((resolve, reject) => {
		let timedOut = false;
		let escalation;
		signalTree = (signal) => {
			try {
				if (processGroup) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch (error) {
				if (error?.code !== 'ESRCH') throw error;
			}
		};
		const timeout = setTimeout(() => {
			timedOut = true;
			signalTree('SIGTERM');
			escalation = setTimeout(() => signalTree('SIGKILL'), 2_000);
		}, timeoutMs);
		child.once('error', (error) => {
			clearTimeout(timeout);
			clearTimeout(escalation);
			reject(error);
		});
		child.once('close', (code, signal) => {
			clearTimeout(timeout);
			clearTimeout(escalation);
			const result = { code, signal, stdout, stderr, durationMs: Date.now() - startedAt };
			if (timedOut) {
				reject(Object.assign(new Error(`Child process exceeded ${timeoutMs} ms`), { result }));
			} else resolve(result);
		});
	});
}

function lastReceipt(output) {
	const line = output.trim().split('\n').filter(Boolean).at(-1);
	assert.ok(line, 'expected a JSON receipt');
	return JSON.parse(line);
}

async function startFixture(databasePath, tokenA, tokenB) {
	const child = spawn(process.execPath, [serverScript], {
		env: {
			...process.env,
			AFD_FIXTURE_DB_PATH: databasePath,
			AFD_FIXTURE_TOKEN_A: tokenA,
			AFD_FIXTURE_TOKEN_B: tokenB,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout.setEncoding('utf8');
	let stdout = '';
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error('fixture readiness timeout'));
		}, 5_000);
		const inspect = () => {
			const line = stdout.split('\n').find(Boolean);
			if (!line) return;
			try {
				const ready = JSON.parse(line);
				if (ready.event !== 'ready') return;
				clearTimeout(timeout);
				child.stdout.off('data', inspect);
				resolve({ child, ...ready });
			} catch {}
		};
		child.stdout.on('data', inspect);
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', (code, signal) => {
			clearTimeout(timeout);
			reject(new Error(`fixture exited before readiness: ${code ?? signal}`));
		});
	});
}

async function stopFixture(fixture) {
	if (!fixture || fixture.child.exitCode !== null || fixture.child.signalCode !== null) return;
	const exited = new Promise((resolve) => fixture.child.once('exit', resolve));
	fixture.child.kill('SIGTERM');
	let timeout;
	try {
		await Promise.race([
			exited,
			new Promise((_, reject) => {
				timeout = setTimeout(() => {
					fixture.child.kill('SIGKILL');
					reject(new Error('fixture shutdown timeout'));
				}, 3_000);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

function phaseEnvironment(baseURL, runId, tokenA, tokenB, extra = {}) {
	return {
		AFD_TEST_HTTP_BASE_URL: baseURL,
		AFD_TEST_HTTP_TABLE: 'integration_records',
		AFD_TEST_HTTP_RUN_ID: runId,
		AFD_TEST_HTTP_TOKEN: tokenA,
		AFD_TEST_HTTP_SECONDARY_TOKEN: tokenB,
		AFD_TEST_HTTP_APP_REVISION: 'node-test-revision',
		AFD_TEST_HTTP_DEADLINE_MS: '500',
		...extra,
	};
}

test('local lifecycle proves restart, recovery, and exact cleanup', {
	timeout: 20_000,
}, async () => {
	const result = await runProcess(localScript, {}, 15_000);
	assert.equal(result.code, 0, result.stderr);
	const receipt = lastReceipt(result.stdout);
	assert.equal(receipt.status, 'passed');
	assert.deepEqual(
		receipt.phases.map((phase) => phase.phase),
		['write', 'unavailable', 'read', 'cleanup']
	);
});

test('malformed URL cannot count as controlled unavailability', async () => {
	const result = await runProcess(phaseScript, {
		AFD_TEST_HTTP_PHASE: 'unavailable',
		AFD_TEST_HTTP_BASE_URL: 'relative-or-malformed',
		AFD_TEST_HTTP_TABLE: 'integration_records',
		AFD_TEST_HTTP_RUN_ID: 'malformed-url-362',
		AFD_TEST_HTTP_UNAVAILABLE_ACK: 'controlled-outage-362',
	});
	assert.equal(result.code, 1);
	const receipt = lastReceipt(result.stderr);
	assert.equal(receipt.code, 'CONFIG');
	assert.match(receipt.message, /valid absolute URL/);
});

test('external cleartext endpoints are rejected before bearer tokens can be sent', async () => {
	const result = await runProcess(phaseScript, {
		AFD_TEST_HTTP_PHASE: 'preflight',
		AFD_TEST_HTTP_BASE_URL: 'http://example.com/api/v1',
		AFD_TEST_HTTP_TABLE: 'integration_records',
		AFD_TEST_HTTP_RUN_ID: 'cleartext-url-362',
	});
	assert.equal(result.code, 1);
	const receipt = lastReceipt(result.stderr);
	assert.equal(receipt.code, 'CONFIG');
	assert.match(receipt.message, /must use HTTPS/);
});

test('SIGTERM waits for exact cleanup and child teardown', { timeout: 20_000 }, async () => {
	let signalSent = false;
	const result = await runProcess(
		localScript,
		{ AFD_FIXTURE_TEST_SIGNAL_READY: '1' },
		15_000,
		(chunk, terminate) => {
			if (!signalSent && chunk.includes('signal-test-ready')) {
				signalSent = true;
				terminate();
			}
		}
	);
	assert.equal(signalSent, true);
	assert.equal(result.code, 143);
	assert.equal(result.signal, null);
	const receipt = lastReceipt(result.stderr);
	assert.equal(receipt.status, 'failed');
	assert.match(receipt.message, /interrupted by SIGTERM/);
	assert.equal(receipt.detail.cleanup, 'exact-ID cleanup and child teardown complete');
});

test('read phase rejects a claimed restart on the same application instance', {
	timeout: 20_000,
}, async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'afd-362-test-'));
	const tokenA = randomUUID();
	const tokenB = randomUUID();
	const runId = `same-instance-${randomUUID()}`;
	let fixture;
	try {
		fixture = await startFixture(join(temporaryDirectory, 'fixture.sqlite'), tokenA, tokenB);
		const environment = phaseEnvironment(fixture.baseURL, runId, tokenA, tokenB, {
			AFD_TEST_HTTP_STORE_ID: fixture.storeId,
		});
		const write = await runProcess(phaseScript, { ...environment, AFD_TEST_HTTP_PHASE: 'write' });
		assert.equal(write.code, 0, write.stderr);
		const read = await runProcess(phaseScript, {
			...environment,
			AFD_TEST_HTTP_PHASE: 'read',
			AFD_TEST_HTTP_RESTART_ACK: 'same-instance-claim',
		});
		assert.equal(read.code, 1);
		const failure = lastReceipt(read.stderr);
		assert.equal(failure.code, 'ASSERTION');
		assert.match(failure.message, /instance did not change/);
		const cleanup = await runProcess(phaseScript, {
			...environment,
			AFD_TEST_HTTP_PHASE: 'cleanup',
		});
		assert.equal(cleanup.code, 0, cleanup.stderr);
	} finally {
		await stopFixture(fixture);
		await rm(temporaryDirectory, { recursive: true });
	}
});

test('cleanup failure is bounded and returns exact-ID failure evidence', async () => {
	const result = await runProcess(
		phaseScript,
		{
			AFD_TEST_HTTP_PHASE: 'cleanup',
			AFD_TEST_HTTP_BASE_URL: 'http://127.0.0.1:1/api/v1',
			AFD_TEST_HTTP_TABLE: 'integration_records',
			AFD_TEST_HTTP_RUN_ID: 'bounded-cleanup-362',
			AFD_TEST_HTTP_DEADLINE_MS: '100',
		},
		5_000
	);
	assert.equal(result.code, 1);
	assert.ok(result.durationMs < 5_000);
	const failure = lastReceipt(result.stderr);
	assert.equal(failure.code, 'ASSERTION');
	assert.match(failure.message, /Exact-ID cleanup failed/);
});

test('view-state hydration failures are redacted and cannot pass category checks', async () => {
	const runId = 'redacted-warning-362';
	const ids = idsFor(runId);
	const secret = 'raw-provider-secret-body';
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://fixture.test');
		const segments = url.pathname.split('/').filter(Boolean);
		const id = segments.length > 3 ? decodeURIComponent(segments.at(-1)) : undefined;
		let status = 200;
		let body;
		if (url.pathname.endsWith('/health')) {
			body = { status: 'ok', version: 1, tables: 1, uptime: 1, storeId: 'redacted-store' };
		} else if (id === ids.marker) {
			body = {
				id,
				runId,
				storeIdentity: 'redacted-store',
				applicationRevision: 'before',
				applicationInstance: null,
			};
		} else if (url.searchParams.has('group')) {
			body = { data: [{ id: ids.queryA, group: runId, score: 10 }], total: 2 };
		} else if (url.searchParams.has('category')) {
			status = 500;
			body = { error: secret };
		} else if (id === ids.base) body = { id, value: 'after' };
		else if (id === ids.encoded) body = { id, kind: 'encoded-path' };
		else if (id === ids.batch) body = { id, value: 2 };
		else if (id === ids.batchUpsert) body = { id, value: 3 };
		else {
			status = 404;
			body = null;
		}
		response.writeHead(status, { 'content-type': 'application/json' });
		response.end(JSON.stringify(body));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	try {
		const result = await runProcess(phaseScript, {
			AFD_TEST_HTTP_PHASE: 'read',
			AFD_TEST_HTTP_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`,
			AFD_TEST_HTTP_TABLE: 'integration_records',
			AFD_TEST_HTTP_RUN_ID: runId,
			AFD_TEST_HTTP_APP_REVISION: 'after',
			AFD_TEST_HTTP_RESTART_ACK: 'redacted-restart-362',
		});
		assert.equal(result.code, 1);
		assert.equal(result.stderr.includes(secret), false);
		const failure = lastReceipt(result.stderr);
		assert.equal(failure.code, 'ASSERTION');
		assert.match(failure.message, /redacted warning/);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});
