/**
 * @fileoverview `createLoamHost` (phase 6 specification, 3.1): one Node process on Hono 4.13 through
 * `@hono/node-server` 2.1's `serve`, with `node:https` when the server terminates TLS. One process per
 * data directory, one deployment per process. Step 1 serves the written shell and, on the sandbox's
 * origin, its `sandbox/`; the provider, MCP, the trust-record transport and the relay come in later steps,
 * and their paths answer 404 until then (3.3).
 */

import { readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { type HttpBindings, serve } from '@hono/node-server';
import type { MountAccess } from '@lushly-dev/loam-cli/deployment';
import {
	readServerConfig,
	type ServerConfigV1,
	type ServerLimitsV1,
	splitListen,
} from '@lushly-dev/loam-manifest/server';
import { Hono } from 'hono';
import { checkHost } from './check.js';
import { ensureDataDirectory, writeSite } from './data.js';
import { HostError, type HostFinding } from './errors.js';
import { authorityOf, gate, type NodeListener } from './gate.js';
import {
	commonHeaders,
	INERT_POLICY,
	isScriptOrStyle,
	metaPolicy,
	SHELL_PERMISSIONS_POLICY,
	sandboxPolicy,
	shellPagePolicy,
	siteCacheControl,
} from './headers.js';
import { acquireDataLock, type DataLock } from './lock.js';
import type { ResolvedSecrets } from './secrets.js';
import { type SiteAnswer, serveSite } from './site.js';
import {
	type BoundAddresses,
	recordAddresses,
	SERVE_STATIC_DEPLOYMENT,
	type TestOnlyOptions,
} from './testing-only.js';

export interface LoamHostConfig {
	/** Read by `readServerConfig` (3.2); `createLoamHost` reads it again. */
	server: ServerConfigV1;
	/** The path of `loam.deployment.toml`: version 4 with `[host] kind = "hosted"` from step 3. */
	deployment: string;
	/** The web host's `vite build` output. */
	dist: string;
}

export interface LoamHost {
	readonly origin: string;
	readonly sandboxOrigin: string | null;
	listen(): Promise<void>;
	close(): Promise<void>;
}

type Env = { Bindings: HttpBindings };

const TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.map': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.wasm': 'application/wasm',
	'.txt': 'text/plain; charset=utf-8',
};

/** The raw request target's path, with no query or fragment: never one a router normalized. */
function rawPath(incoming: IncomingMessage): string {
	const target = incoming.url ?? '/';
	const end = target.search(/[?#]/);
	return end === -1 ? target : target.slice(0, end);
}

function text(status: number, body: string, cache = 'no-cache'): Response {
	return new Response(`${body}\n`, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache },
	});
}

const notFound = (cache?: string) => text(404, 'Not Found', cache);

interface Pages {
	/** The `<meta>` policy of each shell page, by its path in the site: `index.html`, `404.html`. */
	shell: Map<string, string>;
}

/** Reads the shell pages' `<meta>` policies once, at start (3.5). */
function readPages(site: string): Pages | HostFinding {
	const shell = new Map<string, string>();
	for (const page of ['index.html', '404.html']) {
		const policy = metaPolicy(readFileSync(join(site, page), 'utf8'));
		if (!policy.ok) {
			return {
				code: 'DEPLOYMENT_PATH_INVALID',
				key: '--dist',
				message: `The written \`${page}\` cannot carry its policy as a header: ${policy.reason}.`,
				suggestion: "Run the web host's `vite build`; its page holds phase 0's one policy.",
			};
		}
		shell.set(page, policy.policy);
	}
	return { shell };
}

async function fileResponse(
	answer: Extract<SiteAnswer, { status: 200 }>,
	method: string,
	headers: Record<string, string>
): Promise<Response> {
	const body = await readFileAsync(answer.file);
	const type = TYPES[extname(answer.file).toLowerCase()] ?? 'application/octet-stream';
	return new Response(method === 'HEAD' ? null : body, {
		status: 200,
		headers: { 'content-type': type, 'content-length': String(body.length), ...headers },
	});
}

