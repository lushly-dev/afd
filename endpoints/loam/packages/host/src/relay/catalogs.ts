/**
 * @fileoverview The tools the relay knows (phase 6 specification, 8.2): each enabled instance discovered exactly as the
 * browser's kernel discovers it, by the kernel's own `discoverInstance`, over a server-side `MountTransport` on AFD's
 * `StreamableHttpTransport` carrying the deployer's bearer. The catalog it returns decides 8.1's exposure and pinning.
 * At start and every 10 minutes; a command not in the catalog triggers one rediscovery, never more often than once per
 * 30 seconds an instance. Discovery is the relay's alone and is never answered to a browser (8.3).
 */

import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import {
	discoverInstance,
	type InstanceCatalogV1,
	type McpTool,
	type McpToolCallResult,
	type MountTransport,
} from '@lushly-dev/loam-kernel/mounted';
import type { ManifestV3, ProjectionAppV1 } from '@lushly-dev/loam-manifest';

/** How often every instance is discovered again. */
export const CATALOG_REFRESH_MS = 10 * 60_000;
/** The least time between two discoveries of one instance (8.2). */
export const REDISCOVERY_MS = 30_000;
/** One discovery's deadline, the kernel's own (`DISCOVERY_DEADLINE_MS`). */
export const DISCOVERY_DEADLINE_MS = 10_000;
/** What discovery reads of any one answer: the browser's own bound (`mount.ts`'s `RESPONSE_MAX_BYTES`). */
const DISCOVERY_RESPONSE_MAX = 4 * 1024 * 1024;

/** A `fetch` that reads no answer past the bound and opens no event stream, as the browser's `boundedFetch` does. */
function discoveryFetch(fetcher: typeof fetch, session: { id?: string }): typeof fetch {
	return async (input, init) => {
		if ((init?.method ?? 'GET').toUpperCase() === 'GET') return new Response(null, { status: 405 });
		const response = await fetcher(input, { ...init, redirect: 'manual' });
		// A legacy-era instance's session, which the SDK's `disconnect()` never ends: `close()` sends its `DELETE`.
		const issued = response.headers.get('mcp-session-id');
		if (issued) session.id = issued;
		if (!response.body) return response;
		let read = 0;
		const limited = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					read += chunk.byteLength;
					if (read > DISCOVERY_RESPONSE_MAX) controller.error(new Error('The answer is too large'));
					else controller.enqueue(chunk);
				},
			})
		);
		return new Response(limited, { status: response.status, headers: response.headers });
	};
}

/**
 * The server-side port `discoverInstance` takes: AFD's transport with the deployer's bearer and nothing of a page's. A
 * failure carries no text of the instance's; `discoverInstance` reads only a code.
 */
