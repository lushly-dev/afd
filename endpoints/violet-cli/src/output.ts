import type { CommandResult } from '@lushly-dev/violet-afd';
import chalk from 'chalk';

/**
 * Format a command result for terminal output
 */
export function formatOutput(result: CommandResult<unknown>): string {
	const lines: string[] = [];

	if (result.success) {
		// Success output
		if (result.data) {
			lines.push(formatData(result.data));
		}

		if (result.reasoning) {
			lines.push('');
			lines.push(chalk.dim(`ℹ ${result.reasoning}`));
		}

		if (result.warnings && result.warnings.length > 0) {
			lines.push('');
			for (const warning of result.warnings) {
				lines.push(chalk.yellow(`⚠ ${warning.message}`));
			}
		}
	} else {
		// Error output
		lines.push(formatError(result.error?.message || 'Unknown error'));

		if (result.error?.suggestion) {
			lines.push(chalk.dim(`  💡 ${result.error.suggestion}`));
		}

		if (result.alternatives && result.alternatives.length > 0) {
			lines.push('');
			lines.push(chalk.dim('Did you mean:'));
			for (const alt of result.alternatives.slice(0, 3)) {
				lines.push(chalk.dim(`  • ${alt.reason}`));
			}
		}
	}

	// Execution metadata
	if (result.metadata?.executionTimeMs) {
		lines.push('');
		lines.push(chalk.dim(`[${result.metadata.executionTimeMs}ms]`));
	}

	return lines.join('\n');
}

/**
 * Format data for terminal output
 */
function formatData(data: unknown, indent = 0): string {
	const padding = '  '.repeat(indent);

	if (data === null || data === undefined) {
		return `${padding}${chalk.dim('null')}`;
	}

	if (typeof data === 'string') {
		return `${padding}${chalk.green(`"${data}"`)}`;
	}

	if (typeof data === 'number' || typeof data === 'boolean') {
		return `${padding}${chalk.yellow(String(data))}`;
	}

	if (Array.isArray(data)) {
		if (data.length === 0) {
			return `${padding}[]`;
		}

		// Check if it's an array of simple values
		if (data.every((item) => typeof item !== 'object' || item === null)) {
			return `${padding}[${data.map((item) => formatSimpleValue(item)).join(', ')}]`;
		}

		// Array of objects - format each
		const lines = [`${padding}[`];
		for (const item of data) {
			lines.push(`${formatData(item, indent + 1)},`);
		}
		lines.push(`${padding}]`);
		return lines.join('\n');
	}

	if (typeof data === 'object') {
		const entries = Object.entries(data);
		if (entries.length === 0) {
			return `${padding}{}`;
		}

		const lines = [`${padding}{`];
		for (const [key, value] of entries) {
			const valueStr = formatData(value, 0).trim();
			if (valueStr.includes('\n')) {
				lines.push(`${padding}  ${chalk.cyan(key)}:`);
				lines.push(formatData(value, indent + 2));
			} else {
				lines.push(`${padding}  ${chalk.cyan(key)}: ${valueStr}`);
			}
		}
		lines.push(`${padding}}`);
		return lines.join('\n');
	}

	return `${padding}${String(data)}`;
}

/**
 * Format a simple value inline
 */
function formatSimpleValue(value: unknown): string {
	if (value === null || value === undefined) {
		return chalk.dim('null');
	}
	if (typeof value === 'string') {
		return chalk.green(`"${value}"`);
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return chalk.yellow(String(value));
	}
	return String(value);
}

/**
 * Format an error message
 */
export function formatError(message: string): string {
	return chalk.red(`✗ ${message}`);
}

/**
 * Format a success message
 */
export function formatSuccess(message: string): string {
	return chalk.green(`✓ ${message}`);
}

/**
 * Format a warning message
 */
export function formatWarning(message: string): string {
	return chalk.yellow(`⚠ ${message}`);
}

/**
 * Format a table (for list commands)
 */
export function formatTable(
	headers: string[],
	rows: string[][],
	options: { alignRight?: number[] } = {},
): string {
	// Calculate column widths
	const widths = headers.map((h, i) => {
		const maxRow = Math.max(...rows.map((r) => (r[i] || '').length));
		return Math.max(h.length, maxRow);
	});

	// Format header
	const headerRow = headers
		.map((h, i) => {
			const align = options.alignRight?.includes(i) ? 'padStart' : 'padEnd';
			return chalk.bold(h[align](widths[i]));
		})
		.join('  ');

	// Format separator
	const separator = widths.map((w) => '─'.repeat(w)).join('──');

	// Format rows
	const dataRows = rows.map((row) =>
		row
			.map((cell, i) => {
				const align = options.alignRight?.includes(i) ? 'padStart' : 'padEnd';
				return (cell || '')[align](widths[i]);
			})
			.join('  '),
	);

	return [headerRow, separator, ...dataRows].join('\n');
}

