import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	type CommandContext,
	type CommandResult,
	type Database,
	buildOpenApiSpec,
	createMemoryDatabase,
	createSQLiteDatabase,
	initializeCore,
	registry,
	seedRealisticSystem,
} from '@lushly-dev/violet-afd';
import { Command } from 'commander';
import { nanoid } from 'nanoid';
import { stringify as stringifyYaml } from 'yaml';
import {
	CICD_TEMPLATES,
	CLI_NOT_PUBLISHED_NOTE,
	CLI_PACKAGE,
	type CicdTemplate,
	type CicdTemplateOptions,
	SAFE_NODE_ID,
	SAFE_TOKENS_DIR,
	getWorkflowTemplate,
	isCicdTemplate,
	workflowFilename,
} from './cicd-templates.js';
import {
	type AuditData,
	type CatalogData,
	type CompareData,
	type GraphData,
	type HealthData,
	type ImpactData,
	type MatrixData,
	type SpecimenData,
	type TrendsData,
	type ViolationsData,
	formatAudit,
	formatCatalog,
	formatCompare,
	formatError,
	formatHealth,
	formatImpact,
	formatMatrix,
	formatOutput,
	formatSpecimen,
	formatSuccess,
	formatTree,
	formatTrends,
	formatViolations,
	formatWarning,
} from './output.js';
import { PACKAGE_VERSION } from './version.js';

/**
 * Create the Violet CLI
 * @param skipInit - Skip initializing core (for tests that init separately)
 */
export function createCLI(skipInit = false): Command {
	// Initialize core commands
	if (!skipInit) {
		initializeCore();
	}

	const program = new Command();

	program
		.name('violet')
		.description('Violet Design - Hierarchical design token management')
		.version(PACKAGE_VERSION)
		.option('--db <path>', 'Database file path', getDefaultDbPath())
		.option('--memory', 'Use in-memory database (for testing)')
		.option(
			'--from <dir>',
			'Build an in-memory node tree from DTCG token files in <dir> (one node per file; no database)',
		)
		.option('--json', 'Output as JSON')
		.option('--agent', 'Agent-optimized output (JSON, no colors)');

	// Add node commands
	addNodeCommands(program);

	// Add token commands
	addTokenCommands(program);

	// Add export commands
	addExportCommands(program);

	// Add import commands
	addImportCommands(program);

	// Add constraint commands
	addConstraintCommands(program);

	// Add analyze commands
	addAnalyzeCommands(program);

	// Add compare commands
	addCompareCommands(program);

	// Add specimen role map commands
	addSpecimenCommands(program);

	// Add MCP server commands
	addMcpCommands(program);

	// Add API server commands
	addApiCommands(program);

	// Add CI/CD integration commands
	addCicdCommands(program);

	// Add utility commands
	addUtilityCommands(program);

	// Add demo data commands
	addDemoCommands(program);

	// Add hosted API key helpers
	addApiKeyCommands(program);

	// Add generic call command for any registered command
	program
		.command('call <command>')
		.description('Call any registered command by name')
		.option('--schema', 'Show the command schema instead of executing')
		.option('-i, --input <json>', 'Input as JSON string')
		.action(async (commandName, options, cmd) => {
			const globalOpts = cmd.parent.opts();

			if (options.schema) {
				// Same JSON Schema as the MCP tool definition for this command
				const schema = registry.getInputJsonSchema(commandName);
				if (schema) {
					console.log(JSON.stringify(schema, null, 2));
				} else {
					console.error(formatError(`Command '${commandName}' not found`));
					process.exit(1);
				}
				return;
			}

			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const input = options.input ? JSON.parse(options.input) : {};
			const result = await registry.execute(commandName, input, context);
			outputResult(result, globalOpts);
		});

	return program;
}

/** `--sunset` and `--replaced-by` as node.update fields; 'none' clears one */
function planUpdates(options: { sunset?: string; replacedBy?: string }): Record<string, unknown> {
	const clearable = (value: string) => (value === 'none' ? null : value);
	return {
		...(options.sunset ? { sunsetAt: clearable(options.sunset) } : {}),
		...(options.replacedBy ? { replacedBy: clearable(options.replacedBy) } : {}),
	};
}

/**
 * Add node-related commands
 */
