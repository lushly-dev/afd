/**
 * @fileoverview `@lushly-dev/loam-host/testing` (phase 6 specification, 5.2): `startDevHost`, the development
 * profile in a child process a test can restart and kill, and `scanSecrets`. The `loam-host` bin never
 * imports it.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { DEV_DATA_DIRECTORY } from '../dev.js';
import {
	ensureCertificate,
	privateDirectory,
	readMail,
	SECRETS_DIRECTORY,
	type SinkMessage,
} from '../dev-files.js';
import { type ChildReady, FAILED, READY } from './protocol.js';

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

const CHILD = fileURLToPath(new URL('./dev-child.js', import.meta.url));
const READY_TIMEOUT_MS = 60_000;

interface Running {
	child: ChildProcess;
	ready: ChildReady;
}

function spawnChild(
	deployment: string,
	env: Record<string, string>,
	logs: string[]
): Promise<Running> {
	const child = spawn(process.execPath, [CHILD, JSON.stringify({ deployment })], {
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return new Promise((done, fail) => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			fail(new Error(`The development profile did not report within ${READY_TIMEOUT_MS} ms.`));
		}, READY_TIMEOUT_MS);
		let pending = '';
		const onLine = (line: string) => {
			logs.push(line);
			if (line.startsWith(`${READY} `)) {
				clearTimeout(timer);
				done({ child, ready: JSON.parse(line.slice(READY.length + 1)) as ChildReady });
			} else if (line.startsWith(`${FAILED} `)) {
				clearTimeout(timer);
				const { code, message } = JSON.parse(line.slice(FAILED.length + 1)) as {
					code: string;
					message: string;
				};
				fail(Object.assign(new Error(message), { code }));
			}
		};
		child.stdout?.on('data', (chunk: Buffer) => {
			pending += chunk.toString('utf8');
			let end = pending.indexOf('\n');
			while (end !== -1) {
				onLine(pending.slice(0, end));
				pending = pending.slice(end + 1);
				end = pending.indexOf('\n');
			}
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			for (const line of chunk.toString('utf8').split('\n')) if (line) logs.push(line);
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			fail(new Error(`The development profile exited with ${code} before it was ready.`));
		});
	});
}

async function stop(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill(signal);
	const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
	await exited;
	clearTimeout(timer);
}

/**
 * The development profile in a child process, as `startTestAuthHost` runs its host, so a test can kill it,
 * with `NODE_EXTRA_CA_CERTS` set to its own certificate. Until step 3 it serves a `local` deployment of
 * version 1 or 2 through the test-only option.
 */
export async function startDevHost(options: StartDevHostOptions): Promise<DevHost> {
	for (const [key, step] of Object.entries(LATER))
		if (options[key as keyof StartDevHostOptions] !== undefined)
			throw new Error(`startDevHost's \`${key}\` arrives in ${step}.`);
	const root = await mkdtemp(join(tmpdir(), 'loam-dev-host-'));
	const logs: string[] = [];
	let running: Running | undefined;
	try {
		const deployment = join(root, 'loam.deployment.toml');
		await writeFile(
			deployment,
			[
				options.config,
				...(options.basePath ? [`[site]\nbase_path = ${JSON.stringify(options.basePath)}`] : []),
			].join('\n\n')
		);
		// The certificate exists before the child starts, so it can trust its own origin from its first line.
		const data = join(root, DEV_DATA_DIRECTORY);
		await privateDirectory(data);
		const { certificate } = await ensureCertificate(data);
		const env = { ...options.env, NODE_EXTRA_CA_CERTS: certificate };
		running = await spawnChild(deployment, env, logs);
		const basePath = options.basePath ?? '/';
		const current = (): Running => {
			if (!running) throw new Error('The development profile is not running.');
			return running;
		};
		const database = (name: string): DatabaseSync => {
			const path = join(current().ready.data, name);
			if (!existsSync(path)) throw new Error(`\`${name}\` does not exist yet.`);
			return new DatabaseSync(path, { readOnly: true });
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
				await stop(current().child, 'SIGTERM');
				running = await spawnChild(deployment, env, logs);
				if (running.ready.origin !== before)
					throw new Error(
						`The origin changed across a restart: ${before} to ${running.ready.origin}.`
					);
			},
			async kill() {
				await stop(current().child, 'SIGKILL');
			},
			async close() {
				if (running) await stop(running.child, 'SIGTERM');
				running = undefined;
				await rm(root, { recursive: true, force: true });
			},
		};
		return host;
	} catch (cause) {
		if (running) await stop(running.child, 'SIGKILL');
		await rm(root, { recursive: true, force: true });
		throw cause;
	}
}

