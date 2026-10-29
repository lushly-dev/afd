/**
 * Violet Design MCP Server
 *
 * Creates an MCP server that exposes all Violet commands as AI tools.
 * Uses the official @modelcontextprotocol/sdk for protocol compliance.
 */

import {
	type Database,
	MemoryDatabase,
	SQLiteDatabase,
	initializeCore,
	registry,
} from '@lushly-dev/violet-afd';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { generateTools } from './tools/generator.js';

/**
 * Server configuration options
 */
export interface ServerOptions {
	/** Path to SQLite database (or ':memory:' for in-memory) */
	dbPath?: string;

	/** Use in-memory database instead of SQLite */
	useMemory?: boolean;

	/** Server name */
	name?: string;

	/** Server version */
	version?: string;

	/** Skip initializing core (use when core is already initialized) */
	skipInit?: boolean;
}

/**
 * Create and configure the Violet MCP server
 *
 * @param options Server configuration
 * @returns Configured McpServer instance
 */
export async function createMcpServer(options: ServerOptions = {}): Promise<McpServer> {
	const {
		dbPath = './violet.db',
		useMemory = false,
		name = 'violet-design',
		version = '0.1.0',
		skipInit = false,
	} = options;

	// Initialize core and register all commands (unless skipped)
	if (!skipInit) {
		initializeCore();
	}

	// Create database instance
	const db: Database = useMemory ? new MemoryDatabase() : new SQLiteDatabase(dbPath);

	// Create MCP server
	const server = new McpServer(
		{
			name,
			version,
		},
		{
			capabilities: {
				tools: {},
			},
			instructions: `Violet Design is a hierarchical design token management platform.

Available command categories:
- node.*: Manage nodes in the design token tree. A deprecated node can carry sunsetAt (YYYY-MM-DD, the day it goes away) and replacedBy (the node that replaces it); null clears either. A date without a replacement, or a deprecated replacement, comes back as a warning.
- nodes.graph: The hierarchy as a graph (parent, include, copy edges, change counts, optional token trace)
- token.*: Add, override, subtract, reset, and copy tokens
- tokens.resolve: Get all resolved tokens for a node
- tokens.matrix: Resolve tokens across many nodes and show how each value got there
- tokens.compare: Put 2–4 nodes side by side and get only the tokens that differ (onlyDifferent: false for all), each cell flagged when it differs from the first node, with per-category counts and a similarity per pair. Use it for "why does X look different from Y?"
- tokens.catalog: Find tokens by words, category, tier or status, and see where they are customized
- export.*: Export tokens to JSON, CSS, SCSS, or TypeScript
- import.*: Import tokens from JSON files
- constraints.*: Define and validate design constraints
- analyze.violations: Every constraint violation across a subtree, with node, rule, values, source and owner
- analyze.health: Health per node for managers: own customizations by category, drift against a baseline ('parent' by default, 'root', or a node id), violations by severity, owner, status, coupling (mix-ins, borrows, borrowers), subtree totals, deprecation plans (sunset date, days left, replacement, usage), and flags for redundant overrides, sibling borrows, deprecated nodes with children, sunsets without a replacement, deprecated replacements and nodes kept past their sunset. Sort by drift, violations or customizations.
- analyze.trends: Is it getting better or worse? Changes per UTC day for a node and its descendants (since defaults to 90d), and the rule issues open now spread over the days their failing values were last set, with a running count. Issues fixed since are not counted on earlier days; days with a check recorded by analyze.snapshot carry the true count (recorded), and summary.history counts the issues that appeared and were fixed from one recorded check to the next.
- analyze.snapshot: Check the rules on a subtree (rootId) or every tree and store the results, for rule-check history in analyze.trends. Run it on a schedule, not on every read.
- specimen.get: The specimen role map of a node's tree and, for each component specimen (button, input, card), which token draws each role on the node, whether it resolves and whether it passes the CSS validator.
- specimen.set: Map component roles to tokens ({ button: { background: 'btn.bg' } }) on the root of a node's tree, for systems not named <component>.<role>. Merges by default; a null token removes a role; replace: true replaces the map. Only known components, roles and tokens defined in the tree.
- audit.list: Query the audit log by node (optionally its subtree), token, event types, actor and time range (ISO dates or spans like 30d), newest first with limit/offset paging and counts per day across every match
- changes.impact: Preview add/override/subtract/reset changes on a node without writing them: which nodes change, which are shielded by their own customization, how the change reaches them (inheritance, include, copy), violations introduced or resolved, and the commands to apply it. Use it before any token.* write.
- analyze.*: Compliance reports, deviation analysis, node comparison

All commands return structured results with 'success', 'data', and 'error' fields.
Error responses include 'code', 'message', and 'suggestion' for recovery guidance.`,
		},
	);

	// Register all commands as tools.
	//
	// We serve the tool list and handle calls via the low-level protocol handlers
	// so that clients see each command's real JSON input schema and the command
	// receives the caller's actual arguments (the high-level `server.tool(name,
	// description, cb)` overload has no input schema and hands the callback its
	// `extra` object instead of the arguments).
	const tools = generateTools();
	const toolNames = new Set(tools.map((tool) => tool.name));

	server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as { type: 'object'; [key: string]: unknown },
		})),
	}));

	server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const toolName = request.params.name;
		const args = request.params.arguments ?? {};

		if (!toolNames.has(toolName)) {
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(
							{
								success: false,
								error: {
									code: 'COMMAND_NOT_FOUND',
									message: `Unknown tool '${toolName}'`,
									suggestion: 'List available tools with tools/list',
								},
							},
							null,
							2,
						),
					},
				],
				isError: true,
			};
		}

		// Execute command through registry (validates input against the zod schema)
		const result = await registry.execute(toolName, args, { db });

		// Format as MCP tool result
		if (result.success) {
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(
							{
								success: true,
								data: result.data,
								confidence: result.confidence,
								reasoning: result.reasoning,
								warnings: result.warnings,
								metadata: result.metadata,
							},
							null,
							2,
						),
					},
				],
			};
		}

		// Return error response
		return {
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify(
						{
							success: false,
							error: result.error,
							metadata: result.metadata,
						},
						null,
						2,
					),
				},
			],
			isError: true,
		};
	});

	return server;
}
