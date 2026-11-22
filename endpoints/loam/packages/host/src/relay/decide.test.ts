import {
	type CatalogCommandV1,
	DISCOVERY_LIMITS,
	type InstanceCatalogV1,
	type ProjectV1,
} from '@lushly-dev/loam-kernel/mounted';
import type { ProjectionAppV1 } from '@lushly-dev/loam-manifest';
import { describe, expect, it } from 'vitest';
import { type DecideContext, type Decision, decideMessage } from './decide.js';
import { type ParsedMessage, parseMessage } from './message.js';
import { rebuildMessage, requestHeaders } from './rebuild.js';
import type { RelayRefusal } from './refusals.js';

const WORKSPACE = 'acme';
const PERSON = 'usr_bea';

const project = (id: string, slug: string, access: ProjectV1['access']): ProjectV1 => ({
	id,
	workspace: WORKSPACE,
	slug,
	name: slug,
	icon: 'folder',
	status: 'active',
	access,
	memberEpoch: 0,
	createdAt: 0,
	updatedAt: 0,
	createdBy: 'usr_olu',
	updatedBy: 'usr_olu',
});

const ATLAS = project('prj_atlas0000', 'atlas', { mode: 'workspace' });
const BEACON = project('prj_beacon000', 'beacon', { mode: 'workspace' });
const VAULT = project('prj_vault0000', 'vault', { mode: 'restricted', members: ['usr_olu'] });

const PLAIN = {
	type: 'object',
	properties: { space: { type: 'string' }, text: { type: 'string' } },
};

const command = (tool: string, extra: Partial<CatalogCommandV1> = {}): CatalogCommandV1 => ({
	name: `work-${tool}`,
	tool,
	firstClass: false,
	description: '',
	inputSchema: PLAIN,
	mutation: false,
	destructive: false,
	expose: { palette: true, agent: true },
	...extra,
});

const CATALOG: InstanceCatalogV1 = {
	protocolVersion: '2026-07-28',
	toolStrategy: 'hybrid',
	warnings: [],
	commands: [
		command('notes-get', { firstClass: true }),
		command('notes-list'),
		command('notes-delete', {
			mutation: true,
			expose: { palette: false, agent: false },
		}),
		command('notes-confirmed', {
			firstClass: true,
			inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
		}),
		command('notes-nested', {
			inputSchema: {
				type: 'object',
				properties: { target: { type: 'object', properties: { space: { type: 'string' } } } },
			},
		}),
		command('notes-spaces', {
			inputSchema: { type: 'object', properties: { spaces: { type: 'array' } } },
		}),
		command('notes-union', { inputSchema: { type: 'object', oneOf: [{ properties: {} }] } }),
		command('notes-branch', {
			// A root `if`/`then`, written as JSON so no object literal holds a `then`.
			inputSchema: JSON.parse('{"type":"object","if":{"properties":{}},"then":{}}'),
		}),
		command('notes-free', { inputSchema: { type: 'object', properties: { text: {} } } }),
	],
};

const entry = (extra: Partial<ProjectionAppV1> = {}): ProjectionAppV1 =>
	({
		instance: 'work',
		app: 'umbel',
		package: 'apps/umbel/',
		transport: 'http',
		prefix: 'work',
		route: 'mounts/work/mcp',
		...extra,
	}) as ProjectionAppV1;

function context(extra: Partial<DecideContext> = {}): DecideContext {
	return {
		workspace: WORKSPACE,
		entry: entry(),
		person: PERSON,
		membership: { mode: 'provider', members: new Map([[PERSON, 'member']]), digest: 'd' },
		projects: [ATLAS, BEACON, VAULT],
		catalog: CATALOG,
		...extra,
	};
}

const scoped = (projectId?: string) =>
	projectId === undefined
		? {}
		: { _meta: { 'dev.loam/scope': { workspace: WORKSPACE, project: projectId } } };

