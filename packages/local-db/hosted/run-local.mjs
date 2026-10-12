#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
/** Credential-free local lifecycle: durable write -> process restart -> read -> exact cleanup. */
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = new URL('.', import.meta.url);
const serverScript = new URL('durable-rest-server.mjs', directory);
const phaseScript = new URL('run-phase.mjs', directory);
const localDbBuild = new URL('../dist/index.js', directory);
const viewStateBuild = new URL('../../view-state/dist/index.js', directory);
const activeChildren = new Set();
let parentSignal;

class LocalHarnessError extends Error {
	constructor(message, detail) {
		super(message);
		this.detail = detail;
	}
}

async function requireRuntime() {
	const major = Number(process.versions.node.split('.')[0]);
	if (major < 24) throw new LocalHarnessError('The durable fixture requires Node 24 or newer');
	try {
		await Promise.all([access(localDbBuild), access(viewStateBuild)]);
	} catch {
		throw new LocalHarnessError(
			'Build local-db and view-state before running the local persistence fixture'
		);
	}
}

function spawnTracked(script, options) {
	const child = spawn(process.execPath, [fileURLToPath(script)], options);
	activeChildren.add(child);
	child.once('exit', () => activeChildren.delete(child));
	child.once('error', () => activeChildren.delete(child));
	return child;
}

function handleParentSignal(signal) {
	parentSignal ??= signal;
	const children = [...activeChildren];
	for (const child of children) child.kill('SIGTERM');
	setTimeout(() => {
		for (const child of children) {
			if (!hasExited(child)) child.kill('SIGKILL');
		}
	}, 2_000).unref();
}

const onSigint = () => handleParentSignal('SIGINT');
const onSigterm = () => handleParentSignal('SIGTERM');

function hasExited(child) {
	return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
	if (hasExited(child)) return Promise.resolve(true);
	return new Promise((resolve) => {
		const onExit = () => finish(true);
		const timeout = setTimeout(() => finish(false), timeoutMs);
		const finish = (exited) => {
			clearTimeout(timeout);
			child.off('exit', onExit);
			resolve(exited);
		};
		child.once('exit', onExit);
	});
}

async function terminateChild(child, label) {
	if (!child || hasExited(child)) return;
	child.kill('SIGTERM');
	if (await waitForExit(child, 5_000)) return;
	child.kill('SIGKILL');
	if (!(await waitForExit(child, 2_000))) {
		throw new LocalHarnessError(`${label} did not exit after SIGKILL`);
	}
	throw new LocalHarnessError(`${label} required SIGKILL after its shutdown deadline`);
}

async function startServer(environment) {
	const child = spawnTracked(serverScript, {
		env: { ...process.env, ...environment },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});

	return new Promise((resolve, reject) => {
		let settled = false;
		const timeout = setTimeout(() => {
			void terminateChild(child, 'Durable REST fixture')
				.catch(() => {})
				.finally(() =>
					finish(
						reject,
						new LocalHarnessError('Durable REST fixture did not become ready before its deadline')
					)
				);
		}, 10_000);
		const finish = (settle, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			child.off('error', onError);
			child.off('exit', onExit);
			child.stdout.off('data', inspect);
			settle(value);
		};
		const inspect = () => {
			const line = stdout.split('\n').find((entry) => entry.trim());
			if (!line) return;
			try {
				const ready = JSON.parse(line);
				if (ready.event !== 'ready' || !ready.baseURL || !ready.storeId) return;
				finish(resolve, { child, ...ready });
			} catch {}
		};
		const onError = () => {
			finish(reject, new LocalHarnessError('Could not start the durable REST fixture process'));
		};
		const onExit = (code) => {
			finish(
				reject,
				new LocalHarnessError('Durable REST fixture exited before readiness', {
					code,
					diagnostic: stderr.trim().slice(0, 400),
				})
			);
		};
		child.stdout.on('data', inspect);
		child.once('error', onError);
		child.once('exit', onExit);
	});
}

async function stopServer(server) {
	await terminateChild(server?.child, 'Durable REST fixture');
}

async function runPhase(environment, phase) {
	const child = spawnTracked(phaseScript, {
		env: { ...process.env, ...environment, AFD_TEST_HTTP_PHASE: phase },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	const exitCode = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			void terminateChild(child, `Phase ${phase}`)
				.catch(() => {})
				.finally(() =>
					reject(new LocalHarnessError(`Phase ${phase} exceeded its process deadline`))
				);
		}, 45_000);
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', (code) => {
			clearTimeout(timeout);
			resolve(code);
		});
	});
	const output = stdout.trim().split('\n').filter(Boolean).at(-1);
	if (exitCode !== 0) {
		let diagnostic = 'phase emitted no safe diagnostic';
		try {
			const failure = JSON.parse(stderr.trim().split('\n').filter(Boolean).at(-1));
			diagnostic = `${failure.code}: ${failure.message}`;
		} catch {}
		throw new LocalHarnessError(`Phase ${phase} failed`, { diagnostic });
	}
	try {
		return JSON.parse(output);
	} catch {
		throw new LocalHarnessError(`Phase ${phase} did not emit a JSON receipt`);
	}
}

async function removeTemporaryDirectory(path) {
	const expectedPrefix = join(tmpdir(), 'afd-362-');
	if (!path.startsWith(expectedPrefix)) {
		throw new LocalHarnessError('Refusing to remove an unexpected fixture directory');
	}
	await rm(path, { recursive: true });
}

