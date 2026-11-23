/**
 * @fileoverview Async command loaders for the five `token-tree-editor` views (spec §7.3, §7.4).
 */
import type { AppContextV1 } from '@lushly-dev/loam-sdk';
import type {
	CompareRowDisplay,
	HistoryDisplay,
	InvalidDisplay,
	LeakedDisplay,
	MissingDisplay,
	NodeListRow,
	RefusedPreviewDisplay,
	TokenDisplayRow,
	TreeCompareRowDisplay,
	ViolationDisplay,
} from './editor-views.js';
import { formatTokenValue, formatTransition, toSwatch } from './format.js';

export async function fetchTokensView(
	context: AppContextV1,
	docId: string,
	node: string,
	filter: string
): Promise<{ tokens: TokenDisplayRow[]; summary: string; error?: string }> {
	if (!node) return { tokens: [], summary: '0 tokens' };
	const [resolved, nodeDetail] = await Promise.all([
		context.client.call<{
			tokens: Array<{ id: string; value: unknown; from: string }>;
			total: number;
		}>('violet-token-resolve', {
			document: docId,
			node,
			...(filter ? { filter } : {}),
		}),
		context.client.call<{ own: Array<{ token: string }> }>('violet-node-get', {
			document: docId,
			node,
		}),
	]);
	if (!resolved.success || !resolved.data) {
		return {
			tokens: [],
			summary: '0 tokens',
			error: resolved.error?.message ?? 'Could not resolve tokens',
		};
	}
	const ownSet = new Set((nodeDetail.data?.own ?? []).map((entry) => entry.token));
	return {
		tokens: resolved.data.tokens.map((token) => ({
			id: token.id,
			valueText: formatTokenValue(token.value),
			swatch: toSwatch(token.value),
			from: token.from,
			own: ownSet.has(token.id),
		})),
		summary: `${resolved.data.total} token${resolved.data.total === 1 ? '' : 's'}`,
	};
}

export async function fetchNodeCompare(
	context: AppContextV1,
	docId: string,
	nodes: readonly NodeListRow[],
	selectedCompareNodes: readonly string[]
): Promise<{ compareNodes: string[]; rows: CompareRowDisplay[]; summary: string; error?: string }> {
	const nodeIds = new Set(nodes.map((n) => n.id));
	const validSelected = selectedCompareNodes.filter((id) => nodeIds.has(id));
	const picked =
		validSelected.length >= 2
			? validSelected.slice(0, 4)
			: nodes
					.filter((n) => n.parent !== null)
					.slice(0, 4)
					.map((n) => n.id);
	const activeNodes = picked.length >= 2 ? picked : nodes.slice(0, 4).map((n) => n.id);
	if (activeNodes.length < 2) {
		return { compareNodes: activeNodes, rows: [], summary: '' };
	}
	const res = await context.client.call<{
		nodes: string[];
		rows: Array<{
			token: string;
			cells: Array<{ node: string; value: unknown; differs: boolean }>;
		}>;
		summary: { differing: number };
	}>('violet-token-compare', { document: docId, nodes: activeNodes });
	if (!res.success || !res.data) {
		return {
			compareNodes: activeNodes,
			rows: [],
			summary: '',
			error: res.error?.message ?? 'Could not compare nodes',
		};
	}
	return {
		compareNodes: activeNodes,
		rows: res.data.rows.map((row) => ({
			token: row.token,
			cells: row.cells.map((cell) => ({
				node: cell.node,
				valueText: formatTokenValue(cell.value),
				swatch: toSwatch(cell.value),
				differs: cell.differs,
			})),
		})),
		summary: `${res.data.summary.differing} differing`,
	};
}

export interface SelectOptionItem {
	id: string;
	label: string;
}