function addNodeCommands(program: Command): void {
	const node = program.command('node').description('Node management commands');

	node
		.command('create')
		.description('Create a new node')
		.requiredOption('-n, --name <name>', 'Node name')
		.option('-p, --parent <id>', 'Parent node ID')
		.option('-t, --type <type>', 'Node type', 'custom')
		.option('-o, --owner <email>', 'Owner email')
		.option('--tags <tags>', 'Comma-separated tags')
		.option('--includes <ids>', 'Comma-separated include node IDs')
		.option('-s, --status <status>', 'active, deprecated or experimental')
		.option('--sunset <date>', 'Day a deprecated node goes away (YYYY-MM-DD)')
		.option('--replaced-by <id>', 'Node that replaces a deprecated node')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'node.create',
				{
					name: options.name,
					parentId: options.parent || null,
					type: options.type,
					owner: options.owner,
					tags: options.tags ? options.tags.split(',') : [],
					includes: options.includes ? options.includes.split(',') : [],
					...(options.status ? { status: options.status } : {}),
					...(options.sunset ? { sunsetAt: options.sunset } : {}),
					...(options.replacedBy ? { replacedBy: options.replacedBy } : {}),
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	node
		.command('get <id>')
		.description('Get a node by ID')
		.option('-a, --ancestry', 'Include ancestry chain')
		.option('--ops', "Include the node's own operations")
		.action(async (id, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'node.get',
				{
					id,
					includeAncestry: options.ancestry || false,
					includeOperations: options.ops || false,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	node
		.command('list')
		.description('List nodes')
		.option('-p, --parent <id>', 'Filter by parent ID')
		.option('-v, --view <view>', 'View mode: flat or tree', 'flat')
		.option('-t, --type <type>', 'Filter by node type')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'node.list',
				{
					parentId: options.parent,
					view: options.view,
					filter: options.type ? { type: options.type } : undefined,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	node
		.command('update <id>')
		.description('Update a node')
		.option('-n, --name <name>', 'New name')
		.option('-t, --type <type>', 'New type')
		.option('-s, --status <status>', 'New status')
		.option('--tags <tags>', 'New tags (comma-separated)')
		.option('--sunset <date>', "Day a deprecated node goes away (YYYY-MM-DD), or 'none' to clear")
		.option('--replaced-by <id>', "Node that replaces a deprecated node, or 'none' to clear")
		.action(async (id, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const updates: Record<string, unknown> = {};
			if (options.name) updates.name = options.name;
			if (options.type) updates.type = options.type;
			if (options.status) updates.status = options.status;
			if (options.tags) updates.tags = options.tags.split(',');
			Object.assign(updates, planUpdates(options));

			const result = await registry.execute('node.update', { id, updates }, context);
			outputResult(result, globalOpts);
		});

	node
		.command('delete <id>')
		.description('Delete a node')
		.option('-r, --reason <reason>', 'Deletion reason')
		.option('-f, --force', 'Force delete (cascade to children)')
		.action(async (id, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'node.delete',
				{
					id,
					reason: options.reason,
					force: options.force || false,
				},
				context,
			);

			outputResult(result, globalOpts);
		});
}

/**
 * Add token-related commands
 */
function addTokenCommands(program: Command): void {
	const token = program.command('token').description('Token management commands');

	token
		.command('add')
		.description('Add a new token to a node')
		.requiredOption('-n, --node <id>', 'Node ID')
		.requiredOption('-t, --token <id>', 'Token ID')
		.requiredOption('-v, --value <value>', 'Token value')
		.option('-r, --reason <reason>', 'Reason for adding')
		.option('-c, --category <category>', 'Token category')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			// Parse value - try JSON first, then use as string
			let value: unknown = options.value;
			try {
				value = JSON.parse(options.value);
			} catch {
				// Keep as string
			}

			const result = await registry.execute(
				'token.add',
				{
					nodeId: options.node,
					tokenId: options.token,
					value,
					reason: options.reason,
					metadata: options.category ? { category: options.category } : undefined,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	token
		.command('override')
		.description("Override an inherited token's value")
		.requiredOption('-n, --node <id>', 'Node ID')
		.requiredOption('-t, --token <id>', 'Token ID')
		.requiredOption('-v, --value <value>', 'New value')
		.option('-r, --reason <reason>', 'Reason for override')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			let value: unknown = options.value;
			try {
				value = JSON.parse(options.value);
			} catch {
				// Keep as string
			}

			const result = await registry.execute(
				'token.override',
				{
					nodeId: options.node,
					tokenId: options.token,
					value,
					reason: options.reason,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	token
		.command('subtract')
		.description('Remove a token from a node')
		.requiredOption('-n, --node <id>', 'Node ID')
		.requiredOption('-t, --token <id>', 'Token ID')
		.option('-r, --reason <reason>', 'Reason for removal')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'token.subtract',
				{
					nodeId: options.node,
					tokenId: options.token,
					reason: options.reason,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	token
		.command('reset')
		.description("Reset a token to an ancestor's value")
		.requiredOption('-n, --node <id>', 'Node ID')
		.requiredOption('-t, --token <id>', 'Token ID')
		.option('-a, --ancestor <id>', 'Specific ancestor to reset to')
		.option('-r, --reason <reason>', 'Reason for reset')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'token.reset',
				{
					nodeId: options.node,
					tokenId: options.token,
					toAncestor: options.ancestor,
					reason: options.reason,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	token
		.command('copy')
		.description("Copy a token's value from another node")
		.requiredOption('-n, --node <id>', 'Target node ID')
		.requiredOption('-t, --token <id>', 'Token ID to copy')
		.requiredOption('-f, --from <id>', 'Source node ID')
		.option('-a, --as <id>', 'Rename token to this ID')
		.option('-r, --reason <reason>', 'Reason for copying')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'token.copy',
				{
					nodeId: options.node,
					tokenId: options.token,
					fromNode: options.from,
					asTokenId: options.as,
					reason: options.reason,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	token
		.command('lineage')
		.description("Trace a token's value through the inheritance chain")
		.requiredOption('-n, --node <id>', 'Node ID')
		.requiredOption('-t, --token <id>', 'Token ID')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'token.lineage',
				{
					nodeId: options.node,
					tokenId: options.token,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	// tokens.resolve as "tokens" command
	program
		.command('tokens <nodeId>')
		.description('Get all resolved tokens for a node')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-l, --lineage', 'Include lineage information')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'tokens.resolve',
				{
					nodeId,
					filter: options.filter,
					includeLineage: options.lineage || false,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	// analyze.violations as "violations" command
	program
		.command('violations')
		.description('List every constraint violation across a subtree')
		.option('-r, --root <id>', 'Subtree to check; defaults to every tree')
		.option('-s, --severity <severity>', 'Only this severity (error, warning, info)')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'analyze.violations',
				{ rootId: options.root, severity: options.severity },
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatViolations(result.data as ViolationsData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});

	// analyze.health as "health" command
	program
		.command('health')
		.description(
			'Health per node: changes, drift, violations, owner, links, deprecation plans and risk flags (redundant overrides, sibling borrows, deprecated nodes with children, sunset dates)',
		)
		.option('-r, --root <id>', 'Subtree to report; defaults to every tree')
		.option('-b, --baseline <baseline>', "Drift against 'parent', 'root', or a node id", 'parent')
		.option('-s, --sort <sort>', 'tree, drift, violations or customizations', 'tree')
		.option('--no-violations', 'Skip checking constraint violations')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'analyze.health',
				{
					rootId: options.root,
					baseline: options.baseline,
					sort: options.sort,
					includeViolations: options.violations,
				},
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatHealth(result.data as HealthData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});

	// analyze.trends as "trends" command
	program
		.command('trends')
		.description(
			'Changes per day, open rule issues by the day their value was set, and recorded rule checks, for a node and its descendants',
		)
		.option('-r, --root <id>', 'The node and its descendants; defaults to every tree')
		.option(
			'--since <time>',
			'From this time: a date, an ISO time, or a span back (30d, 2w)',
			'90d',
		)
		.option('--until <time>', 'Before this time, in the same forms; defaults to now')
		.option('--no-violations', 'Skip dating the open rule issues')
		.option('--no-history', 'Skip the rule checks recorded with `violet snapshot`')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'analyze.trends',
				{
					rootId: options.root,
					since: options.since,
					until: options.until,
					includeViolations: options.violations,
					includeHistory: options.history,
				},
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatTrends(result.data as TrendsData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});

	// analyze.snapshot as "snapshot" command
	program
		.command('snapshot')
		.description(
			'Check the rules on a node and its descendants and store the results, for rule-check history in `violet trends` (run it on a schedule)',
		)
		.option('-r, --root <id>', 'The node and its descendants; defaults to every tree')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute('analyze.snapshot', { rootId: options.root }, context);
			outputResult(result, globalOpts);
		});

	// audit.list as "audit" command
	program
		.command('audit')
		.description(
			'Query the audit log by node, token, event type, actor and time, with counts per day',
		)
		.option('-n, --node <id>', 'Events on this node')
		.option('--subtree', "Also events on the node's descendants")
		.option('-t, --token <id>', 'Events on this token')
		.option('--type <types>', 'Event types, comma-separated (e.g. token_updated,token_deleted)')
		.option('-a, --actor <actor>', 'Who made the change')
		.option('--since <time>', 'From this time: a date, an ISO time, or a span back (30d, 12h, 2w)')
		.option('--until <time>', 'Before this time, in the same forms')
		.option('-l, --limit <n>', 'Events per page (max 500)', '50')
		.option('--offset <n>', 'Skip this many events (for the next page)', '0')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'audit.list',
				{
					nodeId: options.node,
					subtree: options.subtree || false,
					tokenId: options.token,
					eventTypes: options.type
						? String(options.type)
								.split(',')
								.map((type: string) => type.trim())
								.filter(Boolean)
						: undefined,
					actor: options.actor,
					since: options.since,
					until: options.until,
					limit: Number(options.limit),
					offset: Number(options.offset),
				},
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatAudit(result.data as AuditData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});

	// tokens.catalog as "catalog" command
	program
		.command('catalog [query...]')
		.description(
			'Find tokens by words, category, tier or status, and see where they are customized',
		)
		.option('-r, --root <id>', 'Count customizations within this subtree')
		.option(
			'-c, --category <category>',
			'Only tokens of this category (color, spacing, typography, ...)',
		)
		.option('--tier <tier>', 'Only tokens of this tier (global, semantic, component)')
		.option('--status <status>', 'Only tokens with this status (stable, beta, deprecated)')
		.option('-m, --most-customized', 'Sort by how many nodes customize or remove each token')
		.option('-l, --limit <n>', 'Show at most this many tokens', '50')
		.action(async (query: string[], options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'tokens.catalog',
				{
					rootId: options.root,
					query: query.length > 0 ? query.join(' ') : undefined,
					category: options.category,
					tier: options.tier,
					status: options.status,
					sort: options.mostCustomized ? 'customized' : 'id',
					limit: Number.parseInt(options.limit, 10),
				},
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatCatalog(result.data as CatalogData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});

	// nodes.graph as "tree" command
	program
		.command('tree')
		.description('Show the node hierarchy with change counts, mixins and copies')
		.option('-r, --root <id>', 'Subtree root (inclusive); defaults to every tree')
		.option('-t, --token <id>', 'Trace one token through the hierarchy')
		.option('--ops', "List each node's own operations")
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'nodes.graph',
				{
					rootId: options.root,
					token: options.token,
					includeOperations: options.ops || false,
				},
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatTree(result.data as GraphData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});

	// tokens.matrix as "matrix" command
	program
		.command('matrix')
		.description('Resolve tokens across many nodes and show how each value got there')
		.option('-r, --root <id>', 'Subtree root (inclusive); defaults to every node')
		.option('-n, --nodes <ids>', 'Comma-separated node IDs to use as columns, in order')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option(
			'-c, --category <category>',
			'Only tokens of this category (color, spacing, typography, ...)',
		)
		.option('--varying', 'Only show tokens whose value differs across nodes')
		.option('--violations', 'Include constraint violations per cell')
		.option('--only-violations', 'Only show tokens with a constraint violation')
		.option('-g, --group <by>', 'Order rows by group and count each group (category, tier)')
		.option('-s, --sort <order>', 'Token id order, within each group: token-asc, token-desc')
		.option('--summary', 'Counts only, without rows (with --group: per group)')
		.option('-l, --limit <n>', 'Rows per page')
		.option(
			'--cursor <cursor>',
			'Continue from another page (its page.nextCursor, or page.prevCursor to go back)',
		)
		.option('--around <token>', 'With --limit: the page holding this token id')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'tokens.matrix',
				{
					rootId: options.root,
					nodeIds: options.nodes
						? String(options.nodes)
								.split(',')
								.map((id: string) => id.trim())
								.filter(Boolean)
						: undefined,
					filter: options.filter,
					category: options.category,
					onlyVarying: options.varying || false,
					includeViolations: options.violations || false,
					onlyViolating: options.onlyViolations || false,
					groupBy: options.group,
					sort: options.sort,
					summaryOnly: options.summary || false,
					limit: options.limit === undefined ? undefined : Number(options.limit),
					cursor: options.cursor,
					around: options.around,
				},
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatMatrix(result.data as MatrixData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});

	// changes.impact as "impact" command
	program
		.command('impact')
		.description('Preview token changes on a node without writing them')
		.requiredOption('-n, --node <id>', 'Node to change')
		.option('--add <token=value>', 'Add a token (repeatable)', collect, [])
		.option('--override <token=value>', 'Override a token (repeatable)', collect, [])
		.option('--reset <token[=ancestor]>', 'Reset a token to an ancestor (repeatable)', collect, [])
		.option('--subtract <token>', 'Remove a token (repeatable)', collect, [])
		.option('--no-violations', 'Skip checking constraint violations')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const changes = impactChanges(options);
			if (typeof changes === 'string') {
				console.error(formatError(changes));
				process.exit(1);
			}
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'changes.impact',
				{ nodeId: options.node, changes, includeViolations: options.violations },
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatImpact(result.data as ImpactData));
				if (result.reasoning) {
					console.log(`\n${result.reasoning}`);
				}
				return;
			}
			outputResult(result, globalOpts);
		});
}

/**
 * Add export-related commands
 */
function addExportCommands(program: Command): void {
	const exportCmd = program.command('export').description('Export tokens to various formats');

	exportCmd
		.command('json <nodeId>')
		.description('Export tokens as Style Dictionary JSON')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-p, --prefix <prefix>', 'Add prefix to variable names')
		.option('--pretty', 'Pretty print output', true)
		.option('-o, --output <path>', 'Output file path')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'export',
				{
					nodeId,
					format: 'json',
					filter: options.filter,
					prefix: options.prefix,
					pretty: options.pretty,
					output: options.output,
				},
				context,
			);

			handleExportResult(result, options.output, globalOpts);
		});

	exportCmd
		.command('css <nodeId>')
		.description('Export tokens as CSS custom properties')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-p, --prefix <prefix>', 'Add prefix to variable names')
		.option('-s, --selector <selector>', 'CSS selector', ':root')
		.option('--comments', 'Include comments with token info')
		.option('--references', 'Keep aliases as var(--target) instead of resolved values')
		.option('-o, --output <path>', 'Output file path')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'export',
				{
					nodeId,
					format: 'css',
					filter: options.filter,
					prefix: options.prefix,
					selector: options.selector,
					includeComments: options.comments || false,
					outputReferences: options.references || false,
					output: options.output,
				},
				context,
			);

			handleExportResult(result, options.output, globalOpts);
		});

	exportCmd
		.command('scss <nodeId>')
		.description('Export tokens as SCSS variables')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-p, --prefix <prefix>', 'Add prefix to variable names')
		.option('--comments', 'Include comments with token info')
		.option('-g, --group', 'Group variables by category')
		.option('-o, --output <path>', 'Output file path')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'export',
				{
					nodeId,
					format: 'scss',
					filter: options.filter,
					prefix: options.prefix,
					includeComments: options.comments || false,
					groupByCategory: options.group || false,
					output: options.output,
				},
				context,
			);

			handleExportResult(result, options.output, globalOpts);
		});

	exportCmd
		.command('ts <nodeId>')
		.alias('typescript')
		.description('Export tokens as TypeScript constants')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-p, --prefix <prefix>', 'Add prefix to variable names')
		.option('--style <style>', 'Export style: nested or flat', 'nested')
		.option('--type <type>', 'Export type: named or default', 'named')
		.option('-o, --output <path>', 'Output file path')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'export',
				{
					nodeId,
					format: 'typescript',
					filter: options.filter,
					prefix: options.prefix,
					exportStyle: options.style,
					exportType: options.type,
					output: options.output,
				},
				context,
			);

			handleExportResult(result, options.output, globalOpts);
		});

	exportCmd
		.command('lua <nodeId>')
		.description('Export tokens as a Lua module (FenUI colors and theme config)')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-p, --prefix <prefix>', 'Prefix for color primitive names (e.g. vintageDark)')
		.option('-n, --name <name>', 'Lua module and theme name', 'DesignTokens')
		.option(
			'--theme-map <file>',
			'JSON file mapping FenUI semantic names to color token IDs; emits a RegisterTheme config',
		)
		.option('--no-comments', 'Omit hex/token comments on colors')
		.option('-o, --output <path>', 'Output file path')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();

			let themeMap: Record<string, string> | undefined;
			if (options.themeMap) {
				try {
					themeMap = JSON.parse(fs.readFileSync(options.themeMap, 'utf-8'));
				} catch (err) {
					console.error(
						formatError(
							`Failed to read --theme-map: ${err instanceof Error ? err.message : String(err)}`,
						),
					);
					process.exit(1);
				}
			}

			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'export',
				{
					nodeId,
					format: 'lua',
					filter: options.filter,
					prefix: options.prefix,
					className: options.name,
					includeComments: options.comments,
					themeMap,
					output: options.output,
				},
				context,
			);

			handleExportResult(result, options.output, globalOpts);
		});
}