function message(params: Record<string, unknown>, method = 'tools/call'): ParsedMessage {
	const parsed = parseMessage(JSON.stringify({ jsonrpc: '2.0', id: 9, method, params }), {
		depth: DISCOVERY_LIMITS.depth,
		workspace: WORKSPACE,
	});
	if ('code' in parsed) throw new Error(`parse refused: ${(parsed as RelayRefusal).code}`);
	return parsed;
}

const decide = (params: Record<string, unknown>, extra?: Partial<DecideContext>) =>
	decideMessage(message(params), context(extra));
const codeOf = (params: Record<string, unknown>, extra?: Partial<DecideContext>) =>
	(decide(params, extra) as RelayRefusal).code;
const forwarded = (params: Record<string, unknown>, extra?: Partial<DecideContext>) => {
	const parsed = message(params);
	const decision = decideMessage(parsed, context(extra));
	if ('code' in decision) throw new Error(`refused: ${decision.code}`);
	return JSON.parse(rebuildMessage(parsed, decision as Decision).body) as {
		params: { name: string; arguments: Record<string, unknown>; _meta?: Record<string, unknown> };
	};
};

describe('P6-E5: the effective command, through the meta-tools and the `grouped` strategy (8.1 step 9)', () => {
	it('P6-E5: exposure by the catalog: the command whose `tool` matches and its computed `expose`, no recomputing', () => {
		expect(decide({ name: 'notes-get', arguments: {} })).toMatchObject({
			kind: 'command',
			command: { tool: 'notes-get' },
			via: 'first-class',
		});
		// `afd-call` naming a hidden mutation, whatever the server would say of it now.
		expect(codeOf({ name: 'afd-call', arguments: { command: 'notes-delete' } })).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
		// A non-first-class command by its bare name.
		expect(codeOf({ name: 'notes-list', arguments: {} })).toBe('MOUNT_COMMAND_NOT_EXPOSED');
		expect(decide({ name: 'afd-call', arguments: { command: 'notes-list' } })).toMatchObject({
			kind: 'command',
			via: 'afd-call',
		});
	});

	it('P6-E5: `afd-call` naming `afd-context-enter`, `afd-call` or `AFD-BATCH`, and `afd-batch`, `afd-pipe`, `afd-discover` by name, each refused', () => {
		for (const named of ['afd-context-enter', 'afd-call', 'AFD-BATCH', 'afd-help', ' afd_pipe'])
			expect(codeOf({ name: 'afd-call', arguments: { command: named } })).toBe(
				'MOUNT_COMMAND_NOT_EXPOSED'
			);
		for (const name of ['afd-batch', 'afd-pipe', 'afd-discover', 'afd-context-list', 'AFD-call'])
			expect(codeOf({ name, arguments: {} })).toBe('MOUNT_COMMAND_NOT_EXPOSED');
	});

	it("P6-E5: a command the entry lets apps alone call (`expose.apps`, phase 5's 7.5) is not exposed through the relay, which sees no app's grant", () => {
		const catalog: InstanceCatalogV1 = {
			...CATALOG,
			commands: [
				command('notes-apps', {
					mutation: true,
					expose: { palette: false, agent: false, apps: true },
				}),
			],
		};
		expect(codeOf({ name: 'afd-call', arguments: { command: 'notes-apps' } }, { catalog })).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
	});

	it('P6-E5: `afd-call` with no or a non-string `command`, or a non-object `input`, REQUEST_INVALID', () => {
		expect(codeOf({ name: 'afd-call', arguments: {} })).toBe('REQUEST_INVALID');
		expect(codeOf({ name: 'afd-call', arguments: { command: 3 } })).toBe('REQUEST_INVALID');
		expect(codeOf({ name: 'afd-call', arguments: { command: 'notes-list', input: 'x' } })).toBe(
			'REQUEST_INVALID'
		);
	});

	it('P6-E5: a `grouped` fixture: `tools/call notes { action: "delete" }` is refused, and so is any group tool', () => {
		const grouped: InstanceCatalogV1 = { ...CATALOG, toolStrategy: 'grouped' };
		expect(codeOf({ name: 'notes', arguments: { action: 'delete' } }, { catalog: grouped })).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
		expect(codeOf({ name: 'notes', arguments: { action: 'delete' } })).toBe(
			'MOUNT_COMMAND_NOT_EXPOSED'
		);
	});

	it("P6-E5: `firstClass` ignored in a catalog whose `toolStrategy` is not `'hybrid'`", () => {
		for (const toolStrategy of ['individual', 'grouped', 'lazy', undefined]) {
			const catalog = {
				...CATALOG,
				...(toolStrategy ? { toolStrategy } : { toolStrategy: undefined }),
			};
			expect(codeOf({ name: 'notes-get', arguments: {} }, { catalog })).toBe(
				'MOUNT_COMMAND_NOT_EXPOSED'
			);
		}
	});

	it('P6-E5: a command absent from the catalog is refused, marked so the route discovers again once', () => {
		expect(decide({ name: 'afd-call', arguments: { command: 'notes-new' } })).toMatchObject({
			code: 'MOUNT_COMMAND_NOT_EXPOSED',
			missing: true,
		});
		expect(decide({ name: 'notes-get', arguments: {} }, { catalog: undefined })).toMatchObject({
			missing: true,
		});
	});
});

