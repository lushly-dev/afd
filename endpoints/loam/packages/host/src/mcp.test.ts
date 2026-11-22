/**
 * The hosted MCP surface (phase 6 specification, 3.6 and 7; step 4), proved against the real host on the development
 * profile in this process, over TLS, with real tokens from the provider it mounts, never mocks: section 7's served list
 * (P6-E3's list half), the route and its headers, RFC 9728's metadata, A2's root metadata, the paths AFD's handler is
 * never reached by, and the server kernel on `loam.sqlite` and `journal.jsonl`. The hosted suite's P6-H4 repeats the
 * route's cases on the built profile in a child process.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import { AFD_META_TOOL_NAMES, type CommandResult } from '@lushly-dev/afd-core';
import { FileJournalSink } from '@lushly-dev/afd-core/journal-file';
import { seedTestPeople, TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import { INTERNAL_COMMANDS, SHELL_EXPOSE } from '@lushly-dev/loam-kernel';
import { HUMAN_COMMANDS, OWNER_COMMANDS, PERSON_SESSION } from '@lushly-dev/loam-kernel/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { restrictAcls } from './acl.js';
import { runBootstrap, withBootstrapProvider } from './bootstrap.js';
import { type DevProfile, runDev } from './dev.js';
import { originAllowed } from './gate.js';
import { INERT_POLICY } from './headers.js';
import { rawSearch } from './host.js';
import {
	HOSTED_MCP_COMMANDS,
	holdMcpHeaders,
	hostedCommands,
	KERNEL_DATABASE,
	KERNEL_JOURNAL,
	serverPorts,
	trackCommands,
} from './mcp.js';
import {
	deploymentFile,
	expectMode,
	fixtureDist,
	raw,
	temporaryDirectory,
} from './test-support.js';
import { trustingFetch } from './testing/fetch.js';
import { agentToken, type HostSend, registerTestClients } from './testing/oauth.js';
import { hostedMcpOf, providerOf } from './testing-only.js';

const BASE = '/loam/';
const PASSWORD = 'correct horse battery staple';
const REDIRECT = 'http://127.0.0.1:43123/callback';
const PROVIDER = `[workspace]\nid = "acme"\n\n[identity]\nmode = "provider"\norganization = "acme"\nmethods = ["passkey", "password"]\n\n[site]\nbase_path = "${BASE}"\n\n`;
const LOCAL = `[workspace]\nid = "acme"\n\n[site]\nbase_path = "${BASE}"\n\n`;

let profile: DevProfile;
let deployment: string;
let dist: string;
let clientId: string;
let resource: string;
let ca: Buffer;
/** The suite's own directory: `temporaryDirectory`'s are removed after each test, and this profile spans them. */
let suiteRoot: string;

const send: HostSend = async (path, options) => {
	const url = new URL(profile.origin);
	const answer = await raw(Number(url.port), path, {
		tls: true,
		host: url.host,
		method: options.method,
		headers: {
			...options.headers,
			...(options.body !== undefined
				? { 'content-length': String(Buffer.byteLength(options.body)) }
				: {}),
		},
		...(options.body !== undefined ? { body: options.body } : {}),
	});
	return answer as never;
};

/** A request to the profile over TLS with its own `Host`. */
const call = (
	path: string,
	options: { method?: string; headers?: Record<string, string>; json?: unknown } = {}
) => {
	const url = new URL(profile.origin);
	return raw(Number(url.port), path, {
		tls: true,
		host: url.host,
		method: options.method ?? (options.json === undefined ? 'GET' : 'POST'),
		...(options.headers ? { headers: options.headers } : {}),
		...(options.json === undefined ? {} : { json: options.json }),
	});
};

const tokenFor = async (email: string, scope?: string) => {
	const made = await agentToken(send, {
		origin: profile.origin,
		providerPath: `${BASE}api/auth`,
		email,
		password: PASSWORD,
		clientId,
		redirect: REDIRECT,
		resource,
		...(scope ? { scope } : {}),
	});
	if (!made.access) throw new Error(`No token for ${email}: ${JSON.stringify(made.refused)}`);
	return made.access;
};