/**
 * Add import-related commands
 */
function addImportCommands(program: Command): void {
	const importCmd = program.command('import').description('Import tokens from various formats');

	importCmd
		.command('json <nodeId> <file>')
		.description('Import tokens from Style Dictionary JSON')
		.option('-p, --prefix <prefix>', 'Add prefix to imported token IDs')
		.option('-m, --mode <mode>', 'Merge mode: replace or merge', 'merge')
		.option('--tiers', 'Read top-level global/semantic/component groups as token tiers')
		.option('--dry-run', 'Preview changes without applying them')
		.action(async (nodeId, file, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			// Read file content
			let content: string;
			try {
				content = fs.readFileSync(file, 'utf-8');
			} catch (err) {
				console.error(
					formatError(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`),
				);
				process.exit(1);
			}

			const result = await registry.execute(
				'import.json',
				{
					targetNode: nodeId,
					content,
					prefix: options.prefix,
					// Core only knows merge (override on conflict) vs. fail on conflict
					merge: options.mode === 'merge',
					tiers: options.tiers || false,
					dryRun: options.dryRun || false,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	importCmd
		.command('validate <file>')
		.description('Validate a JSON file for import')
		.option('-p, --prefix <prefix>', 'Add prefix to imported token IDs')
		.option('--tiers', 'Read top-level global/semantic/component groups as token tiers')
		.action(async (file, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			// Read file content
			let content: string;
			try {
				content = fs.readFileSync(file, 'utf-8');
			} catch (err) {
				console.error(
					formatError(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`),
				);
				process.exit(1);
			}

			const result = await registry.execute(
				'import.validate',
				{
					content,
					prefix: options.prefix,
					tiers: options.tiers || false,
				},
				context,
			);

			outputResult(result, globalOpts);
		});
}

/**
 * Add constraint-related commands
 */
function addConstraintCommands(program: Command): void {
	const constraints = program.command('constraints').description('Constraint management commands');

	constraints
		.command('set <nodeId>')
		.description('Set constraints for a node')
		.requiredOption('-c, --constraints <json>', 'Constraints as JSON array')
		.option('-m, --merge', 'Merge with existing constraints')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			let constraintsParsed: unknown;
			try {
				constraintsParsed = JSON.parse(options.constraints);
			} catch {
				console.error(formatError('Invalid JSON for constraints'));
				process.exit(1);
			}

			const result = await registry.execute(
				'constraints.set',
				{
					nodeId,
					constraints: constraintsParsed,
					merge: options.merge || false,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	constraints
		.command('list <nodeId>')
		.description('List constraints for a node')
		.option('-i, --inherited', 'Include inherited constraints')
		.option('-e, --enabled-only', 'Show only enabled constraints')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'constraints.list',
				{
					nodeId,
					includeInherited: options.inherited || true,
					enabledOnly: options.enabledOnly || false,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	constraints
		.command('validate <nodeId>')
		.description('Validate tokens against constraints')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'constraints.validate',
				{
					nodeId,
					filter: options.filter,
				},
				context,
			);

			outputResult(result, globalOpts);
		});
}

/**
 * Add analyze-related commands
 */
function addAnalyzeCommands(program: Command): void {
	const analyze = program.command('analyze').description('Analysis and reporting commands');

	analyze
		.command('deviations <nodeId>')
		.description('List tokens that deviate from ancestor values')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-a, --from-ancestor <id>', 'Compare against specific ancestor')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'analyze.deviations',
				{
					nodeId,
					filter: options.filter,
					fromAncestor: options.fromAncestor,
				},
				context,
			);

			outputResult(result, globalOpts);
		});

	analyze
		.command('compliance <nodeId>')
		.description('Generate compliance report for a node')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option('-o, --format <format>', 'Output format: summary, detailed, json', 'summary')
		.action(async (nodeId, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'analyze.compliance',
				{
					nodeId,
					filter: options.filter,
					format: options.format,
				},
				context,
			);

			outputResult(result, globalOpts);
		});
}