async function main() {
	await requireRuntime();
	process.once('SIGINT', onSigint);
	process.once('SIGTERM', onSigterm);
	const fixtureDirectory = await mkdtemp(join(tmpdir(), 'afd-362-'));
	const databasePath = join(fixtureDirectory, 'durable.sqlite');
	const runId = randomUUID();
	const tokenA = randomUUID();
	const tokenB = randomUUID();
	const serverEnvironment = {
		AFD_FIXTURE_DB_PATH: databasePath,
		AFD_FIXTURE_TOKEN_A: tokenA,
		AFD_FIXTURE_TOKEN_B: tokenB,
	};
	const phaseEnvironment = {
		AFD_TEST_HTTP_TABLE: 'integration_records',
		AFD_TEST_HTTP_RUN_ID: runId,
		AFD_TEST_HTTP_TOKEN: tokenA,
		AFD_TEST_HTTP_SECONDARY_TOKEN: tokenB,
		AFD_TEST_HTTP_EXPECT_FIXTURE_AUTH: '1',
		AFD_TEST_HTTP_DEADLINE_MS: '3000',
		AFD_TEST_HTTP_APP_REVISION: 'local-node24-fixture',
	};
	let server;
	let cleanupComplete = false;
	let teardownComplete = false;
	let primaryError;
	const receipts = [];
	try {
		server = await startServer(serverEnvironment);
		if (process.env.AFD_FIXTURE_TEST_SIGNAL_READY === '1') {
			process.stdout.write(`${JSON.stringify({ event: 'signal-test-ready' })}\n`);
		}
		phaseEnvironment.AFD_TEST_HTTP_BASE_URL = server.baseURL;
		phaseEnvironment.AFD_TEST_HTTP_STORE_ID = server.storeId;
		receipts.push(await runPhase(phaseEnvironment, 'write'));
		const firstStoreId = server.storeId;
		const unavailableURL = server.baseURL;
		await stopServer(server);
		server = undefined;

		receipts.push(
			await runPhase(
				{
					...phaseEnvironment,
					AFD_TEST_HTTP_BASE_URL: unavailableURL,
					AFD_TEST_HTTP_DEADLINE_MS: '500',
					AFD_TEST_HTTP_UNAVAILABLE_ACK: `local-outage-${randomUUID()}`,
				},
				'unavailable'
			)
		);

		server = await startServer(serverEnvironment);
		if (server.storeId !== firstStoreId) {
			throw new LocalHarnessError('Fixture store identity changed across server restart');
		}
		phaseEnvironment.AFD_TEST_HTTP_BASE_URL = server.baseURL;
		phaseEnvironment.AFD_TEST_HTTP_RESTART_ACK = `local-restart-${randomUUID()}`;
		receipts.push(await runPhase(phaseEnvironment, 'read'));
		receipts.push(await runPhase(phaseEnvironment, 'cleanup'));
		cleanupComplete = true;
	} catch (error) {
		primaryError = error;
	} finally {
		if (parentSignal && server) {
			try {
				await stopServer(server);
			} catch (stopError) {
				if (!primaryError) primaryError = stopError;
			} finally {
				server = undefined;
			}
		}
		if (!cleanupComplete) {
			try {
				if (!server || hasExited(server.child)) server = await startServer(serverEnvironment);
				phaseEnvironment.AFD_TEST_HTTP_BASE_URL = server.baseURL;
				phaseEnvironment.AFD_TEST_HTTP_STORE_ID = server.storeId;
				receipts.push(await runPhase(phaseEnvironment, 'cleanup'));
				cleanupComplete = true;
			} catch (cleanupError) {
				if (!primaryError) primaryError = cleanupError;
			}
		}
		try {
			await stopServer(server);
		} catch (stopError) {
			if (!primaryError) primaryError = stopError;
		}
		const allChildrenExited = [...activeChildren].every(hasExited);
		teardownComplete = allChildrenExited;
		if (cleanupComplete && allChildrenExited) await removeTemporaryDirectory(fixtureDirectory);
		else if (primaryError instanceof LocalHarnessError) {
			primaryError.detail = { ...primaryError.detail, retainedDatabaseDirectory: fixtureDirectory };
		} else if (!allChildrenExited) {
			primaryError = new LocalHarnessError('Child teardown was incomplete', {
				retainedDatabaseDirectory: fixtureDirectory,
			});
		}
		process.off('SIGINT', onSigint);
		process.off('SIGTERM', onSigterm);
	}
	if (parentSignal) {
		const retainedDatabaseDirectory =
			primaryError instanceof LocalHarnessError
				? primaryError.detail?.retainedDatabaseDirectory
				: undefined;
		primaryError = new LocalHarnessError(
			`Local persistence harness interrupted by ${parentSignal}`,
			{
				cleanup:
					cleanupComplete && teardownComplete
						? 'exact-ID cleanup and child teardown complete'
						: 'cleanup or child teardown incomplete',
				...(retainedDatabaseDirectory ? { retainedDatabaseDirectory } : {}),
			}
		);
	}
	if (primaryError) throw primaryError;
	return {
		status: 'passed',
		mode: 'local-durable-restart',
		runId,
		phases: receipts.map(({ phase, status, checks }) => ({ phase, status, checks })),
		cleanup: 'exact IDs verified absent; temporary database removed',
	};
}

try {
	process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (error) {
	process.stderr.write(
		`${JSON.stringify({
			status: 'failed',
			message:
				error instanceof LocalHarnessError ? error.message : 'Local persistence harness failed',
			detail: error instanceof LocalHarnessError ? error.detail : undefined,
		})}\n`
	);
	process.exitCode = parentSignal === 'SIGINT' ? 130 : parentSignal === 'SIGTERM' ? 143 : 1;
}
