/**
 * @fileoverview The provider the hosted server mounts (phase 6 specification, 3.7): Better Auth from phase 3's
 * `createLoamAuthOptions`, as it is, at `<base><identity.path>`, its database `<data>/auth.sqlite` on
 * `node:sqlite`, and its mail through `createMail`. Nothing here adds to or overrides the options: every rule of
 * phase 3's 2.6 and 5.8 (the disabled paths, the origin and CSRF checks, the registration hooks) and A7's
 * address header are `createLoamAuthOptions`' own.
 */

import { existsSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
	createLoamAuthOptions,
	type LoamMailV1,
	type LoamOidcProviderV1,
	readBinding,
} from '@lushly-dev/loam-identity';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { createMailSink } from './dev-files.js';
import { HostError } from './errors.js';
import type { ResolvedSecrets } from './secrets.js';

/** The provider's database in the data directory (section 4). */
export const AUTH_DATABASE = 'auth.sqlite';

type Provider = ReturnType<typeof betterAuth>;

export interface HostProvider {
	/** The Better Auth instance, from `createLoamAuthOptions` unchanged. */
	readonly auth: Provider;
	/** `<base><identity.path>`, with no trailing slash: the provider's routes are below it. */
	readonly path: string;
	/** Whether the binding exists: the organization was bootstrapped (3.1, `HOST_NOT_BOOTSTRAPPED`). */
	bootstrapped(): Promise<boolean>;
	/** Whether the bound organization has a member: the bootstrap is done (3.7, `HOST_ALREADY_BOOTSTRAPPED`). */
	hasMembers(): Promise<boolean>;
	close(): void;
}

export interface Mailer {
	send(message: LoamMailV1): Promise<void>;
}

/**
 * The provider's mail (3.7): `sink` appends one JSON line per message to `<data>/mail.jsonl`, 0600. `smtp` is
 * section 9's, built with the production profile (step 8), and refused here until then.
 */
export async function createMail(server: ServerConfigV1): Promise<Mailer> {
	const mail = server.mail;
	if (mail?.transport === 'sink') {
		const sink = await createMailSink(server.data);
		return { send: (message) => sink.send(message) };
	}
	throw new HostError([
		{
			code: 'HOST_CONFIG_INVALID',
			key: 'mail.transport',
			message:
				mail === undefined
					? 'A `provider` deployment sends invitations and recovery links, and the server configuration has no `[mail]`.'
					: "`smtp` mail is the production profile's, built with milestone M2; this server sends only to the development profile's sink.",
			suggestion:
				mail === undefined
					? 'Add `[mail]` with `transport = "sink"` on `localhost`.'
					: 'Use `loam-host dev`, whose mail goes to its sink, until the production profile is built.',
		},
	]);
}

/** The deployer's single sign-on providers, one per `oidc:<id>` method, with each client secret (3.2). */
function oidcProviders(
	server: ServerConfigV1,
	secrets: ResolvedSecrets
): LoamOidcProviderV1[] | undefined {
	const tables = Object.entries(server.oidc ?? {});
	if (tables.length === 0) return undefined;
	return tables.map(([id, table]) => ({
		id,
		clientId: table.client_id,
		clientSecret: secrets.oidc[id] as string,
		discoveryUrl: `${table.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
	}));
}

/**
 * Opens the provider on the data directory: `auth.sqlite`, created 0600 so its journal files are too, migrated to
 * Better Auth's and `loamServerPlugin`'s tables, behind `createLoamAuthOptions`. The caller holds the lock.
 */
export async function openProvider(options: {
	server: ServerConfigV1;
	secrets: ResolvedSecrets;
	identity: Extract<IdentityV1, { mode: 'provider' }>;
	workspace: string;
	basePath: string;
	mail: Mailer;
	/** Tests only: a raised rate limit; the limiter is `createLoamAuthOptions`' and on in every mode. */
	rateLimit?: { window: number; max: number };
}): Promise<HostProvider> {
	const { server, secrets, identity, workspace, basePath } = options;
	if (secrets.auth === undefined) {
		throw new HostError([
			{
				code: 'HOST_SECRET_UNAVAILABLE',
				key: 'auth',
				message:
					"A `provider` deployment needs the provider's secret, and the server configuration has no `[auth]`.",
				suggestion:
					'Add `[auth]` with `secret_file` (mode 0600) or `secret_env`, at least 32 bytes.',
			},
		]);
	}
	const file = join(server.data, AUTH_DATABASE);
	// SQLite gives its `-wal` and `-shm` files the database's mode, so the file is made 0600 before it is opened.
	if (!existsSync(file)) await writeFile(file, '', { mode: 0o600, flag: 'wx' });
	await chmod(file, 0o600);
	const database = new DatabaseSync(file);
	try {
		database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
		const shell = `${server.origin}${basePath}`;
		const oidc = oidcProviders(server, secrets);
		const authOptions = createLoamAuthOptions({
			baseURL: `${shell}${identity.path}`,
			secret: secrets.auth,
			database,
			workspace,
			organization: identity.organization,
			methods: identity.methods,
			mail: options.mail,
			shell,
			...(oidc ? { oidc } : {}),
			...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
		});
		await (await getMigrations(authOptions)).runMigrations();
		const auth = betterAuth(authOptions);
		const context = await auth.$context;
		const adapter = context.adapter;
		const binding = () => readBinding(adapter as never, workspace);
		return {
			auth,
			path: `${basePath}${identity.path}`,
			async bootstrapped() {
				return (await binding()) !== null;
			},
			async hasMembers() {
				const held = await binding();
				if (!held) return false;
				const members = await adapter.findMany({
					model: 'member',
					where: [{ field: 'organizationId', value: held.organizationId }],
					limit: 1,
				});
				return members.length > 0;
			},
			close() {
				database.close();
			},
		};
	} catch (cause) {
		database.close();
		throw cause;
	}
}
