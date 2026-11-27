/**
 * @fileoverview The hosted MCP surface (phase 6 specification, 3.6 and 7; step 4): the server kernel on the data
 * directory's store, journal and lock, and AFD's handler mounted at `<base>mcp` over it, serving exactly
 * `HOSTED_MCP_COMMANDS`.
 *
 * - **The kernel** is phase 3's `createServerKernel` (its 9.5) over `SqliteAdapter` on `<data>/loam.sqlite` and
 *   `FileJournalSink` on `<data>/journal.jsonl` (section 4), each created 0600 before it is opened. The host holds the
 *   data directory's lock for the process's life, so the kernel is the store's one writer.
 * - **The served list** is applied here, on the server only: `hostedCommands` keeps the commands of the kernel's
 *   `mcp()` that `HOSTED_MCP_COMMANDS` names, as copies with `expose.mcp: true`. `SHELL_EXPOSE` does not change, so the
 *   browser's kernel and first paint are untouched (7).
 * - **The handler** is `createMcpHandler` with the host's command tracking first, then `credentialsGate`, and
 *   `createMcpAuth`'s bearer layer (phase 3's
 *   9.2 to 9.4), AFD's Host and Origin checks held to the configured origin, no CORS, and the body limit from `[limits]`.
 *   Only `<base>mcp` is rewritten to the handler's `/mcp`; RFC 9728's two metadata paths reach it unchanged, and no other
 *   path of AFD's handler is ever routed (3.4).
 */

import { readFileSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { type CommandMiddleware, failure } from '@lushly-dev/afd-core';
import { FileJournalSink } from '@lushly-dev/afd-core/journal-file';
import {
	createMcpHandler,
	type McpHandler,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server';
import type { MountAccess } from '@lushly-dev/loam-cli/deployment';
import {
	createServerKernel,
	type McpProviderV1,
	membershipOf,
	providerKeys,
	type ServerKernel,
} from '@lushly-dev/loam-identity';
import type { KernelEnvironment, KernelPorts } from '@lushly-dev/loam-kernel';
import type { ProjectV1, WorkspaceAppV1 } from '@lushly-dev/loam-kernel/mounted';
import type { IdentityV1, ManifestV3, ProjectionV4 } from '@lushly-dev/loam-manifest';
import type { ServerLimitsV1 } from '@lushly-dev/loam-manifest/server';
import { readManifest } from '@lushly-dev/loam-manifest/validate';
import { SqliteAdapter } from '@lushly-dev/local-db/sqlite';
import { originAllowed } from './gate.js';
import { INERT_POLICY } from './headers.js';
import { createKernelCall, createRemovalHook, sessionOf } from './kernel-call.js';
import type { HostProvider } from './provider.js';
import { createRelay, type Relay, type RelayInstance } from './relay/route.js';
import { serveSite } from './site.js';

/** Served over MCP by the hosted server (7); in `@lushly-dev/loam-host`, never in a browser's graph. */
export const HOSTED_MCP_COMMANDS = Object.freeze([
	'shell-info-get',
	'workspace-get',
	'workspace-app-list',
	'app-list',
	'app-get',
	'project-list',
	'project-get',
	'project-create',
	'project-update',
	'project-archive',
	'project-restore',
	'account-get',
	'persona-list',
	'member-list',
	'agent-member-list',
	'agent-member-get',
] as const);

export type HostedMcpCommand = (typeof HOSTED_MCP_COMMANDS)[number];

/** The server kernel's workspace store and journal in the data directory (section 4). */
export const KERNEL_DATABASE = 'loam.sqlite';
export const KERNEL_JOURNAL = 'journal.jsonl';

const served: ReadonlySet<string> = new Set(HOSTED_MCP_COMMANDS);

/**
 * The commands of the kernel's `mcp()` that `HOSTED_MCP_COMMANDS` names, as copies with `expose.mcp: true`, in the
 * registry's order (7). Every other command, an app's included, is left out, whatever its own `expose` says.
 */
export function hostedCommands(commands: readonly ZodCommandDefinition[]): ZodCommandDefinition[] {
	return commands
		.filter((command) => served.has(command.name))
		.map((command) => ({ ...command, expose: { ...command.expose, mcp: true } }));
}

/** A server has no page: no media query matches, and none changes. */
const NO_PAGE: KernelEnvironment = {
	matches: () => false,
	onChange: () => () => {},
};

/** Why the server runs no app's code: its handlers, views and mounted instances run in each browser (D46, D54). */
const serverRefusal = (what: string) =>
	Object.assign(new Error(`The hosted server's kernel runs no app's ${what}`), {
		code: 'APP_NOT_READY',
		suggestion:
			"Open the app in the shell: its code runs in each person's browser until the collaboration service",
	});

/**
 * The server kernel's ports: an app's package files are read from the written site, below the shell's address, so the
 * kernel knows each app's manifest and commands; its code (a native module, a handler frame, a mounted instance) is
 * never run here. The relay reaches mounted instances, in step 6.
 */
export function serverPorts(site: string, baseUrl: string): KernelPorts {
	const read = serveSite(site);
	const missing = (url: string, why: string) =>
		Object.assign(new Error(`${url} ${why}`), {
			code: 'APP_PACKAGE_INVALID',
			suggestion:
				"Write the deployment again with `loam deployment write`; an app's files are in the site",
		});
	const file = async (url: string): Promise<string> => {
		if (!url.startsWith(baseUrl)) throw missing(url, "is not under the shell's address");
		// The raw remainder, never a parsed URL's resolved path, so `serveSite`'s own refusals decide it.
		const path = url.slice(baseUrl.length).split(/[?#]/)[0] as string;
		const answer = await read({ method: 'GET', path });
		if (answer.status !== 200) throw missing(url, 'is not in the written site');
		return readFileSync(answer.file, 'utf8');
	};
	return {
		baseUrl,
		fetchText: file,
		fetchJson: async (url) => JSON.parse(await file(url)) as unknown,
		importNative: () => Promise.reject(serverRefusal('module')),
		openHandlerFrame: () => Promise.reject(serverRefusal('handlers')),
		mountTransport: () => Promise.reject(serverRefusal('mounted instance')),
	};
}

/** Creates `path` 0600 when it is missing, so SQLite's `-wal` and `-shm` files and the journal's appends are too. */
async function privateFile(path: string): Promise<void> {
	await writeFile(path, '', { mode: 0o600, flag: 'a' });
	await chmod(path, 0o600);
}

/** The version `initialize` reports: this package's own. `api/health` and the server card report none (11.5). */
function hostVersion(): string {
	try {
		const read = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
			version?: unknown;
		};
		return typeof read.version === 'string' ? read.version : '0.0.0';
	} catch {
		return '0.0.0';
	}
}

export interface HostedMcp {
	/** The server kernel, for the step's tests and the later steps' transport and relay. */
	readonly kernel: ServerKernel;
	/** The served list, as the handler holds it. */
	readonly commands: readonly ZodCommandDefinition[];
	/** `<base>api/kernel/call` (6.2): a browser's trust-record command, run as the session's person. */
	kernelCall(incoming: IncomingMessage, outgoing: ServerResponse): void;
	/** `<base>mounts/<instance>/mcp` (section 8): the hosted relay; `rest` is the raw path below `<base>`. */
	relay(incoming: IncomingMessage, outgoing: ServerResponse, rest: string): void;
	/** The relay itself, for the step's tests. */
	readonly mountRelay: Relay;
	/** `<base>mcp`: the request handed to AFD's handler at its own `/mcp`, its query kept. */
	route(incoming: IncomingMessage, outgoing: ServerResponse, search: string): void;
	/** RFC 9728's metadata, at one of the two paths the handler serves it from (`metadataPaths`). */
	metadata(incoming: IncomingMessage, outgoing: ServerResponse): void;
	/** The request paths of RFC 9728's metadata for `<origin><base>mcp`: the path-inserted form, then the root's. */
	readonly metadataPaths: readonly string[];
	close(): Promise<void>;
}

/** `writeHead`'s headers without any `Cache-Control`, as an object or a flat list, the shapes Node takes. */
function withoutCacheControl(headers: unknown): unknown {
	if (Array.isArray(headers)) {
		// A flat `[name, value, …]` list, the only array `writeHead` takes (a list of pairs is refused).
		const kept: unknown[] = [];
		for (let index = 0; index < headers.length; index += 2)
			if (String(headers[index]).toLowerCase() !== 'cache-control')
				kept.push(headers[index], headers[index + 1]);
		return kept;
	}
	if (headers && typeof headers === 'object')
		return Object.fromEntries(
			Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'cache-control')
		);
	return headers;
}

/**
 * The headers 3.5 gives every answer the handler writes on the host's behalf: the inert policy and `cache`
 * (`no-store` for `<base>mcp`, `no-cache` for the metadata), held against the handler's own writes: the MCP SDK's
 * stream answers set `Cache-Control: no-cache, no-transform` in `writeHead`, which would replace a header set before it.
 */
export function holdMcpHeaders(outgoing: ServerResponse, cache = 'no-store'): void {
	outgoing.setHeader('content-security-policy', INERT_POLICY);
	outgoing.setHeader('cache-control', cache);
	const held = (name: string) => name.toLowerCase() === 'cache-control';
	const setHeader = outgoing.setHeader.bind(outgoing);
	outgoing.setHeader = ((name: string, value: number | string | readonly string[]) =>
		held(name) ? outgoing : setHeader(name, value)) as ServerResponse['setHeader'];
	const appendHeader = outgoing.appendHeader.bind(outgoing);
	outgoing.appendHeader = ((name: string, value: string | readonly string[]) =>
		held(name) ? outgoing : appendHeader(name, value)) as ServerResponse['appendHeader'];
	const writeHead = outgoing.writeHead.bind(outgoing) as (...args: unknown[]) => ServerResponse;
	outgoing.writeHead = ((status: number, ...rest: unknown[]) => {
		const last = rest.length - 1;
		if (last >= 0 && typeof rest[last] !== 'string') rest[last] = withoutCacheControl(rest[last]);
		return writeHead(status, ...rest);
	}) as ServerResponse['writeHead'];
}

/**
 * How long `close()` waits for commands in flight: 3.8's 10 s figure. Waiting for the requests themselves is `start`'s
 * shutdown, step 8's: `close()` drops connections first, so a command that finishes during the drain commits, unanswered.
 */
export const DRAIN_MS = 10_000;

/**
 * Tracks every command the handler runs, as its outermost middleware, so `close()` can wait for each one's whole chain,
 * the journal's append included, before the store closes and the lock is released: AFD's handler settles when its
 * socket closes, while the command it started runs on. Once `drain` begins, a command that has not started, such as a
 * batch's or a pipeline's next step, is refused before anything runs.
 */
export function trackCommands(drainMs = DRAIN_MS): {
	middleware: CommandMiddleware;
	/** Refuses new commands, then waits until `extra` and every command have settled, or `drainMs` has passed. */
	drain(extra?: readonly Promise<unknown>[]): Promise<{ settled: boolean }>;
	readonly size: number;
} {
	const running = new Set<Promise<unknown>>();
	let draining = false;
	return {
		get size() {
			return running.size;
		},
		middleware: (_name, _input, _context, next) => {
			if (draining) {
				return Promise.resolve(
					failure({
						code: 'SERVICE_UNAVAILABLE',
						message: 'The hosted server is stopping',
						suggestion: 'Try again in a moment, once the server has restarted',
						retryable: true,
					})
				);
			}
			const call = next();
			running.add(call);
			const done = () => running.delete(call);
			void call.then(done, done);
			return call;
		},
		async drain(extra = []) {
			draining = true;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const expired = new Promise<'expired'>((done) => {
				timer = setTimeout(() => done('expired'), drainMs);
			});
			try {
				let pending: readonly Promise<unknown>[] = extra;
				while (pending.length > 0 || running.size > 0) {
					const settled = await Promise.race([
						Promise.allSettled([...pending, ...running]),
						expired,
					]);
					if (settled === 'expired') return { settled: false };
					pending = [];
				}
				return { settled: true };
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/** A refusal the host writes itself on the MCP surface: plain text, with 3.5's headers. */
function refuse(outgoing: ServerResponse, status: number, text: string, cache: string): void {
	const body = `${text}\n`;
	outgoing.writeHead(status, {
		'content-type': 'text/plain; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		'cache-control': cache,
		'content-security-policy': INERT_POLICY,
	});
	outgoing.end(body);
}

const FOREIGN_ORIGIN =
	'Forbidden: this server answers only its configured origin. Call it from that origin, or send no Origin.';

/**
 * Opens the server kernel on the data directory and mounts AFD's handler over it (3.6). The caller holds the lock and
 * has opened the provider; the kernel's stage B has run once this resolves, so `mcp()` is defined.
 */
export async function openHostedMcp(options: {
	data: string;
	/** `origin` of `loam.server.toml`. */
	origin: string;
	/** The deployment's `base_path`, with its trailing slash. */
	basePath: string;
	/** The written site's directory, `<data>/public/site`. */
	site: string;
	/** What `writeDeployment` wrote into the site. */
	projection: ProjectionV4;
	identity: Extract<IdentityV1, { mode: 'provider' }>;
	provider: HostProvider;
	/** `[limits]`, with every default filled in. */
	limits: ServerLimitsV1;
	/** How the relay reaches each instance, with its bearer: held in memory, never written (section 13). */
	mounts: readonly MountAccess[];
}): Promise<HostedMcp> {
	const { data, origin, basePath, provider } = options;
	const resource = `${origin}${basePath}mcp`;
	await privateFile(join(data, KERNEL_DATABASE));
	await privateFile(join(data, KERNEL_JOURNAL));
	const store = new SqliteAdapter({ path: join(data, KERNEL_DATABASE) });
	let handler: McpHandler | undefined;
	let kernel: ServerKernel | undefined;
	try {
		const journal = new FileJournalSink(join(data, KERNEL_JOURNAL));
		const auth = provider.auth;
		const providerOf: McpProviderV1 & { oidc: readonly string[] } = {
			issuer: provider.issuer,
			keys: providerKeys(() => (auth.api as unknown as { getJwks(): Promise<unknown> }).getJwks()),
			adapter: async () => (await auth.$context).adapter as never,
			workspace: provider.workspace,
			oidc: provider.oidc,
		};
		kernel = await createServerKernel({
			store,
			storeKind: 'sqlite',
			journal,
			environment: NO_PAGE,
			host: 'hosted',
			identity: options.identity,
			deployment: options.projection,
			ports: serverPorts(options.site, `${origin}${basePath}`),
			resource,
			provider: providerOf,
		});
		const mcp = kernel.mcp();
		const commands = hostedCommands(mcp.commands);
		const commandsRunning = trackCommands();
		handler = createMcpHandler({
			name: 'loam',
			version: hostVersion(),
			commands,
			middleware: [commandsRunning.middleware, ...mcp.middleware],
			contextFields: [...mcp.contextFields],
			auth: mcp.auth,
			// Each command its own tool, so `tools/list` is the served list and AFD's meta-tools (7, P6-H4).
			toolStrategy: 'individual',
			allowedHosts: [new URL(origin).hostname],
			// Behind a TLS proxy AFD reads the scheme as `http`, so the browser's `https` origin is named (3.6).
			allowedOrigins: [origin],
			maxBodyBytes: options.limits.request_body_bytes,
		});
		const mounted = handler;
		const held = kernel;
		// Every request the handler admitted, which `close()` waits for too, with the commands they started.
		const inFlight = new Set<Promise<void>>();
		const serve = (incoming: IncomingMessage, outgoing: ServerResponse) => {
			const request = mounted(incoming, outgoing).catch(() => {
				if (!outgoing.headersSent) refuse(outgoing, 500, 'Internal Server Error', 'no-store');
				else outgoing.destroy();
			});
			inFlight.add(request);
			void request.finally(() => inFlight.delete(request));
		};
		let closing = false;
		// The trust-record transport (6.2, step 5) on the same kernel, tracked as the handler's requests are.
		const call = createKernelCall({
			origin,
			maxBodyBytes: options.limits.request_body_bytes,
			kernel: held,
			provider,
		});
		// The removal hook's work is tracked as a request is, so `close()` waits for it before the store closes (A4).
		const removal = createRemovalHook(held, store);
		provider.hearRemovals((event) => {
			if (closing) return Promise.reject(new Error('The hosted server is stopping'));
			const work = removal(event);
			const tracked = work.then(
				() => undefined,
				() => undefined
			);
			inFlight.add(tracked);
			void tracked.finally(() => inFlight.delete(tracked));
			return work;
		});
		// The hosted relay (section 8) over the server's records and journal, reaching each mounted `http` instance.
		const relay = openRelay({
			origin,
			basePath,
			site: options.site,
			projection: options.projection,
			mounts: options.mounts,
			limits: options.limits,
			provider,
			store,
			journal,
		});
		const metadataPaths = Object.freeze([
			`/.well-known/oauth-protected-resource${basePath}mcp`,
			'/.well-known/oauth-protected-resource',
		]);
		return {
			kernel: held,
			commands,
			metadataPaths,
			mountRelay: relay,
			relay(incoming, outgoing, rest) {
				if (closing) return refuse(outgoing, 503, 'Service Unavailable', 'no-store');
				const request = relay.handle(incoming, outgoing, rest).catch(() => {
					if (!outgoing.headersSent) refuse(outgoing, 500, 'Internal Server Error', 'no-store');
					else outgoing.destroy();
				});
				inFlight.add(request);
				void request.finally(() => inFlight.delete(request));
			},
			kernelCall(incoming, outgoing) {
				if (closing) return refuse(outgoing, 503, 'Service Unavailable', 'no-store');
				const request = call(incoming, outgoing).catch(() => {
					if (!outgoing.headersSent) refuse(outgoing, 500, 'Internal Server Error', 'no-store');
					else outgoing.destroy();
				});
				inFlight.add(request);
				void request.finally(() => inFlight.delete(request));
			},
			route(incoming, outgoing, search) {
				if (closing) return refuse(outgoing, 503, 'Service Unavailable', 'no-store');
				if (!originAllowed(incoming, origin))
					return refuse(outgoing, 403, FOREIGN_ORIGIN, 'no-store');
				holdMcpHeaders(outgoing);
				// The handler's own path; `<base>` is the host's (3.6).
				incoming.url = `/mcp${search}`;
				serve(incoming, outgoing);
			},
			metadata(incoming, outgoing) {
				if (closing) return refuse(outgoing, 503, 'Service Unavailable', 'no-cache');
				if (!originAllowed(incoming, origin))
					return refuse(outgoing, 403, FOREIGN_ORIGIN, 'no-cache');
				holdMcpHeaders(outgoing, 'no-cache');
				serve(incoming, outgoing);
			},
			async close() {
				closing = true;
				// The relay's upstream requests are aborted and its bindings ended upstream before the store closes.
				await relay.close().catch(() => {});
				await commandsRunning.drain([...inFlight]);
				provider.hearRemovals(undefined);
				try {
					await held.parts.kernel.dispose();
				} finally {
					try {
						await mounted.dispose?.();
					} finally {
						store.close();
					}
				}
			},
		};
	} catch (cause) {
		await kernel?.parts.kernel.dispose().catch(() => {});
		await handler?.dispose?.();
		store.close();
		throw cause;
	}
}

/**
 * The hosted relay over the server kernel's store and journal (section 8): each of the projection's mounted `http`
 * entries with the URL and bearer only the server holds, its manifest read from the written site, the session read as
 * the trust-record transport reads it, and membership and the records read for each request.
 */
function openRelay(options: {
	origin: string;
	basePath: string;
	site: string;
	projection: ProjectionV4;
	mounts: readonly MountAccess[];
	limits: ServerLimitsV1;
	provider: HostProvider;
	store: SqliteAdapter;
	journal: FileJournalSink;
}): Relay {
	const { provider, store } = options;
	const baseUrl = `${options.origin}${options.basePath}`;
	const ports = serverPorts(options.site, baseUrl);
	const access = new Map(options.mounts.map((mount) => [mount.instance, mount]));
	const instances: RelayInstance[] = options.projection.apps.flatMap((entry): RelayInstance[] => {
		const mount = access.get(entry.instance);
		if (entry.transport !== 'http' || !mount) return [];
		return [
			{
				entry,
				url: mount.url,
				...(mount.bearer !== undefined ? { bearer: mount.bearer } : {}),
				async manifest(): Promise<ManifestV3> {
					const url = new URL('app-manifest.json', new URL(entry.package, baseUrl)).href;
					const read = readManifest(await ports.fetchJson(url));
					if (!read.ok) throw new Error(`The manifest of ${entry.instance} is refused`);
					return read.manifest;
				},
			},
		];
	});
	const workspace = provider.workspace;
	return createRelay({
		origin: options.origin,
		workspace,
		limits: options.limits,
		instances,
		async session(incoming) {
			const read = await sessionOf(provider, incoming);
			if (read === 'none') return { refused: 'UNAUTHORIZED' };
			if (read === 'agent') return { refused: 'AGENT_CANNOT_SIGN_IN' };
			if (read === 'unavailable') return { refused: 'SERVER_UNAVAILABLE' };
			return { person: read.user.id };
		},
		async membership(person) {
			const adapter = (await provider.auth.$context).adapter as never;
			const row = await membershipOf(adapter, workspace, person);
			return {
				mode: 'provider',
				members: row ? new Map([[person, row.role]]) : new Map(),
				digest: row?.digest ?? '',
			};
		},
		workspaceApp: (instance) => store.get<WorkspaceAppV1>('workspace-app', instance),
		projects: async () => (await store.list<ProjectV1>('project')).data,
		journal: (record) => options.journal.append(record),
	});
}