/**
 * Add demo data commands
 */
function addDemoCommands(program: Command): void {
	const demo = program.command('demo').description('Demo data for trying Violet and the web UI');

	demo
		.command('seed')
		.description(
			'Seed a realistic multi-product design system (~37 nodes, ~1,150 tokens) into an empty database',
		)
		.option('-s, --seed <number>', 'Seed for the deterministic choices', '20261016')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);

			const existing = await db.listNodes();
			if (existing.length > 0) {
				const result: CommandResult<unknown> = {
					success: false,
					error: {
						code: 'VALIDATION_ERROR',
						message: `The database already has ${existing.length} node(s); demo data only seeds an empty database`,
						suggestion: 'Point --db at a new file, e.g. violet --db ./demo.db demo seed',
					},
				};
				outputResult(result, globalOpts);
				return;
			}

			const started = Date.now();
			const summary = await seedRealisticSystem(createContext(db), {
				seed: Number.parseInt(options.seed, 10),
			});
			const result: CommandResult<unknown> = {
				success: true,
				data: {
					...summary,
					durationMs: Date.now() - started,
					db: globalOpts.memory ? 'memory' : globalOpts.db,
				},
			};
			if (globalOpts.json || globalOpts.agent) {
				outputResult(result, globalOpts);
				return;
			}
			console.log(
				formatSuccess(
					`Seeded ${summary.nodes} nodes, ${summary.tokens} tokens, ${summary.operations} operations and ${summary.constraints} constraints in ${Date.now() - started}ms`,
				),
			);
			console.log('\nTry:');
			console.log('  violet tree --root xbox');
			console.log('  violet tree --token color.accent.primary');
			console.log("  violet matrix --root office --filter 'color.text.*' --violations");
			console.log('  violet health --sort drift');
		});
}

/**
 * Add hosted API key helpers. Both run offline: nothing is stored and no
 * database is opened.
 */
function addApiKeyCommands(program: Command): void {
	const apikeys = program
		.command('apikeys')
		.description('Generate and check hosted API keys (offline; nothing is stored)');

	apikeys
		.command('create')
		.description('Generate a key, its VIOLET_API_KEYS_JSON seed entry, and insert/revoke SQL')
		.requiredOption('--id <id>', 'Key id, unique per environment (e.g. lushly-preview)')
		.requiredOption('--name <name>', 'Who or what uses the key')
		.requiredOption(
			'--scopes <scopes>',
			'Comma-separated scopes (e.g. tokens:read,export:read)',
			(value: string) =>
				value
					.split(',')
					.map((scope) => scope.trim())
					.filter(Boolean),
		)
		.option('--rate-limit <n>', 'Requests per minute (API default 100)', (value: string) =>
			Number(value),
		)
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const result = await registry.execute(
				'apikeys.create',
				{
					id: options.id,
					name: options.name,
					scopes: options.scopes,
					...(options.rateLimit !== undefined ? { rateLimit: options.rateLimit } : {}),
				},
				createContext(createMemoryDatabase()),
			);

			if (globalOpts.json || globalOpts.agent || !result.success) {
				outputResult(result, globalOpts);
				return;
			}

			const data = result.data as {
				keyId: string;
				token: string;
				seed: unknown;
				sql: { insert: string; revoke: string };
			};
			console.log(formatSuccess(`Generated key '${data.keyId}'. Nothing was stored.`));
			for (const warning of result.warnings ?? []) {
				console.log(formatWarning(warning.message));
			}
			console.log('\nToken (shown once; put it in the consumer’s secret store):');
			console.log(`  ${data.token}`);
			console.log('\nSeed entry for that environment’s VIOLET_API_KEYS_JSON array:');
			console.log(`  ${JSON.stringify(data.seed)}`);
			console.log('\nOr insert it directly on that environment’s database (hash only):');
			console.log(`  ${data.sql.insert}`);
			console.log('\nRevoke it later with:');
			console.log(`  ${data.sql.revoke}`);
			console.log(
				'\nNext: violet apikeys check <file> on the whole array before saving it, then redeploy.',
			);
		});

	apikeys
		.command('check [file]')
		.description(
			'Check a VIOLET_API_KEYS_JSON value (a file, - for stdin, or the environment variable)',
		)
		.action(async (file: string | undefined, _options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const seeds = readSeedsArgument(file);
			const result = await registry.execute(
				'apikeys.check',
				{ seeds },
				createContext(createMemoryDatabase()),
			);
			const valid = (result.data as { valid?: boolean } | undefined)?.valid;

			if (globalOpts.json || globalOpts.agent || !result.success) {
				outputResult(result, globalOpts);
			} else {
				printSeedCheck(result.data as SeedCheckData);
				console.log(
					valid
						? formatSuccess(result.reasoning ?? 'Seeds are valid')
						: formatError(result.reasoning ?? 'Seeds have errors'),
				);
			}
			if (valid === false) process.exitCode = 1;
		});
}

/** The seeds to check: a file, stdin for '-', or VIOLET_API_KEYS_JSON. Exits when there are none. */
function readSeedsArgument(file: string | undefined): string {
	let seeds: string | undefined;
	try {
		seeds =
			file === '-'
				? fs.readFileSync(0, 'utf-8')
				: file
					? fs.readFileSync(file, 'utf-8')
					: process.env.VIOLET_API_KEYS_JSON;
	} catch (err) {
		console.error(
			formatError(`Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`),
		);
		process.exit(1);
	}
	if (seeds === undefined) {
		console.error(formatError('Pass a file, - for stdin, or set VIOLET_API_KEYS_JSON to check it'));
		process.exit(1);
	}
	return seeds;
}

interface SeedCheckData {
	keys: Array<{ entry: number; id?: string; scopes: string[]; rateLimit?: number }>;
	issues: Array<{
		severity: 'error' | 'warning';
		code: string;
		message: string;
		entry?: number;
		keyId?: string;
	}>;
}

function printSeedCheck(data: SeedCheckData): void {
	for (const key of data.keys) {
		const scopes = key.scopes.join(', ') || '(no scopes)';
		const rate = key.rateLimit ? `  ${key.rateLimit}/min` : '';
		console.log(`  ${String(key.entry).padStart(2)}. ${key.id ?? '(no id)'}  ${scopes}${rate}`);
	}
	for (const issue of data.issues) {
		const keyId = issue.keyId ? ` (${issue.keyId})` : '';
		const where = issue.entry ? `entry ${issue.entry}${keyId}: ` : '';
		const line = `${issue.code} ${where}${issue.message}`;
		console.log(issue.severity === 'error' ? formatError(line) : formatWarning(line));
	}
}

/**
 * Add compare-related commands
 */
function addCompareCommands(program: Command): void {
	program
		.command('compare <nodes...>')
		.description('Compare 2–4 nodes token by token (only differences unless --all)')
		.option('-f, --filter <pattern>', 'Filter tokens by glob pattern')
		.option(
			'-c, --category <category>',
			'Only tokens of this category (color, spacing, typography, ...)',
		)
		.option('-a, --all', 'Include tokens that are the same on every node')
		.action(async (nodes: string[], options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'tokens.compare',
				{
					nodeIds: nodes,
					filter: options.filter,
					category: options.category,
					onlyDifferent: !options.all,
				},
				context,
			);

			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatCompare(result.data as CompareData));
				return;
			}
			outputResult(result, globalOpts);
		});
}

/**
 * `button.background=btn.bg` → ['button', 'background', 'btn.bg']; an empty
 * token (`button.border=`) removes the role. Roles may contain dots.
 */
export function parseSpecimenAssignment(text: string): [string, string, string | null] {
	const match = /^([^.=\s]+)\.([^=\s]+)=(\S*)$/.exec(text);
	if (!match) {
		throw new Error(
			`Can't read '${text}': write component.role=tokenId (button.background=btn.bg), or component.role= to remove it`,
		);
	}
	return [match[1], match[2], match[3] || null];
}

/**
 * Add specimen role map commands (#118)
 */
