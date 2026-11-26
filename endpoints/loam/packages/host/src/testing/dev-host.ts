/**
 * @fileoverview `startDevHost`'s `DevHost` (phase 6 specification, 5.2): the development profile a test can
 * restart and kill, with its mail, stores, journal and logs.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seedTestPeople } from '@lushly-dev/loam-identity/testing';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import { runBootstrap, withBootstrapProvider } from '../bootstrap.js';
import { DEV_DATA_DIRECTORY } from '../dev.js';
import {
	claimDataDirectory,
	DEV_GITIGNORE,
	ensureCertificate,
	readMail,
	type SinkMessage,
	writePrivate,
} from '../dev-files.js';
import type { TestOAuthV1 } from '../provider.js';
import type { Launched, Launcher } from './launcher.js';
import { registerTestClients, type TestClientV1 } from './oauth.js';

/** One entry of the server's journal, as `journal.jsonl` holds it. */
export type JournalEntry = Record<string, unknown>;

export interface DevHost {
	readonly origin: string;
	/** The shell's root: the origin and the base path, with its trailing slash. */
	readonly root: string;
	readonly sandboxOrigin: string | null;
	readonly spki: string;
	/** The dev certificate's path, for `NODE_EXTRA_CA_CERTS` in anything that fetches the host. */
	readonly certificate: string;
	/** The data directory, `.loam-dev/` beside the deployment file. */
	readonly data: string;
	/** Each of `clients`' ids, by name: pre-registered OAuth clients for an MCP client's flow (P6-H4). */
	readonly clients: Readonly<Record<string, string>>;
	mail(): Promise<SinkMessage[]>;
	/** Read-only handles, for assertions; each opens only once its database exists (steps 3 and 4). */
	db(): { auth: DatabaseSync; loam: DatabaseSync };
	journal(): Promise<JournalEntry[]>;
	/** The server's log lines, for the secrets scan. */
	logs(): string[];
	/** Keeps `dev.json`'s ports, so the origin is the same. */
	restart(): Promise<void>;
	/** SIGKILL. */
	kill(): Promise<void>;
	/** Removes the data directory, on success and failure. */
	close(): Promise<void>;
}

export interface StartDevHostOptions {
	/** The deployment file's text, as `serveDeployment` takes it. */
	config: string;
	basePath?: string;
	/**
	 * Bootstraps with `bootstrap --dev`'s own path before the profile starts, inviting `owner` (default an address no
	 * one reads, as the test-only auth host's), then seeds `people` as `startTestAuthHost` does (5.2).
	 */
	organization?: { slug: string; name: string; owner?: string };
	people?: {
		email: string;
		name: string;
		role: 'owner' | 'admin' | 'member';
		methods?: ('passkey' | 'password')[];
		/** A password account, which `methods` holding `password` needs, as the test-only auth host's people take. */
		password?: string;
	}[];
	modules?: unknown[];
	/**
	 * OAuth clients the deployer pre-registers (phase 3's 9.4) before the profile starts, each a public native client
	 * with one redirect, through the provider's server API by the first seeded owner with a password.
	 */
	clients?: readonly TestClientV1[];
	/**
	 * Phase 3's P3-H1: further resources the provider issues tokens for, beside `<base>mcp`, each an absolute URI linked
	 * to every client, so a token for another audience comes from the profile's own provider. Test-only, as `rateLimit`.
	 */
	resources?: string[];
	/** Phase 3's P3-H4: an access token's lifetime, from 1 to 600 seconds (default 600), so a suite sees one expire. */
	accessTokenTtlSeconds?: number;
	/**
	 * Phase 3's P3-H3: Client ID Metadata Documents by their `https` URL, which the provider reads from memory, since its
	 * own transport refuses every special-use address and a suite has no public host. Its CIMD validation is unchanged.
	 */
	clientMetadata?: Record<string, unknown>;
	/**
	 * The provider's rate limit, raised for a suite that legitimately makes many requests from one address, such as
	 * P6-H3's 500 `whoami` reads. It raises the limit only: the limiter is on in every mode.
	 */
	rateLimit?: { window: number; max: number };
	/**
	 * The server configuration's `[limits]` (3.2), test-only as `rateLimit` is: small relay limits, so P6-H6 sees an idle
	 * binding expire, a slot count reached or a deadline pass in seconds. Checked as `loam.server.toml`'s are.
	 */
	limits?: ServerConfigV1['limits'];
	/** The child process's environment additions. */
	env?: Record<string, string>;
}

