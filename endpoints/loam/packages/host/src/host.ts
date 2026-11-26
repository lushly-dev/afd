/**
 * @fileoverview `createLoamHost` (phase 6 specification, 3.1): one Node process on Hono 4.13 through
 * `@hono/node-server` 2.1's request listener, with `node:https` when the server terminates TLS. The
 * development profile binds its sockets before its configuration exists (5.1), so the host serves on
 * servers it creates or is handed, rather than through `serve`, which binds as it creates. One process per
 * data directory, one deployment per process. It serves the written shell and, on the sandbox's origin, its
 * `sandbox/`; in a `provider` deployment, the provider at `<base><identity.path>` (3.7, step 3), and the server
 * kernel with AFD's MCP handler at `<base>mcp`, RFC 9728's metadata and A2's root metadata (3.6, step 4), the
 * trust-record transport (6.2, step 5) and the hosted relay (section 8, step 6). In a `local` deployment those paths
 * answer 404 (3.3).
 */

import { readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { getRequestListener, type HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
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
import { authorityOf, gate, type NodeListener, originAllowed } from './gate.js';
import {
	commonHeaders,
	copilotFramePolicy,
	INERT_POLICY,
	isCopilotFramePath,
	isScriptOrStyle,
	metaPolicy,
	SHELL_PERMISSIONS_POLICY,
	sandboxPolicy,
	shellPagePolicy,
	siteCacheControl,
} from './headers.js';
import { bindServer, createHostServer, HOST_INTERNALS, type HostInternals } from './internal.js';
import { acquireDataLock, type DataLock } from './lock.js';
import type { HostedMcp } from './mcp.js';
import type { HostProvider } from './provider.js';
import type { ResolvedSecrets } from './secrets.js';
import { type SiteAnswer, serveSite, sitePath } from './site.js';
import {
	type BoundAddresses,
	recordAddresses,
	recordHostedMcp,
	recordProvider,
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

/**
 * The raw request target's query, with its `?`, or the empty string. A `?` after a `#` is the fragment's, never a
 * query: a client sends no fragment, and one that does has none of it passed on.
 */
export function rawSearch(incoming: Pick<IncomingMessage, 'url'>): string {
	const target = incoming.url ?? '/';
	const end = target.indexOf('#');
	const before = end === -1 ? target : target.slice(0, end);
	const start = before.indexOf('?');
	return start === -1 ? '' : before.slice(start);
}

function text(status: number, body: string, cache = 'no-cache'): Response {
	return new Response(`${body}\n`, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache },
	});
}

const notFound = (cache?: string) => text(404, 'Not Found', cache);

/** An answer the host writes on the MCP surface's paths: 3.5's cache rule and the inert policy, as the route's own carry. */
function mcpAnswer(status: number, body: string, cache: string): Response {
	const answer = text(status, body, cache);
	answer.headers.set('content-security-policy', INERT_POLICY);
	return answer;
}

const mcpNotFound = (cache = 'no-store') => mcpAnswer(404, 'Not Found', cache);

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

/**
 * A raw path under the provider's prefix that a URL parser would read as another path: a dot segment, or an
 * encoded dot, separator or backslash. Better Auth routes on the parsed URL, so such a path is answered 404
 * before it reaches the handler, as `serveSite` answers its own (step 1's obligation, decided here for the
 * provider's prefix; the MCP route and the relay decide theirs in steps 4 and 6).
 */
const AMBIGUOUS_PATH = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\|%00/i;

/**
 * The provider's answer, with 3.5's `Cache-Control: no-store` for every response under its path, and the inert policy
 * step 1's deviation 1 gives every response on the shell's origin that is neither a shell page nor a script or style
 * sheet: Better Auth's own `/error` page is HTML, and nothing of the provider's is meant to run as a document.
 */
async function providerAnswer(provider: HostProvider, request: Request): Promise<Response> {
	const answer = await provider.auth.handler(request);
	const headers = new Headers(answer.headers);
	headers.set('cache-control', 'no-store');
	headers.set('content-security-policy', INERT_POLICY);
	return new Response(answer.body, {
		status: answer.status,
		statusText: answer.statusText,
		headers,
	});
}

/** A2's answer: the provider's metadata, with the inert policy every non-page answer on the shell's origin carries. */
async function rootMetadataAnswer(provider: HostProvider, request: Request): Promise<Response> {
	const answer = await provider.metadata(request);
	const headers = new Headers(answer.headers);
	headers.set('content-security-policy', INERT_POLICY);
	// 3.5's "anything else": `no-cache`, never Better Auth's public caching, so a changed issuer is read at once.
	headers.set('cache-control', 'no-cache');
	return new Response(answer.body, { status: answer.status, headers });
}

function shellApp(options: {
	base: string;
	site: string;
	pages: Pages;
	provider: HostProvider | undefined;
	mcp: HostedMcp | undefined;
	/** `origin` of `loam.server.toml`. */
	origin: string;
}): Hono<Env> {
	const { base, pages, provider, mcp, origin } = options;
	const providerPrefix = provider ? `${provider.path}/` : undefined;
	// RFC 8414's path insertion for the issuer `<origin><base><identity.path>` (A2), at the origin's root.
	const rootMetadata = provider
		? `/.well-known/oauth-authorization-server${provider.path}`
		: undefined;
	const protectedResource: ReadonlySet<string> = new Set(mcp?.metadataPaths ?? []);
	const site = serveSite(options.site, { fallback: 'index.html' });
	const app = new Hono<Env>();
	// Every route is matched on the raw path here, never a normalized one, so a dot segment cannot reach
	// one; later steps register their own routes before this catch-all (3.4's order). Each of the server's own
	// routes is matched exactly, so a dot segment, an encoded separator or a case variant is never one of them,
	// and reaches the site's refusals instead (step 1's obligation, decided for `<base>mcp` and the well-known paths).
	app.all('*', async (c) => {
		const path = rawPath(c.env.incoming);
		const method = c.req.method;
		// The well-known documents first, most specific (3.4's order), each `GET` only and public.
		if (mcp && protectedResource.has(path)) {
			if (method !== 'GET') return mcpNotFound('no-cache');
			mcp.metadata(c.env.incoming, c.env.outgoing);
			return RESPONSE_ALREADY_SENT;
		}
		if (provider && path === rootMetadata) {
			if (method !== 'GET') return mcpNotFound('no-cache');
			// Only the configured origin, as on the MCP route (3.2), whatever AFD or Better Auth would derive.
			if (!originAllowed(c.env.incoming, origin))
				return mcpAnswer(
					403,
					'Forbidden: this server answers only its configured origin.',
					'no-cache'
				);
			return rootMetadataAnswer(provider, c.req.raw);
		}
		if (!path.startsWith(base)) return notFound();
		// The provider's routes, `GET` and `POST` as Better Auth serves them (3.4, 3.7); nothing else under its path
		// reaches the site.
		if (provider && providerPrefix && (path === provider.path || path.startsWith(providerPrefix))) {
			if ((method !== 'GET' && method !== 'POST') || AMBIGUOUS_PATH.test(path))
				return notFound('no-store');
			return providerAnswer(provider, c.req.raw);
		}
		const rest = path.slice(base.length);
		if (rest === 'api/health') {
			return method === 'GET'
				? new Response('{"ok":true}\n', {
						headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
					})
				: notFound('no-store');
		}
		// `<base>mcp` (3.6): `POST`, and `GET` and `DELETE` as AFD's handler answers them; nothing reads the body first.
		if (rest === 'mcp' && mcp && (method === 'POST' || method === 'GET' || method === 'DELETE')) {
			mcp.route(c.env.incoming, c.env.outgoing, rawSearch(c.env.incoming));
			return RESPONSE_ALREADY_SENT;
		}
		// The routes of later steps, and `<base>mcp` in a `local` deployment: the shell's routes only (3.3). The server
		// card and the guide below `<base>mcp/` are step 10's.
		if (rest === 'mcp' || rest.startsWith('mcp/')) return mcpNotFound();
		// The trust-record transport (6.2): every method reaches it, and anything but its `POST` is refused there.
		if (rest === 'api/kernel/call' && mcp) {
			mcp.kernelCall(c.env.incoming, c.env.outgoing);
			return RESPONSE_ALREADY_SENT;
		}
		// The hosted relay (section 8): every method reaches it, and its own gate refuses all but `POST` and `DELETE`.
		if (rest.startsWith('mounts/') && mcp) {
			mcp.relay(c.env.incoming, c.env.outgoing, rest);
			return RESPONSE_ALREADY_SENT;
		}
		if (rest === 'api/kernel/call' || rest.startsWith('mounts/')) return notFound('no-store');
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

/**
 * `sandbox/` on the sandbox origin: its pages framed only by the shell (D62), and every file under the copilot's path,
 * its scripts included, with the copilot frame's own policy (phase 5 specification, 3.2), decided on the path once
 * decoded so no spelling of it escapes that policy.
 */
function sandboxApp(options: { site: string; origin: string; sandboxOrigin: string }): Hono<Env> {
	const site = serveSite(join(options.site, 'sandbox'));
	const policy = sandboxPolicy(options.origin);
	const copilot = copilotFramePolicy(options.sandboxOrigin, options.origin);
	const app = new Hono<Env>();
	app.all('*', async (c) => {
		const path = rawPath(c.env.incoming);
		if (!path.startsWith('/sandbox/')) return notFound();
		const rawRest = path.slice('/sandbox/'.length);
		const requested = sitePath(rawRest);
		if (requested === undefined) return notFound();
		const answer = await site({
			method: c.req.method,
			path: rawRest,
			accept: c.req.header('accept'),
		});
		if (answer.status !== 200) return notFound();
		const requestedCopilot = isCopilotFramePath(`/sandbox/${requested}`);
		const resolvedCopilot = isCopilotFramePath(`/sandbox/${answer.path}`);
		// Refuse any symlink or case variant crossing the copilot frame's boundary (#1866).
		if (requestedCopilot !== resolvedCopilot) return notFound();
		const own = resolvedCopilot
			? copilot
			: extname(answer.file).toLowerCase() === '.html'
				? policy
				: undefined;
		return fileResponse(answer, c.req.method, {
			'cache-control': 'no-cache',
			...(own ? { 'content-security-policy': own } : {}),
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

/**
 * Closes what the host opened, in order, each whatever the one before did: the server kernel after its in-flight calls,
 * then the provider, then the lock, so the lock is never held past a failed close nor released before the store closes.
 */
async function releaseAll(
	mcp: HostedMcp | undefined,
	provider: HostProvider | undefined,
	lock: DataLock | undefined
): Promise<void> {
	try {
		await mcp?.close();
	} finally {
		try {
			provider?.close();
		} finally {
			lock?.release();
		}
	}
}

function bindHost(listen: string): string {
	return splitListen(listen).host.replace(/^\[(.*)\]$/, '$1');
}

/**
 * Builds the hosted server from its configuration, or throws a `HostError` with the first refusal's code
 * (section 16): any refusal of 3.2 or 3.3, a locked data directory, or an unreadable secret. It takes the
 * data directory's lock and writes the site before it returns, and holds the lock until `close()`.
 */
export async function createLoamHost(config: LoamHostConfig & HostInternals): Promise<LoamHost> {
	const internals = config[HOST_INTERNALS] ?? {};
	try {
		// A test's provider options reach only the development profile, never `start` (phase 3's step 10).
		if (internals.start && internals.testOAuth)
			throw new Error("`loam-host start` takes no test's provider options");
		return await construct(config, internals);
	} catch (cause) {
		// What the caller handed over is the host's: a failed start releases and closes it.
		internals.lock?.release();
		await stopAll(
			[internals.servers?.shell, internals.servers?.sandbox].filter(
				(server): server is Server => !!server
			)
		);
		throw cause;
	}
}

async function construct(
	config: LoamHostConfig,
	internals: NonNullable<HostInternals[typeof HOST_INTERNALS]>
): Promise<LoamHost> {
	const read = readServerConfig(config.server);
	if (!read.ok) throw new HostError(read.refusals);
	const server = read.server;
	const checked = await checkHost({
		server,
		deployment: config.deployment,
		dist: config.dist,
		purpose: internals.start ? 'start' : 'serve',
		...(internals.sandboxOrigin ? { sandboxOrigin: internals.sandboxOrigin } : {}),
	});
	if (checked.refusals.length > 0) throw new HostError(checked.refusals);
	// Held in memory only, never written (section 13, 3.3): the secrets, the limits, and the mounts with
	// their bearers. The provider reads the auth secret (step 3); the relay reads the bearers (step 6).
	const memory: {
		secrets: ResolvedSecrets | undefined;
		limits: ServerLimitsV1;
		mounts: readonly MountAccess[];
	} = { secrets: checked.secrets, limits: read.limits, mounts: [] };

	await ensureDataDirectory(server.data);
	const lock: DataLock = internals.lock ?? acquireDataLock(server.data);
	// Everything between the lock and a returned host is inside this `try`, so a failure releases the lock.
	let listeners: Listener[];
	let origin: string;
	let sandboxOrigin: string | null;
	let common: Record<string, string>;
	let tls: ResolvedSecrets['tls'];
	let provider: HostProvider | undefined;
	let mcp: HostedMcp | undefined;
	try {
		const written = await writeSite({
			data: server.data,
			deployment: config.deployment,
			dist: config.dist,
			...(internals.sandboxOrigin ? { sandboxOrigin: internals.sandboxOrigin } : {}),
		});
		if (!written.ok) throw new HostError(written.refusals);
		memory.mounts = written.mounts;
		const site = written.site;
		const base = checked.analysis?.basePath ?? '/';
		const pages = readPages(site);
		if ('code' in pages) throw new HostError([pages]);
		const identity = checked.analysis?.identity;
		if (identity?.mode === 'provider') {
			// Better Auth loads only for a `provider` deployment, so a `local` one's cold start does not pay for it.
			const { createMail, openProvider } = await import('./provider.js');
			provider = await openProvider({
				server,
				secrets: memory.secrets ?? { oidc: {} },
				identity,
				workspace: checked.analysis?.workspace?.id as string,
				basePath: base,
				mail: await createMail(server),
				...(internals.rateLimit ? { rateLimit: internals.rateLimit } : {}),
				...(internals.testOAuth ? { testOAuth: internals.testOAuth } : {}),
			});
			// Only `start` refuses an organization never bootstrapped; `dev` serves the shell's notice (3.1, 5.1).
			if (internals.start && !(await provider.bootstrapped())) {
				throw new HostError([
					{
						code: 'HOST_NOT_BOOTSTRAPPED',
						key: config.deployment,
						message:
							"This deployment's organization was never bootstrapped, so no one could sign in.",
						suggestion:
							'With the server stopped, run `loam-host bootstrap --server <file> --deployment <file> --slug <slug> --name <name> --owner-email <email>` once, then start.',
					},
				]);
			}
		}
		if (provider && identity?.mode === 'provider') {
			// The server kernel and AFD's handler (3.6, step 4): only a `provider` deployment has one, so in a `local` one
			// `<base>mcp` answers 404 (3.3).
			const { openHostedMcp } = await import('./mcp.js');
			mcp = await openHostedMcp({
				data: server.data,
				origin: server.origin,
				basePath: base,
				site,
				projection: written.projection,
				identity,
				provider,
				limits: memory.limits,
				mounts: memory.mounts,
			});
		}
		origin = server.origin;
		sandboxOrigin = server.sandbox?.origin ?? null;
		listeners = [
			{
				listen: server.listen,
				apps: new Map([
					[
						authorityOf(origin),
						shellApp({ base, site, pages, provider, mcp, origin: server.origin }),
					],
				]),
			},
		];
		if (sandboxOrigin) {
			const sandbox = sandboxApp({ site, origin, sandboxOrigin });
			const own = server.sandbox?.listen;
			if (own === undefined) listeners[0]?.apps.set(authorityOf(sandboxOrigin), sandbox);
			else listeners.push({ listen: own, apps: new Map([[authorityOf(sandboxOrigin), sandbox]]) });
		}
		common = commonHeaders(origin);
		// The check read `[tls]` once; nothing is read from disk again while the lock is held.
		tls = memory.secrets?.tls;
		if (server.tls && !tls) throw new Error('The TLS certificate and key were not read.');
	} catch (cause) {
		// The start's own failure is what the caller reads, whatever the release then meets.
		await releaseAll(mcp, provider, internals.lock ? undefined : lock).catch(() => {});
		throw cause;
	}
	const adopted = internals.servers;
	if (adopted && Boolean(adopted.sandbox) !== listeners.length > 1) {
		await releaseAll(mcp, provider, internals.lock ? undefined : lock);
		throw new Error('The sockets handed over do not match the listeners the configuration names.');
	}

	const servers: Server[] = [];
	const attached = new WeakSet<Server>();
	let closed = false;
	const host: LoamHost = {
		origin,
		sandboxOrigin,
		async listen() {
			if (closed) throw new Error('The host is closed.');
			if (servers.length > 0) return;
			try {
				for (const [index, listener] of listeners.entries()) {
					const given = adopted ? (index === 0 ? adopted.shell : adopted.sandbox) : undefined;
					const server = given ?? createHostServer(tls);
					// A handed-over socket keeps its one handler across a retried `listen()`.
					if (attached.has(server)) {
						servers.push(server);
						continue;
					}
					attached.add(server);
					server.on(
						'request',
						gate(
							new Set(listener.apps.keys()),
							common,
							getRequestListener(socketApp(listener.apps).fetch) as NodeListener
						)
					);
					servers.push(server);
					if (!given)
						await bindServer(server, bindHost(listener.listen), splitListen(listener.listen).port);
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
			await releaseAll(mcp, provider, lock);
		},
	};
	if (provider) recordProvider(host, provider);
	if (mcp) recordHostedMcp(host, mcp);
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