/** An MCP client over the profile's TLS, on the era `mode` names, with a bearer token. */
async function connect(bearer: string, mode: 'modern' | 'legacy' | 'auto' = 'auto') {
	const transport = new StreamableHttpTransport(resource, {
		clientName: 'p6-step4',
		clientVersion: '0',
		mode,
		headers: { authorization: `Bearer ${bearer}` },
		fetch: trustingFetch(ca),
	});
	await transport.connect();
	let id = 0;
	const request = async (method: string, params: unknown) =>
		(await transport.send({ jsonrpc: '2.0', id: ++id, method, params } as never)) as {
			result?: Record<string, unknown>;
			error?: { code: number; message: string };
		};
	return {
		transport,
		async names(): Promise<string[]> {
			const listed = await request('tools/list', {});
			return ((listed.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name).sort();
		},
		async call<T = unknown>(name: string, args: unknown = {}): Promise<CommandResult<T>> {
			const answer = await request('tools/call', { name, arguments: args });
			if (answer.error) throw new Error(`${name}: ${answer.error.message}`);
			const result = answer.result as {
				structuredContent?: CommandResult<T>;
				content?: { text: string }[];
			};
			return (
				result.structuredContent ??
				(JSON.parse(result.content?.[0]?.text ?? '{}') as CommandResult<T>)
			);
		},
	};
}

async function start(): Promise<DevProfile> {
	return runDev({ deployment, dist, rateLimit: TEST_RATE_LIMIT });
}

beforeAll(async () => {
	suiteRoot = await realpath(await mkdtemp(join(tmpdir(), 'loam-host-mcp-')));
	// As `temporaryDirectory`'s root: a grant on the system's temporary directory never reaches the data directory.
	if (process.platform === 'win32') restrictAcls([suiteRoot]);
	const root = suiteRoot;
	deployment = await deploymentFile(root, PROVIDER);
	dist = await fixtureDist(root);
	const report = await runBootstrap({
		form: 'dev',
		deployment,
		slug: 'acme',
		name: 'Acme',
		ownerEmail: 'first@acme.example',
	});
	await withBootstrapProvider({ form: 'dev', deployment }, async ({ provider }) => {
		await seedTestPeople(provider.auth, report.organization.id, [
			{ email: 'olu@acme.example', name: 'Olu', role: 'owner', password: PASSWORD },
			{ email: 'bea@acme.example', name: 'Bea', role: 'member', password: PASSWORD },
		]);
		const ids = await registerTestClients(
			provider.auth,
			{ email: 'olu@acme.example', password: PASSWORD },
			[{ name: 'p6-agent', redirect: REDIRECT }]
		);
		clientId = ids['p6-agent'] as string;
	});
	profile = await start();
	resource = `${profile.origin}${BASE}mcp`;
	ca = readFileSync(profile.certificate);
}, 120_000);
afterAll(async () => {
	await profile?.host.close();
	if (suiteRoot) await rm(suiteRoot, { recursive: true, force: true });
});

describe('P6-E3: the frozen lists (section 7, the served list)', () => {
	it('P6-E3: every served name is registered on the server kernel, and none is a human, owner, session or internal command', () => {
		const mcp = hostedMcpOf(profile.host);
		const registered = new Set(
			mcp.kernel.parts.registries.palette.listCommands().map((command) => command.name)
		);
		for (const name of HOSTED_MCP_COMMANDS) {
			expect(registered.has(name), name).toBe(true);
			expect(HUMAN_COMMANDS, name).not.toContain(name);
			expect(OWNER_COMMANDS, name).not.toContain(name);
			expect(PERSON_SESSION, name).not.toContain(name);
			expect(INTERNAL_COMMANDS, name).not.toContain(name);
		}
		expect(new Set(HOSTED_MCP_COMMANDS).size).toBe(HOSTED_MCP_COMMANDS.length);
		expect(Object.isFrozen(HOSTED_MCP_COMMANDS)).toBe(true);
	});

	it("P6-E3: the handler holds exactly the served list, each exposed over MCP, from the kernel's `mcp()`", () => {
		const mcp = hostedMcpOf(profile.host);
		expect(mcp.commands.map((command) => command.name).sort()).toEqual(
			[...HOSTED_MCP_COMMANDS].sort()
		);
		for (const command of mcp.commands) expect(command.expose?.mcp, command.name).toBe(true);
	});

	it("P6-E3: AFD's meta-tools reach only the served list: `afd-call`, `afd-batch` and `afd-pipe` of a registered command outside it are refused and run nothing, and `afd-discover` lists only the list", async () => {
		const mcp = hostedMcpOf(profile.host);
		const registered = mcp.kernel.parts.registries.palette
			.listCommands()
			.map((command) => command.name);
		// Registered on the server kernel and not served: an owner's, a person's session, page state, a mutation.
		const outside = ['member-invite', 'layout-set', 'appearance-set', 'workspace-deployment-apply'];
		for (const name of outside.slice(0, 3)) expect(registered, name).toContain(name);
		const olu = await connect(await tokenFor('olu@acme.example'));
		const before = readFileSync(join(profile.data, KERNEL_JOURNAL), 'utf8');
		for (const name of outside) {
			const called = await olu.call('afd-call', { command: name, input: {} });
			expect(called.success, name).toBe(false);
			expect(called.error?.code, name).toBe('COMMAND_NOT_FOUND');
		}
		const batch = await olu.call('afd-batch', {
			commands: outside.map((command) => ({ command, input: {} })),
		});
		// A batch answers its own envelope, each step's result inside it.
		const results = (batch as unknown as { results: { result: CommandResult }[] }).results;
		expect(results).toHaveLength(outside.length);
		for (const step of results) expect(step.result.error?.code).toBe('COMMAND_NOT_FOUND');
		const piped = await olu.call('afd-pipe', { steps: [{ command: 'member-invite', input: {} }] });
		// A pipeline answers its own envelope: the step refused, and nothing ran.
		expect(JSON.stringify(piped)).toContain('COMMAND_NOT_FOUND');
		const discovered = await olu.call<{ commands: { name: string }[] }>('afd-discover', {});
		expect(
			((discovered.data?.commands ?? []) as { name: string }[])
				.map((command) => command.name)
				.sort()
		).toEqual([...HOSTED_MCP_COMMANDS].sort());
		await olu.transport.disconnect();
		// Nothing ran: the journal holds no entry for any of them.
		const added = readFileSync(join(profile.data, KERNEL_JOURNAL), 'utf8').slice(before.length);
		for (const name of outside) expect(added, name).not.toContain(`"command":"${name}"`);
	});

	it('P6-E3: `hostedCommands` keeps only the list, leaves the originals as they were, and `SHELL_EXPOSE` is unchanged', () => {
		const handler = async () => ({ success: true as const, data: null });
		const commands = [
			{ name: 'project-list', expose: { mcp: false, palette: true }, handler },
			{ name: 'document-open', expose: { mcp: true }, handler },
			{ name: 'notes-create', expose: { mcp: true }, handler },
		] as never[];
		const kept = hostedCommands(commands);
		expect(kept.map((command) => command.name)).toEqual(['project-list']);
		expect(kept[0]?.expose).toEqual({ mcp: true, palette: true });
		expect((commands[0] as unknown as { expose: { mcp: boolean } }).expose.mcp).toBe(false);
		expect(SHELL_EXPOSE).toEqual({
			palette: true,
			agent: true,
			mcp: false,
			cli: false,
			apps: false,
		});
	});

	it("P6-E3: `tools/list` is the served list and AFD's meta-tools, the same for every token, on both eras", async () => {
		const expected = [...HOSTED_MCP_COMMANDS, ...AFD_META_TOOL_NAMES].sort();
		for (const mode of ['modern', 'legacy'] as const) {
			const owner = await connect(await tokenFor('olu@acme.example'), mode);
			const member = await connect(await tokenFor('bea@acme.example', 'loam:read'), mode);
			expect(await owner.names(), mode).toEqual(expected);
			expect(await member.names(), mode).toEqual(expected);
			await owner.transport.disconnect();
			await member.transport.disconnect();
		}
	});
});

describe('Step 4: the route, the metadata and the server kernel (3.4, 3.6, 3.7, section 4)', () => {
	it("no token: 401, with `resource_metadata` naming RFC 9728's path-inserted URL, which answers, as does the root's", async () => {
		const refused = await call(`${BASE}mcp`, {
			json: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
			headers: { accept: 'application/json, text/event-stream' },
		});
		expect(refused.status).toBe(401);
		const challenge = String(refused.headers['www-authenticate']);
		expect(challenge).toContain(
			`resource_metadata="${profile.origin}/.well-known/oauth-protected-resource${BASE}mcp"`
		);
		for (const path of [
			`/.well-known/oauth-protected-resource${BASE}mcp`,
			'/.well-known/oauth-protected-resource',
		]) {
			const answer = await call(path);
			expect(answer.status, path).toBe(200);
			const metadata = JSON.parse(answer.body) as {
				resource: string;
				authorization_servers: string[];
			};
			expect(metadata.resource, path).toBe(resource);
			expect(metadata.authorization_servers, path).toEqual([`${profile.origin}${BASE}api/auth`]);
			expect(answer.headers['content-security-policy'], path).toBe(INERT_POLICY);
			// 3.5's "anything else": `no-cache`.
			expect(answer.headers['cache-control'], path).toBe('no-cache');
		}
	});

	it('only the configured origin: an `Origin` of its `http` counterpart, as AFD would derive behind a TLS proxy, is 403 on the route and every metadata document; the configured one and none are served', async () => {
		const bearer = await tokenFor('bea@acme.example');
		const http = profile.origin.replace(/^https:/, 'http:');
		const list = (origin?: string) =>
			call(`${BASE}mcp`, {
				json: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
				headers: {
					accept: 'application/json, text/event-stream',
					authorization: `Bearer ${bearer}`,
					'mcp-protocol-version': '2025-11-25',
					...(origin ? { origin } : {}),
				},
			});
		for (const origin of [http, 'https://evil.example', 'null']) {
			const refused = await list(origin);
			expect(refused.status, origin).toBe(403);
			expect(refused.headers['cache-control'], origin).toBe('no-store');
			expect(refused.headers['content-security-policy'], origin).toBe(INERT_POLICY);
			for (const path of [
				`/.well-known/oauth-protected-resource${BASE}mcp`,
				'/.well-known/oauth-protected-resource',
				`/.well-known/oauth-authorization-server${BASE}api/auth`,
			]) {
				expect((await call(path, { headers: { origin } })).status, `${origin} ${path}`).toBe(403);
			}
		}
		expect((await list(profile.origin)).status).toBe(200);
		expect((await list()).status).toBe(200);
	});

	it("A2: the authorization server's metadata at the origin's root names the issuer, as Better Auth's own OpenID configuration does", async () => {
		const issuer = `${profile.origin}${BASE}api/auth`;
		const root = await call(`/.well-known/oauth-authorization-server${BASE}api/auth`);
		expect(root.status, root.body).toBe(200);
		const metadata = JSON.parse(root.body) as Record<string, unknown>;
		expect(metadata.issuer).toBe(issuer);
		expect(metadata.authorization_endpoint).toBe(`${issuer}/oauth2/authorize`);
		expect(metadata.token_endpoint).toBe(`${issuer}/oauth2/token`);
		expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
		expect(root.headers['content-security-policy']).toBe(INERT_POLICY);
		expect(root.headers['cache-control']).toBe('no-cache');
		// Better Auth's own configuration names the same issuer. Its OpenID discovery is not served over HTTP (phase 3's
		// step 7: no `openid` scope, no ID token), so it is read from the provider the host mounts, as its route would.
		const own = (await (
			providerOf(profile.host).auth.api as unknown as {
				getOAuthServerConfig(input: unknown): Promise<Record<string, unknown>>;
			}
		).getOAuthServerConfig({})) as Record<string, unknown>;
		expect(own.issuer).toBe(issuer);
		expect(metadata).toEqual(JSON.parse(JSON.stringify(own)));
		expect((await call(`${BASE}api/auth/.well-known/openid-configuration`)).status).toBe(404);
		// Only `GET`, and no other spelling of the path.
		expect(
			(await call(`/.well-known/oauth-authorization-server${BASE}api/auth`, { method: 'POST' }))
				.status
		).toBe(404);
		expect((await call(`/.well-known/oauth-authorization-server${BASE}api/auth/`)).status).toBe(
			404
		);
		expect((await call('/.well-known/oauth-authorization-server')).status).toBe(404);
	});

	it("a foreign `Origin` is 403, before the token is read; 3.5's headers and `no-store` on every answer of `<base>mcp`", async () => {
		const bearer = await tokenFor('bea@acme.example');
		const foreign = await call(`${BASE}mcp`, {
			json: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
			headers: {
				accept: 'application/json, text/event-stream',
				origin: 'https://evil.example',
				authorization: `Bearer ${bearer}`,
			},
		});
		expect(foreign.status).toBe(403);
		const unauthorized = await call(`${BASE}mcp`, { json: {} });
		const get = await call(`${BASE}mcp`, { headers: { authorization: `Bearer ${bearer}` } });
		// The 2025 era's answer is a stream, whose `writeHead` names its own `Cache-Control`: `no-store` holds over it.
		const stream = await call(`${BASE}mcp`, {
			json: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
			headers: {
				accept: 'application/json, text/event-stream',
				authorization: `Bearer ${bearer}`,
				'mcp-protocol-version': '2025-11-25',
			},
		});
		expect(stream.status).toBe(200);
		expect(String(stream.headers['content-type'])).toContain('text/event-stream');
		for (const answer of [foreign, unauthorized, get, stream]) {
			expect(answer.headers['cache-control']).toBe('no-store');
			expect(answer.headers['x-content-type-options']).toBe('nosniff');
			expect(answer.headers['referrer-policy']).toBe('no-referrer');
			expect(answer.headers['cross-origin-opener-policy']).toBe('same-origin');
			expect(answer.headers['content-security-policy']).toBe(INERT_POLICY);
			expect(answer.headers['access-control-allow-origin']).toBeUndefined();
		}
	});

	it("AFD's other routes are never reached, under `<base>` or at the root; nor is the route by another spelling or method", async () => {
		for (const route of ['sse', 'message', 'rpc', 'batch', 'stream/x', 'health']) {
			for (const path of [`${BASE}${route}`, `/${route}`]) {
				for (const method of ['GET', 'POST']) {
					const answer = await call(path, { method, headers: { accept: 'application/json' } });
					expect(answer.status, `${method} ${path}`).toBe(404);
				}
			}
		}
		for (const path of [
			`${BASE}MCP`,
			`${BASE}%6dcp`,
			`${BASE}x/../mcp`,
			`${BASE}./mcp`,
			`${BASE}mcp/`,
			`${BASE}mcp/tools`,
			`${BASE}mcp%2f`,
			`${BASE}mcp;x`,
			`/${BASE}mcp`,
			'/mcp',
		]) {
			const answer = await call(path, {
				json: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
				headers: { accept: 'application/json' },
			});
			expect(answer.status, path).toBe(404);
			expect(answer.headers['www-authenticate'], path).toBeUndefined();
		}
		for (const method of ['PUT', 'PATCH', 'HEAD', 'OPTIONS']) {
			const refused = await call(`${BASE}mcp`, { method });
			expect(refused.status, method).toBe(404);
			expect(refused.headers['cache-control'], method).toBe('no-store');
			expect(refused.headers['content-security-policy'], method).toBe(INERT_POLICY);
		}
		for (const path of [
			`/.well-known/oauth-protected-resource${BASE}mcp`,
			`/.well-known/oauth-authorization-server${BASE}api/auth`,
		]) {
			const refused = await call(path, { method: 'POST' });
			expect(refused.status, path).toBe(404);
			expect(refused.headers['content-security-policy'], path).toBe(INERT_POLICY);
		}
		// An absolute-form target naming the origin is the same request as its origin form (the gate's rule): the route,
		// with its challenge.
		const absolute = await call(`${profile.origin}${BASE}mcp`, { json: {} });
		expect(absolute.status).toBe(401);
	});

	it('the server kernel reports the hosted host and its SQLite store, on `loam.sqlite` and `journal.jsonl`, each 0600', async () => {
		const bea = await connect(await tokenFor('bea@acme.example'));
		const info = await bea.call<{ host: string; store: string }>('shell-info-get');
		expect(info.success, JSON.stringify(info.error)).toBe(true);
		expect(info.data).toMatchObject({ host: 'hosted', store: 'sqlite' });
		await bea.transport.disconnect();
		for (const file of [KERNEL_DATABASE, KERNEL_JOURNAL]) {
			expect(existsSync(join(profile.data, file)), file).toBe(true);
			expectMode(join(profile.data, file), 0o600, file);
		}
	});

	it("a connected agent's `project-create` lands in `loam.sqlite`, journaled as the agent for its person, and survives a restart; `access` is HUMAN_REQUIRED", async () => {
		const bea = await connect(await tokenFor('bea@acme.example'));
		const created = await bea.call<{ slug: string; id: string }>('project-create', {
			name: 'Field notes',
			slug: 'field-notes',
		});
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		const withAccess = await bea.call('project-create', {
			name: 'Secret',
			slug: 'secret',
			access: { mode: 'restricted', members: [] },
		});
		expect(withAccess.error?.code).toBe('HUMAN_REQUIRED');
		await bea.transport.disconnect();
		const database = new DatabaseSync(join(profile.data, KERNEL_DATABASE), { readOnly: true });
		try {
			const rows = database.prepare("SELECT value FROM records WHERE tbl = 'project'").all() as {
				value: string;
			}[];
			expect(rows.map((row) => (JSON.parse(row.value) as { slug: string }).slug)).toContain(
				'field-notes'
			);
		} finally {
			database.close();
		}
		const journal = readFileSync(join(profile.data, KERNEL_JOURNAL), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map(
				(line) =>
					JSON.parse(line) as { command: string; actor?: { kind: string; onBehalfOf?: string } }
			);
		const entry = journal.find((line) => line.command === 'project-create');
		expect(entry?.actor?.kind).toBe('agent');
		expect(entry?.actor?.onBehalfOf).toBeTruthy();
		const text = JSON.stringify(journal);
		expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
		expect(text).not.toContain('credentials');

		await profile.host.close();
		profile = await start();
		const again = await connect(await tokenFor('bea@acme.example'));
		const listed = await again.call<{ projects: { slug: string }[] } | { slug: string }[]>(
			'project-list'
		);
		expect(JSON.stringify(listed.data)).toContain('field-notes');
		await again.transport.disconnect();
	});
});

describe('Step 4: a `local` deployment pays nothing for the MCP surface (section 14)', () => {
	/** What only a `provider` deployment loads: the server kernel, AFD's handler and the MCP SDK, the store, Better Auth. */
	const HEAVY = [
		/^@lushly-dev\/afd-server$/,
		/^@lushly-dev\/loam-identity/,
		/^@lushly-dev\/loam-kernel/,
		/^@lushly-dev\/local-db\/sqlite$/,
		/^better-auth/,
		/^@better-auth\//,
		/^@modelcontextprotocol\//,
	];
	/** Every static value import and re-export of a module's source, its `import type` and `export type` left out. */
	const valueImports = (source: string): string[] =>
		[
			...source.matchAll(
				/^(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"];?/gms
			),
		]
			.filter((found) => found[1] === undefined)
			.map((found) => found[2] as string);

	it("`host.ts`'s static import graph reaches none of them, so they load only by `mcp.ts`'s and `provider.ts`'s lazy imports", () => {
		const seen = new Set<string>();
		const heavy: string[] = [];
		const walk = (file: URL) => {
			if (seen.has(file.href)) return;
			seen.add(file.href);
			const source = readFileSync(file, 'utf8');
			for (const specifier of valueImports(source)) {
				if (specifier.startsWith('.')) walk(new URL(specifier.replace(/\.js$/, '.ts'), file));
				else if (HEAVY.some((pattern) => pattern.test(specifier)))
					heavy.push(`${file.pathname.split('/src/')[1]} → ${specifier}`);
			}
		};
		walk(new URL('./host.ts', import.meta.url));
		expect(seen.size).toBeGreaterThan(5);
		expect(heavy).toEqual([]);
		// The graph excludes `mcp.ts` and `provider.ts` themselves, which `host.ts` imports lazily.
		expect(
			[...seen].some((href) => href.endsWith('/mcp.ts') || href.endsWith('/provider.ts'))
		).toBe(false);
		const host = readFileSync(new URL('./host.ts', import.meta.url), 'utf8');
		expect(host).toContain("await import('./mcp.js')");
		expect(host).toContain("await import('./provider.js')");
	});

	it('the walk sees a value import, a mixed one and a re-export, and leaves a type-only import out', () => {
		expect(
			valueImports(
				[
					"import { a } from './x.js';",
					"import {\n\ttype B,\n\tc,\n} from 'better-auth';",
					"export { d } from './y.js';",
					"import './z.js';",
					"import type { E } from '@lushly-dev/afd-server';",
					"export type { F } from './w.js';",
				].join('\n')
			)
		).toEqual(['./x.js', 'better-auth', './y.js', './z.js']);
	});
});

describe("Step 4: the route's own pieces, by unit", () => {
	const ORIGIN = 'https://localhost:8443';
	const request = (headers: Record<string, string>, distinct?: Record<string, string[]>) =>
		({ headers, headersDistinct: distinct }) as never;

	it('`originAllowed` admits the configured origin or none, and nothing else, behind a proxy too', () => {
		expect(originAllowed(request({}, {}), ORIGIN)).toBe(true);
		expect(originAllowed(request({ origin: ORIGIN }, { origin: [ORIGIN] }), ORIGIN)).toBe(true);
		for (const sent of [
			['http://localhost:8443'],
			['https://localhost'],
			['https://LOCALHOST:8443'],
			['null'],
			[''],
			[ORIGIN, ORIGIN],
			[ORIGIN, 'https://evil.example'],
		]) {
			expect(
				originAllowed(request({ origin: sent[0] as string }, { origin: sent }), ORIGIN),
				sent.join()
			).toBe(false);
		}
		// With no `headersDistinct`, the header itself decides, never an empty list.
		expect(originAllowed(request({ origin: 'http://localhost:8443' }), ORIGIN)).toBe(false);
		expect(originAllowed(request({}), ORIGIN)).toBe(true);
	});

	it('`holdMcpHeaders` keeps its `Cache-Control` and policy through `setHeader`, `appendHeader` and every `writeHead` shape', () => {
		const shapes: unknown[][] = [
			[{ 'Cache-Control': 'no-cache, no-transform', 'content-type': 'text/event-stream' }],
			['OK', { 'cache-control': 'public' }],
			[['Cache-Control', 'public, max-age=60', 'content-type', 'application/json']],
		];
		for (const shape of shapes) {
			const outgoing = new ServerResponse(new IncomingMessage(new Socket()));
			holdMcpHeaders(outgoing);
			outgoing.setHeader('Cache-Control', 'public');
			outgoing.appendHeader('cache-control', 'max-age=60');
			(outgoing.writeHead as (...args: unknown[]) => unknown)(200, ...shape);
			expect(outgoing.getHeader('cache-control'), JSON.stringify(shape)).toBe('no-store');
			expect(outgoing.getHeader('content-security-policy')).toBe(INERT_POLICY);
		}
		const metadata = new ServerResponse(new IncomingMessage(new Socket()));
		holdMcpHeaders(metadata, 'no-cache');
		metadata.writeHead(200, { 'cache-control': 'public, max-age=86400' });
		expect(metadata.getHeader('cache-control')).toBe('no-cache');
	});

	it('`rawSearch` takes a query only before any fragment', () => {
		expect(rawSearch({ url: '/loam/mcp' })).toBe('');
		expect(rawSearch({ url: '/loam/mcp?a=1' })).toBe('?a=1');
		expect(rawSearch({ url: '/loam/mcp?a=1#b?c' })).toBe('?a=1');
		expect(rawSearch({ url: '/loam/mcp#x?access_token=t' })).toBe('');
	});

	it('`trackCommands` waits for every command, refuses one that starts once it drains, and gives up after its bound', async () => {
		const tracked = trackCommands(50);
		let release: () => void = () => {};
		const held = tracked.middleware(
			'project-create',
			{},
			{} as never,
			() =>
				new Promise((done) => {
					release = () => done({ success: true, data: null });
				})
		);
		expect(tracked.size).toBe(1);
		const drained = tracked.drain();
		let ran = false;
		const late = await tracked.middleware('project-list', {}, {} as never, async () => {
			ran = true;
			return { success: true, data: null };
		});
		expect(ran).toBe(false);
		expect(late.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
		expect(late.error?.suggestion).toBeTruthy();
		release();
		await held;
		expect(await drained).toEqual({ settled: true });
		const stuck = trackCommands(30);
		void stuck.middleware('project-create', {}, {} as never, () => new Promise(() => {}));
		expect(await stuck.drain()).toEqual({ settled: false });
	});
});

describe("Step 4: the server kernel's ports (deviation 5)", () => {
	it("read an app's files from the written site by the raw path, refuse any other spelling or origin, and run no app code", async () => {
		const site = await temporaryDirectory();
		await mkdir(join(site, 'apps', 'hello'), { recursive: true });
		await writeFile(join(site, 'apps', 'hello', 'app-manifest.json'), '{"app":"hello"}');
		await writeFile(join(site, 'secret.json'), '{"no":true}');
		const ports = serverPorts(site, 'https://localhost:8443/loam/');
		expect(
			await ports.fetchJson('https://localhost:8443/loam/apps/hello/app-manifest.json')
		).toEqual({
			app: 'hello',
		});
		for (const url of [
			'https://localhost:8443/loam/apps/hello/../../secret.json',
			'https://localhost:8443/loam/apps/%2e%2e/secret.json',
			'https://localhost:8443/other/secret.json',
			'https://evil.example/loam/secret.json',
			'https://localhost:8443/loam/apps/hello/missing.json',
		]) {
			await expect(ports.fetchText(url), url).rejects.toMatchObject({
				code: 'APP_PACKAGE_INVALID',
			});
		}
		for (const refused of [
			ports.importNative('https://localhost:8443/loam/apps/hello/index.js'),
			ports.openHandlerFrame('hello', '<p></p>'),
			ports.mountTransport({} as never, 'https://localhost:8443/loam/mounts/x/mcp'),
		]) {
			await expect(refused).rejects.toMatchObject({ code: 'APP_NOT_READY' });
		}
	});
});

describe('Step 4: closing the host (section 4)', () => {
	it('`close()` waits for a call in flight, its journal append included, then disposes the kernel, closes the store and releases the lock', async () => {
		const mcp = hostedMcpOf(profile.host);
		const disposed = vi.spyOn(mcp.kernel.parts.kernel, 'dispose');
		const append = FileJournalSink.prototype.append;
		let appended = 0;
		let entered: () => void = () => {};
		const reached = new Promise<void>((done) => {
			entered = done;
		});
		const held = vi.spyOn(FileJournalSink.prototype, 'append').mockImplementation(async function (
			this: FileJournalSink,
			record
		) {
			if ((record as { command?: string }).command === 'project-create') entered();
			await new Promise((done) => setTimeout(done, 400));
			const entry = await append.call(this, record);
			appended = performance.now();
			return entry;
		});
		try {
			const bea = await connect(await tokenFor('bea@acme.example'));
			const created = bea
				.call('project-create', { name: 'Late', slug: 'late-write' })
				.catch(() => undefined);
			// The call is in its journal append, after its handler wrote the store, when the host is closed.
			await reached;
			await profile.host.close();
			const closedAt = performance.now();
			expect(appended).toBeGreaterThan(0);
			expect(appended).toBeLessThanOrEqual(closedAt);
			expect(disposed).toHaveBeenCalledTimes(1);
			await created;
			try {
				await bea.transport.disconnect();
			} catch {
				// The host closed its socket already.
			}
			expect(readFileSync(join(profile.data, KERNEL_JOURNAL), 'utf8')).toContain('late-write');
		} finally {
			held.mockRestore();
			disposed.mockRestore();
			profile = await start();
		}
	});
});

describe('Step 4: a `local` deployment serves the shell only (3.3)', () => {
	it('`<base>mcp` and the well-known documents are 404, and no store or journal is made', async () => {
		const root = await temporaryDirectory();
		const local = await runDev({
			deployment: await deploymentFile(root, LOCAL),
			dist: await fixtureDist(root),
		});
		try {
			const url = new URL(local.origin);
			const get = (path: string, method = 'GET') =>
				raw(Number(url.port), path, { tls: true, host: url.host, method });
			for (const [path, method] of [
				[`${BASE}mcp`, 'POST'],
				[`${BASE}mcp`, 'GET'],
				[`/.well-known/oauth-protected-resource${BASE}mcp`, 'GET'],
				['/.well-known/oauth-protected-resource', 'GET'],
				[`/.well-known/oauth-authorization-server${BASE}api/auth`, 'GET'],
			] as const) {
				expect((await get(path, method)).status, `${method} ${path}`).toBe(404);
			}
			expect(existsSync(join(local.data, KERNEL_DATABASE))).toBe(false);
			expect(existsSync(join(local.data, KERNEL_JOURNAL))).toBe(false);
		} finally {
			await local.host.close();
		}
	});
});