/** The options a later step brings, refused until then rather than ignored. */
const LATER: Record<string, string> = {
	modules: 'the step that builds HostModule',
};

/** The provider's options for phase 3's step 10, from the suite's: none when it names none. */
function testOAuthOf(options: StartDevHostOptions): TestOAuthV1 | undefined {
	const test: TestOAuthV1 = {
		...(options.resources ? { resources: options.resources } : {}),
		...(options.accessTokenTtlSeconds !== undefined
			? { accessTokenSeconds: options.accessTokenTtlSeconds }
			: {}),
		...(options.clientMetadata ? { clientMetadata: options.clientMetadata } : {}),
	};
	return Object.keys(test).length > 0 ? test : undefined;
}

/**
 * The deployment file's text with `site.base_path` set: into its own `[site]` table when it has one, which
 * must not set the path already, or as a new table.
 */
export function withBasePath(config: string, basePath: string | undefined): string {
	if (basePath === undefined) return config;
	const line = `base_path = ${JSON.stringify(basePath)}`;
	const table = /^\[site\][ \t]*$/m.exec(config);
	if (!table) return `${config}\n\n[site]\n${line}`;
	const start = table.index + table[0].length;
	const next = config.slice(start).search(/^\[/m);
	const body = next === -1 ? config.slice(start) : config.slice(start, start + next);
	if (/^\s*base_path\s*=/m.test(body))
		throw new Error(
			"startDevHost's `basePath` and the config's own `[site] base_path` disagree on who sets it."
		);
	return `${config.slice(0, start)}\n${line}${config.slice(start)}`;
}

/**
 * A `DevHost` over the development profile `launch` starts: `startDevHost` passes the child launcher, and
 * this package's units an in-process one. It writes the deployment file, makes the certificate before the
 * profile starts, so `NODE_EXTRA_CA_CERTS` names it from the profile's first line, and removes the whole
 * directory on `close()` or on a failed start.
 */
export async function createDevHost(
	options: StartDevHostOptions,
	launch: Launcher
): Promise<DevHost> {
	for (const [key, step] of Object.entries(LATER))
		if (options[key as keyof StartDevHostOptions] !== undefined)
			throw new Error(`startDevHost's \`${key}\` arrives in ${step}.`);
	const root = await mkdtemp(join(tmpdir(), 'loam-dev-host-'));
	const logs: string[] = [];
	let running: Launched | undefined;
	try {
		const deployment = join(root, 'loam.deployment.toml');
		await writeFile(deployment, withBasePath(options.config, options.basePath));
		// The certificate exists before the child starts, so it can trust its own origin from its first line.
		// The `.gitignore` first: it marks the directory as the profile's, which `dev` then takes as its own.
		const data = join(root, DEV_DATA_DIRECTORY);
		await claimDataDirectory(data);
		await writePrivate(join(data, '.gitignore'), DEV_GITIGNORE);
		const { certificate } = await ensureCertificate(data);
		const testOAuth = testOAuthOf(options);
		if (options.people && !options.organization)
			throw new Error("startDevHost's `people` are seeded into its `organization`.");
		let clients: Record<string, string> = {};
		if (options.organization) {
			// Bootstrapped and seeded before the profile starts, as `bootstrap --dev` runs with `dev` stopped (3.7).
			const { slug, name, owner } = options.organization;
			const report = await runBootstrap({
				form: 'dev',
				deployment,
				data,
				slug,
				name,
				ownerEmail: owner ?? `owner@${slug}.invalid`,
			});
			const people = options.people ?? [];
			for (const person of people) {
				if (person.methods?.includes('password') && person.password === undefined)
					throw new Error(`startDevHost's ${person.email} signs in with a password, and has none.`);
			}
			if (people.length > 0 || options.clients?.length) {
				// The same provider options as the profile's, so a client is linked to a test's other resources too.
				const opened = {
					form: 'dev' as const,
					deployment,
					data,
					...(testOAuth ? { testOAuth } : {}),
				};
				await withBootstrapProvider(opened, async ({ provider }) => {
					await seedTestPeople(
						provider.auth,
						report.organization.id,
						people.map(({ email, name, role, password }) => ({
							email,
							name,
							role,
							...(password !== undefined ? { password } : {}),
						}))
					);
					if (!options.clients?.length) return;
					const owner = people.find((person) => person.role === 'owner' && person.password);
					if (!owner?.password)
						throw new Error(
							"startDevHost's `clients` are registered by a seeded owner with a password."
						);
					clients = await registerTestClients(
						provider.auth,
						{ email: owner.email, password: owner.password },
						options.clients
					);
				});
			}
		} else if (options.clients?.length) {
			throw new Error("startDevHost's `clients` are registered in its `organization`.");
		}
		const env = { ...options.env, NODE_EXTRA_CA_CERTS: certificate };
		running = await launch(deployment, env, logs, options.rateLimit, options.limits, testOAuth);
		const basePath = options.basePath ?? '/';
		const current = (): Launched => {
			if (!running) throw new Error('The development profile is not running.');
			return running;
		};
		// One read-only handle per database for the host's life, closed with it.
		const handles = new Map<string, DatabaseSync>();
		const database = (name: string): DatabaseSync => {
			const held = handles.get(name);
			if (held) return held;
			const path = join(current().ready.data, name);
			if (!existsSync(path)) throw new Error(`\`${name}\` does not exist yet.`);
			const opened = new DatabaseSync(path, { readOnly: true });
			handles.set(name, opened);
			return opened;
		};
		const host: DevHost = {
			get origin() {
				return current().ready.origin;
			},
			get root() {
				return `${current().ready.origin}${basePath}`;
			},
			get sandboxOrigin() {
				return current().ready.sandboxOrigin;
			},
			get spki() {
				return current().ready.spki;
			},
			certificate,
			data,
			clients,
			mail: () => readMail(data),
			// Each database opens when it is first read: `loam.sqlite` exists only from step 4.
			db: () => ({
				get auth() {
					return database('auth.sqlite');
				},
				get loam() {
					return database('loam.sqlite');
				},
			}),
			async journal() {
				try {
					return (await readFile(join(data, 'journal.jsonl'), 'utf8'))
						.split('\n')
						.filter(Boolean)
						.flatMap((line) => {
							try {
								return [JSON.parse(line) as JournalEntry];
							} catch {
								return [];
							}
						});
				} catch {
					return [];
				}
			},
			logs: () => [...logs],
			async restart() {
				const before = current().ready.origin;
				await current().stop('SIGTERM');
				running = undefined;
				running = await launch(deployment, env, logs, options.rateLimit, options.limits, testOAuth);
				if (running.ready.origin !== before)
					throw new Error(
						`The origin changed across a restart: ${before} to ${running.ready.origin}.`
					);
			},
			async kill() {
				await current().stop('SIGKILL');
			},
			async close() {
				for (const handle of handles.values()) handle.close();
				handles.clear();
				if (running) await running.stop('SIGTERM');
				running = undefined;
				await rm(root, { recursive: true, force: true });
			},
		};
		return host;
	} catch (cause) {
		if (running) await running.stop('SIGKILL');
		await rm(root, { recursive: true, force: true });
		throw cause;
	}
}
