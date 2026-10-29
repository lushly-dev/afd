/**
 * @module openapi
 * The hosted API's OpenAPI document, shared by the API (`packages/api`) and
 * `violet api spec` so the two cannot drift.
 */

/**
 * Formats served by GET /api/v1/export/{nodeId}/{format} (`ts` is an alias of
 * typescript). The API routes, the OpenAPI spec and the CLI's sync workflow
 * template all read this list.
 */
export const HOSTED_EXPORT_FORMATS = [
	'json',
	'css',
	'scss',
	'typescript',
	'swift',
	'kotlin',
	'dart',
] as const;

export type HostedExportFormat = (typeof HOSTED_EXPORT_FORMATS)[number];

/** Where `pnpm api:dev` (`vercel dev`) serves the /api/v1 routes. */
export const LOCAL_API_SERVER = {
	url: 'http://localhost:3000',
	description: 'Local development (vercel dev)',
} as const;

export interface OpenApiServer {
	url: string;
	description: string;
}

export interface OpenApiSpecOptions {
	/** A deployment serving these routes, listed before the local server. Pass a normalized URL. */
	deploymentUrl?: string;
	/** Description of the deployment entry. */
	deploymentDescription?: string;
}

/** The local `vercel dev` server, plus the deployment when one is given. */
function servers(options: OpenApiSpecOptions): OpenApiServer[] {
	const list: OpenApiServer[] = [{ ...LOCAL_API_SERVER }];
	if (options.deploymentUrl) {
		list.unshift({
			url: options.deploymentUrl,
			description: options.deploymentDescription ?? 'Deployment',
		});
	}
	return list;
}

/** Paths outside auth and rate limiting. */
const PUBLIC_PATHS = new Set(['/api/v1/health']);

/**
 * OpenAPI specification for the hosted Violet API (`/api/v1`). The API serves
 * it at /api/v1/openapi and `violet api spec` prints it. Every authenticated
 * operation is rate limited, so each one lists the shared 429 response.
 */
export function buildOpenApiSpec(options: OpenApiSpecOptions = {}) {
	const spec = baseSpec(options);
	for (const [path, operations] of Object.entries(spec.paths)) {
		if (PUBLIC_PATHS.has(path)) continue;
		for (const operation of Object.values(operations) as { responses: object }[]) {
			operation.responses = {
				...operation.responses,
				'429': { $ref: '#/components/responses/RateLimited' },
			};
		}
	}
	return spec;
}

