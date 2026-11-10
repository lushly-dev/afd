/**
 * @fileoverview `startDevHost`'s `DevHost` (phase 6 specification, 5.2): the development profile a test can
 * restart and kill, with its mail, stores, journal and logs.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEV_DATA_DIRECTORY } from '../dev.js';
import {
	claimDataDirectory,
	DEV_GITIGNORE,
	ensureCertificate,
	readMail,
	type SinkMessage,
	writePrivate,
} from '../dev-files.js';
import type { Launched, Launcher } from './launcher.js';

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
	organization?: { slug: string; name: string };
	people?: {
		email: string;
		name: string;
		role: 'owner' | 'admin' | 'member';
		methods?: ('passkey' | 'password')[];
	}[];
	modules?: unknown[];
	resources?: string[];
	accessTokenTtlSeconds?: number;
	/** The child process's environment additions. */
	env?: Record<string, string>;
}

/** The options a later step brings, refused until then rather than ignored. */
const LATER: Record<string, string> = {
	organization: 'step 3, with the provider',
	people: 'step 3, with the provider',
	resources: 'step 4, with the MCP route',
	accessTokenTtlSeconds: 'step 4, with the MCP route',
	modules: 'the step that builds HostModule',
};

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
		const env = { ...options.env, NODE_EXTRA_CA_CERTS: certificate };
		running = await launch(deployment, env, logs);
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
			mail: () => readMail(data),
			db: () => ({ auth: database('auth.sqlite'), loam: database('loam.sqlite') }),
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
				running = await launch(deployment, env, logs);
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