export function serverTransport(
	url: string,
	bearer: string | undefined,
	fetcher: typeof fetch = fetch
): MountTransport {
	const session: { id?: string } = {};
	const transport = new StreamableHttpTransport(url, {
		clientName: 'loam-host',
		clientVersion: '1',
		mode: 'auto',
		fetch: discoveryFetch(fetcher, session),
		...(bearer !== undefined ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
	});
	let id = 0;
	const failed = (code: string) => Object.assign(new Error(code), { code });
	return {
		async connect(signal) {
			try {
				await transport.connect(signal);
			} catch {
				throw failed('MOUNT_UNREACHABLE');
			}
			const { protocolVersion } = transport;
			if (protocolVersion === undefined) throw failed('MOUNT_UNREACHABLE');
			return { protocolVersion };
		},
		listTools: async (): Promise<McpTool[]> => [],
		async callTool(name, args, signal) {
			let response: Awaited<ReturnType<StreamableHttpTransport['send']>>;
			try {
				response = await transport.send(
					{
						jsonrpc: '2.0',
						id: ++id,
						method: 'tools/call',
						params: { name, arguments: args ?? {} },
					},
					signal
				);
			} catch {
				throw failed('MOUNT_UNREACHABLE');
			}
			if (response.error) throw failed('MOUNT_RESULT_INVALID');
			return response.result as McpToolCallResult;
		},
		async close() {
			// The negotiated version, read before `disconnect()` drops the client that holds it.
			const version = transport.protocolVersion;
			transport.disconnect();
			// The relay's own discovery ends the session it opened, so each refresh leaves none behind (the trust review,
			// Astra). The instance's answer is not read.
			if (session.id === undefined) return;
			const ended = await fetcher(url, {
				method: 'DELETE',
				headers: {
					'mcp-session-id': session.id,
					...(version !== undefined ? { 'mcp-protocol-version': version } : {}),
					...(bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {}),
				},
				redirect: 'manual',
				signal: AbortSignal.timeout(DISCOVERY_DEADLINE_MS),
			}).catch(() => undefined);
			await ended?.body?.cancel().catch(() => {});
		},
	};
}

export interface Catalogs {
	/** The instance's last good catalog, or none yet. */
	get(instance: string): InstanceCatalogV1 | undefined;
	/** Discovers again, at most once per {@link REDISCOVERY_MS}; resolves once that discovery has settled. */
	rediscover(instance: string): Promise<void>;
	close(): void;
}

export interface CatalogInstance {
	entry: ProjectionAppV1;
	url: string;
	bearer?: string;
	/** The app's manifest, from the written site. */
	manifest(): Promise<ManifestV3>;
	/** Whether the server's `workspace-app` record enables it now: a disabled instance is not discovered. */
	enabled(): Promise<boolean>;
}

export function createCatalogs(options: {
	instances: readonly CatalogInstance[];
	fetch?: typeof fetch;
	clock?: () => number;
	/** Off in a unit that drives discovery itself. */
	schedule?: boolean;
}): Catalogs {
	const clock = options.clock ?? Date.now;
	const held = new Map<string, InstanceCatalogV1>();
	const last = new Map<string, number>();
	const running = new Map<string, Promise<void>>();
	const byInstance = new Map(
		options.instances.map((instance) => [instance.entry.instance, instance])
	);
	let closed = false;
	/** Aborts a discovery still running when the relay closes. */
	const stopping = new AbortController();

	async function discover(instance: CatalogInstance): Promise<void> {
		const name = instance.entry.instance;
		last.set(name, clock());
		if (!(await instance.enabled().catch(() => false))) return;
		const transport = serverTransport(instance.url, instance.bearer, options.fetch);
		const signal = AbortSignal.any([AbortSignal.timeout(DISCOVERY_DEADLINE_MS), stopping.signal]);
		try {
			const catalog = await discoverInstance(
				instance.entry,
				await instance.manifest(),
				transport,
				signal
			);
			if (!closed) held.set(name, catalog);
		} catch {
			// The last good catalog stays: a failed discovery never widens nor empties what was decided.
		} finally {
			await transport.close().catch(() => {});
		}
	}

	function run(instance: CatalogInstance): Promise<void> {
		const name = instance.entry.instance;
		const current = running.get(name);
		if (current) return current;
		const started = discover(instance).finally(() => running.delete(name));
		running.set(name, started);
		return started;
	}

	const all = () => Promise.all(options.instances.map(run)).then(() => undefined);
	let timer: ReturnType<typeof setInterval> | undefined;
	if (options.schedule !== false) {
		void all();
		timer = setInterval(() => void all(), CATALOG_REFRESH_MS);
		timer.unref?.();
	}
	return {
		get: (instance) => held.get(instance),
		async rediscover(name) {
			const instance = byInstance.get(name);
			if (!instance || closed) return;
			const current = running.get(name);
			if (current) return current;
			if (clock() - (last.get(name) ?? Number.NEGATIVE_INFINITY) < REDISCOVERY_MS) return;
			return run(instance);
		},
		close() {
			closed = true;
			if (timer) clearInterval(timer);
			stopping.abort(new Error('The relay closed'));
		},
	};
}