function addSpecimenCommands(program: Command): void {
	const specimen = program
		.command('specimen')
		.description('Which tokens draw the component specimens (button, input, card)');

	specimen
		.command('get <nodeId>')
		.description(
			"The stored role map of the node's tree, and which roles resolve and draw on the node",
		)
		.action(async (nodeId: string, _options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute('specimen.get', { nodeId }, context);
			if (result.success && !globalOpts.json && !globalOpts.agent) {
				console.log(formatSpecimen(result.data as SpecimenData));
				if (result.reasoning) console.log(`\n${result.reasoning}`);
				return;
			}
			outputResult(result, globalOpts);
		});

	specimen
		.command('set <nodeId> [assignments...]')
		.description(
			"Map roles to tokens on the root of the node's tree: button.background=btn.bg (button.border= removes a role)",
		)
		.option('-f, --file <path>', 'A JSON map, { "button": { "background": "btn.bg" } }')
		.option('--replace', 'Replace the stored map instead of merging into it')
		.action(async (nodeId: string, assignments: string[], options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const map: Record<string, Record<string, string | null>> = {};
			try {
				if (options.file) {
					Object.assign(map, JSON.parse(fs.readFileSync(options.file, 'utf8')));
				}
				for (const assignment of assignments) {
					const [component, role, tokenId] = parseSpecimenAssignment(assignment);
					map[component] = { ...(map[component] ?? {}), [role]: tokenId };
				}
			} catch (error) {
				outputResult(
					{
						success: false,
						error: {
							code: 'VALIDATION_ERROR',
							message: error instanceof Error ? error.message : String(error),
						},
					},
					globalOpts,
				);
				return;
			}
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'specimen.set',
				{ nodeId, map, replace: Boolean(options.replace) },
				context,
			);
			outputResult(result, globalOpts);
		});
}

/**
 * Add MCP server commands
 */
function addMcpCommands(program: Command): void {
	const mcp = program.command('mcp').description('MCP (Model Context Protocol) server commands');

	mcp
		.command('start')
		.description('Start MCP server (stdio transport)')
		.action(async (_options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();

			// Start the MCP server with stdio transport. The server is loaded on
			// demand so export-only runs don't pull it in.
			const { startStdioServer } = await import('@lushly-dev/violet-server');
			await startStdioServer({
				name: 'violet-mcp',
				version: PACKAGE_VERSION,
				dbPath: globalOpts.memory ? undefined : globalOpts.db,
				useMemory: globalOpts.memory,
			});
		});

	mcp
		.command('tools')
		.description('List all available MCP tools')
		.action(async () => {
			// Core is already initialized in createCLI()
			const { generateTools } = await import('@lushly-dev/violet-server');
			const tools = generateTools();

			console.log('\nAvailable MCP Tools:\n');
			console.log('─'.repeat(60));

			for (const tool of tools) {
				console.log(`\n  📦 ${tool.name}`);
				console.log(`     ${tool.description}`);

				// Show input schema properties
				const schema = tool.inputSchema as {
					properties?: Record<string, { description?: string }>;
				};
				if (schema.properties) {
					const props = Object.keys(schema.properties);
					if (props.length > 0) {
						console.log(`     Parameters: ${props.join(', ')}`);
					}
				}
			}

			console.log(`\n${'─'.repeat(60)}`);
			console.log(`\nTotal: ${tools.length} tools available`);
			console.log('\nTo use with an MCP client:');
			console.log('  violet mcp start');
			console.log('\n');
		});

	mcp
		.command('call <tool>')
		.description('Call an MCP tool directly')
		.option('-a, --args <json>', 'Tool arguments as JSON', '{}')
		.action(async (toolName, options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			// Parse arguments
			let args: unknown;
			try {
				args = JSON.parse(options.args);
			} catch (e) {
				console.error(formatError(`Invalid JSON arguments: ${options.args}`));
				process.exit(1);
			}

			// Execute the command (MCP tools map directly to commands)
			const result = await registry.execute(toolName, args, context);
			outputResult(result, globalOpts);
		});
}

/**
 * Add API server commands
 */
function addApiCommands(program: Command): void {
	const api = program.command('api').description('REST API server commands');

	api
		.command('start')
		.description('Start the REST API server (local development)')
		.option('-p, --port <port>', 'Port to listen on', '3000')
		.option('--host <host>', 'Host to bind to', 'localhost')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();

			console.log('\n🚀 Starting Violet API server...');
			console.log(`   URL: http://${options.host}:${options.port}`);
			console.log(`   Database: ${globalOpts.memory ? 'memory' : globalOpts.db}`);
			console.log(`   OpenAPI: http://${options.host}:${options.port}/api/v1/openapi\n`);

			// Use Vercel dev for local development
			const { spawn } = await import('node:child_process');
			const devServer = spawn(
				'npx',
				['vercel', 'dev', '--listen', `${options.host}:${options.port}`],
				{
					cwd: process.cwd(),
					stdio: 'inherit',
					shell: true,
				},
			);

			devServer.on('error', (err) => {
				console.error(`Failed to start API server: ${err.message}`);
				process.exit(1);
			});
		});

	api
		.command('deploy')
		.description('Deploy API to Vercel')
		.option('--prod', 'Deploy to production instead of preview')
		.action(async (options) => {
			console.log(
				`\n▲ Deploying Violet API to Vercel${options.prod ? ' (production)' : ' (preview)'}...`,
			);

			const { spawn } = await import('node:child_process');
			const args = ['vercel'];
			if (options.prod) {
				args.push('--prod');
			}

			const deploy = spawn('npx', args, {
				cwd: process.cwd(),
				stdio: 'inherit',
				shell: true,
			});

			deploy.on('error', (err) => {
				console.error(`Failed to deploy: ${err.message}`);
				process.exit(1);
			});
		});

	api
		.command('spec')
		.description('Print the hosted API OpenAPI spec (same document as GET /api/v1/openapi)')
		.option('-o, --output <file>', 'Output file path')
		.option('--yaml', 'Output as YAML (default is JSON)')
		.option(
			'--server <url>',
			'Deployment URL to list as a server (default: $VIOLET_API_URL; otherwise only local vercel dev)',
		)
		.action(async (options, _cmd) => {
			const deploymentUrl = parseServerUrl(options.server ?? process.env.VIOLET_API_URL);
			if (deploymentUrl === null) {
				console.error(formatError('--server / VIOLET_API_URL must be an http(s) URL'));
				process.exit(1);
			}

			const output = renderOpenApiSpec(
				buildOpenApiSpec({ deploymentUrl, deploymentDescription: 'Deployment' }),
				options.yaml ? 'yaml' : 'json',
			);

			if (options.output) {
				fs.writeFileSync(options.output, output);
				console.log(formatSuccess(`OpenAPI spec written to ${options.output}`));
			} else {
				console.log(output.trimEnd());
			}
		});
}

/** Serialize the OpenAPI document as JSON or YAML, ending in a newline. */
export function renderOpenApiSpec(spec: object, format: 'json' | 'yaml'): string {
	return format === 'yaml' ? stringifyYaml(spec) : `${JSON.stringify(spec, null, 2)}\n`;
}

/**
 * Normalize a deployment URL for the OpenAPI servers list: undefined when
 * unset, null when it is not an http(s) URL without credentials.
 */
export function parseServerUrl(raw: string | undefined): string | undefined | null {
	const value = raw?.trim();
	if (!value) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		if (url.username || url.password || url.search || url.hash) return null;
		return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
	} catch {
		return null;
	}
}

/**
 * Add CI/CD integration commands
 */
