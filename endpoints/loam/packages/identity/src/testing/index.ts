/**
 * @fileoverview `@lushly-dev/loam-identity/testing`: the test-only auth host (phase 3 specification, 2.4).
 * A real Better Auth 1.7.18 server in a child process, from `createLoamAuthOptions`, standing in for phase
 * 6's hosted lane as D64's relay did for mounts, and named so wherever its result is recorded. It proves
 * nothing of the hosted lane, its database or its server kernel. Copied in shape, not imported, from
 * `packages/auth/hosted/better-auth/local.ts` at `eba33efa` (the child, its port and its scratch cleanup),
 * since that fixture is outside `@lushly-dev/afd-auth`'s `files` and `exports`.
 */

import { type ChildProcess, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { IdentityMethodV1 } from '@lushly-dev/loam-manifest';
import type { LoamMailV1, LoamOidcProviderV1 } from '../options.js';

export { startTestOidcProvider, type TestOidcPersonV1, type TestOidcProvider } from './oidc.js';
export { type Answer, linkIn, TestBrowser } from './requests.js';
export { SoftAuthenticator, type SoftCredentialV1 } from './webauthn.js';

/** A person the host seeds: an account, and a member row when `role` is set. */
export interface TestPersonV1 {
	email: string;
	name?: string;
	/** Their role in the organization; `null` seeds an account that is no member. */
	role: 'owner' | 'admin' | 'member' | null;
	/** A password account, for `methods` holding `password`. */
	password?: string;
	/** Default true. */
	emailVerified?: boolean;
}

export interface TestAuthHostOptions {
	organization: { slug: string; name: string };
	people: readonly TestPersonV1[];
	/** Default `['passkey', 'password']`, so a seeded person can sign in with a password. */
	methods?: readonly IdentityMethodV1[];
	/** The workspace the binding names. Default `personal`. */
	workspace?: string;
	/**
	 * The origin the provider is served at, when something in front of it proxies `<path>` to it, as the
	 * harness's HTTPS server does from step 3. Default the host's own `http://127.0.0.1:<port>`.
	 */
	origin?: string;
	/** The provider's path under the origin. Default `/api/auth`. */
	path?: string;
	/** The deployer's single sign-on providers, each named in `methods` as `oidc:<id>` (2.6). */
	oidc?: readonly LoamOidcProviderV1[];
	/** Whom `bootstrapOrganization` invites as the first owner; its join link is in the mail (5.6). */
	bootstrapOwner?: string;
}

export interface TestAuthHost {
	/** Where the host listens: `http://127.0.0.1:<port>`. */
	readonly listening: string;
	/** The origin and path the provider answers as, `<origin><path>`. */
	readonly baseURL: string;
	readonly origin: string;
	/** The organization the binding pins. */
	readonly organizationId: string;
	/** Each seeded person's user id, by email. */
	readonly people: Readonly<Record<string, string>>;
	/** Every message the provider has sent, in order. */
	mail(): Promise<LoamMailV1[]>;
	/** The provider's database, read-only unless asked: a test's direct change stands for a provider-side one. */
	db(options?: { writable?: boolean }): DatabaseSync;
	/** Stop the host and remove its scratch directory; idempotent. */
	close(): Promise<void>;
}

/** What the parent gives its child, through the environment. */
export interface HostChildConfig {
	port: number;
	baseURL: string;
	secret: string;
	databasePath: string;
	mailPath: string;
	workspace: string;
	organization: { slug: string; name: string };
	people: readonly TestPersonV1[];
	methods: readonly IdentityMethodV1[];
	shell: string;
	oidc?: readonly LoamOidcProviderV1[];
	bootstrapOwner?: string;
}

export type HostReady =
	| { ready: true; organizationId: string; people: Record<string, string> }
	| { ready: false; message: string };

const STARTUP_MS = 30_000;

async function freePort(): Promise<number> {
	const socket = createServer();
	socket.listen(0, '127.0.0.1');
	await once(socket, 'listening');
	const address = socket.address();
	await new Promise<void>((done) => socket.close(() => done()));
	if (!address || typeof address === 'string') throw new Error('Port allocation failed');
	return address.port;
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill('SIGTERM');
	const timer = setTimeout(() => child.kill('SIGKILL'), 1_000);
	try {
		await exited;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The child's entry: the built module beside this one, or, when this runs from source under a test
 * runner, the source itself through `tsx`, resolved from this package.
 */
function childEntry(): { path: string; execArgv: string[]; cwd: string } {
	const source = import.meta.url.endsWith('.ts');
	const here = new URL(source ? './host-child.ts' : './host-child.js', import.meta.url);
	return {
		path: fileURLToPath(here),
		execArgv: source ? ['--import', 'tsx'] : [],
		cwd: fileURLToPath(new URL('../../', import.meta.url)),
	};
}

/**
 * Start a real Better Auth server in a child process, seeded with `organization` and `people` and the
 * binding pinned, and wait until it listens. Everything it writes is in a scratch directory that `close`
 * removes, on success and on failure.
 */
export async function startTestAuthHost(options: TestAuthHostOptions): Promise<TestAuthHost> {
	const scratch = await mkdtemp(join(tmpdir(), 'loam-auth-host-'));
	let child: ChildProcess | undefined;
	const opened: DatabaseSync[] = [];
	const close = async () => {
		for (const database of opened.splice(0)) {
			try {
				database.close();
			} catch {
				// Already closed by the test.
			}
		}
		if (child) await stopChild(child);
		await rm(scratch, { recursive: true, force: true });
	};
	try {
		const port = await freePort();
		const listening = `http://127.0.0.1:${port}`;
		const origin = options.origin ?? listening;
		const path = options.path ?? '/api/auth';
		const config: HostChildConfig = {
			port,
			baseURL: `${origin}${path}`,
			secret: randomBytes(32).toString('hex'),
			databasePath: join(scratch, 'auth.sqlite'),
			mailPath: join(scratch, 'mail.jsonl'),
			workspace: options.workspace ?? 'personal',
			organization: options.organization,
			people: options.people,
			methods: options.methods ?? ['passkey', 'password'],
			// The shell is served at the path the provider's `api/auth` hangs from.
			shell: `${origin}${path.replace(/api\/auth\/?$/, '')}`.replace(/([^/])$/, '$1/'),
			...(options.oidc ? { oidc: options.oidc } : {}),
			...(options.bootstrapOwner ? { bootstrapOwner: options.bootstrapOwner } : {}),
		};
		const entry = childEntry();
		child = fork(entry.path, [], {
			cwd: entry.cwd,
			execArgv: entry.execArgv,
			env: { ...process.env, LOAM_AUTH_HOST: JSON.stringify(config) },
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
		});
		const started = child;
		const ready = await new Promise<HostReady>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('The auth host did not start')), STARTUP_MS);
			started.once('message', (message) => {
				clearTimeout(timer);
				resolve(message as HostReady);
			});
			started.once('exit', () => {
				clearTimeout(timer);
				reject(new Error('The auth host exited while starting'));
			});
		});
		if (!ready.ready) throw new Error(`The auth host did not start: ${ready.message}`);
		return {
			listening,
			baseURL: config.baseURL,
			origin,
			organizationId: ready.organizationId,
			people: ready.people,
			async mail() {
				const text = await readFile(config.mailPath, 'utf8').catch(() => '');
				return text
					.split('\n')
					.filter(Boolean)
					.map((line) => JSON.parse(line) as LoamMailV1);
			},
			db({ writable = false } = {}) {
				const database = new DatabaseSync(config.databasePath, { readOnly: !writable });
				opened.push(database);
				return database;
			},
			close,
		};
	} catch (cause) {
		await close();
		throw cause;
	}
}
