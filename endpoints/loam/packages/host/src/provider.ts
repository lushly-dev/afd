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
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import {
	createLoamAuthOptions,
	type LoamMailV1,
	type LoamOAuthConfig,
	type LoamOidcProviderV1,
	type MemberRemovedV1,
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

/**
 * Tests only, from `startDevHost` through `dev` (phase 3's step 10): the authorization server's further resources and
 * shorter token lifetime (P3-H1, P3-H4), and the Client ID Metadata Documents a suite serves (P3-H3), since the
 * provider's own transport refuses every special-use address and a suite has no public host. The bin passes none.
 */
export interface TestOAuthV1 {
	/** Further resources beside `<base>mcp`, each linked to every client: `createLoamAuthOptions`' `otherResources`. */
	resources?: string[];
	/** An access token's lifetime, from 1 to 600 seconds: `createLoamAuthOptions`' `accessTokenSeconds`. */
	accessTokenSeconds?: number;
	/** Metadata documents by their `https` URL, the client id: answered from memory, every other URL refused. */
	clientMetadata?: Record<string, unknown>;
}

/**
 * The provider's authorization server options for a test's {@link TestOAuthV1}: none for a deployment. A metadata
 * document's fetch answers only the URLs the suite named, as JSON, and refuses every other as the provider's own
 * transport refuses an address it may not reach, so the provider's CIMD validation reads exactly what it would.
 */
export function testOAuthConfig(test: TestOAuthV1 | undefined): LoamOAuthConfig | undefined {
	if (!test) return undefined;
	const documents = test.clientMetadata;
	return {
		...(test.resources ? { otherResources: test.resources } : {}),
		...(test.accessTokenSeconds !== undefined
			? { accessTokenSeconds: test.accessTokenSeconds }
			: {}),
		...(documents
			? {
					fetchClientMetadataResource: async (input: string | URL | Request) => {
						const url = new Request(input).url;
						if (!Object.hasOwn(documents, url))
							throw new TypeError('A test serves no metadata document at this URL');
						return new Response(JSON.stringify(documents[url]), {
							status: 200,
							headers: { 'content-type': 'application/json' },
						});
					},
				}
			: {}),
	};
}

type Provider = ReturnType<typeof betterAuth>;

export interface HostProvider {
	/** The Better Auth instance, from `createLoamAuthOptions` unchanged. */
	readonly auth: Provider;
	/** `<base><identity.path>`, with no trailing slash: the provider's routes are below it. */
	readonly path: string;
	/** The provider's exact issuer, Better Auth's base URL: `<origin><base><identity.path>` (9.2's step 1). */
	readonly issuer: string;
	/** The workspace whose binding names the organization (phase 3's 2.3). */
	readonly workspace: string;
	/** The deployment's single sign-on method ids, for the account an MCP call reads (phase 3's 9.2). */
	readonly oidc: readonly string[];
	/**
	 * The authorization server's metadata (RFC 8414), which the host serves at its origin's root by path insertion (A2):
	 * Better Auth's own `getOAuthServerConfig`, through `oauthProviderAuthServerMetadata`.
	 */
	metadata(request: Request): Promise<Response>;
	/** Whether the binding exists: the organization was bootstrapped (3.1, `HOST_NOT_BOOTSTRAPPED`). */
	bootstrapped(): Promise<boolean>;
	/** Whether the bound organization has a member: the bootstrap is done (3.7, `HOST_ALREADY_BOOTSTRAPPED`). */
	hasMembers(): Promise<boolean>;
	/**
	 * The server kernel's removal hook (phase 3's A4, 3.7): what `onMemberRemoved` runs, once per removal, from the time
	 * the kernel is open. Before that, or with none, a removal's settle is logged as failed and line 2 stays in force.
	 */
	hearRemovals(hook: ((event: MemberRemovedV1) => Promise<void>) | undefined): void;
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
	/** Tests only: {@link TestOAuthV1}. */
	testOAuth?: TestOAuthV1;
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
		let removals: ((event: MemberRemovedV1) => Promise<void>) | undefined;
		const oauth = testOAuthConfig(options.testOAuth);
		const authOptions = createLoamAuthOptions({
			// Once per removal (A4): the server kernel's `agent-member-settle`, once it is open.
			onMemberRemoved: async (event) => {
				if (!removals)
					throw new Error('The server kernel is not open: no agent member was settled');
				await removals(event);
			},
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
			...(oauth ? { oauth } : {}),
		});
		await (await getMigrations(authOptions)).runMigrations();
		const auth = betterAuth(authOptions);
		const context = await auth.$context;
		const adapter = context.adapter;
		const binding = () => readBinding(adapter as never, workspace);
		const metadata = oauthProviderAuthServerMetadata(auth as never);
		return {
			auth,
			hearRemovals(hook) {
				removals = hook;
			},
			path: `${basePath}${identity.path}`,
			issuer: `${shell}${identity.path}`,
			workspace,
			oidc: identity.methods.flatMap((method) =>
				method.startsWith('oidc:') ? [method.slice('oidc:'.length)] : []
			),
			metadata,
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