function addCicdCommands(program: Command): void {
	const cicd = program.command('cicd').description('CI/CD integration commands');

	// cicd setup - Generate GitHub workflows for the file-driven and hosted paths
	cicd
		.command('setup')
		.description('Generate GitHub workflows that validate, release or sync design tokens')
		.option('-p, --platform <platform>', 'CI platform (only github is supported)', 'github')
		.option(
			'-t, --templates <templates>',
			`Workflow templates, comma-separated: ${CICD_TEMPLATES.join(', ')}`,
			'sync,validate',
		)
		.option('-n, --node <id>', 'Node the workflows validate, export or fetch', 'global-base')
		.option('--tokens-dir <dir>', 'Directory of DTCG node files for --from', 'tokens')
		.option('-o, --output <dir>', 'Output directory for workflows', '.github/workflows')
		.option('--force', 'Overwrite existing files')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const fail = (message: string) =>
				outputResult({ success: false, error: { code: 'VALIDATION_ERROR', message } }, globalOpts);

			if (options.platform !== 'github') {
				fail(`Unsupported platform '${options.platform}'. Only github is supported.`);
				return;
			}

			const templates: string[] = options.templates
				.split(',')
				.map((t: string) => t.trim())
				.filter(Boolean);
			const unknown = templates.filter((t) => !isCicdTemplate(t));
			if (templates.length === 0 || unknown.length > 0) {
				fail(
					`Unknown template(s): ${unknown.join(', ') || '(none)'}. Available: ${CICD_TEMPLATES.join(', ')}`,
				);
				return;
			}

			if (!SAFE_NODE_ID.test(options.node)) {
				fail(`Invalid --node '${options.node}': use letters, digits, '.', '_' and '-'`);
				return;
			}
			if (!SAFE_TOKENS_DIR.test(options.tokensDir)) {
				fail(
					`Invalid --tokens-dir '${options.tokensDir}': use a relative path of letters, digits, '.', '_', '-' and '/'`,
				);
				return;
			}

			const outputDir: string = options.output;
			const templateOptions = { node: options.node, tokensDir: options.tokensDir };
			fs.mkdirSync(outputDir, { recursive: true });

			const createdFiles: string[] = [];
			const skippedFiles: string[] = [];

			for (const template of templates as CicdTemplate[]) {
				const filepath = path.join(outputDir, workflowFilename(template));

				if (fs.existsSync(filepath) && !options.force) {
					skippedFiles.push(filepath);
					continue;
				}

				fs.writeFileSync(filepath, getWorkflowTemplate(template, templateOptions));
				createdFiles.push(filepath);
			}

			const nextSteps = cicdNextSteps(templates as CicdTemplate[], templateOptions);

			if (globalOpts.json || globalOpts.agent) {
				outputResult(
					{
						success: true,
						data: {
							platform: options.platform,
							templates,
							outputDir,
							...templateOptions,
							createdFiles,
							skippedFiles,
							nextSteps,
						},
					},
					globalOpts,
				);
				return;
			}

			console.log(formatSuccess('CI/CD setup complete'));
			console.log(`\n  Output: ${outputDir}/`);

			if (createdFiles.length > 0) {
				console.log('\n  Created files:');
				for (const file of createdFiles) {
					console.log(`    ✓ ${file}`);
				}
			}

			if (skippedFiles.length > 0) {
				console.log('\n  Skipped (use --force to overwrite):');
				for (const file of skippedFiles) {
					console.log(`    - ${file}`);
				}
			}

			console.log('\n  Next steps:');
			nextSteps.forEach((step, i) => {
				console.log(`    ${i + 1}. ${step}`);
			});
		});

	// cicd validate - Validate tokens in CI environment
	cicd
		.command('validate')
		.description('Validate tokens for CI')
		.requiredOption('-n, --node <id>', 'Node ID to validate')
		.option('--fail-on-warning', 'Exit with error on warnings')
		.option('-f, --filter <pattern>', 'Filter tokens by pattern')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			// Run constraint validation
			const result = await registry.execute(
				'constraints.validate',
				{
					nodeId: options.node,
					filter: options.filter,
				},
				context,
			);

			if (!result.success) {
				if (globalOpts.json || globalOpts.agent) {
					console.log(JSON.stringify(result, null, globalOpts.agent ? 0 : 2));
				} else {
					console.error(formatError(result.error?.message || 'Validation failed'));
				}
				process.exit(1);
			}

			const data = result.data as {
				nodeId: string;
				valid: boolean;
				results: Array<{
					tokenId: string;
					valid: boolean;
					violations: Array<{ constraintName: string; severity: string; message: string }>;
				}>;
				summary: {
					totalTokens: number;
					validTokens: number;
					errors: number;
					warnings: number;
					infos: number;
				};
			};

			if (globalOpts.json || globalOpts.agent) {
				console.log(JSON.stringify(result, null, globalOpts.agent ? 0 : 2));
			} else {
				console.log(`\nValidation Results for ${options.node}:`);
				console.log(`  ✓ Valid: ${data.summary.validTokens}/${data.summary.totalTokens}`);
				console.log(`  ⚠ Warnings: ${data.summary.warnings}`);
				console.log(`  ✗ Errors: ${data.summary.errors}`);

				if (data.summary.errors > 0 || data.summary.warnings > 0) {
					console.log('\nViolations:');
					for (const item of data.results) {
						if (item.violations && item.violations.length > 0) {
							for (const v of item.violations) {
								console.log(`  - ${item.tokenId}: ${v.message}`);
							}
						}
					}
				}
			}

			if (data.summary.errors > 0) {
				process.exit(1);
			}

			if (options.failOnWarning && data.summary.warnings > 0) {
				process.exit(1);
			}
		});

	// cicd export - Export tokens for CI pipeline
	cicd
		.command('export')
		.description('Export tokens for CI pipeline')
		.requiredOption('-n, --node <id>', 'Node ID')
		.option('-f, --formats <formats>', 'Export formats (comma-separated)', 'json,css,typescript')
		.option('-o, --output <dir>', 'Output directory', 'dist')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const formats = options.formats.split(',').map((f: string) => f.trim());
			const outputDir = options.output;

			// Ensure output directory exists
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			const exportedFiles: string[] = [];
			const errors: string[] = [];

			for (const format of formats) {
				const outputFile = getExportFilename(format, outputDir);

				const result = await registry.execute(
					'export',
					{
						nodeId: options.node,
						format,
					},
					context,
				);

				if (result.success && result.data) {
					fs.writeFileSync(outputFile, (result.data as { content: string }).content);
					exportedFiles.push(outputFile);
				} else {
					errors.push(`${format}: ${result.error?.message || 'Export failed'}`);
				}
			}

			if (globalOpts.json || globalOpts.agent) {
				console.log(
					JSON.stringify(
						{
							success: errors.length === 0,
							data: {
								nodeId: options.node,
								formats,
								outputDir,
								exportedFiles,
								errors,
							},
						},
						null,
						globalOpts.agent ? 0 : 2,
					),
				);
			} else {
				if (exportedFiles.length > 0) {
					console.log(formatSuccess(`Exported ${exportedFiles.length} files`));
					for (const file of exportedFiles) {
						console.log(`  ✓ ${file}`);
					}
				}

				if (errors.length > 0) {
					console.log('\n  Errors:');
					for (const err of errors) {
						console.log(`  ✗ ${err}`);
					}
				}
			}

			if (errors.length > 0) {
				process.exit(1);
			}
		});

	// cicd diff - Generate token diff for PR
	cicd
		.command('diff')
		.description('Generate token diff for PR description')
		.requiredOption('-n, --node <id>', 'Node ID')
		.option('-b, --base <file>', 'Base tokens file (JSON)')
		.option('-f, --format <format>', 'Output format (markdown, json)', 'markdown')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			// Get current tokens
			const currentResult = await registry.execute(
				'tokens.resolve',
				{ nodeId: options.node },
				context,
			);

			if (!currentResult.success) {
				if (globalOpts.json || globalOpts.agent) {
					console.log(JSON.stringify(currentResult, null, globalOpts.agent ? 0 : 2));
				} else {
					console.error(formatError(currentResult.error?.message || 'Failed to resolve tokens'));
				}
				process.exit(1);
			}

			const currentTokens = tokensToRecord((currentResult.data as { tokens: unknown }).tokens);

			// Get base tokens
			let baseTokens: Record<string, unknown> = {};
			if (options.base) {
				if (fs.existsSync(options.base)) {
					const content = fs.readFileSync(options.base, 'utf-8');
					baseTokens = tokensToRecord(JSON.parse(content));
				} else {
					console.error(formatError(`Base file not found: ${options.base}`));
					process.exit(1);
				}
			}

			// Calculate diff
			const diff = calculateTokenDiff(baseTokens, currentTokens);

			if (options.format === 'json' || globalOpts.json || globalOpts.agent) {
				console.log(
					JSON.stringify(
						{
							success: true,
							data: diff,
						},
						null,
						globalOpts.agent ? 0 : 2,
					),
				);
			} else {
				console.log(formatDiffAsMarkdown(diff));
			}
		});
}

/**
 * What a consumer still has to do after `cicd setup`, one step per line
 */
function cicdNextSteps(templates: CicdTemplate[], options: CicdTemplateOptions): string[] {
	const steps: string[] = [];
	if (templates.includes('validate') || templates.includes('release')) {
		steps.push(
			`Install the CLI: npm install --save-dev ${CLI_PACKAGE}. ${CLI_NOT_PUBLISHED_NOTE}`,
			`Keep one DTCG file per node in ${options.tokensDir}/, each naming its parent under $extensions["dev.lushly.violet"], including node '${options.node}'`,
			`Try it locally: npx --no -- violet --from ${options.tokensDir} cicd validate --node ${options.node}`,
		);
	}
	if (templates.includes('sync')) {
		steps.push(
			'Set the VIOLET_API_URL repository variable to your Violet deployment URL (there is no default)',
			'Add the VIOLET_API_KEY repository secret: a hosted API key with the export:read scope (violet apikeys create)',
			'Allow GitHub Actions to create pull requests (Settings > Actions > General)',
		);
	}
	steps.push('Commit and push the workflow files');
	return steps;
}

/**
 * Get export filename for format
 */
function getExportFilename(format: string, outputDir: string): string {
	const filenames: Record<string, string> = {
		json: 'tokens.json',
		css: 'tokens.css',
		scss: 'tokens.scss',
		typescript: 'tokens.ts',
		swift: 'VioletTokens.swift',
		kotlin: 'VioletTokens.kt',
		dart: 'violet_tokens.dart',
		tailwind: 'tailwind.config.js',
	};

	return path.join(outputDir, filenames[format] || `tokens.${format}`);
}