/**
 * Shape of a tokens.matrix result, as far as the terminal renderer needs it
 */
export interface MatrixData {
	nodes: Array<{ id: string; error?: string }>;
	tokens: Array<{
		id: string;
		cells: Record<
			string,
			{ state: string; resolvedValue?: string | number; violations?: unknown[] }
		>;
	}>;
	groups?: Array<{ id: string; tokens: number; varyingTokens: number; violations: number }>;
	page?: { nextCursor: string | null; prevCursor?: string | null };
}

const MATRIX_MARKERS: Record<string, string> = {
	add: '+',
	override: '~',
	copy: 'c',
	reset: 'r',
	include: 'i',
};

const MATRIX_VALUE_WIDTH = 16;

type MatrixCellData = MatrixData['tokens'][number]['cells'][string];

/** A matrix cell as terminal text: the value with its marker, or a symbol for no value */
function describeMatrixCell(cell: MatrixCellData | undefined): string {
	if (!cell) {
		return '';
	}
	let text: string;
	switch (cell.state) {
		case 'subtracted':
			text = '✕';
			break;
		case 'absent':
			text = '–';
			break;
		case 'unresolved':
			text = '!';
			break;
		default: {
			const value = String(cell.resolvedValue ?? '');
			const clipped =
				value.length > MATRIX_VALUE_WIDTH ? `${value.slice(0, MATRIX_VALUE_WIDTH - 1)}…` : value;
			const marker = MATRIX_MARKERS[cell.state];
			text = marker ? `${clipped} ${marker}` : clipped;
		}
	}
	return cell.violations && cell.violations.length > 0 ? `${text} ⚠` : text;
}

/**
 * Format a tokens.matrix result as a token × node grid.
 *
 * Inherited values print bare; values set on the node carry a marker; removed
 * or missing tokens print a symbol instead of a value.
 */
export function formatMatrix(data: MatrixData): string {
	if (data.tokens.length === 0 && data.groups && data.groups.length > 0) {
		return formatTable(
			['group', 'tokens', 'varying', 'violations'],
			data.groups.map((group) => [
				group.id,
				String(group.tokens),
				String(group.varyingTokens),
				String(group.violations),
			]),
		);
	}
	if (data.tokens.length === 0) {
		return chalk.dim('No tokens match');
	}

	const headers = ['token', ...data.nodes.map((node) => node.id)];
	const rows = data.tokens.map((token) => [
		token.id,
		...data.nodes.map((node) => describeMatrixCell(token.cells[node.id])),
	]);

	const legend = chalk.dim(
		'+ add  ~ override  c copy  r reset  i include  (bare = inherited)  ✕ subtracted  – absent  ! unresolved  ⚠ violation',
	);
	const earlier = data.page?.prevCursor
		? `\n${chalk.dim(`Earlier rows: --cursor ${data.page.prevCursor}`)}`
		: '';
	const more = data.page?.nextCursor
		? `\n${chalk.dim(`More rows: --cursor ${data.page.nextCursor}`)}`
		: '';
	return `${formatTable(headers, rows)}\n\n${legend}${earlier}${more}`;
}

/**
 * Shape of a tokens.compare result, as far as the terminal renderer needs it
 */
export interface CompareData {
	nodes: Array<{ id: string; error?: string }>;
	baseline: string;
	tokens: Array<{
		id: string;
		differs: boolean;
		cells: Record<string, MatrixCellData & { differs: boolean }>;
	}>;
	summary: {
		compared: number;
		different: number;
		categories: Array<{ id: string; compared: number; different: number }>;
		pairs: Array<{ nodes: [string, string]; different: number; similarity: number }>;
	};
}

/**
 * Format a tokens.compare result: one column per node, values that differ from
 * the first node marked with ≠, then how alike each pair of nodes is.
 */