export async function fetchTreeCompare(
	context: AppContextV1,
	docId: string,
	selectedNode: string,
	otherDocument: string,
	otherNode: string
): Promise<{
	otherDocuments: SelectOptionItem[];
	otherNodes: SelectOptionItem[];
	otherDocument: string;
	otherNode: string;
	otherLabel: string;
	rows: TreeCompareRowDisplay[];
	summary: string;
	error?: string;
}> {
	const otherDocuments: SelectOptionItem[] = context.documents
		? (await context.documents.list({ type: 'violet-tree' }))
				.filter((d) => d.id !== docId)
				.map((d) => ({ id: d.id, label: d.title || d.id }))
		: [];
	const targetDoc =
		otherDocument &&
		(otherDocuments.length === 0 || otherDocuments.some((d) => d.id === otherDocument))
			? otherDocument
			: (otherDocuments[0]?.id ?? '');
	if (!targetDoc || !selectedNode) {
		return {
			otherDocuments,
			otherNodes: [],
			otherDocument: targetDoc,
			otherNode: '',
			otherLabel: '',
			rows: [],
			summary: 'No other tree in this scope',
		};
	}

	const nodeList = await context.client.call<{
		nodes: Array<{ id: string }>;
	}>('violet-node-list', { document: targetDoc });
	if (!nodeList.success || !nodeList.data) {
		return {
			otherDocuments,
			otherNodes: [],
			otherDocument: targetDoc,
			otherNode: '',
			otherLabel: targetDoc,
			rows: [],
			summary: '',
			error: nodeList.error?.message ?? 'Could not list nodes in the other tree',
		};
	}
	const otherNodes: SelectOptionItem[] = nodeList.data.nodes.map((n) => ({
		id: n.id,
		label: n.id,
	}));
	const targetNode =
		otherNode && otherNodes.some((n) => n.id === otherNode)
			? otherNode
			: otherNodes.some((n) => n.id === selectedNode)
				? selectedNode
				: (otherNodes[0]?.id ?? '');
	if (!targetNode) {
		return {
			otherDocuments,
			otherNodes,
			otherDocument: targetDoc,
			otherNode: '',
			otherLabel: targetDoc,
			rows: [],
			summary: 'Other tree has no nodes',
		};
	}
	const docTitle = otherDocuments.find((d) => d.id === targetDoc)?.label ?? targetDoc;
	const otherLabel = `${docTitle} · ${targetNode}`;
	const res = await context.client.call<{
		rows: Array<{ token: string; here: unknown; there: unknown }>;
		summary: { differing: number; onlyHere: number; onlyThere: number };
	}>('violet-tree-compare', {
		document: docId,
		node: selectedNode,
		other: { document: targetDoc, node: targetNode },
	});
	if (!res.success || !res.data) {
		return {
			otherDocuments,
			otherNodes,
			otherDocument: targetDoc,
			otherNode: targetNode,
			otherLabel,
			rows: [],
			summary: '',
			error: res.error?.message ?? 'Could not compare trees',
		};
	}
	const s = res.data.summary;
	return {
		otherDocuments,
		otherNodes,
		otherDocument: targetDoc,
		otherNode: targetNode,
		otherLabel,
		rows: res.data.rows.map((row) => ({
			token: row.token,
			hereText: formatTokenValue(row.here),
			hereSwatch: toSwatch(row.here),
			thereText: formatTokenValue(row.there),
			thereSwatch: toSwatch(row.there),
		})),
		summary: `${s.differing} differing, ${s.onlyHere} only here, ${s.onlyThere} only there`,
	};
}

export async function fetchPreviewView(
	context: AppContextV1,
	docId: string,
	selectedNode: string
): Promise<{
	count: number;
	properties: Array<{ name: string; value: string }>;
	refused: RefusedPreviewDisplay[];
	summary: string;
	error?: string;
}> {
	if (!selectedNode) return { count: 0, properties: [], refused: [], summary: '' };
	const res = await context.client.call<{
		node: string;
		count: number;
		properties: Array<{ name: string; value: string }>;
		refused: RefusedPreviewDisplay[];
	}>('violet-theme-preview', { document: docId, node: selectedNode });
	if (!res.success || !res.data) {
		return {
			count: 0,
			properties: [],
			refused: [],
			summary: '',
			error: res.error?.message ?? 'Could not preview theme',
		};
	}
	return {
		count: res.data.count,
		properties: res.data.properties,
		refused: res.data.refused,
		summary: `${res.data.count} properties applied to ${res.data.node}${
			res.data.refused.length > 0 ? `, ${res.data.refused.length} refused` : ''
		}`,
	};
}