/**
 * Normalize token data into a record of token id -> comparable value.
 *
 * Accepts the shapes the CLI produces or consumes:
 * - an array of resolved tokens (the `tokens` field of `tokens.resolve`)
 * - a command result envelope (`{ success, data: { tokens } }`)
 * - an object with a `tokens` field (array or record)
 * - a plain record of id -> value
 */
function tokensToRecord(input: unknown): Record<string, unknown> {
	if (Array.isArray(input)) {
		return tokenArrayToRecord(input);
	}
	if (!input || typeof input !== 'object') {
		return {};
	}

	const obj = input as Record<string, unknown>;
	const data = obj.data as Record<string, unknown> | undefined;
	if (data && typeof data === 'object' && 'tokens' in data) {
		return tokensToRecord(data.tokens);
	}
	if ('tokens' in obj) {
		return tokensToRecord(obj.tokens);
	}
	return obj;
}

function tokenArrayToRecord(tokens: unknown[]): Record<string, unknown> {
	const record: Record<string, unknown> = {};
	for (const item of tokens) {
		const token = item as { id?: unknown; resolvedValue?: unknown; value?: unknown } | null;
		if (token && typeof token.id === 'string') {
			record[token.id] = token.resolvedValue !== undefined ? token.resolvedValue : token.value;
		}
	}
	return record;
}

/**
 * Handle the result of an `export` command: write the generated content to
 * `outputPath` when given (creating parent directories), otherwise print it.
 */
function handleExportResult(
	result: CommandResult<unknown>,
	outputPath: string | undefined,
	globalOpts: { json?: boolean; agent?: boolean },
): void {
	if (!result.success || !result.data) {
		outputResult(result, globalOpts);
		return;
	}

	const data = result.data as { content: string; tokenCount?: number; format?: string };

	if (!outputPath) {
		console.log(data.content);
		return;
	}

	try {
		fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
		fs.writeFileSync(outputPath, data.content);
	} catch (err) {
		console.error(
			formatError(`Failed to write file: ${err instanceof Error ? err.message : String(err)}`),
		);
		process.exitCode = 1;
		return;
	}

	if (globalOpts.json || globalOpts.agent) {
		outputResult(
			{ ...result, data: { ...data, outputPath } } as CommandResult<unknown>,
			globalOpts,
		);
	} else {
		console.log(
			formatSuccess(
				`Exported ${data.tokenCount ?? 0} tokens${data.format ? ` as ${data.format}` : ''} to ${outputPath}`,
			),
		);
	}
}

/**
 * Token diff types
 */
interface TokenChange {
	id: string;
	oldValue?: unknown;
	newValue?: unknown;
}

interface TokenDiff {
	added: TokenChange[];
	changed: TokenChange[];
	removed: TokenChange[];
	summary: {
		added: number;
		changed: number;
		removed: number;
		total: number;
	};
}

/**
 * Calculate diff between two token sets
 */
function calculateTokenDiff(
	base: Record<string, unknown>,
	current: Record<string, unknown>,
): TokenDiff {
	const added: TokenChange[] = [];
	const changed: TokenChange[] = [];
	const removed: TokenChange[] = [];

	const baseKeys = new Set(Object.keys(base));
	const currentKeys = new Set(Object.keys(current));

	// Find added and changed tokens
	for (const key of currentKeys) {
		if (!baseKeys.has(key)) {
			added.push({ id: key, newValue: current[key] });
		} else if (JSON.stringify(base[key]) !== JSON.stringify(current[key])) {
			changed.push({ id: key, oldValue: base[key], newValue: current[key] });
		}
	}

	// Find removed tokens
	for (const key of baseKeys) {
		if (!currentKeys.has(key)) {
			removed.push({ id: key, oldValue: base[key] });
		}
	}

	return {
		added,
		changed,
		removed,
		summary: {
			added: added.length,
			changed: changed.length,
			removed: removed.length,
			total: added.length + changed.length + removed.length,
		},
	};
}

/**
 * Format token diff as markdown
 */
function formatDiffAsMarkdown(diff: TokenDiff): string {
	const lines: string[] = [];

	lines.push('## Token Changes\n');
	lines.push(
		`**Summary:** ${diff.summary.added} added, ${diff.summary.changed} changed, ${diff.summary.removed} removed\n`,
	);

	if (diff.added.length > 0) {
		lines.push('### Added Tokens\n');
		for (const token of diff.added) {
			const value =
				typeof token.newValue === 'string' ? token.newValue : JSON.stringify(token.newValue);
			lines.push(`- \`${token.id}\`: \`${value}\``);
		}
		lines.push('');
	}

	if (diff.changed.length > 0) {
		lines.push('### Changed Tokens\n');
		for (const token of diff.changed) {
			const oldVal =
				typeof token.oldValue === 'string' ? token.oldValue : JSON.stringify(token.oldValue);
			const newVal =
				typeof token.newValue === 'string' ? token.newValue : JSON.stringify(token.newValue);
			lines.push(`- \`${token.id}\`: \`${oldVal}\` → \`${newVal}\``);
		}
		lines.push('');
	}

	if (diff.removed.length > 0) {
		lines.push('### Removed Tokens\n');
		for (const token of diff.removed) {
			lines.push(`- \`${token.id}\``);
		}
		lines.push('');
	}

	if (diff.summary.total === 0) {
		lines.push('*No changes detected*\n');
	}

	return lines.join('\n');
}

/**
 * Add utility commands
 */