function shellApp(options: { base: string; site: string; pages: Pages }): Hono<Env> {
	const { base, pages } = options;
	const site = serveSite(options.site, { fallback: 'index.html' });
	const app = new Hono<Env>();
	// Every route is matched on the raw path here, never a normalized one, so a dot segment cannot reach
	// one; later steps register their own routes before this catch-all (3.4's order).
	app.all('*', async (c) => {
		const path = rawPath(c.env.incoming);
		const method = c.req.method;
		if (!path.startsWith(base)) return notFound();
		const rest = path.slice(base.length);
		if (rest === 'api/health') {
			return method === 'GET'
				? new Response('{"ok":true}\n', {
						headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
					})
				: notFound('no-store');
		}
		// The routes of later steps: in a `local` deployment the shell's routes only (3.3).
		if (rest === 'mcp' || rest === 'api/kernel/call' || rest.startsWith('mounts/'))
			return notFound('no-store');
		const answer = await site({ method, path: rest, accept: c.req.header('accept') });
		if (answer.status !== 200) return notFound();
		const relative = answer.fallback ? 'index.html' : answer.path;
		const meta = pages.shell.get(relative);
		const headers: Record<string, string> = {
			'cache-control': siteCacheControl(relative, meta !== undefined),
		};
		if (meta !== undefined) {
			headers['content-security-policy'] = shellPagePolicy(meta, answer.path);
			headers['permissions-policy'] = SHELL_PERMISSIONS_POLICY;
		} else if (!isScriptOrStyle(answer.file)) {
			headers['content-security-policy'] = INERT_POLICY;
		}
		return fileResponse(answer, method, headers);
	});
	return app;
}

function sandboxApp(options: { site: string; origin: string }): Hono<Env> {
	const site = serveSite(join(options.site, 'sandbox'));
	const policy = sandboxPolicy(options.origin);
	const app = new Hono<Env>();
	app.all('*', async (c) => {
		const path = rawPath(c.env.incoming);
		if (!path.startsWith('/sandbox/')) return notFound();
		const answer = await site({
			method: c.req.method,
			path: path.slice('/sandbox/'.length),
			accept: c.req.header('accept'),
		});
		if (answer.status !== 200) return notFound();
		return fileResponse(answer, c.req.method, {
			'cache-control': 'no-cache',
			...(extname(answer.file).toLowerCase() === '.html'
				? { 'content-security-policy': policy }
				: {}),
		});
	});
	return app;
}

interface Listener {
	listen: string;
	/** The app each authority this socket serves reaches; the gate has checked the authority first. */
	apps: Map<string, Hono<Env>>;
}

/** One socket's app: the authority, already checked by the gate, picks the shell's or the sandbox's. */
function socketApp(apps: ReadonlyMap<string, Hono<Env>>): Hono<Env> {
	const app = new Hono<Env>();
	app.all('*', (c) => {
		const authority = (c.env.incoming.headers.host ?? '').toLowerCase();
		const chosen = apps.get(authority);
		return chosen ? chosen.fetch(c.req.raw, c.env) : notFound();
	});
	return app;
}

/** Closes each server, listening or not, and drops its connections. */
async function stopAll(started: readonly Server[]): Promise<void> {
	await Promise.all(
		started.map(
			(server) =>
				new Promise<void>((done) => {
					if (!server.listening) return done();
					server.close(() => done());
					server.closeAllConnections();
				})
		)
	);
}

function bindHost(listen: string): string {
	return splitListen(listen).host.replace(/^\[(.*)\]$/, '$1');
}

/**
 * Builds the hosted server from its configuration, or throws a `HostError` with the first refusal's code
 * (section 16): any refusal of 3.2 or 3.3, a locked data directory, or an unreadable secret. It takes the
 * data directory's lock and writes the site before it returns, and holds the lock until `close()`.
 */