export function formatCompare(data: CompareData): string {
	const headers = ['token', ...data.nodes.map((node) => node.id)];
	const rows = data.tokens.map((token) => [
		token.id,
		...data.nodes.map((node) => {
			const cell = token.cells[node.id];
			const text = describeMatrixCell(cell);
			return cell?.differs ? `${text} ≠` : text;
		}),
	]);
	const table = rows.length > 0 ? formatTable(headers, rows) : chalk.dim('No tokens differ');
	const categories = data.summary.categories
		.filter((category) => category.different > 0)
		.map((category) => `${category.id} ${category.different}/${category.compared}`)
		.join('  ');
	const pairs = data.summary.pairs.map(
		(pair) =>
			`  ${pair.nodes[0]} ↔ ${pair.nodes[1]}: ${pair.similarity}% the same (${pair.different} differ)`,
	);
	const legend = chalk.dim(
		`≠ differs from ${data.baseline}  + add  ~ override  c copy  r reset  i include  ✕ subtracted  – absent  ! unresolved`,
	);
	return [
		table,
		'',
		`${data.summary.different} of ${data.summary.compared} token(s) differ${categories ? `: ${categories}` : ''}`,
		...pairs,
		'',
		legend,
	].join('\n');
}

/**
 * Shape of a nodes.graph result, as far as the terminal renderer needs it
 */
export interface GraphData {
	roots: string[];
	nodes: Array<{
		id: string;
		type: string;
		parentId: string | null;
		external: boolean;
		includes: string[];
		changes: Record<'add' | 'override' | 'subtract' | 'reset' | 'copy', number>;
		operations?: Array<{
			type: string;
			tokenId: string;
			value?: unknown;
			fromNode?: string;
			asTokenId?: string;
			toAncestor?: string;
		}>;
	}>;
	edges: Array<{ kind: string; from: string; to: string; tokens?: Array<{ tokenId: string }> }>;
	trace?: {
		tokenId: string;
		found: boolean;
		cells: Record<
			string,
			{ state: string; resolvedValue?: string | number; source: string | null }
		>;
	};
}

const CHANGE_MARKERS: Array<[keyof GraphData['nodes'][number]['changes'], string]> = [
	['add', '+'],
	['override', '~'],
	['subtract', '−'],
	['reset', 'r'],
	['copy', 'c'],
];

function formatOperation(
	op: NonNullable<GraphData['nodes'][number]['operations']>[number],
): string {
	const value =
		op.value === undefined
			? ''
			: ` = ${typeof op.value === 'string' ? op.value : JSON.stringify(op.value)}`;
	switch (op.type) {
		case 'subtract':
			return `− ${op.tokenId}`;
		case 'reset':
			return `r ${op.tokenId}${op.toAncestor ? ` to ${op.toAncestor}` : ''}`;
		case 'copy':
			return `c ${op.asTokenId ?? op.tokenId} from ${op.fromNode}${op.asTokenId ? ` (${op.tokenId})` : ''}`;
		default:
			return `${MATRIX_MARKERS[op.type] ?? '?'} ${op.tokenId}${value}`;
	}
}

/**
 * Format a nodes.graph result as an indented tree.
 *
 * Each node shows how much it changes (+ add, ~ override, − subtract, r reset,
 * c copy) and its mixin/copy sources. With a trace, each node shows the traced
 * token's value instead, marked where the node sets it.
 */