function addUtilityCommands(program: Command): void {
	program
		.command('commands')
		.description('List all available commands')
		.option('-c, --category <category>', 'Filter by category')
		.action((options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const commands = options.category
				? registry.list().filter((c) => c.category === options.category)
				: registry.list();

			if (globalOpts.json || globalOpts.agent) {
				const data = commands.map((c) => ({
					...c,
					inputSchema: registry.getInputJsonSchema(c.name),
				}));
				outputResult({ success: true, data: { total: data.length, commands: data } }, globalOpts);
				return;
			}

			if (options.category) {
				console.log(`\nCommands in category '${options.category}':\n`);
			} else {
				console.log('\nAll available commands:\n');
			}

			for (const cmd of commands) {
				console.log(`  ${cmd.name.padEnd(20)} ${cmd.description}`);
			}
			console.log();
		});

	program
		.command('doctor')
		.description('Check system health and configuration')
		.option('-v, --verbose', 'Include environment details')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'doctor',
				{ verbose: options.verbose || false },
				context,
			);

			if (globalOpts.json || globalOpts.agent) {
				outputResult(result, globalOpts);
				if (
					result.success &&
					(result.data as { healthy?: boolean } | undefined)?.healthy === false
				) {
					process.exitCode = 1;
				}
				return;
			}

			// Human-friendly output
			if (result.success && result.data) {
				const data = result.data as {
					healthy: boolean;
					checks: Array<{
						name: string;
						status: 'pass' | 'warn' | 'fail';
						message: string;
						detail?: string;
					}>;
					summary: {
						passed: number;
						warnings: number;
						failed: number;
						total: number;
					};
					environment?: {
						nodeVersion: string;
						platform: string;
						arch: string;
						cwd: string;
						packageVersion: string;
					};
				};
				const { healthy, checks, summary, environment } = data;

				console.log('\n🔍 Violet Design System Health Check\n');

				for (const check of checks) {
					const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
					const color =
						check.status === 'pass'
							? '\x1b[32m'
							: check.status === 'warn'
								? '\x1b[33m'
								: '\x1b[31m';
					const reset = '\x1b[0m';

					console.log(`  ${color}${icon}${reset} ${check.name}: ${check.message}`);
					if (check.detail) {
						console.log(`      ${check.detail}`);
					}
				}

				console.log('\n  Summary:');
				console.log(`    Passed:   ${summary.passed}`);
				if (summary.warnings > 0) {
					console.log(`    Warnings: ${summary.warnings}`);
				}
				if (summary.failed > 0) {
					console.log(`    Failed:   ${summary.failed}`);
				}
				console.log(`    Total:    ${summary.total}`);

				if (environment) {
					console.log('\n  Environment:');
					console.log(`    Node.js:  ${environment.nodeVersion}`);
					console.log(`    Platform: ${environment.platform} (${environment.arch})`);
					console.log(`    CWD:      ${environment.cwd}`);
					console.log(`    Version:  ${environment.packageVersion}`);
				}

				console.log();

				if (!healthy) {
					process.exit(1);
				}
			} else {
				console.error(formatError(result.error?.message || 'Health check failed'));
				process.exit(1);
			}
		});

	program
		.command('validate')
		.description('Run test suite with optional coverage')
		.option('-c, --coverage', 'Include coverage report')
		.option('-f, --filter <pattern>', 'Filter tests by pattern')
		.option('-b, --bail', 'Stop on first failure')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'validate',
				{
					coverage: options.coverage || false,
					filter: options.filter,
					bail: options.bail || false,
				},
				context,
			);

			if (globalOpts.json || globalOpts.agent) {
				outputResult(result, globalOpts);
				if (result.success && (result.data as { passed?: boolean } | undefined)?.passed === false) {
					process.exitCode = 1;
				}
				return;
			}

			// Human-friendly output
			if (result.success && result.data) {
				const data = result.data as {
					passed: boolean;
					testResults: {
						total: number;
						passed: number;
						failed: number;
						skipped: number;
						duration: number;
					};
					coverage?: {
						statements: number;
						branches: number;
						functions: number;
						lines: number;
					};
					rawOutput?: string;
				};
				const { passed, testResults, coverage } = data;

				console.log('\n🧪 Violet Design Test Results\n');

				const icon = passed ? '✓' : '✗';
				const color = passed ? '\x1b[32m' : '\x1b[31m';
				const reset = '\x1b[0m';

				console.log(
					`  ${color}${icon}${reset} Tests: ${testResults.passed}/${testResults.total} passed`,
				);
				if (testResults.failed > 0) {
					console.log(`  \x1b[31m✗\x1b[0m Failed: ${testResults.failed}`);
				}
				if (testResults.skipped > 0) {
					console.log(`  ⊘ Skipped: ${testResults.skipped}`);
				}

				if (coverage) {
					console.log('\n  Coverage:');
					console.log(`    Statements: ${coverage.statements.toFixed(1)}%`);
					console.log(`    Branches:   ${coverage.branches.toFixed(1)}%`);
					console.log(`    Functions:  ${coverage.functions.toFixed(1)}%`);
					console.log(`    Lines:      ${coverage.lines.toFixed(1)}%`);
				}

				console.log(`\n  Duration: ${(testResults.duration / 1000).toFixed(2)}s\n`);

				if (!passed) {
					process.exit(1);
				}
			} else {
				console.error(formatError(result.error?.message || 'Test run failed'));
				process.exit(1);
			}
		});

	// ============================================
	// docs command - Generate documentation
	// ============================================
	program
		.command('docs')
		.description('Generate command reference documentation')
		.option('-f, --format <format>', 'Output format (markdown, json)', 'markdown')
		.option('--filter <pattern>', 'Filter commands by pattern (e.g., node.*)')
		.option('--no-schemas', 'Exclude input/output schemas')
		.option('--no-examples', 'Exclude command examples')
		.option('-o, --output <path>', 'Write output to file')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			const result = await registry.execute(
				'docs.generate',
				{
					format: options.format,
					filter: options.filter,
					includeSchemas: options.schemas !== false,
					includeExamples: options.examples !== false,
				},
				context,
			);

			if (globalOpts.json || globalOpts.agent) {
				outputResult(result, globalOpts);
				return;
			}

			if (result.success && result.data) {
				const data = result.data as {
					commandCount: number;
					categories: string[];
					markdown?: string;
					commands: Array<{ name: string; description: string }>;
					errorCodes: Array<{ code: string }>;
				};

				// Write to file if requested
				if (options.output) {
					const content =
						options.format === 'markdown'
							? data.markdown || ''
							: JSON.stringify(result.data, null, 2);

					fs.writeFileSync(options.output, content);
					console.log(formatSuccess(`Documentation written to ${options.output}`));
					console.log(`\n  Commands: ${data.commandCount}`);
					console.log(`  Categories: ${data.categories.join(', ')}`);
				} else if (options.format === 'markdown' && data.markdown) {
					console.log(data.markdown);
				} else {
					// Human-friendly summary
					console.log(formatSuccess('Documentation generated'));
					console.log(`\n  Commands: ${data.commandCount}`);
					console.log(`  Categories: ${data.categories.join(', ')}`);
					console.log(`  Error Codes: ${data.errorCodes.length}`);
					console.log('\nUse --output <file> to save, or --format json for raw output');
				}
			} else {
				console.error(formatError(result.error?.message || 'Failed to generate docs'));
				process.exit(1);
			}
		});

	program
		.command('init')
		.description('Initialize a new Violet Design project')
		.option('-n, --name <name>', 'Root node name', 'global-base')
		.action(async (options, cmd) => {
			const globalOpts = cmd.parent.opts();
			const db = await getDatabase(globalOpts);
			const context = createContext(db);

			// Create root node
			const result = await registry.execute(
				'node.create',
				{
					name: options.name,
					type: 'root',
					parentId: null,
				},
				context,
			);

			if (globalOpts.json || globalOpts.agent) {
				outputResult(result, globalOpts);
				return;
			}

			if (result.success) {
				console.log(formatSuccess(`Initialized Violet Design with root node '${options.name}'`));
				console.log('\nNext steps:');
				console.log(`  violet node create --name my-product --parent ${options.name}`);
				console.log(
					`  violet token add --node ${options.name} --token color.brand.primary --value "#0078D4"`,
				);
			} else {
				console.error(formatError(result.error?.message || 'Failed to initialize'));
				process.exit(1);
			}
		});
}

/**
 * The changes.impact `changes` list from `violet impact` options, or an error
 * message. Changes apply in this order: adds, overrides, resets, then removals.
 */
function impactChanges(options: {
	add: string[];
	override: string[];
	reset: string[];
	subtract: string[];
}): Array<Record<string, unknown>> | string {
	const changes: Array<Record<string, unknown>> = [];
	for (const [type, specs] of [
		['add', options.add],
		['override', options.override],
	] as const) {
		for (const spec of specs) {
			const [tokenId, raw] = splitAssignment(spec);
			if (raw === undefined) return `--${type} expects token=value, got '${spec}'`;
			changes.push({ type, tokenId, value: parseCliValue(raw) });
		}
	}
	for (const spec of options.reset) {
		const [tokenId, toAncestor] = splitAssignment(spec);
		changes.push({ type: 'reset', tokenId, ...(toAncestor ? { toAncestor } : {}) });
	}
	for (const tokenId of options.subtract) {
		changes.push({ type: 'subtract', tokenId });
	}
	return changes.length > 0
		? changes
		: 'Nothing to preview: pass at least one of --add, --override, --reset or --subtract';
}

/** Commander collector for repeatable options */
function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}

/** Split `token=value` on the first '=' */
function splitAssignment(spec: string): [string, string | undefined] {
	const index = spec.indexOf('=');
	return index < 0 ? [spec, undefined] : [spec.slice(0, index), spec.slice(index + 1)];
}

/** Parse a --value the way token add/override do: JSON first, else the raw text */
function parseCliValue(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

/**
 * Get database instance based on options
 */
async function getDatabase(options: { db?: string; memory?: boolean; from?: string }) {
	if (options.from) {
		return loadTreeFromFiles(options.from);
	}

	if (options.memory) {
		return createMemoryDatabase();
	}

	const dbPath = options.db || getDefaultDbPath();

	// Ensure directory exists
	const dir = path.dirname(dbPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	return createSQLiteDatabase(dbPath);
}

/**
 * Build an in-memory database from every *.json file under `dir` (see import.tree)
 */
async function loadTreeFromFiles(dir: string): Promise<Database> {
	let files: Array<{ name: string; content: string }>;
	try {
		files = fs
			.readdirSync(dir, { recursive: true, encoding: 'utf-8' })
			.filter((name) => name.endsWith('.json'))
			.sort()
			.map((name) => ({ name, content: fs.readFileSync(path.join(dir, name), 'utf-8') }));
	} catch (err) {
		console.error(
			formatError(
				`Failed to read --from ${dir}: ${err instanceof Error ? err.message : String(err)}`,
			),
		);
		process.exit(1);
	}

	if (files.length === 0) {
		console.error(formatError(`No *.json token files found in ${dir}`));
		process.exit(1);
	}

	const db = createMemoryDatabase();
	const result = await registry.execute('import.tree', { files }, createContext(db));
	if (!result.success) {
		console.error(formatOutput(result));
		process.exit(1);
	}
	return db;
}

/**
 * Get default database path
 */
function getDefaultDbPath(): string {
	const homeDir = os.homedir();
	return path.join(homeDir, '.violet', 'violet.db');
}

/**
 * Create command context
 */
function createContext(db: Database): CommandContext {
	return {
		db,
		actor: process.env.USER || 'cli',
		traceId: nanoid(),
	};
}

/**
 * Output result based on format options
 */
function outputResult(
	result: CommandResult<unknown>,
	options: { json?: boolean; agent?: boolean },
): void {
	if (options.json || options.agent) {
		console.log(JSON.stringify(result, null, options.agent ? 0 : 2));
	} else {
		console.log(formatOutput(result));
	}

	if (!result.success) {
		process.exit(1);
	}
}
