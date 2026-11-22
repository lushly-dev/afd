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
	const clients = await registerClients(auth, config);
	const server = createServer(toNodeHandler(auth));
	await new Promise<void>((resolve) => server.listen(config.port, '127.0.0.1', resolve));
	const close = () => {
		server.close();
		database.close();
		process.exit(0);
	};
	process.once('SIGTERM', close);
	process.once('SIGINT', close);
	return { ready: true, organizationId, people, clients };
}

/** The deployer's pre-registration (9.4): an owner's session, through the server API, as `loam-host` will do it. */
async function registerClients(
	auth: Awaited<ReturnType<typeof createTestProvider>>['auth'],
	config: HostChildConfig
): Promise<Record<string, string>> {
	const clients: Record<string, string> = {};
	if (!config.clients?.length) return clients;
	const owner = config.people.find((person) => person.role === 'owner' && person.password);
	if (!owner) throw new Error('Pre-registering a client needs a seeded owner with a password');
	const api = auth.api as unknown as Record<string, (input: unknown) => Promise<unknown>>;
	const signedIn = (await api.signInEmail?.({
		body: { email: owner.email, password: owner.password },
		asResponse: true,
	})) as Response;
	const cookie = signedIn.headers
		.getSetCookie()
		.map((line) => line.split(';')[0])
		.join('; ');
	for (const client of config.clients) {
		const made = (await api.adminCreateOAuthClient?.({
			headers: new Headers({ cookie }),
			body: {
				client_name: client.name,
				redirect_uris: [client.redirect],
				token_endpoint_auth_method: 'none',
				application_type: 'native',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
			},
		})) as { client_id: string };
		clients[client.name] = made.client_id;
	}
	return clients;
}

try {
	const config = JSON.parse(process.env.LOAM_AUTH_HOST ?? '') as HostChildConfig;
	delete process.env.LOAM_AUTH_HOST;
	process.send?.(await start(config));
} catch (cause) {
	process.send?.({ ready: false, message: String((cause as Error)?.message ?? cause) });
	process.exitCode = 1;
}