export function formatTree(data: GraphData): string {
	const byId = new Map(data.nodes.map((node) => [node.id, node]));
	const children = new Map<string, string[]>();
	for (const edge of data.edges) {
		if (edge.kind === 'parent') {
			children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
		}
	}
	const copiesInto = new Map<string, string[]>();
	for (const edge of data.edges) {
		if (edge.kind === 'copy') {
			const tokens = (edge.tokens ?? []).map((token) => token.tokenId).join(', ');
			copiesInto.set(edge.to, [...(copiesInto.get(edge.to) ?? []), `${tokens} from ${edge.from}`]);
		}
	}

	const describe = (id: string): string => {
		const node = byId.get(id);
		if (!node) return id;
		const label = `${chalk.bold(node.id)} ${chalk.dim(`(${node.type})`)}`;
		if (data.trace) {
			const cell = data.trace.cells[id];
			let value: string;
			if (!cell || cell.state === 'absent') {
				value = chalk.dim(cell?.source ? `– (subtracted on ${cell.source})` : '–');
			} else if (cell.state === 'subtracted') value = '✕ subtracted';
			else if (cell.state === 'unresolved') value = chalk.red('! unresolved');
			else {
				const marker = MATRIX_MARKERS[cell.state];
				const text = String(cell.resolvedValue ?? '');
				value = marker ? `${text} ${marker}` : chalk.dim(text);
			}
			return `${label}  ${value}`;
		}
		const counts = CHANGE_MARKERS.filter(([key]) => node.changes[key] > 0)
			.map(([key, marker]) => `${marker}${node.changes[key]}`)
			.join(' ');
		const notes = [
			...node.includes.map((include) => `includes ${include}`),
			...(copiesInto.get(id) ?? []).map((copy) => `copies ${copy}`),
		];
		return [label, counts, notes.length > 0 ? chalk.dim(`⇠ ${notes.join('; ')}`) : '']
			.filter(Boolean)
			.join('  ');
	};

	const lines: string[] = [];
	const visit = (id: string, prefix: string, connector: string, childPrefix: string) => {
		lines.push(`${prefix}${connector}${describe(id)}`);
		for (const op of byId.get(id)?.operations ?? []) {
			lines.push(
				chalk.dim(
					`${prefix}${childPrefix}${(children.get(id)?.length ?? 0) > 0 ? '│ ' : '  '}  ${formatOperation(op)}`,
				),
			);
		}
		const kids = children.get(id) ?? [];
		kids.forEach((kid, index) => {
			const last = index === kids.length - 1;
			visit(kid, prefix + childPrefix, last ? '└─ ' : '├─ ', last ? '   ' : '│  ');
		});
	};
	for (const root of data.roots) {
		visit(root, '', '', '');
	}

	const external = data.nodes.filter((node) => node.external);
	if (external.length > 0) {
		lines.push('', chalk.dim('Sources outside this subtree:'));
		for (const node of external) {
			visit(node.id, '  ', '', '');
		}
	}

	const legend = data.trace
		? `Tracing ${data.trace.tokenId}${data.trace.found ? '' : ' (not defined in this graph)'} · + add  ~ override  c copy  r reset  i include  (dim = inherited)  ✕ subtracted  – absent`
		: '+ add  ~ override  − subtract  r reset  c copy  ⇠ mixin/copy sources';
	return `${lines.join('\n')}\n\n${chalk.dim(legend)}`;
}

/**
 * Shape of a tokens.catalog result, as far as the terminal renderer needs it
 */
export interface CatalogData {
	tokens: Array<{
		id: string;
		category: string;
		tier: string;
		status: string;
		definedAt: string;
		customizedOn: string[];
		removedOn: string[];
	}>;
	total: number;
}

/** Format a tokens.catalog result as a table. */
export function formatCatalog(data: CatalogData): string {
	if (data.tokens.length === 0) {
		return chalk.dim('No tokens match');
	}
	const rows = data.tokens.map((token) => [
		token.id,
		token.category,
		token.tier,
		token.status === 'stable' ? '' : token.status,
		token.definedAt,
		token.customizedOn.length > 0 ? String(token.customizedOn.length) : '',
		token.removedOn.length > 0 ? String(token.removedOn.length) : '',
	]);
	return formatTable(
		['token', 'category', 'tier', 'status', 'defined on', 'customized on', 'removed on'],
		rows,
		{ alignRight: [5, 6] },
	);
}

/**
 * Shape of an analyze.violations result, as far as the terminal renderer needs it
 */
export interface ViolationsData {
	violations: Array<{
		nodeId: string;
		owner?: string;
		tokenId: string;
		value: string | number;
		source: string;
		inherited: boolean;
		constraintName: string;
		severity: string;
		expected?: string;
		actual?: string;
	}>;
}

/** Format an analyze.violations result as a table, errors first. */
export function formatViolations(data: ViolationsData): string {
	if (data.violations.length === 0) {
		return chalk.green('✓ No violations');
	}
	const rows = data.violations.map((violation) => [
		violation.severity,
		violation.nodeId,
		violation.tokenId,
		violation.constraintName,
		violation.actual ?? String(violation.value),
		violation.expected ?? '',
		violation.inherited ? `inherited from ${violation.source}` : 'set here',
		violation.owner ?? '',
	]);
	return formatTable(
		['severity', 'node', 'token', 'rule', 'actual', 'expected', 'value', 'owner'],
		rows,
	);
}

/**
 * Shape of an analyze.health result, as far as the terminal renderer needs it
 */
