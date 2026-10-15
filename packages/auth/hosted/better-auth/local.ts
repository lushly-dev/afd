import { type ChildProcess, execFile, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { RunConfig } from './contract.js';
import { startOAuthProvider } from './oauth-provider.js';
import type { FixtureConfig } from './provider.js';

export async function stopChild(child: ChildProcess) {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill('SIGTERM');
	const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
	try {
		await exited;
	} finally {
		clearTimeout(timer);
	}
}
export async function startChild(
	directory: string,
	fixture: FixtureConfig,
	signal: AbortSignal,
	timeoutMs: number
) {
	const child = fork(resolve(directory, 'server.mjs'), [], {
		env: { ...process.env, AFD_BA_INTERNAL_CONFIG: JSON.stringify(fixture) },
		stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
	});
	try {
		await new Promise<void>((resolveReady, reject) => {
			const aborted = () => reject(new Error('Provider startup interrupted'));
			signal.addEventListener('abort', aborted, { once: true });
			if (signal.aborted) aborted();
			const timer = setTimeout(() => reject(new Error('Provider startup deadline')), timeoutMs);
			const cleanup = () => {
				clearTimeout(timer);
				signal.removeEventListener('abort', aborted);
			};
			child.once('exit', cleanup);
			child.once('message', cleanup);
			child.once('error', () => {
				clearTimeout(timer);
				reject(new Error('Provider process launch failed'));
			});
			child.once('exit', () => {
				clearTimeout(timer);
				reject(new Error('Provider startup failed'));
			});
			child.once('message', (message: { ready?: boolean }) => {
				clearTimeout(timer);
				message.ready ? resolveReady() : reject(new Error('Provider startup failed'));
			});
		});
		return child;
	} catch (error) {
		await stopChild(child);
		throw error;
	}
}
export async function startLocal(
	directory: string,
	revision: string,
	deadlineMs: number,
	signal: AbortSignal,
	expectedEmail = 'oauth@example.test'
) {
	signal.throwIfAborted();
	const scratch = await mkdtemp(resolve(tmpdir(), 'afd-better-auth-'));
	let child: ChildProcess | undefined;
	let oauth: Awaited<ReturnType<typeof startOAuthProvider>> | undefined;
	try {
		const certificatePath = resolve(scratch, 'certificate.pem');
		const privateKeyPath = resolve(scratch, 'private-key.pem');
		await promisify(execFile)(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-keyout',
				privateKeyPath,
				'-out',
				certificatePath,
				'-days',
				'1',
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=IP:127.0.0.1,DNS:localhost',
			],
			{ timeout: 15_000, signal }
		);
		const socket = createServer();
		socket.listen(0, '127.0.0.1');
		await once(socket, 'listening');
		const address = socket.address();
		if (!address || typeof address === 'string') throw new Error('Port allocation failed');
		const port = address.port;
		await new Promise<void>((done) => socket.close(() => done()));
		const origin = `https://127.0.0.1:${port}`;
		oauth = await startOAuthProvider();
		signal.throwIfAborted();
		const config: RunConfig = {
			mode: 'local',
			appURL: origin,
			providerId: 'afd-local-oauth',
			callbackURL: `${origin}/api/auth/callback/afd-local-oauth`,
			returnURL: `${origin}/`,
			expectedEmail,
			revision,
			controlKey: randomBytes(32).toString('hex'),
			restartCommand: [],
			deadlineMs,
			operationTimeoutMs: 5_000,
			restartTimeoutMs: 3_000,
			sessionExpiresIn: 12,
			sessionUpdateAge: 1,
		};
		oauth.registerCallback(config.callbackURL);
		const fixture: FixtureConfig = {
			origin,
			host: '127.0.0.1',
			port,
			databasePath: resolve(scratch, 'auth.sqlite'),
			secret: randomBytes(32).toString('hex'),
			controlKey: config.controlKey,
			providerId: config.providerId,
			expectedEmail: config.expectedEmail,
			revision,
			assetPath: resolve(directory, 'fixture.js'),
			clientId: 'afd-local-client',
			clientSecret: 'afd-local-secret',
			localOAuthOrigin: oauth.origin,
			certificatePath,
			privateKeyPath,
			expiresIn: config.sessionExpiresIn,
			updateAge: config.sessionUpdateAge,
		};
		child = await startChild(directory, fixture, signal, config.operationTimeoutMs);
		signal.throwIfAborted();
		return {
			config,
			async restart(timeoutMs = config.operationTimeoutMs) {
				if (child) await stopChild(child);
				child = await startChild(
					directory,
					fixture,
					signal,
					Math.min(timeoutMs, config.operationTimeoutMs)
				);
			},
			async close() {
				try {
					if (child) await stopChild(child);
				} finally {
					try {
						await oauth?.close();
					} finally {
						await rm(scratch, { recursive: true, force: true });
					}
				}
			},
		};
	} catch (error) {
		if (child) await stopChild(child);
		await oauth?.close();
		await rm(scratch, { recursive: true, force: true });
		throw error;
	}
}