/** A page whose storage the scan reads: Playwright's `Page` fits. */
export interface ScannedPage {
	evaluate(script: string): Promise<unknown>;
}

function filesBelow(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return filesBelow(path);
		return entry.isFile() ? [path] : [];
	});
}

function storeRows(path: string): string {
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		const tables = database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as Array<{ name: string }>;
		return tables
			.map(({ name }) =>
				JSON.stringify(database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all())
			)
			.join('\n');
	} finally {
		database.close();
	}
}

/**
 * What a page holds in `localStorage` and every IndexedDB store it can open, as a script, since this
 * package has no DOM types: `Page.evaluate` takes one as a string.
 */
const PAGE_STORAGE = `(async () => {
	const parts = [];
	for (let index = 0; index < localStorage.length; index++) {
		const key = localStorage.key(index) ?? '';
		parts.push(key + '=' + localStorage.getItem(key));
	}
	for (const { name } of await indexedDB.databases()) {
		if (!name) continue;
		const database = await new Promise((done, fail) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => done(request.result);
			request.onerror = () => fail(request.error);
		});
		for (const store of [...database.objectStoreNames]) {
			const rows = await new Promise((done, fail) => {
				const request = database.transaction(store).objectStore(store).getAll();
				request.onsuccess = () => done(request.result);
				request.onerror = () => fail(request.error);
			});
			parts.push(JSON.stringify(rows));
		}
		database.close();
	}
	return parts.join('\\n');
})()`;

/**
 * Scans the served files, the projection, the server's journal, its logs, every store row and each page's
 * `localStorage` and IndexedDB for section 13's secrets: the `known` ones and the profile's generated auth
 * secret. `found` names each secret by its index in `known` (or `auth secret`) and where it was found, and
 * never its value, so a failing assertion cannot print one.
 */
export async function scanSecrets(
	host: DevHost,
	pages: readonly ScannedPage[],
	known: readonly string[]
): Promise<{ found: string[] }> {
	const places: Array<[string, string]> = [];
	for (const file of filesBelow(join(host.data, 'public')))
		places.push([`served file ${file.slice(host.data.length + 1)}`, readFileSync(file, 'utf8')]);
	for (const file of filesBelow(host.data).filter((path) => /\.jsonl$/.test(path)))
		places.push([`file ${file.slice(host.data.length + 1)}`, readFileSync(file, 'utf8')]);
	// Not `lock.sqlite`: the server holds it exclusively, and it holds nothing but the time it was taken.
	for (const file of filesBelow(host.data).filter(
		(path) => path.endsWith('.sqlite') && !path.endsWith('lock.sqlite')
	))
		if (statSync(file).size > 0)
			places.push([`store ${file.slice(host.data.length + 1)}`, storeRows(file)]);
	places.push(['the server log', host.logs().join('\n')]);
	for (const [index, page] of pages.entries())
		places.push([`page ${index}'s storage`, String(await page.evaluate(PAGE_STORAGE))]);
	const secrets: Array<[string, string]> = known.map((value, index) => [`known[${index}]`, value]);
	const generated = join(host.data, SECRETS_DIRECTORY, 'auth');
	if (existsSync(generated)) secrets.push(['auth secret', readFileSync(generated, 'utf8').trim()]);
	const found: string[] = [];
	for (const [name, value] of secrets) {
		if (value.length < 8) throw new Error(`${name} is too short to scan for.`);
		for (const [place, text] of places) if (text.includes(value)) found.push(`${name} in ${place}`);
	}
	return { found };
}