export interface HealthData {
	baseline: string;
	sort: string;
	nodes: Array<{
		id: string;
		status: string;
		depth: number;
		owner?: string;
		customizations: { total: number };
		drift: { baseline: string | null; ratio: number };
		violations?: { error: number; warning: number; info: number };
		coupling: { includes: string[]; borrows: unknown[]; borrowedBy: string[] };
		flags: Array<{ kind: string; message: string }>;
		subtree: { nodes: number; customizations: number; violations: number };
		error?: string;
	}>;
	summary: {
		owners: Array<{ owner: string | null; nodes: number; violations: number }>;
		sunsets?: Array<{
			id: string;
			sunsetAt: string;
			daysLeft: number;
			replacedBy: string | null;
			descendants: number;
			borrowers: number;
		}>;
	};
}

const FLAG_LABELS: Record<string, string> = {
	'redundant-override': 'redundant',
	'sibling-borrow': 'sibling borrow',
	'deprecated-with-children': 'deprecated with children',
	'inert-reset': 'inert reset',
	'sunset-without-replacement': 'sunset, no replacement',
	'replacement-deprecated': 'replacement deprecated',
	'past-sunset': 'past sunset',
};

/** "in 12 days", "today" or "3 days ago" */
function daysText(days: number): string {
	if (days === 0) return 'today';
	const n = Math.abs(days);
	const unit = n === 1 ? 'day' : 'days';
	return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/**
 * Format an analyze.health result: one row per node (indented in tree order),
 * then every risk flag, then nodes and violations per owner.
 */
export function formatHealth(data: HealthData): string {
	if (data.nodes.length === 0) {
		return chalk.dim('No nodes');
	}
	const indent = data.sort === 'tree';
	const count = (value: number) => (value > 0 ? String(value) : '');
	const rows = data.nodes.map((node) => {
		const links =
			node.coupling.includes.length +
			node.coupling.borrows.length +
			node.coupling.borrowedBy.length;
		return [
			`${indent ? '  '.repeat(node.depth) : ''}${node.id}${node.error ? ' !' : ''}`,
			node.status === 'active' ? '' : node.status,
			node.owner ?? '',
			count(node.customizations.total),
			node.subtree.nodes > 1 ? String(node.subtree.customizations) : '',
			node.drift.baseline === null ? '' : `${Math.round(node.drift.ratio * 100)}%`,
			count(node.violations?.error ?? 0),
			count(node.violations?.warning ?? 0),
			count(links),
			count(node.flags.length),
		];
	});
	const lines = [
		formatTable(
			[
				'node',
				'status',
				'owner',
				'changes',
				'subtree',
				'drift',
				'errors',
				'warnings',
				'links',
				'flags',
			],
			rows,
			{ alignRight: [3, 4, 5, 6, 7, 8, 9] },
		),
	];

	const flagged = data.nodes.flatMap((node) =>
		node.flags.map((flag) => [node.id, FLAG_LABELS[flag.kind] ?? flag.kind, flag.message]),
	);
	if (flagged.length > 0) {
		lines.push('', chalk.bold('Flags'), formatTable(['node', 'flag', 'detail'], flagged));
	}

	const sunsets = (data.summary.sunsets ?? []).map((entry) => [
		entry.id,
		entry.sunsetAt,
		daysText(entry.daysLeft),
		entry.replacedBy ?? chalk.dim('(none)'),
		count(entry.descendants),
		count(entry.borrowers),
	]);
	if (sunsets.length > 0) {
		lines.push(
			'',
			chalk.bold('Sunsets'),
			formatTable(['node', 'sunset', 'when', 'replaced by', 'descendants', 'borrowers'], sunsets, {
				alignRight: [4, 5],
			}),
		);
	}

	const owners = data.summary.owners.map((entry) => [
		entry.owner ?? chalk.dim('(no owner)'),
		String(entry.nodes),
		count(entry.violations),
	]);
	if (owners.length > 1 || data.summary.owners[0]?.owner) {
		lines.push(
			'',
			chalk.bold('Owners'),
			formatTable(['owner', 'nodes', 'violations'], owners, { alignRight: [1, 2] }),
		);
	}

	lines.push(
		'',
		chalk.dim(
			`drift: share of resolved tokens that differ from ${data.baseline === 'parent' ? 'the parent' : data.baseline === 'root' ? 'the root' : data.baseline} · changes: own customizations · subtree: changes including descendants · links: mix-ins, borrows and borrowers`,
		),
	);
	return lines.join('\n');
}

/**
 * Shape of an audit.list result, as far as the terminal renderer needs it
 */
export interface AuditData {
	events: Array<{
		timestamp: string;
		eventType: string;
		actor: string;
		targetNode: string;
		targetToken?: string;
		oldValue?: unknown;
		newValue?: unknown;
	}>;
	days: Array<{ date: string; count: number }>;
	summary: { total: number };
	page: { offset: number; returned: number; nextOffset: number | null };
}

function auditValue(value: unknown): string {
	if (value === undefined) return '';
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	return text.length > 32 ? `${text.slice(0, 31)}…` : text;
}

/**
 * Format an audit.list result: the page of events, newest first, then a bar
 * per day for every match, then where the next page starts.
 */
export function formatAudit(data: AuditData): string {
	if (data.summary.total === 0) {
		return chalk.dim('No audit events match');
	}
	const lines: string[] = [];
	if (data.events.length > 0) {
		const rows = data.events.map((event) => {
			// Node and token events carry whole records; show values only for token changes
			const change = event.targetToken
				? [auditValue(event.oldValue), auditValue(event.newValue)].filter(Boolean).join(' → ')
				: '';
			return [
				event.timestamp.slice(0, 19).replace('T', ' '),
				event.eventType,
				event.actor,
				event.targetNode,
				event.targetToken ?? '',
				change,
			];
		});
		lines.push(formatTable(['time (UTC)', 'event', 'actor', 'node', 'token', 'change'], rows));
	}

	const most = Math.max(...data.days.map((day) => day.count));
	const width = String(most).length;
	lines.push(
		'',
		chalk.bold('Per day'),
		...data.days.map(
			(day) =>
				`${day.date}  ${String(day.count).padStart(width)}  ${'█'.repeat(Math.max(1, Math.round((day.count / most) * 30)))}`,
		),
	);

	const first = data.page.offset + 1;
	const last = data.page.offset + data.page.returned;
	const range = data.page.returned > 0 ? `${first}–${last}` : 'none';
	const next =
		data.page.nextOffset === null ? '' : ` · next page: --offset ${data.page.nextOffset}`;
	lines.push('', chalk.dim(`Showing ${range} of ${data.summary.total}${next}`));
	return lines.join('\n');
}

/**
 * Shape of an analyze.trends result, as far as the terminal renderer needs it
 */
export interface TrendsData {
	since: string;
	until: string;
	days: Array<{
		date: string;
		changes: number;
		tokenChanges: number;
		open?: number;
		recorded?: { total: number };
	}>;
	summary: {
		nodes: number;
		changes: number;
		violations?: { open: { total: number }; before: number; during: number; undated: number };
		history?: {
			days: number;
			firstOpen: number;
			lastOpen: number;
			introduced: number;
			fixed: number;
		};
	};
}

/**
 * Format an analyze.trends result: one row per day that had changes or a new
 * open issue, with a bar for the changes and the running count of open issues.
 */
export function formatTrends(data: TrendsData): string {
	const issues = data.summary.violations;
	const history = data.summary.history && data.summary.history.days > 0;
	const active = data.days.filter(
		(day, index) =>
			day.changes > 0 ||
			day.recorded !== undefined ||
			(day.open ?? 0) !== (data.days[index - 1]?.open ?? 0),
	);
	const lines: string[] = [];
	if (active.length === 0) {
		lines.push(
			chalk.dim(`No changes between ${data.since.slice(0, 10)} and ${data.until.slice(0, 10)}`),
		);
	} else {
		const most = Math.max(1, ...active.map((day) => day.changes));
		const width = String(most).length;
		lines.push(
			chalk.bold(
				`Day          changes${issues ? '  open issues' : ''}${history ? '  recorded' : ''}`,
			),
			...active.map((day) => {
				const bar =
					day.changes > 0 ? '█'.repeat(Math.max(1, Math.round((day.changes / most) * 24))) : '';
				const open = issues ? `  ${String(day.open ?? 0).padStart(11)}` : '';
				const recorded = history
					? `  ${(day.recorded ? String(day.recorded.total) : '·').padStart(8)}`
					: '';
				return `${day.date}  ${String(day.changes).padStart(Math.max(width, 7))}${open}${recorded}  ${bar}`;
			}),
		);
	}
	if (issues) {
		lines.push(
			'',
			chalk.dim(
				`open issues: ${issues.open.total} now · value set before the range: ${issues.before} · in it: ${issues.during} · undated: ${issues.undated}. Issues fixed since are not counted on earlier days${history ? '; the recorded column is' : ' (record checks with `violet snapshot` for'} true history${history ? '' : ')'}.`,
			),
		);
	}
	const recorded = data.summary.history;
	if (recorded && recorded.days > 0) {
		lines.push(
			chalk.dim(
				`recorded checks on ${recorded.days} day(s): ${recorded.firstOpen} → ${recorded.lastOpen} open · ${recorded.introduced} new · ${recorded.fixed} fixed`,
			),
		);
	}
	return lines.join('\n');
}

/**
 * Shape of a specimen.get result, as far as the terminal renderer needs it
 */
export interface SpecimenData {
	nodeId: string;
	rootId: string;
	stored: boolean;
	components: Array<{
		component: string;
		drawn: boolean;
		roles: Array<{
			role: string;
			tokenId: string;
			source: string;
			resolves: boolean;
			valid: boolean;
			value?: string | number;
		}>;
	}>;
}

/**
 * Format a specimen.get result: per component, each role that resolves (or is
 * mapped) with its token, where the mapping comes from and whether it draws.
 */
export function formatSpecimen(data: SpecimenData): string {
	const rows = data.components.flatMap((entry) =>
		entry.roles
			.filter((role) => role.resolves || role.source === 'map')
			.map((role) => [
				entry.component,
				role.role,
				role.tokenId,
				role.source,
				role.value === undefined ? chalk.dim('not on this node') : String(role.value),
				role.valid ? '✓' : chalk.yellow('✗'),
			]),
	);
	const drawn = data.components.filter((entry) => entry.drawn).map((entry) => entry.component);
	const lines = [
		rows.length > 0
			? formatTable(['component', 'role', 'token', 'from', 'value', 'draws'], rows)
			: chalk.dim('No component role resolves on this node'),
		'',
		chalk.dim(
			`${data.stored ? `map stored on ${data.rootId}` : `no map on ${data.rootId}: naming convention <component>.<role>`} · drawn on ${data.nodeId}: ${drawn.length > 0 ? drawn.join(', ') : 'none'}`,
		),
	];
	return lines.join('\n');
}

/**
 * Shape of a changes.impact result, as far as the terminal renderer needs it
 */
export interface ImpactData {
	nodeId: string;
	changes: Array<{ type: string; tokenId: string; value?: unknown; toAncestor?: string }>;
	nodes: Array<{
		id: string;
		type: string;
		parentId: string | null;
		via: string;
		through?: string;
		effect: string;
		tokens: Array<{
			tokenId: string;
			effect: string;
			direct: boolean;
			before: { state: string; resolvedValue?: string | number };
			after: { state: string; resolvedValue?: string | number };
			shieldedBy?: string;
			copySourceRemoved?: string;
		}>;
		violations: {
			introduced: Array<{ tokenId: string; constraintName: string }>;
			resolved: Array<{ tokenId: string; constraintName: string }>;
		};
		error?: string;
	}>;
	apply: Array<{ cli: string }>;
	summary: {
		effects: Record<string, number>;
		violationsIntroduced: number;
		violationsResolved: number;
		violationsChecked: boolean;
	};
}

/** Effect markers: a symbol and a word, so the output never relies on colour alone */
const IMPACT_MARKERS: Record<string, (text: string) => string> = {
	changes: (text) => chalk.yellow(`● ${text}`),
	added: (text) => chalk.green(`+ ${text}`),
	removed: (text) => chalk.red(`✕ ${text}`),
	shielded: (text) => chalk.cyan(`◇ ${text}`),
	unaffected: (text) => chalk.dim(`· ${text}`),
	unresolved: (text) => chalk.red(`! ${text}`),
};

function describeChange(change: ImpactData['changes'][number]): string {
	switch (change.type) {
		case 'subtract':
			return `remove ${change.tokenId}`;
		case 'reset':
			return `reset ${change.tokenId} to ${change.toAncestor}`;
		default: {
			const value = typeof change.value === 'string' ? change.value : JSON.stringify(change.value);
			return `${change.type} ${change.tokenId} = ${value}`;
		}
	}
}

function impactValue(cell: { state: string; resolvedValue?: string | number }): string {
	switch (cell.state) {
		case 'subtracted':
			return '✕';
		case 'absent':
			return '–';
		case 'unresolved':
			return '!';
		default:
			return String(cell.resolvedValue ?? '');
	}
}

function describeImpactToken(token: ImpactData['nodes'][number]['tokens'][number]): string {
	const was = impactValue(token.before);
	const now = impactValue(token.after);
	const values = was === now ? was : `${was} → ${now}`;
	let note = token.effect;
	if (token.shieldedBy) note = `shielded by ${token.shieldedBy}`;
	if (token.copySourceRemoved) note += ` (copy source ${token.copySourceRemoved} lost it)`;
	return `${values}  ${(IMPACT_MARKERS[token.effect] ?? IMPACT_MARKERS.unaffected)(note)}`;
}

const IMPACT_VIA: Record<string, string> = {
	include: 'mixes in',
	copy: 'borrows from',
};

/**
 * One node of an impact preview: its label with the changed token inline when
 * there is a single change, then other tokens, then violations gained or lost.
 */
function describeImpactNode(node: ImpactData['nodes'][number], single: string | null): string[] {
	const via = IMPACT_VIA[node.via] ? chalk.dim(`  ⇠ ${IMPACT_VIA[node.via]} ${node.through}`) : '';
	const label = `${chalk.bold(node.id)} ${chalk.dim(`(${node.type})`)}${via}`;
	if (node.error) {
		return [`${label}  ${IMPACT_MARKERS.unresolved(node.error)}`];
	}
	const main = node.tokens.find((token) => token.tokenId === single);
	const lines = [main ? `${label}  ${describeImpactToken(main)}` : label];
	for (const token of node.tokens.filter((candidate) => candidate !== main)) {
		lines.push(`  ${token.tokenId}  ${describeImpactToken(token)}`);
	}
	for (const violation of node.violations.introduced) {
		lines.push(chalk.red(`  ⚠ new violation: ${violation.constraintName} (${violation.tokenId})`));
	}
	for (const violation of node.violations.resolved) {
		lines.push(chalk.green(`  ✓ resolves: ${violation.constraintName} (${violation.tokenId})`));
	}
	return lines;
}

/**
 * Format a changes.impact result as the affected part of the tree.
 *
 * Each node shows the changed token before → after and its effect; nodes the
 * change reaches through a mix-in or a borrow start their own branch. Then the
 * violations the change introduces or resolves, and the commands to apply it.
 */
export function formatImpact(data: ImpactData): string {
	const single = data.changes.length === 1 ? data.changes[0].tokenId : null;
	const byId = new Map(data.nodes.map((node) => [node.id, node]));
	const children = new Map<string, string[]>();
	const roots: string[] = [];
	for (const node of data.nodes) {
		if (node.parentId && byId.has(node.parentId)) {
			children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
		} else {
			roots.push(node.id);
		}
	}

	const describe = (node: ImpactData['nodes'][number]) => describeImpactNode(node, single);

	const lines: string[] = [
		chalk.bold(`What if ${data.nodeId}: ${data.changes.map(describeChange).join('; ')}`),
		'',
	];
	const visit = (id: string, prefix: string, connector: string, childPrefix: string) => {
		const node = byId.get(id);
		if (!node) return;
		const kids = children.get(id) ?? [];
		const [first, ...rest] = describe(node);
		lines.push(`${prefix}${connector}${first}`);
		for (const line of rest) {
			lines.push(`${prefix}${childPrefix}${kids.length > 0 ? '│ ' : '  '}${line}`);
		}
		kids.forEach((kid, index) => {
			const last = index === kids.length - 1;
			visit(kid, prefix + childPrefix, last ? '└─ ' : '├─ ', last ? '   ' : '│  ');
		});
	};
	for (const root of roots) {
		visit(root, '', '', '');
	}

	const { effects } = data.summary;
	const counts = ['changes', 'added', 'removed', 'shielded', 'unaffected', 'unresolved']
		.filter((effect) => (effects[effect] ?? 0) > 0)
		.map((effect) => `${effects[effect]} ${effect}`);
	const violations = data.summary.violationsChecked
		? ` · ${data.summary.violationsIntroduced} new violation(s), ${data.summary.violationsResolved} resolved`
		: '';
	lines.push('', `${data.nodes.length} node(s): ${counts.join(', ')}${violations}`);
	lines.push('', chalk.dim('Nothing was written. To apply:'));
	for (const step of data.apply) {
		lines.push(`  ${step.cli}`);
	}
	return lines.join('\n');
}