describe('P6-E5: discovery and the session at workspace level (8.1 step 10)', () => {
	const discover = (name: string, args: unknown = {}, extra: Record<string, unknown> = {}) =>
		message({ name, arguments: args, ...extra });

	it('P6-E5: `afd-help` and `afd-detail` let through at workspace level, refused with a scope, from `_meta` or `arguments.meta`', () => {
		expect(decideMessage(discover('afd-help', { format: 'full' }), context())).toMatchObject({
			kind: 'discovery',
			tool: 'afd-help',
		});
		expect(
			(decideMessage(discover('afd-help', {}, scoped(ATLAS.id)), context()) as RelayRefusal).code
		).toBe('REQUEST_INVALID');
		expect(
			(
				decideMessage(
					discover('afd-detail', {
						command: 'x',
						meta: { 'dev.loam/scope': { workspace: WORKSPACE, project: ATLAS.id } },
					}),
					context()
				) as RelayRefusal
			).code
		).toBe('REQUEST_INVALID');
	});

	it("P6-E5: `afd-help`'s and `afd-detail`'s arguments rebuilt from their schemas", () => {
		const help = discover('afd-help', { format: 'full', filter: 'n', extra: 1, meta: {} });
		const helped = decideMessage(help, context()) as Decision;
		expect(JSON.parse(rebuildMessage(help, helped).body).params).toEqual({
			name: 'afd-help',
			arguments: { format: 'full', filter: 'n' },
		});
		const detail = discover('afd-detail', { command: ['a', 'b'], other: true });
		expect(
			JSON.parse(rebuildMessage(detail, decideMessage(detail, context()) as Decision).body).params
		).toEqual({
			name: 'afd-detail',
			arguments: { command: ['a', 'b'] },
		});
		expect(
			(decideMessage(discover('afd-help', { format: 'xml' }), context()) as RelayRefusal).code
		).toBe('REQUEST_INVALID');
		expect(
			(
				decideMessage(
					discover('afd-detail', { command: Array(11).fill('a') }),
					context()
				) as RelayRefusal
			).code
		).toBe('REQUEST_INVALID');
	});

	it('P6-E5: a member of a listed project discovers a project-listed instance; a member of none is MOUNT_PROJECT_NOT_LISTED', () => {
		const listed = entry({ projects: ['atlas', 'vault'] });
		expect(decideMessage(discover('afd-help'), context({ entry: listed }))).toMatchObject({
			kind: 'discovery',
		});
		const onlyVault = entry({ projects: ['vault'] });
		expect(
			(decideMessage(discover('afd-help'), context({ entry: onlyVault })) as RelayRefusal).code
		).toBe('MOUNT_PROJECT_NOT_LISTED');
		const ping = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}', {
			depth: 64,
			workspace: WORKSPACE,
		}) as ParsedMessage;
		expect((decideMessage(ping, context({ entry: onlyVault })) as RelayRefusal).code).toBe(
			'MOUNT_PROJECT_NOT_LISTED'
		);
		expect(decideMessage(ping, context({ entry: listed }))).toEqual({ kind: 'workspace' });
	});

	it('P6-E5: a non-member is WORKSPACE_NOT_MEMBER before anything of the catalog is read', () => {
		const outsider = context({ membership: { mode: 'provider', members: new Map(), digest: '' } });
		expect((decideMessage(discover('afd-help'), outsider) as RelayRefusal).code).toBe(
			'WORKSPACE_NOT_MEMBER'
		);
		expect((decideMessage(message({ name: 'nope' }), outsider) as RelayRefusal).code).toBe(
			'WORKSPACE_NOT_MEMBER'
		);
	});
});