export async function fetchChecksView(
	context: AppContextV1,
	docId: string
): Promise<{
	violations: ViolationDisplay[];
	missing: MissingDisplay[];
	invalid: InvalidDisplay[];
	leaked: LeakedDisplay[];
	healthy: boolean;
	summary: string;
	error?: string;
}> {
	const [violRes, ifaceRes] = await Promise.all([
		context.client.call<{
			violations: Array<{
				node: string;
				token: string;
				rule: string;
				severity: string;
				ratio?: number;
				min?: number;
			}>;
		}>('violet-violation-list', { document: docId }),
		context.client.call<{
			complete: boolean;
			missing: MissingDisplay[];
			invalid: InvalidDisplay[];
			leaked: LeakedDisplay[];
		}>('violet-interface-check', { document: docId }),
	]);
	const errors: string[] = [];
	if (!violRes.success || !violRes.data) {
		errors.push(violRes.error?.message ?? 'Could not run violation check');
	}
	if (!ifaceRes.success || !ifaceRes.data) {
		errors.push(ifaceRes.error?.message ?? 'Could not run interface check');
	}
	if (errors.length > 0) {
		return {
			violations: [],
			missing: [],
			invalid: [],
			leaked: [],
			healthy: false,
			summary: 'Checks unavailable',
			error: errors.join('; '),
		};
	}
	const violations = (violRes.data?.violations ?? []).map((v) => ({
		node: v.node,
		token: v.token,
		rule: v.rule,
		severity: v.severity,
		detail:
			v.ratio !== undefined && v.min !== undefined
				? `${v.rule}: ${v.ratio}:1 (min ${v.min}:1)`
				: `${v.rule} (${v.severity})`,
	}));
	const missing = ifaceRes.data?.missing ?? [];
	const invalid = ifaceRes.data?.invalid ?? [];
	const leaked = ifaceRes.data?.leaked ?? [];
	return {
		violations,
		missing,
		invalid,
		leaked,
		healthy:
			violations.length === 0 &&
			missing.length === 0 &&
			invalid.length === 0 &&
			leaked.length === 0 &&
			ifaceRes.data?.complete === true,
		summary: `${violations.length} violations, ${missing.length} unfilled, ${invalid.length} invalid, ${leaked.length} leaked`,
	};
}

export async function importTokenFiles(
	context: AppContextV1,
	docId: string,
	files: Array<{ name: string; content: string }>,
	replace: boolean,
	lastExportedRev: number | null
): Promise<{ ok: boolean; error?: string }> {
	const result = await context.client.call<{ nodes: unknown[]; rev: number }>(
		'violet-tree-import',
		{
			document: docId,
			content: { files },
			...(replace ? { replace: true } : {}),
			...(replace && lastExportedRev !== null ? { exportedRev: lastExportedRev } : {}),
		}
	);
	if (!result.success) {
		const msg = result.error?.message ?? 'Import failed';
		const hint = result.error?.suggestion ? ` — ${result.error.suggestion}` : '';
		return { ok: false, error: `${msg}${hint}` };
	}
	return { ok: true };
}

export async function exportTokenFiles(
	context: AppContextV1,
	docId: string
): Promise<{ rev?: number; count?: number; error?: string }> {
	const result = await context.client.call<{
		content: { files: Array<{ name: string; content: string }> };
		rev: number;
	}>('violet-tree-export', { document: docId });
	if (!result.success || !result.data) {
		return { error: result.error?.message ?? 'Export failed' };
	}
	for (const file of result.data.content.files) {
		const blob = new Blob([file.content], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = file.name;
		anchor.click();
		URL.revokeObjectURL(url);
	}
	return { rev: result.data.rev, count: result.data.content.files.length };
}

export async function fetchHistoryView(
	context: AppContextV1,
	docId: string
): Promise<{ rows: HistoryDisplay[]; error?: string }> {
	const res = await context.client.call<{
		changes: Array<{
			node: string;
			token: string | null;
			operation: string;
			oldValue: unknown;
			value: unknown;
			reason: string | null;
			actor: string;
			at: string;
		}>;
	}>('violet-change-list', { document: docId, limit: 50 });
	if (!res.success || !res.data) {
		return { rows: [], error: res.error?.message ?? 'Could not read history' };
	}
	return {
		rows: res.data.changes.map((c) => ({
			at: c.at,
			actor: c.actor,
			node: c.node,
			token: c.token ?? '',
			operation: c.operation,
			transition: formatTransition(c.oldValue, c.value),
			reason: c.reason ?? '—',
		})),
	};
}