function baseSpec(options: OpenApiSpecOptions) {
	return {
		openapi: '3.1.0',
		info: {
			title: 'Violet Design API',
			version: '1.0.0',
			description:
				'Hierarchical design token management API. Wraps Violet core commands as REST endpoints.',
			contact: {
				name: 'Violet Design Team',
			},
			license: {
				name: 'MIT',
			},
		},
		servers: servers(options),
		tags: [
			{ name: 'nodes', description: 'Node management' },
			{ name: 'tokens', description: 'Token operations' },
			{ name: 'export', description: 'Token export' },
			{ name: 'analyze', description: 'Analysis and compliance' },
			{ name: 'audit', description: 'Audit log of changes' },
			{ name: 'system', description: 'Health and metadata' },
		],
		paths: {
			'/api/v1/health': {
				get: {
					tags: ['system'],
					summary: 'Health check',
					responses: {
						'200': {
							description: 'API is healthy, or degraded with configuration warnings',
							content: {
								'application/json': {
									schema: {
										$ref: '#/components/schemas/HealthResponse',
									},
								},
							},
						},
						'503': {
							description: 'Required hosted configuration is missing (status: misconfigured)',
							content: {
								'application/json': {
									schema: {
										$ref: '#/components/schemas/HealthResponse',
									},
								},
							},
						},
					},
				},
			},
			'/api/v1/nodes': {
				get: {
					tags: ['nodes'],
					summary: 'List all nodes',
					parameters: [
						{ name: 'parent', in: 'query', schema: { type: 'string' } },
						{ name: 'type', in: 'query', schema: { type: 'string' } },
						{ name: 'status', in: 'query', schema: { type: 'string' } },
						{
							name: 'view',
							in: 'query',
							schema: { type: 'string', enum: ['flat', 'tree'] },
						},
					],
					responses: {
						'200': { description: 'List of nodes' },
					},
				},
				post: {
					tags: ['nodes'],
					summary: 'Create a node',
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/CreateNodeInput' },
							},
						},
					},
					responses: {
						'201': { description: 'Node created' },
						'400': { description: 'Validation error' },
					},
				},
			},
			'/api/v1/nodes/graph': {
				get: {
					tags: ['nodes'],
					summary: 'The node hierarchy as a graph',
					description:
						"Nodes with parent, include and copy edges, per-node change counts by operation type and category, the token ids each node subtracts (subtractedTokens), and owners. Include and copy sources outside a root subtree are returned as external nodes. For one node's operations, use /api/v1/nodes/{id}?ops=true.",
					parameters: [
						{
							name: 'root',
							in: 'query',
							description: 'Subtree root (inclusive); defaults to every tree',
							schema: { type: 'string' },
						},
						{
							name: 'token',
							in: 'query',
							description: 'Exact token ID to trace: where it is set, overridden or removed',
							schema: { type: 'string' },
						},
						{
							name: 'ops',
							in: 'query',
							description:
								"Include each node's own operations (large on a big system; /api/v1/nodes/{id}?ops=true fetches one node's)",
							schema: { type: 'boolean' },
						},
					],
					responses: {
						'200': { description: 'Node graph' },
						'404': { description: 'Root node not found' },
					},
				},
			},
			'/api/v1/nodes/{id}': {
				get: {
					tags: ['nodes'],
					summary: 'Get a node by ID',
					parameters: [
						{
							name: 'id',
							in: 'path',
							required: true,
							schema: { type: 'string' },
						},
						{ name: 'ancestry', in: 'query', schema: { type: 'boolean' } },
						{
							name: 'ops',
							in: 'query',
							description:
								"Include the node's own operations in data.operations, in the same shape as /api/v1/nodes/graph?ops=true",
							schema: { type: 'boolean' },
						},
					],
					responses: {
						'200': { description: 'Node details' },
						'404': { description: 'Node not found' },
					},
				},
				patch: {
					tags: ['nodes'],
					summary: 'Update a node',
					parameters: [
						{
							name: 'id',
							in: 'path',
							required: true,
							schema: { type: 'string' },
						},
					],
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/UpdateNodeInput' },
							},
						},
					},
					responses: {
						'200': { description: 'Node updated' },
						'404': { description: 'Node not found' },
					},
				},
				delete: {
					tags: ['nodes'],
					summary: 'Delete a node',
					parameters: [
						{
							name: 'id',
							in: 'path',
							required: true,
							schema: { type: 'string' },
						},
						{ name: 'reason', in: 'query', schema: { type: 'string' } },
						{ name: 'force', in: 'query', schema: { type: 'boolean' } },
					],
					responses: {
						'200': { description: 'Node deleted' },
						'404': { description: 'Node not found' },
						'409': { description: 'Node has children' },
					},
				},
			},
			'/api/v1/nodes/{id}/tokens': {
				get: {
					tags: ['tokens'],
					summary: 'Get resolved tokens for a node',
					parameters: [
						{
							name: 'id',
							in: 'path',
							required: true,
							schema: { type: 'string' },
						},
						{ name: 'filter', in: 'query', schema: { type: 'string' } },
					],
					responses: {
						'200': { description: 'Resolved tokens' },
						'404': { description: 'Node not found' },
					},
				},
				post: {
					tags: ['tokens'],
					summary: 'Add a token to a node',
					parameters: [
						{
							name: 'id',
							in: 'path',
							required: true,
							schema: { type: 'string' },
						},
					],
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/AddTokenInput' },
							},
						},
					},
					responses: {
						'201': { description: 'Token added' },
						'400': { description: 'Validation error' },
					},
				},
			},
			'/api/v1/nodes/{id}/specimen': {
				get: {
					tags: ['tokens'],
					summary: "The specimen role map of a node's tree, and which roles draw on the node",
					description:
						"Runs `specimen.get`. The map (`{ component: { role: tokenId } }`) is stored once per tree, on its root; `stored` is false when there is none and the naming convention `<component>.<role>` applies. For each component the Specimens view draws (button, input, card), every role lists the token that draws it on this node, whether it comes from the `map` or the `convention`, whether it `resolves` here and whether its value passes the role's CSS validator (`valid`). Needs the `tokens:read` scope.",
					parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
					responses: {
						'200': { description: 'The map and each component role on the node' },
						'404': { description: 'Node not found' },
					},
				},
				put: {
					tags: ['tokens'],
					summary: "Map component roles to tokens on the root of a node's tree",
					description:
						'Runs `specimen.set`. Merges into the stored map unless `replace` is true; a null token removes a role, and an empty map removes the record. Components and roles must be ones the Specimens view draws, and every token must be defined in the tree or a node it mixes in. Needs the `tokens:write` scope.',
					parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/SpecimenMapInput' },
							},
						},
					},
					responses: {
						'200': { description: 'The stored map and the roles that changed' },
						'400': { description: 'Unknown component or role' },
						'404': { description: 'Node or token not found' },
					},
				},
			},
			'/api/v1/tokens/catalog': {
				get: {
					tags: ['tokens'],
					summary: 'Find tokens and see where each is customized or removed',
					parameters: [
						{ name: 'q', in: 'query', schema: { type: 'string' } },
						{ name: 'root', in: 'query', schema: { type: 'string' } },
						{
							name: 'category',
							in: 'query',
							schema: {
								type: 'string',
								enum: [
									'color',
									'spacing',
									'typography',
									'shadow',
									'motion',
									'radius',
									'opacity',
									'z-index',
									'custom',
								],
							},
						},
						{
							name: 'tier',
							in: 'query',
							schema: { type: 'string', enum: ['global', 'semantic', 'component'] },
						},
						{
							name: 'status',
							in: 'query',
							schema: { type: 'string', enum: ['stable', 'beta', 'deprecated'] },
						},
						{ name: 'sort', in: 'query', schema: { type: 'string', enum: ['id', 'customized'] } },
						{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5000 } },
					],
					responses: {
						'200': { description: 'Matching tokens with metadata and customization counts' },
						'400': { description: 'Validation error' },
						'404': { description: 'Root node not found' },
					},
				},
			},
			'/api/v1/tokens/matrix': {
				get: {
					tags: ['tokens'],
					summary: 'Resolve tokens across many nodes (token × node matrix)',
					description:
						'Each cell reports the value, state (add, override, copy, reset, include, inherited, subtracted, absent, unresolved) and source node. Use either root or nodes, not both; with neither, every node is included.',
					parameters: [
						{
							name: 'root',
							in: 'query',
							description: 'Subtree root (inclusive)',
							schema: { type: 'string' },
						},
						{
							name: 'nodes',
							in: 'query',
							description: 'Comma-separated node IDs, in column order',
							schema: { type: 'string' },
						},
						{
							name: 'filter',
							in: 'query',
							description: 'Glob pattern like "color.*"',
							schema: { type: 'string' },
						},
						{
							name: 'category',
							in: 'query',
							description: 'Only tokens of this category (from their metadata)',
							schema: {
								type: 'string',
								enum: [
									'color',
									'spacing',
									'typography',
									'shadow',
									'motion',
									'radius',
									'opacity',
									'z-index',
									'custom',
								],
							},
						},
						{
							name: 'varying',
							in: 'query',
							description: 'Only tokens whose value differs across nodes',
							schema: { type: 'boolean' },
						},
						{
							name: 'violations',
							in: 'query',
							description: 'Include constraint violations per cell',
							schema: { type: 'boolean' },
						},
						{
							name: 'issues',
							in: 'query',
							description: 'Only tokens with a constraint violation (implies violations)',
							schema: { type: 'boolean' },
						},
						{
							name: 'group',
							in: 'query',
							description:
								'Order rows by category or tier and return per-group counts in data.groups',
							schema: { type: 'string', enum: ['category', 'tier'] },
						},
						{
							name: 'sort',
							in: 'query',
							description:
								'Token id order, within each group when grouping (groups stay ascending)',
							schema: { type: 'string', enum: ['token-asc', 'token-desc'], default: 'token-asc' },
						},
						{
							name: 'summary',
							in: 'query',
							description:
								'Leave out rows: return nodes, summary and (with group) groups, to load one category at a time',
							schema: { type: 'boolean' },
						},
						{
							name: 'limit',
							in: 'query',
							description:
								'Rows per page; data.page.nextCursor continues, data.page.prevCursor goes back and data.page.offset counts the rows before the page. summary and groups count every matching row; cells are built only for the page',
							schema: { type: 'integer', minimum: 1, maximum: 5000 },
						},
						{
							name: 'cursor',
							in: 'query',
							description:
								'data.page.nextCursor (or prevCursor) from another page, with the same group and sort',
							schema: { type: 'string' },
						},
						{
							name: 'around',
							in: 'query',
							description:
								'With limit (and no cursor): return the page holding this token id, at the offset paging from the first page reaches it. 404 TOKEN_NOT_FOUND when it is not among the matching rows',
							schema: { type: 'string' },
						},
					],
					responses: {
						'200': { description: 'Token matrix' },
						'400': {
							description:
								'Validation error (e.g. both root and nodes, a bad cursor, or around without limit)',
						},
						'404': { description: 'Node not found, or the around token has no matching row' },
					},
				},
			},
			'/api/v1/tokens/compare': {
				get: {
					tags: ['tokens'],
					summary: 'Compare 2–4 nodes token by token',
					description:
						"One row per token with each node's cell (value with references followed, state and source) and `differs` against the first node, the baseline. Without all, only tokens that differ are returned; data.summary counts every compared token per category and gives each pair of nodes a similarity (0–100).",
					parameters: [
						{
							name: 'nodes',
							in: 'query',
							required: true,
							description:
								'Comma-separated node IDs (2–4), in column order; the first is the baseline',
							schema: { type: 'string' },
						},
						{
							name: 'filter',
							in: 'query',
							description: 'Glob pattern like "color.*"',
							schema: { type: 'string' },
						},
						{
							name: 'category',
							in: 'query',
							description: 'Only tokens of this category (from their metadata)',
							schema: {
								type: 'string',
								enum: [
									'color',
									'spacing',
									'typography',
									'shadow',
									'motion',
									'radius',
									'opacity',
									'z-index',
									'custom',
								],
							},
						},
						{
							name: 'all',
							in: 'query',
							description: 'Include tokens that are the same on every node',
							schema: { type: 'boolean' },
						},
					],
					responses: {
						'200': { description: 'Tokens side by side, with what differs' },
						'400': {
							description: 'Validation error (fewer than 2, more than 4 or repeated nodes)',
						},
						'404': { description: 'Node not found' },
					},
				},
			},
			'/api/v1/analyze/violations': {
				get: {
					tags: ['analyze'],
					summary: 'Every constraint violation across a subtree',
					parameters: [
						{ name: 'root', in: 'query', schema: { type: 'string' } },
						{
							name: 'severity',
							in: 'query',
							schema: { type: 'string', enum: ['error', 'warning', 'info'] },
						},
					],
					responses: {
						'200': { description: 'Violations with node, token, rule, values, source and owner' },
						'400': { description: 'Validation error' },
						'404': { description: 'Root node not found' },
					},
				},
			},
			'/api/v1/analyze/health': {
				get: {
					tags: ['analyze'],
					summary:
						'Health per node: customizations, drift, violations, owner, coupling and risk flags',
					description:
						"For each node in a subtree: its own customizations by category, drift (share of resolved tokens that differ from a baseline), violations by severity, owner, status, coupling (mix-ins, borrows and borrowers) and subtree totals, with flags for redundant overrides, sibling borrows and deprecated nodes that still have children. Deprecated nodes report their plan (`deprecation`: sunset date, days left, replacement and its status, usage), flagged when a date has no replacement, the replacement is deprecated or gone, or the node is kept past its sunset; `summary.sunsets` lists the dates soonest first. The baseline is 'parent' (default), 'root', or a node id.",
					parameters: [
						{ name: 'root', in: 'query', schema: { type: 'string' } },
						{
							name: 'baseline',
							in: 'query',
							description: "'parent' (default), 'root', or a node id to measure drift against",
							schema: { type: 'string' },
						},
						{
							name: 'sort',
							in: 'query',
							schema: {
								type: 'string',
								enum: ['tree', 'drift', 'violations', 'customizations'],
							},
						},
						{
							name: 'violations',
							in: 'query',
							description: 'false skips the constraint checks',
							schema: { type: 'boolean' },
						},
					],
					responses: {
						'200': { description: 'Health rows per node, flags and per-owner totals' },
						'400': { description: 'Validation error' },
						'404': { description: 'Root or baseline node not found' },
					},
				},
			},
			'/api/v1/analyze/trends': {
				get: {
					tags: ['analyze'],
					summary: 'Changes per day and open rule issues by the day their value was set',
					description:
						'For a node and its descendants (or every node): audit events per UTC day, token changes among them, and the rule issues open now spread over the days their failing values were last set, with a running count. The audit log records changes, not past check results, so an issue fixed since is not counted on earlier days. Days with a rule check recorded by POST /analyze/snapshots carry its true count (`recorded`, cut to the subtree), and `summary.history` counts the issues that appeared and were fixed from one recorded check to the next. The range is 1–366 days and defaults to the last 90.',
					parameters: [
						{ name: 'root', in: 'query', schema: { type: 'string' } },
						{
							name: 'since',
							in: 'query',
							description: 'ISO date or time, or a span back from now (30d, 12h, 2w); default 90d',
							schema: { type: 'string' },
						},
						{
							name: 'until',
							in: 'query',
							description: 'Same forms, exclusive; default now',
							schema: { type: 'string' },
						},
						{
							name: 'violations',
							in: 'query',
							description: 'false skips dating the open rule issues',
							schema: { type: 'boolean' },
						},
						{
							name: 'history',
							in: 'query',
							description: 'false skips the rule checks recorded with POST /analyze/snapshots',
							schema: { type: 'boolean' },
						},
					],
					responses: {
						'200': { description: 'Every day in the range with changes and open issues' },
						'400': { description: 'Unreadable time, or a range outside 1–366 days' },
						'404': { description: 'Root node not found' },
					},
				},
			},
			'/api/v1/analyze/snapshots': {
				post: {
					tags: ['analyze'],
					summary: 'Check the rules on a subtree and store the results',
					description:
						'Runs `analyze.snapshot` on the node and its descendants (`?root`), or every tree, and stores the open rule issues with the time. `/analyze/trends` reads them back as `recorded` per day and `summary.history`, so issues fixed since are counted on the days they were open. Run it on a schedule. Returns the stored counts and, against the previous snapshot of the same subtree, how many issues are new and how many were fixed. Needs the `analyze:read` and `analyze:write` scopes.',
					parameters: [{ name: 'root', in: 'query', schema: { type: 'string' } }],
					responses: {
						'201': { description: 'The snapshot and the change since the previous one' },
						'403': { description: 'The key lacks analyze:write' },
						'404': { description: 'Root node not found' },
					},
				},
			},
			'/api/v1/analyze/impact': {
				post: {
					tags: ['analyze'],
					summary: 'Preview token changes on a node without writing them',
					description:
						'Dry-runs add, override, subtract and reset changes on a read-only overlay. Reports every node the change reaches (via inheritance, include or copy) with before → after cells, its effect (changes, added, removed, shielded, unaffected, unresolved), introduced and resolved constraint violations, and the CLI commands that would apply the change. Nothing is written.',
					requestBody: {
						required: true,
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/ImpactInput' } },
						},
					},
					responses: {
						'200': { description: 'Affected nodes, effects, violations and apply commands' },
						'400': { description: 'Validation error, or a change the mutation command rejects' },
						'404': { description: 'Node or token not found' },
					},
				},
			},
			'/api/v1/audit': {
				get: {
					tags: ['audit'],
					summary: 'Query the audit log, with counts per day',
					description:
						'Events newest first, filtered by node (optionally with its descendants), token, event type, actor and time range, paged with limit and offset. `days` counts every match per UTC day, not only the page. Needs the `audit:read` scope.',
					parameters: [
						{ name: 'node', in: 'query', schema: { type: 'string' } },
						{
							name: 'subtree',
							in: 'query',
							description: "Also events on the node's descendants",
							schema: { type: 'boolean' },
						},
						{ name: 'token', in: 'query', schema: { type: 'string' } },
						{
							name: 'type',
							in: 'query',
							description: 'Event types, comma-separated (e.g. token_updated,token_deleted)',
							schema: { type: 'string' },
						},
						{ name: 'actor', in: 'query', schema: { type: 'string' } },
						{
							name: 'since',
							in: 'query',
							description: 'Inclusive: an ISO date or time, or a span back from now (30d, 12h, 2w)',
							schema: { type: 'string' },
						},
						{
							name: 'until',
							in: 'query',
							description: 'Exclusive, in the same forms as since',
							schema: { type: 'string' },
						},
						{
							name: 'limit',
							in: 'query',
							schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
						},
						{ name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
					],
					responses: {
						'200': { description: 'Events, per-day counts, totals and the next page offset' },
						'400': { description: 'Validation error (e.g. an unreadable since)' },
						'403': { description: 'API key lacks audit:read' },
						'404': { description: 'Node not found (with subtree=true)' },
					},
				},
			},
			'/api/v1/export/{nodeId}/{format}': {
				get: {
					tags: ['export'],
					summary: 'Export tokens in specified format',
					description:
						'Runs the same core `export` command as `violet cicd export` and returns `{ success, data: { format, content, tokenCount, nodeId } }`. `ts` is an alias of `typescript`. Needs the `export:read` scope.',
					parameters: [
						{
							name: 'nodeId',
							in: 'path',
							required: true,
							schema: { type: 'string' },
						},
						{
							name: 'format',
							in: 'path',
							required: true,
							schema: {
								type: 'string',
								enum: [...HOSTED_EXPORT_FORMATS],
							},
						},
						{ name: 'filter', in: 'query', schema: { type: 'string' } },
						{ name: 'prefix', in: 'query', schema: { type: 'string' } },
					],
					responses: {
						'200': { description: 'Exported tokens in data.content' },
						'403': { description: 'API key lacks export:read' },
						'404': { description: 'Node not found, or a format the API does not serve' },
					},
				},
			},
		},
		components: {
			responses: {
				RateLimited: {
					description:
						'Rate limit exceeded (error code RATE_LIMITED). Wait Retry-After seconds before retrying.',
					headers: {
						'Retry-After': {
							description: 'Seconds until the window resets',
							schema: { type: 'integer' },
						},
						'X-RateLimit-Limit': { schema: { type: 'integer' } },
						'X-RateLimit-Remaining': { schema: { type: 'integer' } },
						'X-RateLimit-Reset': {
							description: 'Unix time (seconds) when the window resets',
							schema: { type: 'integer' },
						},
					},
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/CommandResult' },
							example: {
								success: false,
								error: {
									code: 'RATE_LIMITED',
									message: 'Rate limit exceeded. Try again in 42 seconds.',
								},
								meta: { requestId: 'req_123' },
							},
						},
					},
				},
			},
			securitySchemes: {
				ApiKeyAuth: {
					type: 'apiKey',
					in: 'header',
					name: 'X-API-Key',
				},
			},
			schemas: {
				HealthResponse: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						data: {
							type: 'object',
							properties: {
								status: { type: 'string', enum: ['healthy', 'degraded', 'misconfigured'] },
								version: { type: 'string' },
								commands: { type: 'number' },
								timestamp: { type: 'string', format: 'date-time' },
								environment: { type: 'string' },
								storage: { type: 'string', enum: ['neon', 'memory', 'unavailable'] },
								corsOrigins: { type: 'number' },
								issues: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											severity: { type: 'string', enum: ['error', 'warning'] },
											variable: { type: 'string' },
											message: { type: 'string' },
										},
									},
								},
							},
						},
					},
				},
				CreateNodeInput: {
					type: 'object',
					required: ['name'],
					properties: {
						name: { type: 'string', minLength: 1, maxLength: 100 },
						parentId: { type: 'string' },
						type: {
							type: 'string',
							enum: [
								'root',
								'product',
								'platform',
								'device',
								'locale',
								'theme',
								'experiment',
								'shared',
								'custom',
							],
						},
						description: { type: 'string' },
						tags: { type: 'array', items: { type: 'string' } },
						includes: { type: 'array', items: { type: 'string' } },
						status: { type: 'string', enum: ['active', 'deprecated', 'experimental'] },
						sunsetAt: {
							type: 'string',
							format: 'date',
							description: 'The day a deprecated node goes away (YYYY-MM-DD)',
						},
						replacedBy: { type: 'string', description: 'The node that replaces it' },
					},
				},
				UpdateNodeInput: {
					type: 'object',
					properties: {
						name: { type: 'string', minLength: 1 },
						type: { type: 'string' },
						owner: { type: 'string' },
						status: {
							type: 'string',
							enum: ['active', 'deprecated', 'experimental'],
						},
						sunsetAt: {
							type: ['string', 'null'],
							format: 'date',
							description: 'The day a deprecated node goes away (YYYY-MM-DD); null clears it',
						},
						replacedBy: {
							type: ['string', 'null'],
							description: 'The node that replaces it; null clears it',
						},
						tags: { type: 'array', items: { type: 'string' } },
						includes: { type: 'array', items: { type: 'string' } },
						includePolicy: { type: 'string', enum: ['merge', 'override'] },
					},
				},
				SpecimenMapInput: {
					type: 'object',
					required: ['map'],
					properties: {
						map: {
							type: 'object',
							description:
								'{ component: { role: tokenId } }, e.g. { "button": { "background": "btn.bg" } }; a null token removes the role',
							additionalProperties: {
								type: 'object',
								additionalProperties: { type: ['string', 'null'] },
							},
						},
						replace: { type: 'boolean', description: 'Replace the stored map instead of merging' },
					},
				},
				AddTokenInput: {
					type: 'object',
					required: ['token', 'value'],
					properties: {
						token: { type: 'string', minLength: 1 },
						value: {
							oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'object' }],
						},
						description: { type: 'string' },
					},
				},
				ImpactInput: {
					type: 'object',
					required: ['nodeId', 'changes'],
					properties: {
						nodeId: { type: 'string', minLength: 1 },
						changes: {
							type: 'array',
							minItems: 1,
							maxItems: 50,
							items: {
								type: 'object',
								required: ['type', 'tokenId'],
								properties: {
									type: { type: 'string', enum: ['add', 'override', 'subtract', 'reset'] },
									tokenId: { type: 'string', minLength: 1 },
									value: {
										description: 'Required for add and override',
										oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'object' }],
									},
									metadata: { type: 'object', description: 'add only' },
									toAncestor: { type: 'string', description: 'reset only; defaults to the parent' },
								},
							},
						},
						includeViolations: { type: 'boolean', default: true },
					},
				},
				CommandResult: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						data: {},
						error: {
							type: 'object',
							properties: {
								code: {
									type: 'string',
									description:
										'Command error codes (e.g. NODE_NOT_FOUND, VALIDATION_ERROR) or HTTP-level codes: BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, SERVICE_UNAVAILABLE, INTERNAL_ERROR (5xx only)',
								},
								message: { type: 'string' },
								suggestion: { type: 'string' },
							},
						},
						meta: {
							type: 'object',
							properties: {
								requestId: { type: 'string' },
							},
						},
					},
				},
			},
		},
		security: [{ ApiKeyAuth: [] }],
	};
}