describe('P6-E5: a command at its scope, or with none (8.1 step 11)', () => {
	it('P6-E5: access: a restricted project the person is not in is PROJECT_NOT_FOUND, as is an unknown id', () => {
		expect(codeOf({ name: 'notes-get', arguments: {}, ...scoped(VAULT.id) })).toBe(
			'PROJECT_NOT_FOUND'
		);
		expect(codeOf({ name: 'notes-get', arguments: {}, ...scoped('prj_nothing00') })).toBe(
			'PROJECT_NOT_FOUND'
		);
	});

	it('P6-E5: `afd-call` with `meta` scope in a restricted project is PROJECT_NOT_FOUND', () => {
		expect(
			codeOf({
				name: 'afd-call',
				arguments: {
					command: 'notes-list',
					meta: { 'dev.loam/scope': { workspace: WORKSPACE, project: VAULT.id } },
				},
			})
		).toBe('PROJECT_NOT_FOUND');
	});

	it("P6-E5: `unlistedProject` with the effective scope's slug, and with none (11.0)", () => {
		const listed = entry({ projects: ['atlas'] });
		expect(
			codeOf({ name: 'notes-get', arguments: {}, ...scoped(BEACON.id) }, { entry: listed })
		).toBe('MOUNT_PROJECT_NOT_LISTED');
		expect(
			decide({ name: 'notes-get', arguments: {}, ...scoped(ATLAS.id) }, { entry: listed })
		).toMatchObject({
			kind: 'command',
			slug: 'atlas',
		});
		// A member of no listed project, sending a scope-less call to a project-listed instance (11.0).
		expect(
			codeOf({ name: 'notes-get', arguments: {} }, { entry: entry({ projects: ['vault'] }) })
		).toBe('MOUNT_PROJECT_NOT_LISTED');
		// Even a member of a listed project: a scope-less call to a project-listed instance serves no project.
		expect(codeOf({ name: 'notes-get', arguments: {} }, { entry: listed })).toBe(
			'MOUNT_PROJECT_NOT_LISTED'
		);
	});

	it("P6-E5: a member of project A's first-class call with `arguments.meta` set to A and no `_meta` is decided and forwarded at workspace level, with no `dev.loam/scope`", () => {
		const sent = forwarded({
			name: 'notes-get',
			arguments: { meta: { 'dev.loam/scope': { workspace: WORKSPACE, project: ATLAS.id } } },
		});
		expect(sent.params._meta).toBeUndefined();
		expect(sent.params.arguments).toEqual({
			command: 'notes-get',
			input: { meta: { 'dev.loam/scope': { workspace: WORKSPACE, project: ATLAS.id } } },
		});
	});

	it("P6-E5: a page's input holding `code` and `status` is input, never a refusal: decided and forwarded whole (the trust review)", () => {
		const input = { code: 'UNAUTHORIZED', status: 401, text: 'x' };
		expect(decide({ name: 'afd-call', arguments: { command: 'notes-list', input } })).toMatchObject(
			{
				kind: 'command',
				input,
			}
		);
		expect(forwarded({ name: 'notes-get', arguments: input }).params.arguments).toEqual({
			command: 'notes-get',
			input,
		});
		const pinned = { entry: entry({ space: { atlas: 'main' } }) };
		expect(
			decide(
				{ name: 'afd-call', arguments: { command: 'notes-list', input }, ...scoped(ATLAS.id) },
				pinned
			)
		).toMatchObject({ kind: 'command', input: { ...input, space: 'main' } });
	});

	it('P6-E5: a mutation under an archived project is PROJECT_ARCHIVED; a read there passes', () => {
		const archived = { ...ATLAS, status: 'archived' as const };
		const catalog: InstanceCatalogV1 = {
			...CATALOG,
			commands: [...CATALOG.commands, command('notes-write', { mutation: true })],
		};
		const extra = { projects: [archived, BEACON, VAULT], catalog };
		expect(
			codeOf(
				{ name: 'afd-call', arguments: { command: 'notes-write' }, ...scoped(ATLAS.id) },
				extra
			)
		).toBe('PROJECT_ARCHIVED');
		expect(
			decide({ name: 'afd-call', arguments: { command: 'notes-list' }, ...scoped(ATLAS.id) }, extra)
		).toMatchObject({ kind: 'command' });
	});

	it('P6-E5: the pinned space and the forwarded arguments rewritten, the slug (not the id) given to `pinMountedInput`', () => {
		const pinned = entry({ space: { atlas: 'main' } });
		const sent = forwarded(
			{
				name: 'afd-call',
				arguments: { command: 'notes-list', input: { text: 'x' } },
				...scoped(ATLAS.id),
			},
			{ entry: pinned }
		);
		expect(sent.params.arguments).toEqual({
			command: 'notes-list',
			input: { text: 'x', space: 'main' },
		});
		expect(sent.params._meta).toEqual({
			'dev.loam/scope': { workspace: WORKSPACE, project: ATLAS.id },
		});
		expect(
			codeOf(
				{
					name: 'afd-call',
					arguments: { command: 'notes-list', input: { space: 'other' } },
					...scoped(ATLAS.id),
				},
				{ entry: pinned }
			)
		).toBe('MOUNT_SPACE_PINNED');
		// Another project of the same instance is not pinned.
		expect(
			forwarded(
				{
					name: 'afd-call',
					arguments: { command: 'notes-list', input: { space: 'other' } },
					...scoped(BEACON.id),
				},
				{ entry: pinned }
			).params.arguments
		).toEqual({ command: 'notes-list', input: { space: 'other' } });
	});

	it("P6-E5: the pin's allow-list in a pinned project: a nested `target.space`, a `Space` variant, a root `if`/`then` and a root `oneOf` each MOUNT_SPACE_PINNED", () => {
		const pinned = { entry: entry({ space: { atlas: 'main' } }) };
		const via = (tool: string, input: Record<string, unknown>) =>
			codeOf(
				{ name: 'afd-call', arguments: { command: tool, input }, ...scoped(ATLAS.id) },
				pinned
			);
		expect(via('notes-nested', { target: { space: 'other' } })).toBe('MOUNT_SPACE_PINNED');
		expect(via('notes-list', { Space: 'other' })).toBe('MOUNT_SPACE_PINNED');
		expect(via('notes-list', { text: { deep: [{ SPACES: ['x'] }] } })).toBe('MOUNT_SPACE_PINNED');
		expect(via('notes-branch', {})).toBe('MOUNT_SPACE_PINNED');
		expect(via('notes-union', {})).toBe('MOUNT_SPACE_PINNED');
		// A schema with no `space` cannot take one from the input: the pin did not set it.
		expect(via('notes-free', { space: 'main' })).toBe('MOUNT_SPACE_PINNED');
		// What the relay cannot read as names fails closed: a schema discovery replaced, a pattern, a reference.
		const unreadable = (extra: Partial<CatalogCommandV1>) =>
			codeOf(
				{ name: 'afd-call', arguments: { command: 'notes-odd', input: {} }, ...scoped(ATLAS.id) },
				{ ...pinned, catalog: { ...CATALOG, commands: [command('notes-odd', extra)] } }
			);
		expect(unreadable({ inputSchema: { type: 'object' }, replaced: true })).toBe(
			'MOUNT_SPACE_PINNED'
		);
		expect(
			unreadable({
				inputSchema: {
					type: 'object',
					properties: { target: { type: 'object', patternProperties: { '^s.*e$': {} } } },
				},
			})
		).toBe('MOUNT_SPACE_PINNED');
		expect(
			unreadable({
				inputSchema: {
					type: 'object',
					properties: { target: { $ref: '#/$defs/t' } },
					$defs: { t: {} },
				},
			})
		).toBe('MOUNT_SPACE_PINNED');
		// Outside a pinned project, none of them is refused for it.
		expect(
			decide(
				{ name: 'afd-call', arguments: { command: 'notes-odd', input: {} }, ...scoped(BEACON.id) },
				{ ...pinned, catalog: { ...CATALOG, commands: [command('notes-odd', { replaced: true })] } }
			)
		).toMatchObject({ kind: 'command' });
	});

	it('P6-E5: with the input leaving the field out, a schema declaring `properties.target.properties.space`, and one with a top-level `spaces` and no `space`, each MOUNT_SPACE_PINNED; a plain object schema with the pinned top-level `space` passes', () => {
		const pinned = { entry: entry({ space: { atlas: 'main' } }) };
		const via = (tool: string) =>
			decide(
				{ name: 'afd-call', arguments: { command: tool, input: {} }, ...scoped(ATLAS.id) },
				pinned
			);
		expect((via('notes-nested') as RelayRefusal).code).toBe('MOUNT_SPACE_PINNED');
		expect((via('notes-spaces') as RelayRefusal).code).toBe('MOUNT_SPACE_PINNED');
		expect(via('notes-list')).toMatchObject({ kind: 'command', input: { space: 'main' } });
		expect(via('notes-free')).toMatchObject({ kind: 'command', input: {} });
	});
});

