/**
 * @fileoverview The test-only auth host's child process (phase 3 specification, 2.4): Better Auth 1.7.18
 * from `createLoamAuthOptions`, on `node:sqlite` in the host's scratch directory, with a mail sink, the
 * organization and its people seeded, and the binding pinned. Copied in shape from
 * `packages/auth/hosted/better-auth/child-entry.ts` and `provider.ts` at `eba33efa`.
 */

import { appendFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { toNodeHandler } from 'better-auth/node';
import type { HostChildConfig, HostReady } from './index.js';
import { createTestProvider } from './provider.js';

async function start(config: HostChildConfig): Promise<HostReady> {
	const database = new DatabaseSync(config.databasePath);
	database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
	const { auth, organizationId, people } = await createTestProvider({
		...config,
		database,
		async send(message) {
			await appendFile(config.mailPath, `${JSON.stringify(message)}\n`);
		},
	});
	const server = createServer(toNodeHandler(auth));
	await new Promise<void>((resolve) => server.listen(config.port, '127.0.0.1', resolve));
	const close = () => {
		server.close();
		database.close();
		process.exit(0);
	};
	process.once('SIGTERM', close);
	process.once('SIGINT', close);
	return { ready: true, organizationId, people };
}

try {
	const config = JSON.parse(process.env.LOAM_AUTH_HOST ?? '') as HostChildConfig;
	delete process.env.LOAM_AUTH_HOST;
	process.send?.(await start(config));
} catch (cause) {
	process.send?.({ ready: false, message: String((cause as Error)?.message ?? cause) });
	process.exitCode = 1;
}
