/** Run behind HTTPS ingress with persistent volume. No resources are provisioned here. */
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFixture } from './build.mjs';
import { hostedConfig, hostedListenConfig } from './contract.ts';

let child;
let directory;
let timer;
try {
	if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ required');
	const config = hostedConfig(process.env);
	for (const name of [
		'DATABASE_PATH',
		'SECRET',
		'CLIENT_ID',
		'CLIENT_SECRET',
		'DISCOVERY_URL',
		'ISSUER',
	]) {
		if (!process.env[`AFD_BA_${name}`]) throw new Error(`Missing AFD_BA_${name}`);
	}
	const listen = hostedListenConfig(process.env);
	const discovery = new URL(process.env.AFD_BA_DISCOVERY_URL);
	if (discovery.protocol !== 'https:' || discovery.username || discovery.password)
		throw new Error('Discovery must use HTTPS');
	if (process.env.AFD_BA_SECRET.length < 32)
		throw new Error('Secret must contain at least 32 characters');
	const cache = resolve('node_modules/.cache');
	await mkdir(cache, { recursive: true });
	directory = await mkdtemp(resolve(cache, 'afd-better-auth-serve-'));
	await buildFixture(directory);
	const fixture = {
		origin: config.appURL,
		host: listen.host,
		port: listen.port,
		databasePath: resolve(process.env.AFD_BA_DATABASE_PATH),
		secret: process.env.AFD_BA_SECRET,
		controlKey: config.controlKey,
		providerId: config.providerId,
		expectedEmail: config.expectedEmail,
		revision: config.revision,
		assetPath: resolve(directory, 'fixture.js'),
		clientId: process.env.AFD_BA_CLIENT_ID,
		clientSecret: process.env.AFD_BA_CLIENT_SECRET,
		discoveryURL: discovery.href,
		issuer: process.env.AFD_BA_ISSUER,
		expiresIn: config.sessionExpiresIn,
		updateAge: config.sessionUpdateAge,
	};
	child = fork(resolve(directory, 'server.mjs'), [], {
		env: { ...process.env, AFD_BA_INTERNAL_CONFIG: JSON.stringify(fixture) },
		stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
	});
	timer = setTimeout(() => child.kill('SIGKILL'), config.operationTimeoutMs);
	child.once('message', (message) => {
		if (message.ready) {
			clearTimeout(timer);
			process.stdout.write('Disposable Better Auth fixture ready\n');
		}
	});
	for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
	await new Promise((resolveExit) =>
		child.once('exit', (code) => {
			process.exitCode = code ?? 1;
			resolveExit();
		})
	);
} catch (error) {
	process.stderr.write(
		`Better Auth fixture preflight/startup failed: ${error instanceof Error ? error.message : 'configuration error'}\n`
	);
	process.exitCode = 1;
} finally {
	if (timer) clearTimeout(timer);
	child?.kill('SIGKILL');
	if (directory) await rm(directory, { recursive: true, force: true });
}