export async function createLoamHost(config: LoamHostConfig & TestOnlyOptions): Promise<LoamHost> {
	const read = readServerConfig(config.server);
	if (!read.ok) throw new HostError(read.refusals);
	const server = read.server;
	const checked = await checkHost({
		server,
		deployment: config.deployment,
		dist: config.dist,
		purpose: 'serve',
		serveStatic: config[SERVE_STATIC_DEPLOYMENT] === true,
	});
	if (checked.refusals.length > 0) throw new HostError(checked.refusals);
	// Held in memory only, never written (section 13, 3.3): the secrets, the limits, and the mounts with
	// their bearers. Nothing in step 1 reads them; the steps that serve the provider and the relay do.
	const memory: {
		secrets: ResolvedSecrets | undefined;
		limits: ServerLimitsV1;
		mounts: readonly MountAccess[];
	} = { secrets: checked.secrets, limits: read.limits, mounts: [] };

	await ensureDataDirectory(server.data);
	const lock: DataLock = acquireDataLock(server.data);
	// Everything between the lock and a returned host is inside this `try`, so a failure releases the lock.
	let listeners: Listener[];
	let origin: string;
	let sandboxOrigin: string | null;
	let common: Record<string, string>;
	let tls: ResolvedSecrets['tls'];
	try {
		const written = await writeSite({
			data: server.data,
			deployment: config.deployment,
			dist: config.dist,
		});
		if (!written.ok) throw new HostError(written.refusals);
		memory.mounts = written.mounts;
		const site = written.site;
		const base = checked.analysis?.basePath ?? '/';
		const pages = readPages(site);
		if ('code' in pages) throw new HostError([pages]);
		origin = server.origin;
		sandboxOrigin = server.sandbox?.origin ?? null;
		listeners = [
			{
				listen: server.listen,
				apps: new Map([[authorityOf(origin), shellApp({ base, site, pages })]]),
			},
		];
		if (sandboxOrigin) {
			const sandbox = sandboxApp({ site, origin });
			const own = server.sandbox?.listen;
			if (own === undefined) listeners[0]?.apps.set(authorityOf(sandboxOrigin), sandbox);
			else listeners.push({ listen: own, apps: new Map([[authorityOf(sandboxOrigin), sandbox]]) });
		}
		common = commonHeaders(origin);
		// The check read `[tls]` once; nothing is read from disk again while the lock is held.
		tls = memory.secrets?.tls;
		if (server.tls && !tls) throw new Error('The TLS certificate and key were not read.');
	} catch (cause) {
		lock.release();
		throw cause;
	}

	const servers: Server[] = [];
	let closed = false;
	const host: LoamHost = {
		origin,
		sandboxOrigin,
		async listen() {
			if (closed) throw new Error('The host is closed.');
			if (servers.length > 0) return;
			try {
				for (const listener of listeners) {
					const allowed = new Set(listener.apps.keys());
					// `serve` hands its listener to `createServer`; the gate wraps it, so it runs first.
					const wrap = (options: object, next: NodeListener) =>
						tls
							? createHttpsServer(options, gate(allowed, common, next))
							: createHttpServer(options, gate(allowed, common, next));
					const started = serve({
						fetch: socketApp(listener.apps).fetch,
						hostname: bindHost(listener.listen),
						port: splitListen(listener.listen).port,
						// A request with no `Host` reaches the gate, which answers it 421, not Node's own 400.
						...(tls
							? {
									createServer: wrap as unknown as typeof createHttpsServer,
									serverOptions: { cert: tls.cert, key: tls.key, requireHostHeader: false },
								}
							: {
									createServer: wrap as unknown as typeof createHttpServer,
									serverOptions: { requireHostHeader: false },
								}),
					}) as Server;
					servers.push(started);
					await new Promise<void>((done, fail) => {
						started.once('listening', () => done());
						started.once('error', fail);
					});
				}
			} catch (cause) {
				// Nothing half-started stays: whatever listened is closed, and `listen()` may run again.
				await stopAll(servers.splice(0));
				throw cause;
			}
		},
		async close() {
			if (closed) return;
			closed = true;
			await stopAll(servers.splice(0));
			lock.release();
		},
	};
	recordAddresses(host, (): BoundAddresses | null => {
		const [shellServer, sandboxServer] = servers;
		if (!shellServer) return null;
		const shellAddress = shellServer.address() as AddressInfo;
		return {
			shell: shellAddress,
			sandbox: sandboxOrigin ? ((sandboxServer ?? shellServer).address() as AddressInfo) : null,
		};
	});
	return host;
}