describe('P6-E5: the rebuilt message (8.1 steps 12 to 14)', () => {
	it("P6-E5: a first-class tool's top-level `confirm` dropped; one whose schema declares `confirm` forwarded as `afd-call { command: tool, input: arguments }`, with no acknowledgement", () => {
		// Every command leaves as `afd-call` with its exact name, so a strategy changed since discovery routes nothing else.
		expect(
			forwarded({ name: 'notes-get', arguments: { confirm: true, text: 'x' } }).params
		).toEqual({
			name: 'afd-call',
			arguments: { command: 'notes-get', input: { text: 'x' } },
		});
		expect(forwarded({ name: 'notes-confirmed', arguments: { confirm: true } }).params).toEqual({
			name: 'afd-call',
			arguments: { command: 'notes-confirmed', input: { confirm: true } },
		});
	});

	it("P6-E5: `afd-call`'s `meta` and `confirm` dropped, with every other argument", () => {
		expect(
			forwarded({
				name: 'afd-call',
				arguments: {
					command: 'notes-list',
					input: { text: 'x' },
					confirm: true,
					meta: {},
					extra: 1,
				},
			}).params
		).toEqual({ name: 'afd-call', arguments: { command: 'notes-list', input: { text: 'x' } } });
	});

	it("P6-E5: a page's `params.task`, `inputResponses`, `requestState`, extra fields and every `_meta` key but those named never reach the instance", () => {
		const sent = forwarded({
			name: 'notes-get',
			arguments: {},
			task: { ttl: 1 },
			inputResponses: {},
			requestState: 'x',
			extra: true,
			_meta: {
				'dev.afd/confirm': true,
				'dev.afd/outputBudget': 10,
				traceparent: '00-x',
				tracestate: 'x',
				'io.modelcontextprotocol/related-task': {},
				progressToken: 'p',
			},
		}) as unknown as { params: Record<string, unknown> };
		expect(Object.keys(sent.params).sort()).toEqual(['_meta', 'arguments', 'name']);
		expect(sent.params._meta).toEqual({ progressToken: 'p' });
	});

	it("P6-E5: `initialize`'s capabilities replaced, and `server/discover` decided at workspace level with `clientCapabilities` replaced and the modern keys kept", () => {
		const init = parseMessage(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-11-25',
					clientInfo: { name: 'loam', version: '1' },
					capabilities: { sampling: {}, roots: {} },
					_meta: { traceparent: 'x' },
				},
			}),
			{ depth: 64, workspace: WORKSPACE }
		) as ParsedMessage;
		expect(JSON.parse(rebuildMessage(init, { kind: 'workspace' }).body)).toEqual({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-11-25',
				clientInfo: { name: 'loam', version: '1' },
				capabilities: {},
			},
		});
		const discover = parseMessage(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'server/discover',
				params: {
					extra: 1,
					_meta: {
						'io.modelcontextprotocol/protocolVersion': '2026-07-28',
						'io.modelcontextprotocol/clientInfo': { name: 'loam', version: '1' },
						'io.modelcontextprotocol/clientCapabilities': { sampling: {} },
						'io.modelcontextprotocol/other': 1,
					},
				},
			}),
			{ depth: 64, workspace: WORKSPACE }
		) as ParsedMessage;
		expect(decideMessage(discover, context())).toEqual({ kind: 'workspace' });
		const rebuilt = rebuildMessage(discover, { kind: 'workspace' });
		expect(JSON.parse(rebuilt.body).params).toEqual({
			_meta: {
				'io.modelcontextprotocol/protocolVersion': '2026-07-28',
				'io.modelcontextprotocol/clientInfo': { name: 'loam', version: '1' },
				'io.modelcontextprotocol/clientCapabilities': {},
			},
		});
		expect(requestHeaders({ rebuilt })['mcp-protocol-version']).toBe('2026-07-28');
	});

	it("P6-E5: the relay's headers come from the rebuilt message, with the deployer's bearer, and none of the page's", () => {
		const parsed = message({ name: 'notes-confirmed', arguments: {} });
		const rebuilt = rebuildMessage(parsed, decideMessage(parsed, context()) as Decision);
		expect(requestHeaders({ rebuilt, bearer: 'tok' })).toEqual({
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'accept-encoding': 'identity',
			'mcp-method': 'tools/call',
			'mcp-name': 'afd-call',
			authorization: 'Bearer tok',
		});
		// A legacy session's own version and id; a stateless instance's version only when the SDK supports it.
		expect(
			requestHeaders({ rebuilt, session: { id: 's1', protocolVersion: '2025-06-18' } })
		).toMatchObject({ 'mcp-session-id': 's1', 'mcp-protocol-version': '2025-06-18' });
		expect(
			requestHeaders({ rebuilt, statelessVersion: '2025-11-25' })['mcp-protocol-version']
		).toBe('2025-11-25');
	});

	it('P6-E5: an `initialize` is forwarded with no `Mcp-Session-Id`', () => {
		const init = parseMessage(
			'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","clientInfo":{"name":"l","version":"1"}}}',
			{ depth: 64, workspace: WORKSPACE }
		) as ParsedMessage;
		const headers = requestHeaders({
			rebuilt: rebuildMessage(init, { kind: 'workspace' }),
			session: { id: 's1', protocolVersion: '2025-11-25' },
		});
		expect(headers['mcp-session-id']).toBeUndefined();
	});
});
